// Network Analytics lens (Phase 9) — Datadog-CNM-style source→dest aggregation.
// Pure functions, no I/O, no clock. Consumed by /api/network (the route supplies
// windowSeconds and the bucket keys for sparklines via recentBuckets()).
import type { FlowEdge } from '../types';
import { entityKey, ratePerGb } from './aggregate';
import { portLabel } from './port-mix';

export type Scope = 'service' | 'namespace' | 'subnet' | 'az' | 'vpc' | 'category' | 'monitor' | 'port';
export type NetMetric = 'volume' | 'throughput' | 'retransmits' | 'rtt';

export const SCOPES: Scope[] = ['service', 'namespace', 'subnet', 'az', 'vpc', 'category', 'monitor', 'port'];
export const NET_METRICS: NetMetric[] = ['volume', 'throughput', 'retransmits', 'rtt'];

/** Default danger threshold in retransmissions per GB (matches reliability DEFAULT_RETRANS_RATE). */
export const DEFAULT_RETRANS_THRESHOLD = 10;
export const DEFAULT_TOP_N = 50;
/** 5-minute grid bucket length — system invariant shared with the collector. */
const BUCKET_SECONDS = 300;
const UNKNOWN = 'unknown';

export interface NetPair {
  source: string;
  dest: string;
  bytes: number;
  /** bytes/s over the whole window (0 when windowSeconds is missing or ≤ 0). */
  throughput: number;
  retransmissions: number;
  /** Retransmissions per GB transferred (0 when no bytes observed). */
  retransRate: number;
  /** Mean ROUND_TRIP_TIME, null when the pair has no RTT sample. */
  rtt: number | null;
  health: 'ok' | 'warn' | 'danger';
  /** Per-bucket value of the SELECTED metric, in the order of opts.buckets ([] without buckets). */
  spark: number[];
}

export interface NetworkAnalyticsResult {
  pairs: NetPair[];
  totalBytes: number;
  totalRetrans: number;
  /** Fleet-wide retransmissions per GB across all flows (0 when no bytes observed). */
  retransRateOverall: number;
  sourceScope: Scope;
  destScope: Scope;
  metric: NetMetric;
}

/** Aggregation key for one endpoint of a flow at the given scope. Missing fields → 'unknown'. */
export function scopeKey(flow: FlowEdge, endpoint: 'a' | 'b', scope: Scope): string {
  switch (scope) {
    case 'service':
    case 'namespace':
    case 'az':
    case 'vpc':
      return entityKey(flow[endpoint], scope);
    case 'subnet':
      return flow[endpoint].subnetId ?? UNKNOWN;
    case 'category':
      return flow.category;
    case 'monitor':
      return flow.monitor;
    case 'port':
      return portLabel(flow.targetPort);
  }
}

interface PairAcc {
  source: string;
  dest: string;
  bytes: number;
  retransmissions: number;
  rttSum: number;
  rttCount: number;
  /** bucket → accumulator for the spark of the selected metric. */
  byBucket: Map<string, { bytes: number; retransmissions: number; rttSum: number; rttCount: number }>;
}

function sparkValue(
  slot: { bytes: number; retransmissions: number; rttSum: number; rttCount: number } | undefined,
  metric: NetMetric,
): number {
  if (!slot) return 0;
  switch (metric) {
    case 'volume':
      return slot.bytes;
    case 'throughput':
      return slot.bytes / BUCKET_SECONDS;
    case 'retransmits':
      return slot.retransmissions;
    case 'rtt':
      return slot.rttCount === 0 ? 0 : slot.rttSum / slot.rttCount;
  }
}

function rankValue(p: NetPair, metric: NetMetric): number {
  switch (metric) {
    case 'volume':
      return p.bytes;
    case 'throughput':
      return p.throughput;
    case 'retransmits':
      return p.retransmissions;
    case 'rtt':
      return p.rtt ?? -1; // pairs without an RTT sample rank last (rtt is never negative)
  }
}

/**
 * Aggregate flows into (source scope of `a`) → (dest scope of `b`) pairs with
 * volume/throughput/retransmit/RTT metrics, health coloring, and a per-bucket
 * sparkline of the selected metric. Ranked desc by the selected metric, capped at topN.
 * Self-pairs (source === dest) are kept — they represent intra-scope traffic.
 */
export function networkAnalyticsLens(
  flows: FlowEdge[],
  opts: {
    sourceScope: Scope;
    destScope: Scope;
    metric?: NetMetric;
    windowSeconds?: number;
    buckets?: string[];
    topN?: number;
    retransThreshold?: number;
  },
): NetworkAnalyticsResult {
  const metric = opts.metric ?? 'volume';
  const topN = opts.topN ?? DEFAULT_TOP_N;
  const retransThreshold = opts.retransThreshold ?? DEFAULT_RETRANS_THRESHOLD;
  const windowSeconds = opts.windowSeconds ?? 0;
  const buckets = opts.buckets ?? [];

  const acc = new Map<string, PairAcc>();
  let totalBytes = 0;
  let totalRetrans = 0;
  for (const f of flows) {
    if (f.metric !== 'DATA_TRANSFERRED' && f.metric !== 'RETRANSMISSIONS' && f.metric !== 'ROUND_TRIP_TIME') continue;
    const source = scopeKey(f, 'a', opts.sourceScope);
    const dest = scopeKey(f, 'b', opts.destScope);
    const key = `${source}\u0000${dest}`;
    let pair = acc.get(key);
    if (!pair) {
      pair = { source, dest, bytes: 0, retransmissions: 0, rttSum: 0, rttCount: 0, byBucket: new Map() };
      acc.set(key, pair);
    }
    let slot = pair.byBucket.get(f.bucket);
    if (!slot) {
      slot = { bytes: 0, retransmissions: 0, rttSum: 0, rttCount: 0 };
      pair.byBucket.set(f.bucket, slot);
    }
    if (f.metric === 'DATA_TRANSFERRED') {
      pair.bytes += f.value;
      slot.bytes += f.value;
      totalBytes += f.value;
    } else if (f.metric === 'RETRANSMISSIONS') {
      pair.retransmissions += f.value;
      slot.retransmissions += f.value;
      totalRetrans += f.value;
    } else {
      pair.rttSum += f.value;
      pair.rttCount += 1;
      slot.rttSum += f.value;
      slot.rttCount += 1;
    }
  }

  const pairs: NetPair[] = [...acc.values()].map((p) => {
    const retransRate = ratePerGb(p.retransmissions, p.bytes);
    return {
      source: p.source,
      dest: p.dest,
      bytes: p.bytes,
      throughput: windowSeconds > 0 ? p.bytes / windowSeconds : 0,
      retransmissions: p.retransmissions,
      retransRate,
      rtt: p.rttCount === 0 ? null : p.rttSum / p.rttCount,
      health: retransRate >= retransThreshold ? 'danger' : retransRate >= retransThreshold / 2 ? 'warn' : 'ok',
      spark: buckets.map((b) => sparkValue(p.byBucket.get(b), metric)),
    };
  });
  pairs.sort(
    (x, y) =>
      rankValue(y, metric) - rankValue(x, metric) ||
      x.source.localeCompare(y.source) ||
      x.dest.localeCompare(y.dest),
  );

  return {
    pairs: pairs.slice(0, topN),
    totalBytes,
    totalRetrans,
    retransRateOverall: ratePerGb(totalRetrans, totalBytes),
    sourceScope: opts.sourceScope,
    destScope: opts.destScope,
    metric,
  };
}
