// app/src/lib/analytics/network-analytics.test.ts
import { describe, it, expect } from 'vitest';
import { scopeKey, networkAnalyticsLens } from './network-analytics';
import type { FlowEdge, MetricName } from '../types';

function flow(over: Partial<FlowEdge> & { metric: MetricName; value: number }): FlowEdge {
  return {
    edgeHash: 'e1', monitor: 'mon-1', category: 'INTRA_AZ', bucket: 'b1', unit: 'Bytes',
    a: { podNamespace: 'shop', serviceName: 'api', subnetId: 'subnet-a', az: 'apne2-az1', vpcId: 'vpc-1' },
    b: { podNamespace: 'shop', serviceName: 'db', subnetId: 'subnet-b', az: 'apne2-az2', vpcId: 'vpc-2' },
    traversedConstructs: [],
    ...over,
  } as FlowEdge;
}

describe('scopeKey', () => {
  const f = flow({ metric: 'DATA_TRANSFERRED', value: 1 });
  it('keys service/namespace/az/vpc via entityKey semantics', () => {
    expect(scopeKey(f, 'a', 'service')).toBe('shop/api');
    expect(scopeKey(f, 'b', 'service')).toBe('shop/db');
    expect(scopeKey(f, 'a', 'namespace')).toBe('shop');
    expect(scopeKey(f, 'a', 'az')).toBe('apne2-az1');
    expect(scopeKey(f, 'b', 'az')).toBe('apne2-az2');
    expect(scopeKey(f, 'a', 'vpc')).toBe('vpc-1');
  });
  it('keys subnet by subnetId with unknown fallback', () => {
    expect(scopeKey(f, 'a', 'subnet')).toBe('subnet-a');
    expect(scopeKey(f, 'b', 'subnet')).toBe('subnet-b');
    const bare = flow({ metric: 'DATA_TRANSFERRED', value: 1, a: {}, b: {} });
    expect(scopeKey(bare, 'a', 'subnet')).toBe('unknown');
  });
  it('keys category and monitor at flow level regardless of endpoint', () => {
    expect(scopeKey(f, 'a', 'category')).toBe('INTRA_AZ');
    expect(scopeKey(f, 'b', 'category')).toBe('INTRA_AZ');
    expect(scopeKey(f, 'a', 'monitor')).toBe('mon-1');
    expect(scopeKey(f, 'b', 'monitor')).toBe('mon-1');
  });
});

describe('networkAnalyticsLens — pair aggregation', () => {
  const flows = [
    flow({ metric: 'DATA_TRANSFERRED', value: 1e9 }),
    flow({ metric: 'DATA_TRANSFERRED', value: 2e9 }),
    flow({ metric: 'RETRANSMISSIONS', value: 30 }),
    flow({ metric: 'ROUND_TRIP_TIME', value: 100 }),
    flow({ metric: 'ROUND_TRIP_TIME', value: 300 }),
  ];
  it('aggregates bytes/retransmissions/avg rtt per (source, dest) pair', () => {
    const res = networkAnalyticsLens(flows, { sourceScope: 'service', destScope: 'service' });
    expect(res.pairs).toHaveLength(1);
    const p = res.pairs[0];
    expect(p.source).toBe('shop/api');
    expect(p.dest).toBe('shop/db');
    expect(p.bytes).toBe(3e9);
    expect(p.retransmissions).toBe(30);
    expect(p.rtt).toBeCloseTo(200); // avg of 100, 300
  });
  it('separates pairs by scope keys and fills result totals', () => {
    const mixed = [
      ...flows,
      flow({ metric: 'DATA_TRANSFERRED', value: 5e9,
        a: { podNamespace: 'pay', serviceName: 'gw' }, b: { podNamespace: 'pay', serviceName: 'ledger' } }),
      flow({ metric: 'RETRANSMISSIONS', value: 7,
        a: { podNamespace: 'pay', serviceName: 'gw' }, b: { podNamespace: 'pay', serviceName: 'ledger' } }),
    ];
    const res = networkAnalyticsLens(mixed, { sourceScope: 'service', destScope: 'service' });
    expect(res.pairs).toHaveLength(2);
    expect(res.totalBytes).toBe(8e9);
    expect(res.totalRetrans).toBe(37);
    expect(res.sourceScope).toBe('service');
    expect(res.destScope).toBe('service');
    expect(res.metric).toBe('volume'); // default
  });
  it('retransRateOverall = fleet retransmissions per GB', () => {
    const flows = [
      flow({ metric: 'DATA_TRANSFERRED', value: 2e9 }),      // 2 GB
      flow({ metric: 'RETRANSMISSIONS', value: 20 }),
    ];
    const r = networkAnalyticsLens(flows, { sourceScope: 'service', destScope: 'service' });
    expect(r.totalRetrans).toBe(20);
    expect(r.retransRateOverall).toBeCloseTo(10, 6);         // 20 / 2GB
  });
  it('supports asymmetric scopes (namespace source, az dest)', () => {
    const res = networkAnalyticsLens(flows, { sourceScope: 'namespace', destScope: 'az' });
    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0].source).toBe('shop');
    expect(res.pairs[0].dest).toBe('apne2-az2');
  });
});

