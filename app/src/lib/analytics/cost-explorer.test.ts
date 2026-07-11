import { describe, it, expect } from 'vitest';
import { costExplorerLens, deriveCluster } from './cost-explorer';
import type { FlowEdge } from '../types';

// 30 days in seconds — the run-rate scaling constant (Phase 8 Task 4).
const MONTH_SECONDS = 2_592_000;

function flow(over: Partial<FlowEdge>): FlowEdge {
  return {
    edgeHash: 'h', monitor: 'nfm-eks-demo', metric: 'DATA_TRANSFERRED', category: 'INTRA_AZ',
    bucket: 'b1', value: 0, unit: 'Bytes', a: {}, b: {}, traversedConstructs: [],
    ...over,
  } as FlowEdge;
}

describe('deriveCluster', () => {
  it('maps nfm-eks-<cluster> to <cluster> and nfm-vpc-* to vpc', () => {
    expect(deriveCluster('nfm-eks-demo')).toBe('demo');
    expect(deriveCluster('nfm-eks-prod-a')).toBe('prod-a');
    expect(deriveCluster('nfm-vpc-all')).toBe('vpc');
  });

  it('falls back to the monitor name for unknown shapes', () => {
    expect(deriveCluster('custom-monitor')).toBe('custom-monitor');
  });
});

