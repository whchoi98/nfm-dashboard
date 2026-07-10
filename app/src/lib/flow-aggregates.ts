// Client-side aggregates for the flows page strip. Pure functions, no I/O —
// operate on the CURRENTLY loaded /api/flows result set only.
import type { DestCategory, EndpointInfo, FlowEdge } from './types';
import { CATEGORY_ORDER } from './chart-tokens';

export interface FlowAggregates {
  /** Bytes per local endpoint (a), sorted desc, capped at n. */
  topTalkers: { label: string; value: number }[];
  /** Bytes per destination category — every DestCategory key present (0-filled). */
  byCategory: Record<DestCategory, number>;
}

/** Stable display label: pod ns/name > serviceName > ip > instanceId > 'unknown'. */
function endpointLabel(e: EndpointInfo): string {
  if (e.podName) return `${e.podNamespace ?? 'unknown'}/${e.podName}`;
  return e.serviceName ?? e.ip ?? e.instanceId ?? 'unknown';
}

/**
 * Aggregate DATA_TRANSFERRED bytes over a flow result set: per local endpoint
 * (top talkers, desc) and per destination category. Rows with any other
 * metric (RTT, retransmissions, timeouts) are ignored — only DATA_TRANSFERRED
 * carries byte counts.
 */
export function flowAggregates(flows: FlowEdge[], n = 8): FlowAggregates {
  const byTalker = new Map<string, number>();
  const byCategory = Object.fromEntries(
    CATEGORY_ORDER.map((c) => [c, 0]),
  ) as Record<DestCategory, number>;

  for (const f of flows) {
    if (f.metric !== 'DATA_TRANSFERRED') continue;
    const label = endpointLabel(f.a);
    byTalker.set(label, (byTalker.get(label) ?? 0) + f.value);
    byCategory[f.category] = (byCategory[f.category] ?? 0) + f.value;
  }

  const topTalkers = [...byTalker.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((x, y) => y.value - x.value || x.label.localeCompare(y.label))
    .slice(0, n);

  return { topTalkers, byCategory };
}