describe('networkAnalyticsLens — retransRate + health', () => {
  const pairFlows = (retrans: number) => [
    flow({ metric: 'DATA_TRANSFERRED', value: 1e9 }),
    flow({ metric: 'RETRANSMISSIONS', value: retrans }),
  ];
  it('computes retransRate as events per GB (ratePerGb formula)', () => {
    const res = networkAnalyticsLens(pairFlows(30), { sourceScope: 'service', destScope: 'service' });
    expect(res.pairs[0].retransRate).toBeCloseTo(30); // 30 / (1e9/1e9)
  });
  it('retransRate is 0 (not Infinity) when bytes are 0', () => {
    const res = networkAnalyticsLens([flow({ metric: 'RETRANSMISSIONS', value: 5 })],
      { sourceScope: 'service', destScope: 'service' });
    expect(res.pairs[0].retransRate).toBe(0);
    expect(Number.isFinite(res.pairs[0].retransRate)).toBe(true);
  });
  it('health: danger at ≥ threshold, warn at ≥ half, ok below', () => {
    const at = (retrans: number) =>
      networkAnalyticsLens(pairFlows(retrans), { sourceScope: 'service', destScope: 'service' }).pairs[0].health;
    expect(at(10)).toBe('danger'); // ≥ 10 (default threshold)
    expect(at(30)).toBe('danger');
    expect(at(5)).toBe('warn'); // ≥ 5 (half)
    expect(at(7)).toBe('warn');
    expect(at(4)).toBe('ok');
    expect(at(0)).toBe('ok');
  });
  it('honors a custom retransThreshold', () => {
    const res = networkAnalyticsLens(pairFlows(30),
      { sourceScope: 'service', destScope: 'service', retransThreshold: 100 });
    expect(res.pairs[0].health).toBe('ok');
    const warn = networkAnalyticsLens(pairFlows(60),
      { sourceScope: 'service', destScope: 'service', retransThreshold: 100 });
    expect(warn.pairs[0].health).toBe('warn');
  });
});

describe('networkAnalyticsLens — throughput', () => {
  it('scales bytes by windowSeconds', () => {
    const res = networkAnalyticsLens([flow({ metric: 'DATA_TRANSFERRED', value: 3000 })],
      { sourceScope: 'service', destScope: 'service', windowSeconds: 300 });
    expect(res.pairs[0].throughput).toBe(10);
  });
  it('guards windowSeconds ≤ 0 or missing → throughput 0, never NaN/Infinity', () => {
    for (const windowSeconds of [undefined, 0, -5]) {
      const res = networkAnalyticsLens([flow({ metric: 'DATA_TRANSFERRED', value: 3000 })],
        { sourceScope: 'service', destScope: 'service', windowSeconds });
      expect(res.pairs[0].throughput).toBe(0);
      expect(Number.isFinite(res.pairs[0].throughput)).toBe(true);
    }
  });
});

describe('networkAnalyticsLens — rtt', () => {
  it('rtt is null when the pair has no ROUND_TRIP_TIME samples', () => {
    const res = networkAnalyticsLens([flow({ metric: 'DATA_TRANSFERRED', value: 1e9 })],
      { sourceScope: 'service', destScope: 'service' });
    expect(res.pairs[0].rtt).toBeNull();
  });
});

describe('networkAnalyticsLens — spark', () => {
  const bucketed = [
    flow({ metric: 'DATA_TRANSFERRED', value: 100, bucket: 'b1' }),
    flow({ metric: 'DATA_TRANSFERRED', value: 200, bucket: 'b2' }),
    flow({ metric: 'DATA_TRANSFERRED', value: 300, bucket: 'b2' }),
    flow({ metric: 'RETRANSMISSIONS', value: 4, bucket: 'b1' }),
    flow({ metric: 'ROUND_TRIP_TIME', value: 100, bucket: 'b3' }),
    flow({ metric: 'ROUND_TRIP_TIME', value: 200, bucket: 'b3' }),
  ];
  it('bucketizes the selected metric in the given bucket order (volume)', () => {
    const res = networkAnalyticsLens(bucketed, { sourceScope: 'service', destScope: 'service',
      metric: 'volume', buckets: ['b3', 'b2', 'b1'] });
    expect(res.pairs[0].spark).toEqual([0, 500, 100]);
  });
  it('sparks the retransmits metric per bucket', () => {
    const res = networkAnalyticsLens(bucketed, { sourceScope: 'service', destScope: 'service',
      metric: 'retransmits', buckets: ['b1', 'b2', 'b3'] });
    expect(res.pairs[0].spark).toEqual([4, 0, 0]);
  });
  it('sparks rtt as per-bucket average (0 when a bucket has no sample)', () => {
    const res = networkAnalyticsLens(bucketed, { sourceScope: 'service', destScope: 'service',
      metric: 'rtt', buckets: ['b1', 'b2', 'b3'] });
    expect(res.pairs[0].spark).toEqual([0, 0, 150]);
  });
  it('spark is [] when no buckets are provided', () => {
    const res = networkAnalyticsLens(bucketed, { sourceScope: 'service', destScope: 'service', metric: 'volume' });
    expect(res.pairs[0].spark).toEqual([]);
  });
});

