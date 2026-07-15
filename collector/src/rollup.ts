import type { FlowEdge } from './types.js';

// Hourly rollup pure helpers. Hour keys share the collector ISO format
// (no ms) so HFLOW keys line up with the 5-min FLOW grid.
export const HOUR_MS = 3_600_000;
const FIVE_MIN_MS = 300_000;
// One full cycle past hour close, so the hour's last 5-min bucket has landed.
// MUST stay > the collector Lambda timeout (270s, infra/lib/data-stack.ts) so
// a cycle started just before the hour close cannot commit raw rows after the
// hour is rolled up.
const CLOSE_GRACE_MS = 5 * 60_000;

const iso = (t: number) => new Date(t).toISOString().replace(/\.\d+Z/, 'Z');

export function hourBucketOf(t: number): string {
  return iso(Math.floor(t / HOUR_MS) * HOUR_MS);
}

export function fiveMinBucketsOfHour(hourBucket: string): string[] {
  const start = Date.parse(hourBucket);
  return Array.from({ length: 12 }, (_, i) => iso(start + i * FIVE_MIN_MS));
}

export function eligibleMissingHours(
  nowMs: number, done: Set<string>, lookbackHours = 168, maxPerCycle = 6,
): string[] {
  const newestEligibleStart = Math.floor((nowMs - CLOSE_GRACE_MS) / HOUR_MS) * HOUR_MS - HOUR_MS;
  const out: string[] = [];
  for (let i = 0; i < lookbackHours && out.length < maxPerCycle; i++) {
    const key = iso(newestEligibleStart - i * HOUR_MS);
    if (!done.has(key)) out.push(key);
  }
  return out;
}

/**
 * Merge one hour's raw 5-min edges into hour-grain FlowEdges.
 * Counters SUM; ROUND_TRIP_TIME is the MEAN of present buckets (gauge —
 * approximation, documented in the spec); endpoint/port/traversed fields come
 * from the edge's latest bucket. Each (monitor, metric, category) group keeps
 * only the top `capPerGroup` edges by value (merge of 12 x top-100 raw lists).
 */
export function mergeHourEdges(
  raw: FlowEdge[], hourBucket: string, capPerGroup = 200,
): FlowEdge[] {
  type Acc = { edge: FlowEdge; sum: number; count: number; latestBucket: string };
  const acc = new Map<string, Acc>();
  for (const e of raw) {
    const key = `${e.monitor}|${e.metric}|${e.category}|${e.edgeHash}`;
    const cur = acc.get(key);
    if (!cur) {
      acc.set(key, { edge: e, sum: e.value, count: 1, latestBucket: e.bucket });
    } else {
      cur.sum += e.value;
      cur.count += 1;
      if (e.bucket > cur.latestBucket) { cur.edge = e; cur.latestBucket = e.bucket; }
    }
  }
  const groups = new Map<string, FlowEdge[]>();
  for (const { edge, sum, count } of acc.values()) {
    const value = edge.metric === 'ROUND_TRIP_TIME' ? sum / count : sum;
    const merged: FlowEdge = { ...edge, bucket: hourBucket, value };
    const gkey = `${edge.monitor}|${edge.metric}|${edge.category}`;
    (groups.get(gkey) ?? groups.set(gkey, []).get(gkey)!).push(merged);
  }
  const out: FlowEdge[] = [];
  for (const group of groups.values()) {
    group.sort((x, y) => y.value - x.value);
    out.push(...group.slice(0, capPerGroup));
  }
  return out;
}
