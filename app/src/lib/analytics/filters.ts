// Global analytics-hub filter primitives (pure — no React/browser deps).
// Every hub widget consumes AnalyticsFilters; 'all' is the no-filter sentinel.
import type { FlowEdge, MetricName } from '../types';

// 7d was removed from the interactive ranges (2026-07-15 incident): a
// 2016-bucket cold fetch+compute blocks the 1-vCPU event loop for minutes,
// fails the ALB health check and crash-loops the task. 7d+ queries belong to
// the Athena-backed /history page. Restore only behind collector pre-aggregated
// rollups (see the 2026-07-14/15 incident notes in docs/runbooks/incident-response.md).
export type TimeRange = '15m' | '1h' | '3h' | '24h';

export interface AnalyticsFilters {
  range: TimeRange;
  cluster: string;
  namespace: string;
  category: string;
  metric: MetricName;
}

export const TIME_RANGES: TimeRange[] = ['15m', '1h', '3h', '24h'];

export const METRIC_NAMES: MetricName[] = [
  'DATA_TRANSFERRED',
  'RETRANSMISSIONS',
  'TIMEOUTS',
  'ROUND_TRIP_TIME',
];

export const DEFAULT_FILTERS: AnalyticsFilters = {
  range: '1h',
  cluster: 'all',
  namespace: 'all',
  category: 'all',
  metric: 'DATA_TRANSFERRED',
};

/** Number of 5-minute buckets covering the selected range. */
export function rangeToBuckets(range: TimeRange): number {
  switch (range) {
    case '15m':
      return 3;
    case '1h':
      return 12;
    case '3h':
      return 36;
    case '24h':
      return 288;
  }
}

/** Widest flows window a lens route will fetch: 24h of 5-minute buckets (24*12). */
const MAX_BUCKETS = 288;
const DEFAULT_BUCKETS = 12;

function bucketsFrom(url: URL): number {
  const raw = Number(url.searchParams.get('buckets'));
  // Guard is `>= 1`, NOT `> 0`: a fractional 0<raw<1 (e.g. ?buckets=0.5) would
  // otherwise floor to 0 and getFlowsWindow(0) returns an empty window.
  return Number.isFinite(raw) && raw >= 1
    ? Math.max(1, Math.min(Math.floor(raw), MAX_BUCKETS))
    : DEFAULT_BUCKETS;
}

/**
 * Parse `?buckets=` for the /api/analytics/* flow routes: valid values are
 * floored and clamped to [1, 288]; missing/NaN/<1 falls back to 12 (1h).
 */
export function parseBuckets(req: Request): number {
  return bucketsFrom(new URL(req.url));
}

/**
 * One-pass query parse shared by all /api/analytics/* flow routes:
 * buckets (see parseBuckets) plus the raw namespace/category values that feed
 * applyFlowFilters (null when absent — applyFlowFilters treats that as no-op).
 */
export function parseLensParams(req: Request): {
  buckets: number;
  namespace: string | null;
  category: string | null;
} {
  const url = new URL(req.url);
  return {
    buckets: bucketsFrom(url),
    namespace: url.searchParams.get('namespace'),
    category: url.searchParams.get('category'),
  };
}

/**
 * Filter a flows window by optional namespace/category before a lens runs.
 * Missing/'all' values are no-ops; namespace matches EITHER endpoint's
 * podNamespace (a flow touching the namespace belongs to it).
 * Used by all /api/analytics/* flow routes so every lens filters consistently.
 */
export function applyFlowFilters(
  flows: FlowEdge[],
  opts: { namespace?: string | null; category?: string | null },
): FlowEdge[] {
  let out = flows;
  if (opts.category && opts.category !== 'all') {
    out = out.filter((f) => f.category === opts.category);
  }
  if (opts.namespace && opts.namespace !== 'all') {
    out = out.filter(
      (f) => f.a.podNamespace === opts.namespace || f.b.podNamespace === opts.namespace,
    );
  }
  return out;
}

/** Query string for /api/analytics/* lens routes derived from the hub filters. */
export function lensQuery(filters: AnalyticsFilters): string {
  let qs = `?buckets=${rangeToBuckets(filters.range)}`;
  if (filters.namespace !== 'all') qs += `&namespace=${encodeURIComponent(filters.namespace)}`;
  if (filters.category !== 'all') qs += `&category=${encodeURIComponent(filters.category)}`;
  return qs;
}

/** Coerce an unknown record (URL query, sessionStorage JSON) into AnalyticsFilters,
 *  falling back to DEFAULT_FILTERS per field for missing/invalid values. */
export function parseFilters(input: unknown): AnalyticsFilters {
  const rec = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);
  return {
    range: TIME_RANGES.includes(rec.range as TimeRange)
      ? (rec.range as TimeRange)
      : DEFAULT_FILTERS.range,
    cluster: str(rec.cluster) ?? DEFAULT_FILTERS.cluster,
    namespace: str(rec.namespace) ?? DEFAULT_FILTERS.namespace,
    category: str(rec.category) ?? DEFAULT_FILTERS.category,
    metric: METRIC_NAMES.includes(rec.metric as MetricName)
      ? (rec.metric as MetricName)
      : DEFAULT_FILTERS.metric,
  };
}
