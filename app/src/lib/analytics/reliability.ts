// Reliability analytics lens (spec §6.2). Pure functions, no I/O.
// Consumed by /api/analytics/reliability — the route exposes these shapes as JSON verbatim.
import type { FlowEdge } from '../types';
import { entityKey, type EntityKind, type Series } from './aggregate';

// Default breach thresholds in events per GB (spec §6.2) — revisit after observing real data.
export const DEFAULT_RETRANS_RATE = 10;
export const DEFAULT_TIMEOUT_RATE = 5;

export interface ReliabilityRow {
  key: string;
  label: string;
  bytes: number;
  retransmissions: number;
  timeouts: number;
  /** Retransmissions per GB transferred (0 when no bytes observed). */
  retransRate: number;
  /** Timeouts per GB transferred (0 when no bytes observed). */
  timeoutRate: number;
}

export interface ScatterPoint { key: string; label: string; rtt: number; retransmissions: number; bytes: number; }
export interface NhiSwimlane { monitor: string; points: { t: string; healthy: boolean }[]; }
export interface ReliabilityCw { healthIndicator?: Series; byMonitor?: Record<string, Series>; }
export interface ReliabilityLensResult {
  hotspots: ReliabilityRow[];
  breaches: ReliabilityRow[];
  nhi: Series;
  nhiSwimlanes: NhiSwimlane[];
  scatter: ScatterPoint[];
}

/** Events per GB with 0-division guard: bytes=0 → 0 (no traffic ≠ infinitely bad). */
function ratePerGb(events: number, bytes: number): number {
  return bytes === 0 ? 0 : events / Math.max(bytes / 1e9, 1e-9);
}

/**
 * Per-entity retransmission/timeout rates normalized by transferred GB, desc by retransRate.
 * Each flow's counts are attributed to BOTH endpoint entities (a and b) — an unreliable
 * link shows up on either side; same-entity flows are counted once, not twice.
 */
export function ratePer(flows: FlowEdge[], kind: EntityKind = 'service'): ReliabilityRow[] {
  const acc = new Map<string, { bytes: number; retransmissions: number; timeouts: number }>();
  for (const f of flows) {
    if (f.metric !== 'DATA_TRANSFERRED' && f.metric !== 'RETRANSMISSIONS' && f.metric !== 'TIMEOUTS') continue;
    for (const key of new Set([entityKey(f.a, kind), entityKey(f.b, kind)])) {
      let slot = acc.get(key);
      if (!slot) { slot = { bytes: 0, retransmissions: 0, timeouts: 0 }; acc.set(key, slot); }
      if (f.metric === 'DATA_TRANSFERRED') slot.bytes += f.value;
      else if (f.metric === 'RETRANSMISSIONS') slot.retransmissions += f.value;
      else slot.timeouts += f.value;
    }
  }
  const rows: ReliabilityRow[] = [...acc.entries()].map(([key, s]) => ({
    key,
    label: key,
    bytes: s.bytes,
    retransmissions: s.retransmissions,
    timeouts: s.timeouts,
    retransRate: ratePerGb(s.retransmissions, s.bytes),
    timeoutRate: ratePerGb(s.timeouts, s.bytes),
  }));
  rows.sort((x, y) => y.retransRate - x.retransRate || y.timeoutRate - x.timeoutRate || x.key.localeCompare(y.key));
  return rows;
}

/**
 * Rows exceeding either threshold (strict >), sorted desc by severity =
 * max(retransRate/retransThreshold, timeoutRate/timeoutThreshold). Input is not mutated.
 */
export function thresholdBreaches(
  rows: ReliabilityRow[],
  opts: { retransRate?: number; timeoutRate?: number } = {},
): ReliabilityRow[] {
  const retransThreshold = opts.retransRate ?? DEFAULT_RETRANS_RATE;
  const timeoutThreshold = opts.timeoutRate ?? DEFAULT_TIMEOUT_RATE;
  const severity = (r: ReliabilityRow) =>
    Math.max(r.retransRate / Math.max(retransThreshold, 1e-9), r.timeoutRate / Math.max(timeoutThreshold, 1e-9));
  return rows
    .filter((r) => r.retransRate > retransThreshold || r.timeoutRate > timeoutThreshold)
    .sort((x, y) => severity(y) - severity(x) || x.key.localeCompare(y.key));
}

