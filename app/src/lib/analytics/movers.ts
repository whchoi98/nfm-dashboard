// Top-movers lens (Phase 7 Task 3). Pure functions, no I/O.
// Window-over-window deltas per service entity for incident triage: which
// entities' traffic / retransmissions / timeouts changed most vs the PRIOR
// window. Consumed by /api/analytics/movers — the route exposes this shape
// as JSON verbatim.
import type { FlowEdge, MetricName } from '../types';
import { entityKey } from './aggregate';

const DEFAULT_TOP_N = 8;

export type MoverDirection = 'up' | 'down' | 'flat';

export interface Mover {
  key: string;
  label: string;
  metric: MetricName;
  current: number;
  prior: number;
  /** (current − prior) / prior × 100; null when prior is 0 (a "new" mover — no baseline). */
  deltaPct: number | null;
  direction: MoverDirection;
  /** True iff the entity was seen in the prior window but is at 0 now — a
   *  crashed / scaled-to-zero incident signal, distinct from a mere decline. */
  wentSilent: boolean;
}

export interface MoversResult {
  dataTransferred: Mover[];
  retransmissions: Mover[];
  timeouts: Mover[];
  /** Went-silent entities (prior > 0 → current 0) across all three metric
   *  lists, deduped by key keeping the mover with the largest prior. */
  silent: Mover[];
}

/**
 * Per-entity metric sums at service granularity. Each flow's value is
 * attributed to BOTH endpoint entities (a and b) — a change shows up on
 * either side; same-entity flows are counted once, not twice (mirrors
 * reliability's ratePer attribution).
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

/**
 * Movers for one metric, ranked by ABSOLUTE change |current − prior| desc
 * (a big drop matters as much as a big spike), capped at topN.
 * Prior-0 handling is explicit: prior 0 & current > 0 → deltaPct null +
 * direction 'up' (a "new" mover); 0 in both windows → excluded entirely.
 */
function moversFor(
  current: FlowEdge[],
  prior: FlowEdge[],
  metric: MetricName,
  topN: number,
): Mover[] {
  const cur = sumsByEntity(current, metric);
  const pri = sumsByEntity(prior, metric);
  const movers: Mover[] = [];
  for (const key of new Set([...cur.keys(), ...pri.keys()])) {
    const c = cur.get(key) ?? 0;
    const p = pri.get(key) ?? 0;
    if (c === 0 && p === 0) continue; // nothing observed in either window
    movers.push({
      key,
      label: key,
      metric,
      current: c,
      prior: p,
      deltaPct: p === 0 ? null : ((c - p) / p) * 100,
      direction: c > p ? 'up' : c < p ? 'down' : 'flat',
      wentSilent: p > 0 && c === 0,
    });
  }
  movers.sort(
    (x, y) =>
      Math.abs(y.current - y.prior) - Math.abs(x.current - x.prior) ||
      y.current - x.current ||
      x.key.localeCompare(y.key),
  );
  return movers.slice(0, topN);
}

/**
 * Went-silent movers across the metric lists, deduped by key — when the same
 * entity went silent on several metrics, keep the one with the largest prior.
 * Ordered by prior desc (biggest lost baseline first), key asc as tiebreak.
 */
function silentMovers(lists: Mover[][]): Mover[] {
  const byKey = new Map<string, Mover>();
  for (const list of lists) {
    for (const m of list) {
      if (!m.wentSilent) continue;
      const kept = byKey.get(m.key);
      if (!kept || m.prior > kept.prior) byKey.set(m.key, m);
    }
  }
  return [...byKey.values()].sort(
    (x, y) => y.prior - x.prior || x.key.localeCompare(y.key),
  );
}

/** Window-over-window movers per metric (DATA_TRANSFERRED / RETRANSMISSIONS / TIMEOUTS). */
export function moversLens(
  current: FlowEdge[],
  prior: FlowEdge[],
  opts?: { topN?: number },
): MoversResult {
  const topN =
    opts?.topN && Number.isFinite(opts.topN) && opts.topN > 0
      ? Math.floor(opts.topN)
      : DEFAULT_TOP_N;
  const dataTransferred = moversFor(current, prior, 'DATA_TRANSFERRED', topN);
  const retransmissions = moversFor(current, prior, 'RETRANSMISSIONS', topN);
  const timeouts = moversFor(current, prior, 'TIMEOUTS', topN);
  return {
    dataTransferred,
    retransmissions,
    timeouts,
    silent: silentMovers([dataTransferred, retransmissions, timeouts]),
  };
}
