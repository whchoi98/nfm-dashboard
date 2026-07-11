// Alerts event derivation (Phase 8 Task 1). Pure functions, no I/O.
// Builds a derived event feed from signals the dashboard already collects:
// CW HealthIndicator degradation, reliability threshold breaches, collector
// cycle failures/throttling, and window-over-window retrans/timeout spikes.
// Consumed by /api/alerts — the route exposes the events as JSON verbatim.
//
// i18n contract: `title` is a translation KEY (alerts.event.*) the page
// resolves via t(); `detail` is data (entity labels, rates, counts) rendered
// verbatim, so no locale-dependent prose is baked in server-side.

export type AlertSeverity = 'critical' | 'warn' | 'info';
export type AlertKind = 'nhi' | 'breach' | 'collection' | 'spike';

export interface AlertEvent {
  id: string;
  severity: AlertSeverity;
  kind: AlertKind;
  /** i18n key (alerts.event.*) — the page renders t(title). */
  title: string;
  /** Data payload (labels/rates/counts), rendered verbatim. */
  detail: string;
  /** ISO timestamp: the cycle's own ts for collection events, `now` otherwise. */
  ts: string;
  href?: string;
}

export interface AlertsInput {
  /** Latest CW HealthIndicator per monitor: degraded ⇔ latest value > 0. */
  nhiByMonitor: { monitor: string; degraded: boolean }[];
  /** reliabilityLens(...).breaches — already threshold-filtered. */
  breaches: { label: string; retransRate: number; timeoutRate: number }[];
  /** Collector cycles (CollectionStatus.stats flattened). */
  collectionHistory: { cycleTs: string; failed: number; started: number; throttled?: number }[];
  /** moversLens retransmissions+timeouts movers. */
  movers: { label: string; metric: string; deltaPct: number | null; direction: string; current: number }[];
  /** Timestamp for signals without their own (nhi/breach/spike); defaults to now. */
  now?: string;
}

/** Minimum window-over-window increase (%) for a retrans/timeout mover to count as a spike. */
export const SPIKE_DELTA_PCT = 100;

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warn: 1, info: 2 };

/**
 * Derive the alert event feed from already-collected signals. Rules:
 * - degraded NHI monitor → critical (AWS-detected network impairment);
 * - each reliability breach → warn;
 * - collection cycle with failed>0 → warn, throttled-only → info, clean → nothing;
 * - retrans/timeout mover rising ≥ SPIKE_DELTA_PCT% vs prior window → warn
 *   (deltaPct null = no baseline → skipped: growth is not measurable).
 * Sorted by severity (critical > warn > info), then ts desc, then id for stability.
 */
export function deriveEvents(input: AlertsInput): AlertEvent[] {
  const now = input.now ?? new Date().toISOString();
  const events: AlertEvent[] = [];

  for (const m of input.nhiByMonitor) {
    if (!m.degraded) continue;
    events.push({
      id: `nhi:${m.monitor}`,
      severity: 'critical',
      kind: 'nhi',
      title: 'alerts.event.nhi',
      detail: m.monitor,
      ts: now,
      href: `/monitors/${encodeURIComponent(m.monitor)}`,
    });
  }

  for (const b of input.breaches) {
    events.push({
      id: `breach:${b.label}`,
      severity: 'warn',
      kind: 'breach',
      title: 'alerts.event.breach',
      detail: `${b.label} · retrans ${b.retransRate.toFixed(1)}/GB · timeout ${b.timeoutRate.toFixed(1)}/GB`,
      ts: now,
      href: '/insights?tab=reliability',
    });
  }

  for (const c of input.collectionHistory) {
    const throttled = c.throttled ?? 0;
    if (c.failed <= 0 && throttled <= 0) continue;
    const hasFailures = c.failed > 0;
    events.push({
      id: `collection:${c.cycleTs}`,
      severity: hasFailures ? 'warn' : 'info',
      kind: 'collection',
      title: hasFailures ? 'alerts.event.collection' : 'alerts.event.collectionThrottled',
      detail: `${hasFailures ? c.failed : throttled}/${c.started} · ${c.cycleTs}`,
      ts: c.cycleTs,
      href: '/agents',
    });
  }

  for (const m of input.movers) {
    if (m.direction !== 'up' || m.deltaPct === null || m.deltaPct < SPIKE_DELTA_PCT) continue;
    if (m.metric !== 'RETRANSMISSIONS' && m.metric !== 'TIMEOUTS') continue;
    events.push({
      id: `spike:${m.metric}:${m.label}`,
      severity: 'warn',
      kind: 'spike',
      title: m.metric === 'RETRANSMISSIONS' ? 'alerts.event.spikeRetrans' : 'alerts.event.spikeTimeout',
      detail: `${m.label} · +${Math.round(m.deltaPct)}%`,
      ts: now,
      href: '/insights?tab=movers',
    });
  }

  events.sort(
    (x, y) =>
      SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] ||
      y.ts.localeCompare(x.ts) ||
      x.id.localeCompare(y.id),
  );
  return events;
}
