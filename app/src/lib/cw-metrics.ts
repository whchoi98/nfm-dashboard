import { CloudWatchClient, ListMetricsCommand, GetMetricDataCommand,
  type Metric, type Dimension } from '@aws-sdk/client-cloudwatch';
import type { Series } from './analytics/aggregate';

const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';
const NAMESPACE = 'AWS/NetworkFlowMonitor';

let client: CloudWatchClient | undefined;
function cw(): CloudWatchClient {
  return (client ??= new CloudWatchClient({ region: REGION }));
}

export interface NfmSeries { metric: string; monitor: string; monitorArn?: string;
  timestamps: string[]; values: number[]; }

/**
 * CW HealthIndicator series (keys "HealthIndicator:<monitor>") → per-monitor
 * Series lanes (0 = healthy / > 0 = degraded, stat Maximum). Same mapping as the
 * reliability route's buildReliabilityCw, minus the worst-case aggregate the
 * scorecard lens derives itself (breachTimeline). Shared by the scorecard and
 * overview routes.
 */
export function healthByMonitor(cwSeries: Record<string, NfmSeries>): Record<string, Series> {
  const byMonitor: Record<string, Series> = {};
  for (const [key, s] of Object.entries(cwSeries)) {
    if (!key.startsWith('HealthIndicator:')) continue;
    const monitor = s.monitor || key.slice('HealthIndicator:'.length);
    byMonitor[monitor] = {
      label: monitor,
      points: s.timestamps.map((t, i) => ({ t, v: s.values[i] ?? 0 })),
    };
  }
  return byMonitor;
}

// NFM publishes metrics with dimension MonitorId whose value is the monitor ARN
// (arn:...:monitor/<name>) — NOT MonitorName. Dimensions are therefore discovered via
// ListMetrics and passed to GetMetricData verbatim rather than assumed.
function monitorOf(dims: Dimension[] | undefined): { name: string; arn?: string } {
  const monId = dims?.find(d => d.Name === 'MonitorId')?.Value;
  if (monId) return { name: monId.split('/').pop() ?? monId, arn: monId };
  const first = dims?.[0]?.Value;
  return { name: first ?? 'unknown' };
}

function statFor(metricName: string): string {
  if (metricName === 'RoundTripTime') return 'Average';
  if (metricName === 'HealthIndicator') return 'Maximum';
  return 'Sum'; // DataTransferred / Retransmissions / Timeouts
}

async function listNfmMetrics(): Promise<Metric[]> {
  const metrics: Metric[] = [];
  let nextToken: string | undefined;
  do {
    const res = await cw().send(new ListMetricsCommand({ Namespace: NAMESPACE, NextToken: nextToken }));
    metrics.push(...(res.Metrics ?? []));
    nextToken = res.NextToken;
  } while (nextToken);
  return metrics;
}

/** Distinct NFM monitor names discovered from CloudWatch metric dimensions. */
export async function listMonitorNames(): Promise<string[]> {
  const metrics = await listNfmMetrics();
  const names = new Set<string>();
  for (const m of metrics) {
    const { name, arn } = monitorOf(m.Dimensions);
    if (arn) names.add(name);
  }
  return [...names];
}

/**
 * Time series for every AWS/NetworkFlowMonitor metric over the last `minutes`,
 * keyed by `<MetricName>:<monitorName>`. Returns {} when no metrics exist.
 */
export async function getNfmMetrics(minutes = 60): Promise<Record<string, NfmSeries>> {
  const metrics = await listNfmMetrics();
  if (metrics.length === 0) return {};
  const end = new Date();
  const start = new Date(end.getTime() - minutes * 60000);
  const out: Record<string, NfmSeries> = {};
  for (let i = 0; i < metrics.length; i += 500) { // GetMetricData caps at 500 queries/call
    const chunk = metrics.slice(i, i + 500);
    const queries = chunk.map((m, j) => ({ Id: `m${i + j}`, MetricStat: {
      Metric: { Namespace: NAMESPACE, MetricName: m.MetricName, Dimensions: m.Dimensions },
      Period: 300, Stat: statFor(m.MetricName ?? '') } }));
    let nextToken: string | undefined;
    do {
      const res = await cw().send(new GetMetricDataCommand({ StartTime: start, EndTime: end,
        MetricDataQueries: queries, ScanBy: 'TimestampAscending', NextToken: nextToken }));
      for (const r of res.MetricDataResults ?? []) {
        const idx = Number((r.Id ?? '').slice(1));
        const m = metrics[idx];
        if (!m || !r.Id?.startsWith('m') || Number.isNaN(idx)) continue;
        const { name, arn } = monitorOf(m.Dimensions);
        const key = `${m.MetricName}:${name}`;
        const s = (out[key] ??= { metric: m.MetricName ?? '', monitor: name, monitorArn: arn,
          timestamps: [], values: [] });
        s.timestamps.push(...(r.Timestamps ?? []).map(t => new Date(t).toISOString()));
        s.values.push(...(r.Values ?? []));
      }
      nextToken = res.NextToken;
    } while (nextToken);
  }
  return out;
}
