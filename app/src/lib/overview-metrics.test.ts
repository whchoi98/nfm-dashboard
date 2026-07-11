// TDD for the /api/overview cross-monitor KPI reducers (§15.4 semantics
// applied fleet-wide): per-bucket combination across monitors, half-window
// deltaPct, RTT percentiles and worst-latest NHI.
import { describe, it, expect } from 'vitest';
import type { NfmSeries } from './cw-metrics';
import type { FlowEdge } from './types';
import {
  buildOverviewKpis,
  combineAcrossMonitors,
  errorRateSeries,
  halfWindowDeltaPct,
} from './overview-metrics';

const T = ['2026-07-10T00:00:00.000Z', '2026-07-10T00:05:00.000Z', '2026-07-10T00:10:00.000Z',
  '2026-07-10T00:15:00.000Z'];

function series(metric: string, monitor: string, timestamps: string[], values: number[]): NfmSeries {
  return { metric, monitor, timestamps, values };
}

describe('combineAcrossMonitors', () => {
  it('sums values per bucket across monitors, sorted by time', () => {
    const metrics = {
      'DataTransferred:a': series('DataTransferred', 'a', [T[1], T[0]], [20, 10]),
      'DataTransferred:b': series('DataTransferred', 'b', [T[0], T[2]], [1, 3]),
      'Timeouts:a': series('Timeouts', 'a', [T[0]], [99]), // other metrics ignored
    };
    expect(combineAcrossMonitors(metrics, 'DataTransferred', 'sum')).toEqual([11, 20, 3]);
  });

  it('takes the per-bucket minimum when asked (RTT)', () => {
    const metrics = {
      'RoundTripTime:a': series('RoundTripTime', 'a', [T[0], T[1]], [500, 300]),
      'RoundTripTime:b': series('RoundTripTime', 'b', [T[0]], [200]),
    };
    expect(combineAcrossMonitors(metrics, 'RoundTripTime', 'min')).toEqual([200, 300]);
  });

  it('returns [] when the metric is absent', () => {
    expect(combineAcrossMonitors({}, 'DataTransferred', 'sum')).toEqual([]);
  });
});

describe('halfWindowDeltaPct', () => {
  it('compares the latest-half mean vs the prior-half mean as a percentage', () => {
    expect(halfWindowDeltaPct([1, 1, 3, 3])).toBe(200); // 3 vs 1 → +200%
    expect(halfWindowDeltaPct([4, 4, 2, 2])).toBe(-50); // 2 vs 4 → -50%
  });

  it('puts the middle bucket of an odd-length window in the latest half', () => {
    expect(halfWindowDeltaPct([1, 2, 3])).toBe(150); // prior [1], latest [2,3] → 2.5 vs 1
  });

  it('is null with fewer than 2 buckets or a zero prior-half mean', () => {
    expect(halfWindowDeltaPct([])).toBeNull();
    expect(halfWindowDeltaPct([5])).toBeNull();
    expect(halfWindowDeltaPct([0, 0, 7, 7])).toBeNull(); // no baseline to divide by
  });
});

