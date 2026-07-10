// Pure reducers for /api/overview. They apply the AWS NFM traffic-summary
// semantics (§15.4: DataTransferred avg, Retransmissions/Timeouts sum,
// RoundTripTime min + nearest-rank p50/p95) fleet-wide over a getNfmMetrics()
// result keyed "<MetricName>:<monitorName>": each metric's series are first
// combined across monitors into one per-bucket array (the StatDelta sparkline),
// then reduced to the KPI value; deltaPct compares the window's halves.
import type { NfmSeries } from './cw-metrics';
import { percentile } from './analytics/aggregate';

export type OverviewKpiKey = 'dataTransferred' | 'retransmissions' | 'timeouts' | 'rtt';
export interface OverviewKpi {
  value: number | null;
  deltaPct: number | null;
  spark: number[];
}
export interface OverviewKpis {
  kpis: Record<OverviewKpiKey, OverviewKpi>;
  rttP50: number | null;
  rttP95: number | null;
  nhi: number | null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length === 0 ? 0 : sum(xs) / xs.length);

/**
 * One value per time bucket for `metric`, combined across ALL monitors and
 * sorted by timestamp asc. Counters (bytes/retrans/timeouts) combine with
 * 'sum' (fleet total per bucket); RTT combines with 'min' (§15.4 best-case).
 */
export function combineAcrossMonitors(
  metrics: Record<string, NfmSeries>,
  metric: string,
  combine: 'sum' | 'min',
): number[] {
  const byBucket = new Map<string, number>();
  for (const s of Object.values(metrics)) {
    if (s.metric !== metric) continue;
    s.timestamps.forEach((t, i) => {
      const v = s.values[i];
      const prev = byBucket.get(t);
      byBucket.set(t, prev == null ? v : combine === 'sum' ? prev + v : Math.min(prev, v));
    });
  }
  return [...byBucket.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
}

/**
 * Latest-half mean vs prior-half mean of the combined window, as a signed %
 * (odd lengths put the middle bucket in the latest half). null when there are
 * fewer than 2 buckets or the prior-half mean is 0 (no baseline to divide by).
 */
export function halfWindowDeltaPct(values: number[]): number | null {
  const mid = Math.floor(values.length / 2);
  if (mid === 0) return null;
  const prior = mean(values.slice(0, mid));
  if (prior === 0) return null;
  return ((mean(values.slice(mid)) - prior) / prior) * 100;
}

function kpiOf(spark: number[], reduce: (xs: number[]) => number): OverviewKpi {
  return {
    value: spark.length ? reduce(spark) : null,
    deltaPct: halfWindowDeltaPct(spark),
    spark,
  };
}

/** /api/overview KPI block: 4 KPIs + pooled RTT percentiles + worst-latest NHI. */
export function buildOverviewKpis(metrics: Record<string, NfmSeries>): OverviewKpis {
  // Percentiles pool every raw RTT sample (per monitor+bucket), matching the
  // per-monitor trafficSummary(); the KPI value/spark use per-bucket minima.
  const rttPool = Object.values(metrics)
    .filter((s) => s.metric === 'RoundTripTime')
    .flatMap((s) => s.values)
    .sort((a, b) => a - b);
  // Network Health Indicator: worst (max) latest value across monitors (0 = healthy).
  const nhiLatest = Object.values(metrics)
    .filter((s) => s.metric === 'HealthIndicator' && s.values.length > 0)
    .map((s) => s.values[s.values.length - 1]);
  return {
    kpis: {
      dataTransferred: kpiOf(combineAcrossMonitors(metrics, 'DataTransferred', 'sum'), mean),
      retransmissions: kpiOf(combineAcrossMonitors(metrics, 'Retransmissions', 'sum'), sum),
      timeouts: kpiOf(combineAcrossMonitors(metrics, 'Timeouts', 'sum'), sum),
      rtt: kpiOf(combineAcrossMonitors(metrics, 'RoundTripTime', 'min'), (xs) => Math.min(...xs)),
    },
    rttP50: rttPool.length ? percentile(rttPool, 50) : null,
    rttP95: rttPool.length ? percentile(rttPool, 95) : null,
    nhi: nhiLatest.length ? Math.max(...nhiLatest) : null,
  };
}
