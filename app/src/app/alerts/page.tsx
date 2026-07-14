'use client';

// /alerts — live CloudWatch alarm states + the derived event feed built from
// signals the dashboard already collects (NHI degradation, reliability
// breaches, collection gaps, retrans/timeout spikes). Polls /api/alerts.
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  CircleCheck,
  CircleHelp,
  Database,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { AlarmState } from '@/lib/cw-alarms';
import type { AlertEvent, AlertKind, AlertSeverity } from '@/lib/alerts';
import type { CompositeRow } from '@/lib/analytics/composite-conditions';
import { STATUS, TOKENS } from '@/lib/chart-tokens';
import Widget from '@/components/analytics/Widget';
import { LensState } from '@/app/insights/tabs/shared';

interface AlertsResponse {
  alarms: AlarmState[];
  events: AlertEvent[];
  composite: CompositeRow[];
}

// Severity dot colors from chart tokens — ALWAYS dual-encoded with the
// severity text label below (pastels are not reliable alone).
const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: STATUS.danger,
  warn: STATUS.warn,
  info: TOKENS.accentBlue,
};

const KIND_ICON: Record<AlertKind, LucideIcon> = {
  nhi: Activity,
  breach: AlertTriangle,
  collection: Database,
  spike: TrendingUp,
};

/** Relative time for the event feed ("just now" under a minute). */
function timeAgo(ts: string, t: (k: string, p?: Record<string, string | number>) => string): string {
  const ms = Date.now() - Date.parse(ts);
  if (!Number.isFinite(ms) || ms < 60_000) return t('alerts.justNow');
  const min = Math.floor(ms / 60_000);
  if (min < 60) return t('alerts.minAgo', { min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('alerts.hourAgo', { h });
  return t('alerts.dayAgo', { d: Math.floor(h / 24) });
}

/** Alarm state chip, dual-encoded (icon + text) — StatusBadge's look for alarm states. */
function AlarmChip({ state }: { state: AlarmState['stateValue'] }) {
  const { t } = useLanguage();
  if (state === 'ALARM') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white dark:bg-white dark:text-ink">
        <AlertTriangle size={14} strokeWidth={2} aria-hidden />
        {t('alerts.state.alarm')}
      </span>
    );
  }
  if (state === 'OK') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accentMint px-3 py-1 text-xs font-semibold text-ink">
        <CircleCheck size={14} strokeWidth={2} aria-hidden />
        {t('alerts.state.ok')}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink/60 dark:bg-white/10 dark:text-white/60">
      <CircleHelp size={14} strokeWidth={1.5} aria-hidden />
      {t('alerts.state.insufficient')}
    </span>
  );
}

function EventRow({ event }: { event: AlertEvent }) {
  const { t } = useLanguage();
  const Icon = KIND_ICON[event.kind];
  return (
    <li className="flex items-start gap-3 rounded-lg bg-black/5 px-3 py-2 dark:bg-white/5">
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: SEVERITY_COLOR[event.severity] }}
        aria-hidden
      />
      <Icon size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink/60 dark:text-white/60" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="text-sm font-medium">{t(event.title)}</p>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/50 dark:text-white/50">
            {t(`alerts.severity.${event.severity}`)}
          </span>
        </div>
        <p className="truncate text-xs text-ink/60 dark:text-white/60" title={event.detail}>
          {event.detail}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-[11px] tabular-nums text-ink/50 dark:text-white/50">
          {timeAgo(event.ts, t)}
        </span>
        {event.href ? (
          <Link href={event.href} className="text-[11px] font-medium underline underline-offset-2">
            {t('alerts.view')}
          </Link>
        ) : null}
      </div>
    </li>
  );
}

/**
 * G5 — composite-condition view: entities breaching >=2 signals at once
 * (high retransmission rate AND a large window-over-window volume drop).
 * A dashboard signal, NOT a CloudWatch alarm. Severity is dual-encoded — the
 * SEVERITY_COLOR dot is always paired with the always-visible severity text,
 * never color alone (chart-tokens.ts STATUS contract). Condition strings are
 * a data payload (rates/percentages), rendered verbatim like AlertEvent.detail.
 */
export function CompositeConditions({ rows }: { rows: CompositeRow[] }) {
  const { t } = useLanguage();
  if (rows.length === 0) {
    return (
      <p
        data-testid="alerts-composite-empty"
        className="ui-empty flex h-32 items-center justify-center text-sm text-ink/45 dark:text-white/45"
      >
        {t('alerts.composite.empty')}
      </p>
    );
  }
  return (
    <ul data-testid="alerts-composite-list" className="flex flex-col gap-2">
      {rows.map((r) => (
        <li
          key={r.label}
          className="flex items-start gap-3 rounded-lg bg-black/5 px-3 py-2 dark:bg-white/5"
        >
          <span
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: SEVERITY_COLOR[r.severity] }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p className="truncate text-sm font-medium" title={r.label}>
                {r.label}
              </p>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/50 dark:text-white/50">
                {t(`alerts.severity.${r.severity}`)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {r.conditions.map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-ink/70 dark:bg-white/10 dark:text-white/70"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function AlertsPage() {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<AlertsResponse>('/api/alerts');
  const alarms = data?.alarms ?? [];
  const events = data?.events ?? [];
  const composite = data?.composite ?? [];

  return (
    <div data-testid="alerts-page" className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t('alerts.title')}</h1>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Widget title={t('alerts.alarms')} testId="alerts-alarms">
          <LensState
            loading={loading && !data}
            error={error}
            empty={alarms.length === 0}
            emptyLabel={t('alerts.noAlarms')}
          >
            <ul className="flex flex-col gap-2">
              {alarms.map((a) => (
                <li
                  key={a.name}
                  className="flex items-center justify-between gap-3 rounded-lg bg-black/5 px-3 py-2 dark:bg-white/5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={a.name}>
                      {a.name}
                    </p>
                    <p className="truncate text-[11px] text-ink/50 dark:text-white/50">
                      {[a.metricName, a.updatedAt ? timeAgo(a.updatedAt, t) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <AlarmChip state={a.stateValue} />
                </li>
              ))}
            </ul>
          </LensState>
        </Widget>

        <Widget title={t('alerts.events')} testId="alerts-events">
          <LensState
            loading={loading && !data}
            error={error}
            empty={events.length === 0}
            emptyLabel={t('alerts.noEvents')}
          >
            <ul className="flex flex-col gap-2">
              {events.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </ul>
          </LensState>
        </Widget>
      </div>

      <Widget title={t('alerts.composite.title')} testId="alerts-composite">
        <LensState loading={loading && !data} error={error}>
          <CompositeConditions rows={composite} />
        </LensState>
      </Widget>
    </div>
  );
}
