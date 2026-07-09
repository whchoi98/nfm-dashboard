// Shared aggregation helpers for the analytics lenses (cost/reliability/latency/dependencies).
// Pure functions, no I/O. Consumed by app/src/lib/analytics/{cost,reliability,latency,dependencies}.ts.
import type { EndpointInfo, FlowEdge, MetricName } from '../types';

export type EntityKind = 'pod' | 'service' | 'namespace' | 'az' | 'azpair' | 'vpc';
export interface Series { label: string; points: { t: string; v: number }[]; }

const UNKNOWN = 'unknown';

/** Stable label for an endpoint at the given entity granularity. Missing fields -> 'unknown'. */
export function entityKey(e: EndpointInfo, kind: EntityKind): string {
  switch (kind) {
    case 'pod':
      return e.podName ? `${e.podNamespace ?? UNKNOWN}/${e.podName}` : UNKNOWN;
    case 'service': {
      const name = e.serviceName ?? e.podName ?? e.ip;
      return name ? `${e.podNamespace ?? UNKNOWN}/${name}` : UNKNOWN;
    }
    case 'namespace':
      return e.podNamespace ?? UNKNOWN;
    case 'az':
      return e.az ?? UNKNOWN;
    case 'vpc':
      return e.vpcId ?? UNKNOWN;
    case 'azpair':
      // azpair is an edge-level concept (needs both endpoints); not derivable from one endpoint.
      return UNKNOWN;
  }
}

/** Nearest-rank percentile over an ascending-sorted array; index clamped to [0, len-1]; empty -> 0. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const idx = Math.min(Math.max(rank - 1, 0), sortedAsc.length - 1);
  return sortedAsc[idx];
}

/** Sum of `value` over flows whose metric matches. */
export function sumByMetric(flows: FlowEdge[], metric: MetricName): number {
  let sum = 0;
  for (const f of flows) if (f.metric === metric) sum += f.value;
  return sum;
}

/** Group items into a Map by the string key produced by keyFn (insertion order preserved). */
export function groupBy<T>(items: T[], keyFn: (t: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}
