// Global analytics-hub filter primitives (pure — no React/browser deps).
// Every hub widget consumes AnalyticsFilters; 'all' is the no-filter sentinel.
import type { MetricName } from '../types';

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