describe('networkAnalyticsLens — ranking + topN', () => {
  const abFlows = [
    // pair A: big bytes, few retrans, no rtt
    flow({ metric: 'DATA_TRANSFERRED', value: 9e9,
      a: { serviceName: 'a1', podNamespace: 'ns' }, b: { serviceName: 'a2', podNamespace: 'ns' } }),
    flow({ metric: 'RETRANSMISSIONS', value: 1,
      a: { serviceName: 'a1', podNamespace: 'ns' }, b: { serviceName: 'a2', podNamespace: 'ns' } }),
    // pair B: small bytes, many retrans, high rtt
    flow({ metric: 'DATA_TRANSFERRED', value: 1e9,
      a: { serviceName: 'b1', podNamespace: 'ns' }, b: { serviceName: 'b2', podNamespace: 'ns' } }),
    flow({ metric: 'RETRANSMISSIONS', value: 50,
      a: { serviceName: 'b1', podNamespace: 'ns' }, b: { serviceName: 'b2', podNamespace: 'ns' } }),
    flow({ metric: 'ROUND_TRIP_TIME', value: 500,
      a: { serviceName: 'b1', podNamespace: 'ns' }, b: { serviceName: 'b2', podNamespace: 'ns' } }),
  ];
  const opts = { sourceScope: 'service' as const, destScope: 'service' as const, windowSeconds: 600 };
  it('ranks by bytes for volume', () => {
    const res = networkAnalyticsLens(abFlows, { ...opts, metric: 'volume' });
    expect(res.pairs.map((p) => p.source)).toEqual(['ns/a1', 'ns/b1']);
  });
  it('ranks by throughput for throughput', () => {
    const res = networkAnalyticsLens(abFlows, { ...opts, metric: 'throughput' });
    expect(res.pairs.map((p) => p.source)).toEqual(['ns/a1', 'ns/b1']);
  });
  it('ranks by retransmissions for retransmits', () => {
    const res = networkAnalyticsLens(abFlows, { ...opts, metric: 'retransmits' });
    expect(res.pairs.map((p) => p.source)).toEqual(['ns/b1', 'ns/a1']);
  });
  it('ranks by rtt for rtt, null rtt last', () => {
    const res = networkAnalyticsLens(abFlows, { ...opts, metric: 'rtt' });
    expect(res.pairs.map((p) => p.source)).toEqual(['ns/b1', 'ns/a1']);
    expect(res.pairs[1].rtt).toBeNull();
  });
  it('caps at topN but totals still cover all flows', () => {
    const res = networkAnalyticsLens(abFlows, { ...opts, metric: 'volume', topN: 1 });
    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0].source).toBe('ns/a1');
    expect(res.totalBytes).toBe(10e9);
    expect(res.totalRetrans).toBe(51);
  });
  it('defaults topN to 50', () => {
    const many: FlowEdge[] = Array.from({ length: 60 }, (_, i) =>
      flow({ metric: 'DATA_TRANSFERRED', value: (i + 1) * 10,
        a: { serviceName: `s${i}`, podNamespace: 'ns' }, b: { serviceName: 'dst', podNamespace: 'ns' } }));
    const res = networkAnalyticsLens(many, { sourceScope: 'service', destScope: 'service' });
    expect(res.pairs).toHaveLength(50);
    expect(res.pairs[0].bytes).toBe(600); // highest kept
  });
});

describe('networkAnalyticsLens — empty input', () => {
  it('returns empty pairs and zero totals with no NaN/Infinity', () => {
    const res = networkAnalyticsLens([], { sourceScope: 'service', destScope: 'service' });
    expect(res.pairs).toEqual([]);
    expect(res.totalBytes).toBe(0);
    expect(res.totalRetrans).toBe(0);
    expect(Number.isFinite(res.totalBytes)).toBe(true);
    expect(Number.isFinite(res.totalRetrans)).toBe(true);
  });
});