/** CW HealthIndicator (Maximum) normalized to a 0/1 step series; missing/empty → empty 'nhi' series. */
export function nhiTimeline(cwHealthIndicator?: Series): Series {
  if (!cwHealthIndicator || cwHealthIndicator.points.length === 0) return { label: 'nhi', points: [] };
  return {
    label: cwHealthIndicator.label || 'nhi',
    points: cwHealthIndicator.points.map((p) => ({ t: p.t, v: p.v > 0 ? 1 : 0 })),
  };
}

/** Per-monitor HealthIndicator swimlanes: healthy ⇔ CW value === 0 (any degradation flips the lane). */
export function nhiSwimlanes(cwByMonitor: Record<string, Series> = {}): NhiSwimlane[] {
  return Object.entries(cwByMonitor).map(([monitor, series]) => ({
    monitor,
    points: series.points.map((p) => ({ t: p.t, healthy: p.v === 0 })),
  }));
}

/** Directional edge label at service granularity (single entity when a and b collapse). */
function edgeLabel(f: FlowEdge): string {
  const a = entityKey(f.a, 'service');
  const b = entityKey(f.b, 'service');
  return a === b ? a : `${a} → ${b}`;
}

/**
 * RTT × retransmissions scatter, one point per edgeHash: rtt = mean of the edge's
 * ROUND_TRIP_TIME values, retransmissions/bytes = sums. Edges with no RTT sample are
 * excluded (nothing to correlate). Capped to `sampleCap` keeping the highest-retransmission
 * points; the dropped count is logged via console.warn.
 */
export function rttVsRetrans(flows: FlowEdge[], sampleCap = 500): ScatterPoint[] {
  const byEdge = new Map<string, { label: string; rttSum: number; rttCount: number; retransmissions: number; bytes: number }>();
  for (const f of flows) {
    let slot = byEdge.get(f.edgeHash);
    if (!slot) { slot = { label: edgeLabel(f), rttSum: 0, rttCount: 0, retransmissions: 0, bytes: 0 }; byEdge.set(f.edgeHash, slot); }
    if (f.metric === 'ROUND_TRIP_TIME') { slot.rttSum += f.value; slot.rttCount += 1; }
    else if (f.metric === 'RETRANSMISSIONS') slot.retransmissions += f.value;
    else if (f.metric === 'DATA_TRANSFERRED') slot.bytes += f.value;
  }
  const points: ScatterPoint[] = [];
  for (const [key, s] of byEdge) {
    if (s.rttCount === 0) continue; // no RTT sample → excluded from the correlation view
    points.push({ key, label: s.label, rtt: s.rttSum / s.rttCount, retransmissions: s.retransmissions, bytes: s.bytes });
  }
  points.sort((x, y) => y.retransmissions - x.retransmissions || y.bytes - x.bytes || x.key.localeCompare(y.key));
  if (points.length > sampleCap) {
    console.warn(`rttVsRetrans: dropped ${points.length - sampleCap} of ${points.length} points (sampleCap=${sampleCap})`);
    return points.slice(0, sampleCap);
  }
  return points;
}

/** Spec §6.2 response for /api/analytics/reliability. `cw` supplies optional HealthIndicator series. */
export function reliabilityLens(flows: FlowEdge[], cw?: ReliabilityCw): ReliabilityLensResult {
  const hotspots = ratePer(flows);
  return {
    hotspots,
    breaches: thresholdBreaches(hotspots),
    nhi: nhiTimeline(cw?.healthIndicator),
    nhiSwimlanes: nhiSwimlanes(cw?.byMonitor),
    scatter: rttVsRetrans(flows),
  };
}