describe('buildOverviewKpis', () => {
  const metrics: Record<string, NfmSeries> = {
    'DataTransferred:a': series('DataTransferred', 'a', T, [100, 100, 300, 300]),
    'DataTransferred:b': series('DataTransferred', 'b', T, [100, 100, 100, 100]),
    'Retransmissions:a': series('Retransmissions', 'a', [T[0], T[1]], [5, 7]),
    'Timeouts:b': series('Timeouts', 'b', [T[2]], [2]),
    'RoundTripTime:a': series('RoundTripTime', 'a', [T[0], T[1]], [900, 400]),
    'RoundTripTime:b': series('RoundTripTime', 'b', [T[0]], [700]),
    'HealthIndicator:a': series('HealthIndicator', 'a', [T[0], T[1]], [1, 0]),
    'HealthIndicator:b': series('HealthIndicator', 'b', [T[0], T[1]], [0, 1]),
  };

  it('applies §15.4 semantics fleet-wide: avg / sum / sum / min', () => {
    const r = buildOverviewKpis(metrics);
    // per-bucket sums: [200, 200, 400, 400] → avg 300
    expect(r.kpis.dataTransferred.value).toBe(300);
    expect(r.kpis.dataTransferred.spark).toEqual([200, 200, 400, 400]);
    expect(r.kpis.dataTransferred.deltaPct).toBe(100); // 400 vs 200
    expect(r.kpis.retransmissions.value).toBe(12);
    expect(r.kpis.retransmissions.spark).toEqual([5, 7]);
    expect(r.kpis.timeouts.value).toBe(2);
    // RTT: per-bucket min [700, 400] → value = min = 400
    expect(r.kpis.rtt.value).toBe(400);
    expect(r.kpis.rtt.spark).toEqual([700, 400]);
  });

  it('computes RTT percentiles over the pooled samples (nearest-rank)', () => {
    const r = buildOverviewKpis(metrics);
    expect(r.rttP50).toBe(700); // pooled sorted [400, 700, 900]
    expect(r.rttP95).toBe(900);
  });

  it('reports the worst (max) latest HealthIndicator across monitors', () => {
    expect(buildOverviewKpis(metrics).nhi).toBe(1); // a latest 0, b latest 1
  });

  it('degrades to nulls and empty sparks with no data', () => {
    const r = buildOverviewKpis({});
    for (const k of ['dataTransferred', 'retransmissions', 'timeouts', 'rtt'] as const) {
      expect(r.kpis[k]).toEqual({ value: null, deltaPct: null, spark: [] });
    }
    expect(r.rttP50).toBeNull();
    expect(r.rttP95).toBeNull();
    expect(r.nhi).toBeNull();
  });
});

describe('errorRateSeries', () => {
  it('errorRateSeries computes per-bucket retrans%/timeout% per GB, sorted by bucket', () => {
    const f = (bucket: string, metric: any, value: number): FlowEdge => ({ edgeHash: 'e', monitor: 'm',
      metric, category: 'INTRA_AZ', bucket, value, unit: 'x', a: {}, b: {}, traversedConstructs: [] });
    const flows = [
      f('2026-07-11T00:05:00Z', 'DATA_TRANSFERRED', 2e9), f('2026-07-11T00:05:00Z', 'RETRANSMISSIONS', 20),
      f('2026-07-11T00:00:00Z', 'DATA_TRANSFERRED', 1e9), f('2026-07-11T00:00:00Z', 'TIMEOUTS', 5),
    ];
    const s = errorRateSeries(flows);
    expect(s.map((p) => p.t)).toEqual(['2026-07-11T00:00:00Z', '2026-07-11T00:05:00Z']); // ascending
    expect(s[1].retransRate).toBeCloseTo(10, 6);   // 20 / 2GB
    expect(s[0].timeoutRate).toBeCloseTo(5, 6);    // 5 / 1GB
  });

  it('fills missing counters with 0 and guards zero-byte buckets (ratePerGb → 0)', () => {
    const f = (bucket: string, metric: FlowEdge['metric'], value: number): FlowEdge => ({
      edgeHash: 'e', monitor: 'm', metric, category: 'INTRA_AZ', bucket, value, unit: 'x',
      a: {}, b: {}, traversedConstructs: [] });
    // Bucket with bytes but no events → both rates 0; bucket with events but no bytes → guard to 0.
    const s = errorRateSeries([
      f('2026-07-11T00:00:00Z', 'DATA_TRANSFERRED', 1e9),
      f('2026-07-11T00:05:00Z', 'RETRANSMISSIONS', 8),
    ]);
    expect(s).toEqual([
      { t: '2026-07-11T00:00:00Z', retransRate: 0, timeoutRate: 0 },
      { t: '2026-07-11T00:05:00Z', retransRate: 0, timeoutRate: 0 },
    ]);
  });

  it('returns [] for no flows', () => {
    expect(errorRateSeries([])).toEqual([]);
  });
});
