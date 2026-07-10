// Pure aggregation helpers for the per-monitor pages (/api/monitors and
// /api/monitors/[name]). They reduce a getNfmMetrics() result — keyed
// "<MetricName>:<monitorName>" — following the AWS NFM traffic-summary
// semantics: DataTransferred avg, Retransmissions/Timeouts sum,
// RoundTripTime min (+ nearest-rank p50/p95).
import type { NfmSeries } from './cw-metrics';
import { percentile } from './analytics/aggregate';

export interface MonitorListItem {
  name: string;
  cluster?: string;
  nhi: number | null;
  dataTransferred: number;
  spark: number[];
}

export interface MonitorTraffic {
  dataTransferredAvg: number;
  retransmissionsSum: number;
  timeoutsSum: number;
  rttMin: number | null;
  rttP50: number | null;
  rttP95: number | null;
}

export interface SeriesPoints {
  label: string;
  points: { t: string; v: number }[];
}

export interface MonitorDetail {
  name: string;
  nhi: number | null;
  traffic: MonitorTraffic;
  nhiTimeline: SeriesPoints;
  dataSeries: SeriesPoints;
  monitorArn?: string;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length === 0 ? 0 : sum(xs) / xs.length);

/** Latest (most recent) value of a series, or null when absent/empty. */
function latestValue(s?: NfmSeries): number | null {
  if (!s || s.values.length === 0) return null;
  return s.values[s.values.length - 1];
}

function toPoints(s?: NfmSeries): { t: string; v: number }[] {
  return (s?.timestamps ?? []).map((t, i) => ({ t, v: s!.values[i] }));
}

/** `MONITORS` env ("name=cluster,name2=cluster2") → name→cluster map. */
export function parseMonitorsEnv(env?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (env ?? '').split(',')) {
    const [name, cluster] = part.split('=').map((x) => x.trim());
    if (name && cluster) out[name] = cluster;
  }
  return out;
}

/** /api/monitors payload: one row per monitor, sorted by dataTransferred desc. */
export function buildMonitorList(
  metrics: Record<string, NfmSeries>,
  clusters: Record<string, string> = {},
): MonitorListItem[] {
  const names = [...new Set(Object.values(metrics).map((s) => s.monitor))];
  return names
    .map((name) => {
      const data = metrics[`DataTransferred:${name}`];
      const item: MonitorListItem = {
        name,
        nhi: latestValue(metrics[`HealthIndicator:${name}`]),
        dataTransferred: sum(data?.values ?? []),
        spark: data?.values ?? [],
      };
      if (clusters[name]) item.cluster = clusters[name];
      return item;
    })
    .sort((a, b) => b.dataTransferred - a.dataTransferred);
}

/** Traffic-summary reducer: avg / sum / sum / min (+ p50/p95); RTT null without samples. */
export function trafficSummary(metrics: Record<string, NfmSeries>, name: string): MonitorTraffic {
  const rtt = [...(metrics[`RoundTripTime:${name}`]?.values ?? [])].sort((a, b) => a - b);
  return {
    dataTransferredAvg: mean(metrics[`DataTransferred:${name}`]?.values ?? []),
    retransmissionsSum: sum(metrics[`Retransmissions:${name}`]?.values ?? []),
    timeoutsSum: sum(metrics[`Timeouts:${name}`]?.values ?? []),
    rttMin: rtt.length ? rtt[0] : null,
    rttP50: rtt.length ? percentile(rtt, 50) : null,
    rttP95: rtt.length ? percentile(rtt, 95) : null,
  };
}

/** /api/monitors/[name] payload; null when the monitor has no metrics at all. */
export function buildMonitorDetail(
  metrics: Record<string, NfmSeries>,
  name: string,
): MonitorDetail | null {
  const mine = Object.values(metrics).filter((s) => s.monitor === name);
  if (mine.length === 0) return null;
  const arn = mine.find((s) => s.monitorArn)?.monitorArn;
  const detail: MonitorDetail = {
    name,
    nhi: latestValue(metrics[`HealthIndicator:${name}`]),
    traffic: trafficSummary(metrics, name),
    nhiTimeline: { label: 'HealthIndicator', points: toPoints(metrics[`HealthIndicator:${name}`]) },
    dataSeries: { label: 'DataTransferred', points: toPoints(metrics[`DataTransferred:${name}`]) },
  };
  if (arn) detail.monitorArn = arn;
  return detail;
}
