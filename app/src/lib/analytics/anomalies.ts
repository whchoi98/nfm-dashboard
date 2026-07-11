// Anomalies lens (Phase 8 Task 5). Pure functions, no I/O.
// Baseline-deviation detection per service entity across two adjacent flow
// windows (getFlowsWindowPair). Two rules:
//  (a) THRESHOLD — current-window retransmission/timeout rate in events per GB
//      (reliability's ratePer normalization) strictly above the configured
//      threshold → kind 'retrans' | 'timeout';
//  (b) SPIKE — window-over-window jump per entity × metric total.
//
// SPIKE deviation rule (deterministic, documented): the prior window yields a
// SINGLE aggregate per entity × metric (5-min buckets can be sparse or missing,
// so a per-bucket stddev is not robust at lab scale). We therefore use the
// relative-jump form: spike ⇔ prior > 0 AND current > sigma × prior.
// prior = 0 means growth is not measurable (a "new" entity — mirrors movers'
// deltaPct=null handling) and is never flagged. ROUND_TRIP_TIME is excluded
// (window sums of RTT samples are meaningless).
//
// Severity (both rules): 'critical' when the measure exceeds 2× its bar
// (rate > 2×threshold, or current > 2×sigma×prior), 'warn' otherwise.
// Ranked by severity, then magnitude (value/baseline) desc, then key/kind.
// Consumed by /api/anomalies — the route exposes {anomalies} as JSON verbatim.
import type { FlowEdge, MetricName } from '../types';
import { entityKey } from './aggregate';
import { ratePer } from './reliability';

/** Default spike sensitivity (σ) — mirrors DEFAULT_SETTINGS.anomalySigma. */
export const DEFAULT_SIGMA = 3;

export type AnomalyKind = 'retrans' | 'timeout' | 'spike';
export type AnomalySeverity = 'critical' | 'warn';

export interface Anomaly {
  key: string;
  label: string;
  kind: AnomalyKind;
  metric: MetricName;
  /** Threshold kinds: events/GB rate; spike: current-window metric total. */
  value: number;
  /** Threshold kinds: the configured threshold; spike: prior-window total. */
  baseline: number;
  severity: AnomalySeverity;
  /** Data payload (rates/factors), rendered verbatim — no locale-bound prose. */
  detail: string;
}

export interface AnomalyOpts {
  /** Retransmission threshold, events per GB (strict >). */
  retransThreshold: number;
  /** Timeout threshold, events per GB (strict >). */
  timeoutThreshold: number;
  /** Spike sensitivity: flag when current > sigma × prior. */
  sigma: number;
}

const SPIKE_METRICS: MetricName[] = ['DATA_TRANSFERRED', 'RETRANSMISSIONS', 'TIMEOUTS'];

const SEVERITY_RANK: Record<AnomalySeverity, number> = { critical: 0, warn: 1 };

/** value/baseline ratio used for both severity escalation and ranking. */
function magnitude(a: Anomaly): number {
  return a.value / Math.max(a.baseline, 1e-9);
}

/**
 * Per-entity metric sums at service granularity, attributed to BOTH endpoint
 * entities (same-entity flows counted once) — mirrors movers/reliability.
 */
function sumsByEntity(flows: FlowEdge[], metric: MetricName): Map<string, number> {
  const acc = new Map<string, number>();
  for (const f of flows) {
    if (f.metric !== metric) continue;
    for (const key of new Set([entityKey(f.a, 'service'), entityKey(f.b, 'service')])) {
      acc.set(key, (acc.get(key) ?? 0) + f.value);
    }
  }
  return acc;
}

/** 'critical' when value exceeds 2× the bar it already broke, else 'warn'. */
function severityFor(value: number, bar: number): AnomalySeverity {
  return value > 2 * bar ? 'critical' : 'warn';
}

/** Baseline-deviation anomalies over adjacent windows — see module header for the rules. */
export function detectAnomalies(
  current: FlowEdge[],
  prior: FlowEdge[],
  opts: AnomalyOpts,
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // (a) THRESHOLD — events/GB on the current window (reliability normalization).
  for (const row of ratePer(current, 'service')) {
    if (row.retransRate > opts.retransThreshold) {
      anomalies.push({
        key: row.key, label: row.label, kind: 'retrans', metric: 'RETRANSMISSIONS',
        value: row.retransRate, baseline: opts.retransThreshold,
        severity: severityFor(row.retransRate, opts.retransThreshold),
        detail: `retrans ${row.retransRate.toFixed(1)}/GB > ${opts.retransThreshold}/GB`,
      });
    }
    if (row.timeoutRate > opts.timeoutThreshold) {
      anomalies.push({
        key: row.key, label: row.label, kind: 'timeout', metric: 'TIMEOUTS',
        value: row.timeoutRate, baseline: opts.timeoutThreshold,
        severity: severityFor(row.timeoutRate, opts.timeoutThreshold),
        detail: `timeout ${row.timeoutRate.toFixed(1)}/GB > ${opts.timeoutThreshold}/GB`,
      });
    }
  }

  // (b) SPIKE — relative jump vs the prior window (rule in the module header).
  for (const metric of SPIKE_METRICS) {
    const pri = sumsByEntity(prior, metric);
    for (const [key, value] of sumsByEntity(current, metric)) {
      const baseline = pri.get(key) ?? 0;
      if (baseline <= 0 || value <= opts.sigma * baseline) continue;
      anomalies.push({
        key, label: key, kind: 'spike', metric,
        value, baseline,
        severity: severityFor(value, opts.sigma * baseline),
        detail: `${metric} ×${(value / baseline).toFixed(1)} vs prior window`,
      });
    }
  }

  anomalies.sort(
    (x, y) =>
      SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] ||
      magnitude(y) - magnitude(x) ||
      x.key.localeCompare(y.key) ||
      x.kind.localeCompare(y.kind),
  );
  return anomalies;
}
