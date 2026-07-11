// Reliability scorecard / SLO lens (Phase 7 Task 2). Pure functions, no I/O.
// Consumed by /api/analytics/scorecard — the route exposes this shape as JSON verbatim.
// Per-monitor NHI availability comes from CW HealthIndicator series (0 = healthy,
// > 0 = degraded); retrans/timeout rates come from the flows window grouped by monitor.
import type { FlowEdge } from '../types';
import type { Series } from './aggregate';
import { ratePer, type ReliabilityRow } from './reliability';

// ── Score normalization constants (lab-scale, like reliability.ts thresholds) ──
// A monitor's retrans/timeout rate (events per GB) is normalized to 0..1 by these
// scales: normRetrans = min(retransRate / RETRANS_SCALE, 1). At or beyond the scale
// the rate term contributes nothing to the score. 2× the reliability lens breach
// thresholds (10 / 5 events per GB) so a fresh breach loses half the rate term,
// not all of it. Revisit after observing real data.
export const RETRANS_SCALE = 20;
export const TIMEOUT_SCALE = 10;

// Status thresholds on the 0..100 composite score: ok ≥ 90, warn ≥ 70, danger < 70.
export const OK_SCORE = 90;
export const WARN_SCORE = 70;

// Worst-services toplist cap (matches the other lenses' top-8 convention).
const WORST_LIMIT = 8;

export interface MonitorScore {
  monitor: string;
  /** % of the monitor's HealthIndicator points == 0 (healthy); null when no CW points. */
  nhiAvailabilityPct: number | null;
  retransRate: number; // events per GB (0 when no bytes observed)
  timeoutRate: number; // events per GB (0 when no bytes observed)
  bytes: number;
  score: number; // 0..100 composite (see compositeScore)
  status: 'ok' | 'warn' | 'danger';
}

export interface ScorecardResult {
  monitors: MonitorScore[]; // sorted worst-first (score asc, then monitor name)
  overall: { availabilityPct: number | null; score: number };
  breachTimeline: { t: string; count: number }[]; // degraded-monitor count per timestamp
  worst: ReliabilityRow[]; // services with non-zero event rates, desc by retransRate
}

/** Events per GB with 0-division guard: bytes=0 → 0 (no traffic ≠ infinitely bad). */
function ratePerGb(events: number, bytes: number): number {
  return bytes === 0 ? 0 : events / Math.max(bytes / 1e9, 1e-9);
}

/**
 * Composite SLO score = 0.6×availability + 0.2×(1−normRetrans) + 0.2×(1−normTimeout),
 * scaled to 0..100 and clamped. availability is the 0..1 healthy fraction; null
 * (no HealthIndicator points — NHI is often sparse/all-healthy in the lab) is
 * treated as healthy (1) so a monitor without CW data is scored on rates alone.
 * normX = min(rate / X_SCALE, 1) — see the scale constants above.
 */
export function compositeScore(
  availability01: number | null,
  retransRate: number,
  timeoutRate: number,
): number {
  const avail = availability01 ?? 1;
  const normRetrans = Math.min(retransRate / RETRANS_SCALE, 1);
  const normTimeout = Math.min(timeoutRate / TIMEOUT_SCALE, 1);
  const score = (0.6 * avail + 0.2 * (1 - normRetrans) + 0.2 * (1 - normTimeout)) * 100;
  return Math.min(Math.max(score, 0), 100);
}

/** Status by composite score: ok ≥ 90, warn ≥ 70, danger < 70. */
export function scoreStatus(score: number): MonitorScore['status'] {
  if (score >= OK_SCORE) return 'ok';
  if (score >= WARN_SCORE) return 'warn';
  return 'danger';
}

/** Healthy (==0) fraction of a HealthIndicator lane as a %; null when no points. */
function availabilityPct(lane?: Series): number | null {
  if (!lane || lane.points.length === 0) return null;
  const healthy = lane.points.filter((p) => p.v === 0).length;
  return (healthy / lane.points.length) * 100;
}

/** Degraded-monitor count per timestamp over the union of lane timestamps, asc by t. */
function breachTimeline(byMonitor: Record<string, Series>): { t: string; count: number }[] {
  const countByT = new Map<string, number>();
  for (const lane of Object.values(byMonitor)) {
    for (const p of lane.points) {
      countByT.set(p.t, (countByT.get(p.t) ?? 0) + (p.v > 0 ? 1 : 0));
    }
  }
  return [...countByT.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, count]) => ({ t, count }));
}

/**
 * Reliability scorecard over a flows window + CW HealthIndicator lanes:
 * per-monitor availability/rates/composite score, fleet-level overall numbers,
 * a degraded-monitor timeline and the worst services (reused reliability ratePer).
 * Monitors are the union of flow monitors and CW lanes — either source alone
 * still produces a row (missing side degrades to null availability / zero rates).
 */
export function scorecardLens(
  flows: FlowEdge[],
  cw: { byMonitor?: Record<string, Series> },
): ScorecardResult {
  const byMonitorCw = cw.byMonitor ?? {};

  // Per-monitor flow aggregates (FlowEdge.monitor is the grouping key).
  const acc = new Map<string, { bytes: number; retransmissions: number; timeouts: number }>();
  for (const f of flows) {
    if (f.metric !== 'DATA_TRANSFERRED' && f.metric !== 'RETRANSMISSIONS' && f.metric !== 'TIMEOUTS') continue;
    let slot = acc.get(f.monitor);
    if (!slot) { slot = { bytes: 0, retransmissions: 0, timeouts: 0 }; acc.set(f.monitor, slot); }
    if (f.metric === 'DATA_TRANSFERRED') slot.bytes += f.value;
    else if (f.metric === 'RETRANSMISSIONS') slot.retransmissions += f.value;
    else slot.timeouts += f.value;
  }

  const names = new Set<string>([...acc.keys(), ...Object.keys(byMonitorCw)]);
  const monitors: MonitorScore[] = [...names].map((monitor) => {
    const s = acc.get(monitor) ?? { bytes: 0, retransmissions: 0, timeouts: 0 };
    const availability = availabilityPct(byMonitorCw[monitor]);
    const retransRate = ratePerGb(s.retransmissions, s.bytes);
    const timeoutRate = ratePerGb(s.timeouts, s.bytes);
    const score = compositeScore(availability === null ? null : availability / 100, retransRate, timeoutRate);
    return {
      monitor,
      nhiAvailabilityPct: availability,
      retransRate,
      timeoutRate,
      bytes: s.bytes,
      score,
      status: scoreStatus(score),
    };
  });
  monitors.sort((x, y) => x.score - y.score || x.monitor.localeCompare(y.monitor));

  // Overall: mean availability over monitors WITH CW data (null when none) and mean score.
  const withAvailability = monitors.filter((m) => m.nhiAvailabilityPct !== null);
  const overallAvailability =
    withAvailability.length > 0
      ? withAvailability.reduce((sum, m) => sum + (m.nhiAvailabilityPct as number), 0) /
        withAvailability.length
      : null;
  const overallScore =
    monitors.length > 0 ? monitors.reduce((sum, m) => sum + m.score, 0) / monitors.length : 0;

  // Worst services: reliability ratePer is already sorted desc by retransRate then
  // timeoutRate — keep only rows with actual events (all-clean lab → empty list).
  const worst = ratePer(flows, 'service')
    .filter((r) => r.retransRate > 0 || r.timeoutRate > 0)
    .slice(0, WORST_LIMIT);

  return {
    monitors,
    overall: { availabilityPct: overallAvailability, score: overallScore },
    breachTimeline: breachTimeline(byMonitorCw),
    worst,
  };
}
