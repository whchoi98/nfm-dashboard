// Latency analytics lens (spec §6.3). Pure functions, no I/O.
// Consumed by /api/analytics/latency — the route exposes these shapes as JSON verbatim.
// Only ROUND_TRIP_TIME flows carry RTT and RTT is sparse: every function tolerates
// empty/absent samples (zeros / empty arrays, never throws).
import type { FlowEdge } from '../types';
import { entityKey, percentile, type Series } from './aggregate';

// `min` is included for AWS console parity (§15.4): Round-trip time tile = Minimum (best-case latency).
export interface LatencyStats { p50: number; p90: number; p95: number; min: number; max: number; count: number; }
export interface SlowPath { key: string; label: string; rtt: number; edgeHash: string; }
export interface RttHeatmapCell { day: number; hour: number; value: number; count: number; }
export interface RttBin { bucketMs: number; count: number; }
export interface LatencyLensResult {
  overall: LatencyStats;
  intra: LatencyStats;
  inter: LatencyStats;
  slowest: SlowPath[];
  trend: Series;
  distribution: RttBin[];
  hourHeatmap: RttHeatmapCell[];
}

const ZERO_STATS: LatencyStats = { p50: 0, p90: 0, p95: 0, min: 0, max: 0, count: 0 };

/** RTT sample values (ms) — only ROUND_TRIP_TIME flows carry RTT. */
function rttValues(flows: FlowEdge[]): number[] {
  const values: number[] = [];
  for (const f of flows) if (f.metric === 'ROUND_TRIP_TIME') values.push(f.value);
  return values;
}

/** Nearest-rank p50/p90/p95 + min/max/count over RTT samples; empty → all zeros. Input not mutated. */
export function percentilesOf(rttValues: number[]): LatencyStats {
  if (rttValues.length === 0) return { ...ZERO_STATS };
  const sorted = [...rttValues].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: sorted.length,
  };
}

/** RTT stats split by destination category: INTRA_AZ vs INTER_AZ (other categories ignored). */
export function intraVsInter(flows: FlowEdge[]): { intra: LatencyStats; inter: LatencyStats } {
  const intra: number[] = [];
  const inter: number[] = [];
  for (const f of flows) {
    if (f.metric !== 'ROUND_TRIP_TIME') continue;
    if (f.category === 'INTRA_AZ') intra.push(f.value);
    else if (f.category === 'INTER_AZ') inter.push(f.value);
  }
  return { intra: percentilesOf(intra), inter: percentilesOf(inter) };
}

/** Directional edge label at service granularity (single entity when a and b collapse). */
function pathLabel(f: FlowEdge): string {
  const a = entityKey(f.a, 'service');
  const b = entityKey(f.b, 'service');
  return a === b ? a : `${a} → ${b}`;
}

/** Top-n slowest edges: mean RTT per edgeHash, desc by rtt (key ties broken lexically). */
export function slowestPaths(flows: FlowEdge[], n = 20): SlowPath[] {
  const byEdge = new Map<string, { label: string; sum: number; count: number }>();
  for (const f of flows) {
    if (f.metric !== 'ROUND_TRIP_TIME') continue;
    let slot = byEdge.get(f.edgeHash);
    if (!slot) { slot = { label: pathLabel(f), sum: 0, count: 0 }; byEdge.set(f.edgeHash, slot); }
    slot.sum += f.value;
    slot.count += 1;
  }
  const paths: SlowPath[] = [...byEdge.entries()].map(([edgeHash, s]) => ({
    key: edgeHash, label: s.label, rtt: s.sum / s.count, edgeHash,
  }));
  paths.sort((x, y) => y.rtt - x.rtt || x.key.localeCompare(y.key));
  return paths.slice(0, n);
}

/** Mean RTT per time bucket, ascending by bucket ts; no RTT → empty 'rtt' series. */
export function rttTrend(flows: FlowEdge[]): Series {
  const byBucket = new Map<string, { sum: number; count: number }>();
  for (const f of flows) {
    if (f.metric !== 'ROUND_TRIP_TIME') continue;
    let slot = byBucket.get(f.bucket);
    if (!slot) { slot = { sum: 0, count: 0 }; byBucket.set(f.bucket, slot); }
    slot.sum += f.value;
    slot.count += 1;
  }
  const points = [...byBucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, s]) => ({ t, v: s.sum / s.count }));
  return { label: 'rtt', points };
}

/**
 * Mean RTT per (day-of-week, hour-of-day) cell from the bucket ISO timestamp (UTC:
 * buckets are collector-emitted `...Z` instants). day 0=Sunday..6=Saturday, hour 0-23.
 * Unparseable buckets are skipped; only observed cells are returned (sorted day, hour).
 */
export function rttByHourHeatmap(flows: FlowEdge[]): RttHeatmapCell[] {
  const cells = new Map<number, { sum: number; count: number }>(); // key = day*24 + hour
  for (const f of flows) {
    if (f.metric !== 'ROUND_TRIP_TIME') continue;
    const ts = new Date(f.bucket);
    if (Number.isNaN(ts.getTime())) continue;
    const key = ts.getUTCDay() * 24 + ts.getUTCHours();
    let slot = cells.get(key);
    if (!slot) { slot = { sum: 0, count: 0 }; cells.set(key, slot); }
    slot.sum += f.value;
    slot.count += 1;
  }
  return [...cells.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, s]) => ({
      day: Math.floor(key / 24), hour: key % 24, value: s.sum / s.count, count: s.count,
    }));
}

/** Smallest "nice" bin width (1·2·5 × 10^k) giving at most `targetBins` bins over [0, max]. */
function niceBinWidth(max: number, targetBins: number): number {
  const raw = Math.max(max / targetBins, 1e-9); // max=0 guard → single 0 bin
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/**
 * RTT histogram: ~targetBins zero-filled contiguous bins between the observed min and max,
 * `bucketMs` = inclusive lower bound of the bin (bin width is a nice 1·2·5×10^k step).
 * No RTT samples → [].
 */
export function rttDistribution(flows: FlowEdge[], targetBins = 12): RttBin[] {
  const values = rttValues(flows);
  if (values.length === 0) return [];
  let min = values[0];
  let max = values[0];
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  const width = niceBinWidth(max, targetBins);
  const counts = new Map<number, number>();
  for (const v of values) {
    const bucketMs = Math.floor(v / width) * width;
    counts.set(bucketMs, (counts.get(bucketMs) ?? 0) + 1);
  }
  const bins: RttBin[] = [];
  const last = Math.floor(max / width);
  for (let i = Math.floor(min / width); i <= last; i++) {
    const bucketMs = i * width;
    bins.push({ bucketMs, count: counts.get(bucketMs) ?? 0 });
  }
  return bins;
}

/** Spec §6.3 response for /api/analytics/latency. Only ROUND_TRIP_TIME flows contribute. */
export function latencyLens(flows: FlowEdge[]): LatencyLensResult {
  const { intra, inter } = intraVsInter(flows);
  return {
    overall: percentilesOf(rttValues(flows)),
    intra,
    inter,
    slowest: slowestPaths(flows),
    trend: rttTrend(flows),
    distribution: rttDistribution(flows),
    hourHeatmap: rttByHourHeatmap(flows),
  };
}
