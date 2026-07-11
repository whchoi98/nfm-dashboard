import { describe, it, expect } from 'vitest';
import { efficiencyLens } from './efficiency';
import type { FlowEdge } from '../types';

// 30 days in seconds — the run-rate scaling constant (spec Task 1).
const MONTH_SECONDS = 2_592_000;

function flow(over: Partial<FlowEdge>): FlowEdge {
  return {
    edgeHash: 'h', monitor: 'm', metric: 'DATA_TRANSFERRED', category: 'INTRA_AZ',
    bucket: 'b1', value: 0, unit: 'Bytes', a: {}, b: {}, traversedConstructs: [],
    ...over,
  } as FlowEdge;
}

describe('efficiencyLens', () => {
  it('splits billed (INTER_AZ/VPC/REGION) vs free bytes and prices per category', () => {
    const flows = [
      flow({ category: 'INTER_AZ', value: 2e9, a: { podNamespace: 'ns', serviceName: 'svc-a' }, b: { podNamespace: 'ns', serviceName: 'svc-b' } }),
      flow({ category: 'INTER_VPC', value: 1e9 }),
      flow({ category: 'INTER_REGION', value: 1e9 }),
      flow({ category: 'INTRA_AZ', value: 5e9 }),
      flow({ category: 'AMAZON_S3', value: 3e9 }),
    ];
    const r = efficiencyLens(flows, { windowSeconds: 3600 });
    expect(r.totalBytes).toBe(12e9);
    expect(r.billedBytes).toBe(4e9);
    expect(r.freeBytes).toBe(8e9);
    expect(r.billedRatio).toBeCloseTo(4 / 12);
    // byCategory carries bytes + usd for every category ($0.01/GB billed, $0 free).
    expect(r.byCategory.INTER_AZ).toEqual({ bytes: 2e9, usd: expect.closeTo(0.02) });
    expect(r.byCategory.INTRA_AZ).toEqual({ bytes: 5e9, usd: 0 });
    expect(r.byCategory.AMAZON_S3.usd).toBe(0);
    expect(r.byCategory.UNCLASSIFIED).toEqual({ bytes: 0, usd: 0 });
    expect(r.windowUsd).toBeCloseTo(0.04); // 4 GB billed × $0.01
  });

  it('ignores non-DATA_TRANSFERRED flows', () => {
    const flows = [
      flow({ metric: 'RETRANSMISSIONS', category: 'INTER_AZ', value: 1e9 }),
      flow({ metric: 'ROUND_TRIP_TIME', category: 'INTER_AZ', value: 50 }),
      flow({ category: 'INTER_AZ', value: 1e9 }),
    ];
    const r = efficiencyLens(flows, { windowSeconds: 3600 });
    expect(r.totalBytes).toBe(1e9);
    expect(r.billedBytes).toBe(1e9);
  });

  it('scales windowUsd to a 30-day run-rate by 2592000/windowSeconds', () => {
    const flows = [flow({ category: 'INTER_AZ', value: 1e9 })]; // $0.01 in the window
    const r = efficiencyLens(flows, { windowSeconds: 3600 });
    expect(r.monthlyUsdRunRate).toBeCloseTo(0.01 * (MONTH_SECONDS / 3600)); // ×720
    const r2 = efficiencyLens(flows, { windowSeconds: 86400 });
    expect(r2.monthlyUsdRunRate).toBeCloseTo(0.01 * 30);
  });

  it('defaults windowSeconds to 3600 (12 buckets × 300s) and guards invalid values', () => {
    const flows = [flow({ category: 'INTER_AZ', value: 1e9 })];
    expect(efficiencyLens(flows).monthlyUsdRunRate).toBeCloseTo(7.2);
    expect(efficiencyLens(flows, { windowSeconds: 0 }).monthlyUsdRunRate).toBeCloseTo(7.2);
    expect(efficiencyLens(flows, { windowSeconds: NaN }).monthlyUsdRunRate).toBeCloseTo(7.2);
  });

  it('topCrossAz keeps only billed contributors, sorted desc by usd, capped at 8', () => {
    const flows = [
      // Free traffic must never appear even though it is the biggest flow.
      flow({ category: 'INTRA_AZ', value: 9e9, a: { serviceName: 'free' }, b: { serviceName: 'free2' } }),
      ...Array.from({ length: 10 }, (_, i) =>
        flow({
          category: 'INTER_AZ', value: (i + 1) * 1e9,
          a: { podNamespace: 'ns', serviceName: `svc-${i}` },
          b: { podNamespace: 'ns', serviceName: 'hub' },
        })),
    ];
    const r = efficiencyLens(flows, { windowSeconds: 3600 });
    expect(r.topCrossAz).toHaveLength(8);
    expect(r.topCrossAz[0].usd).toBeCloseTo(0.1); // 10 GB pair
    const usds = r.topCrossAz.map((x) => x.usd);
    expect([...usds].sort((a, b) => b - a)).toEqual(usds);
    expect(r.topCrossAz.every((x) => x.usd > 0)).toBe(true);
    expect(r.topCrossAz.some((x) => x.label.includes('free'))).toBe(false);
  });

  it('trend is billed USD per bucket, sorted by bucket, 0 for free-only buckets', () => {
    const flows = [
      flow({ category: 'INTER_AZ', value: 2e9, bucket: 'b2' }),
      flow({ category: 'INTRA_AZ', value: 5e9, bucket: 'b1' }),
      flow({ category: 'INTER_VPC', value: 1e9, bucket: 'b2' }),
    ];
    const r = efficiencyLens(flows, { windowSeconds: 3600 });
    expect(r.trend.points).toEqual([
      { t: 'b1', v: 0 },
      { t: 'b2', v: expect.closeTo(0.03) },
    ]);
  });

  it('empty flows → all zeros, empty trend/toplist, no NaN/Infinity', () => {
    const r = efficiencyLens([], { windowSeconds: 3600 });
    expect(r.totalBytes).toBe(0);
    expect(r.billedBytes).toBe(0);
    expect(r.freeBytes).toBe(0);
    expect(r.billedRatio).toBe(0);
    expect(r.windowUsd).toBe(0);
    expect(r.monthlyUsdRunRate).toBe(0);
    expect(r.topCrossAz).toEqual([]);
    expect(r.trend.points).toEqual([]);
    for (const v of [r.billedRatio, r.monthlyUsdRunRate, r.windowUsd]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    for (const { bytes, usd } of Object.values(r.byCategory)) {
      expect(bytes).toBe(0);
      expect(usd).toBe(0);
    }
  });
});