describe('costExplorerLens', () => {
  it('groups bytes and billed usd by cluster/monitor via the default deriver', () => {
    const flows = [
      flow({ monitor: 'nfm-eks-demo', category: 'INTER_AZ', value: 2e9 }),
      flow({ monitor: 'nfm-eks-demo', category: 'INTRA_AZ', value: 5e9 }),
      flow({ monitor: 'nfm-vpc-all', category: 'INTER_VPC', value: 1e9 }),
    ];
    const r = costExplorerLens(flows, { windowSeconds: 3600 });
    expect(r.byCluster).toEqual([
      { label: 'demo', bytes: 7e9, usd: expect.closeTo(0.02) },
      { label: 'vpc', bytes: 1e9, usd: expect.closeTo(0.01) },
    ]);
    expect(r.byMonitor).toEqual([
      { label: 'nfm-eks-demo', bytes: 7e9, usd: expect.closeTo(0.02) },
      { label: 'nfm-vpc-all', bytes: 1e9, usd: expect.closeTo(0.01) },
    ]);
    expect(r.totalUsd).toBeCloseTo(0.03);
  });

  it('prefers a caller-provided clusterOf mapper over the default deriver', () => {
    const flows = [
      flow({ monitor: 'nfm-eks-demo', category: 'INTER_AZ', value: 1e9 }),
      flow({ monitor: 'nfm-vpc-all', category: 'INTER_AZ', value: 1e9 }),
    ];
    const r = costExplorerLens(flows, {
      windowSeconds: 3600,
      clusterOf: (m) => (m === 'nfm-eks-demo' ? 'mapped' : 'other'),
    });
    expect(r.byCluster.map((x) => x.label).sort()).toEqual(['mapped', 'other']);
  });

  it('groups by namespace from either endpoint, once per namespace, unknown fallback', () => {
    const flows = [
      // Same namespace on both ends → counted once for 'ns-a'.
      flow({ category: 'INTER_AZ', value: 2e9, a: { podNamespace: 'ns-a' }, b: { podNamespace: 'ns-a' } }),
      // Two namespaces → the flow belongs to both (applyFlowFilters semantics).
      flow({ category: 'INTER_AZ', value: 1e9, a: { podNamespace: 'ns-a' }, b: { podNamespace: 'ns-b' } }),
      // No namespace on either endpoint → 'unknown'.
      flow({ category: 'INTRA_AZ', value: 5e9 }),
    ];
    const r = costExplorerLens(flows, { windowSeconds: 3600 });
    expect(r.byNamespace).toEqual([
      { label: 'ns-a', bytes: 3e9, usd: expect.closeTo(0.03) },
      { label: 'ns-b', bytes: 1e9, usd: expect.closeTo(0.01) },
      { label: 'unknown', bytes: 5e9, usd: 0 },
    ]);
  });

  it('byCategory carries bytes+usd for every category and group arrays sort desc by usd', () => {
    const flows = [
      flow({ monitor: 'm-small', category: 'INTER_AZ', value: 1e9 }),
      flow({ monitor: 'm-big', category: 'INTER_REGION', value: 3e9 }),
      flow({ monitor: 'm-free', category: 'AMAZON_S3', value: 9e9 }),
    ];
    const r = costExplorerLens(flows, { windowSeconds: 3600 });
    expect(r.byCategory.INTER_AZ).toEqual({ bytes: 1e9, usd: expect.closeTo(0.01) });
    expect(r.byCategory.INTER_REGION).toEqual({ bytes: 3e9, usd: expect.closeTo(0.03) });
    expect(r.byCategory.AMAZON_S3).toEqual({ bytes: 9e9, usd: 0 });
    expect(r.byCategory.UNCLASSIFIED).toEqual({ bytes: 0, usd: 0 });
    // Desc by usd even though the free monitor moved the most bytes.
    expect(r.byMonitor.map((x) => x.label)).toEqual(['m-big', 'm-small', 'm-free']);
  });

  it('ignores non-DATA_TRANSFERRED flows entirely', () => {
    const flows = [
      flow({ metric: 'RETRANSMISSIONS', category: 'INTER_AZ', value: 1e9 }),
      flow({ metric: 'ROUND_TRIP_TIME', category: 'INTER_AZ', value: 50 }),
      flow({ category: 'INTER_AZ', value: 1e9 }),
    ];
    const r = costExplorerLens(flows, { windowSeconds: 3600 });
    expect(r.totalUsd).toBeCloseTo(0.01);
    expect(r.byMonitor).toHaveLength(1);
    expect(r.byMonitor[0].bytes).toBe(1e9);
  });

  it('scales totalUsd to a 30-day run-rate by 2592000/windowSeconds', () => {
    const flows = [flow({ category: 'INTER_AZ', value: 1e9 })]; // $0.01 in the window
    const r = costExplorerLens(flows, { windowSeconds: 3600 });
    expect(r.monthlyRunRate).toBeCloseTo(0.01 * (MONTH_SECONDS / 3600)); // ×720
    expect(costExplorerLens(flows, { windowSeconds: 86400 }).monthlyRunRate).toBeCloseTo(0.3);
  });

  it('defaults windowSeconds to 3600 (12 buckets × 300s) and guards invalid values', () => {
    const flows = [flow({ category: 'INTER_AZ', value: 1e9 })];
    expect(costExplorerLens(flows).monthlyRunRate).toBeCloseTo(7.2);
    expect(costExplorerLens(flows, { windowSeconds: 0 }).monthlyRunRate).toBeCloseTo(7.2);
    expect(costExplorerLens(flows, { windowSeconds: NaN }).monthlyRunRate).toBeCloseTo(7.2);
  });

  it('savings ranks billed contributors only, desc by usd, with the category hint key', () => {
    const flows = [
      // Free traffic must never appear even though it is the biggest flow.
      flow({ category: 'INTRA_AZ', value: 9e9, a: { serviceName: 'free-a' }, b: { serviceName: 'free-b' } }),
      flow({ category: 'INTER_AZ', value: 1e9, a: { podNamespace: 'ns', serviceName: 'az-a' }, b: { podNamespace: 'ns', serviceName: 'az-b' } }),
      flow({ category: 'INTER_VPC', value: 2e9, a: { serviceName: 'vpc-a' }, b: { serviceName: 'vpc-b' } }),
      flow({ category: 'INTER_REGION', value: 3e9, a: { serviceName: 'reg-a' }, b: { serviceName: 'reg-b' } }),
    ];
    const r = costExplorerLens(flows, { windowSeconds: 3600 });
    expect(r.savings.map((s) => s.hint)).toEqual([
      'costHint.region', 'costHint.vpcEndpoint', 'costHint.colocate',
    ]);
    const usds = r.savings.map((s) => s.usd);
    expect([...usds].sort((a, b) => b - a)).toEqual(usds);
    expect(usds[0]).toBeCloseTo(0.03);
    expect(r.savings.some((s) => s.label.includes('free'))).toBe(false);
  });

  it('savings caps at 8 rows', () => {
    const flows = Array.from({ length: 10 }, (_, i) =>
      flow({
        category: 'INTER_AZ', value: (i + 1) * 1e9,
        a: { podNamespace: 'ns', serviceName: `svc-${i}` },
        b: { podNamespace: 'ns', serviceName: 'hub' },
      }));
    expect(costExplorerLens(flows, { windowSeconds: 3600 }).savings).toHaveLength(8);
  });

  it('trend is billed USD per bucket, sorted by bucket, 0 for free-only buckets', () => {
    const flows = [
      flow({ category: 'INTER_AZ', value: 2e9, bucket: 'b2' }),
      flow({ category: 'INTRA_AZ', value: 5e9, bucket: 'b1' }),
      flow({ category: 'INTER_VPC', value: 1e9, bucket: 'b2' }),
    ];
    const r = costExplorerLens(flows, { windowSeconds: 3600 });
    expect(r.trend.points).toEqual([
      { t: 'b1', v: 0 },
      { t: 'b2', v: expect.closeTo(0.03) },
    ]);
  });

  it('empty flows → zeros, empty groups/savings/trend, no NaN/Infinity', () => {
    const r = costExplorerLens([], { windowSeconds: 3600 });
    expect(r.totalUsd).toBe(0);
    expect(r.monthlyRunRate).toBe(0);
    expect(r.byCluster).toEqual([]);
    expect(r.byNamespace).toEqual([]);
    expect(r.byMonitor).toEqual([]);
    expect(r.savings).toEqual([]);
    expect(r.trend.points).toEqual([]);
    for (const v of [r.totalUsd, r.monthlyRunRate]) expect(Number.isFinite(v)).toBe(true);
    for (const { bytes, usd } of Object.values(r.byCategory)) {
      expect(bytes).toBe(0);
      expect(usd).toBe(0);
    }
  });
});
