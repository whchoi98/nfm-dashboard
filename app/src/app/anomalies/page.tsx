'use client';

// /anomalies — baseline-deviation detection across service entities:
// threshold exceedances (retrans/timeout events per GB) plus window-over-window
// spikes (current > σ × prior). Thresholds and σ come from useSettings()
// (Settings page, localStorage) and are passed to /api/anomalies as query
// params; the route falls back to the reliability lens defaults when absent.
import { useState } from 'react';
import Link from 'next/link';
import { Clock, Repeat, TrendingUp, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import { useSettings } from '@/lib/settings';
import { rangeToBuckets } from '@/lib/analytics/filters';
import { formatAnomalyValue, type Anomaly, type AnomalyKind, type AnomalySeverity } from '@/lib/analytics/anomalies';
import { STATUS } from '@/lib/chart-tokens';
import { formatCount } from '@/lib/format';
import StatDelta from '@/components/charts/StatDelta';
import Widget from '@/components/analytics/Widget';
import AnomalyDetailPanel from '@/components/analytics/AnomalyDetailPanel';
import PageIntro from '@/components/PageIntro';
import { LensState } from '@/app/insights/tabs/shared';

interface AnomaliesResponse {
  anomalies: Anomaly[];
}

// Severity dot colors from chart tokens — ALWAYS dual-encoded with the
// severity text label next to them (pastels are not reliable alone).
const SEVERITY_COLOR: Record<AnomalySeverity, string> = {
  critical: STATUS.danger,
  warn: STATUS.warn,
};

const KIND_ICON: Record<AnomalyKind, LucideIcon> = {
  retrans: Repeat,
  timeout: Clock,
  spike: TrendingUp,
};

function AnomalyRow({
  anomaly,
  onSelect,
  selected,
}: {
  anomaly: Anomaly;
  onSelect: () => void;
  selected: boolean;
}) {
  const { t } = useLanguage();
  const Icon = KIND_ICON[anomaly.kind];
  return (
    <li>
      <button
        type="button"
        data-testid={`anomaly-row-${anomaly.key}`}
        onClick={onSelect}
        aria-pressed={selected}
        className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
          selected ? 'bg-black/10 dark:bg-white/10' : 'bg-black/5 hover:bg-black/[.08] dark:bg-white/5 dark:hover:bg-white/[.08]'
        }`}
      >
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: SEVERITY_COLOR[anomaly.severity] }}
          aria-hidden
        />
        <Icon size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink/60 dark:text-white/60" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="truncate text-sm font-medium" title={anomaly.label}>{anomaly.label}</p>
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/70 dark:bg-white/10 dark:text-white/70">
              {t(`anomalies.kind.${anomaly.kind}`)}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/50 dark:text-white/50">
              {t(`anomalies.severity.${anomaly.severity}`)}
            </span>
          </div>
          <p className="truncate text-xs text-ink/60 dark:text-white/60" title={anomaly.detail}>{anomaly.detail}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums">{formatAnomalyValue(anomaly, anomaly.value)}</p>
          <p className="text-[11px] tabular-nums text-ink/50 dark:text-white/50">
            {t('anomalies.vsBaseline', { baseline: formatAnomalyValue(anomaly, anomaly.baseline) })}
          </p>
        </div>
      </button>
    </li>
  );
}

export default function AnomaliesPage() {
  const { t } = useLanguage();
  const { settings } = useSettings();
  const query =
    `?buckets=${rangeToBuckets(settings.defaultRange)}` +
    `&retrans=${settings.retransThreshold}&timeout=${settings.timeoutThreshold}` +
    `&sigma=${settings.anomalySigma}`;
  const { data, error, loading } = usePolling<AnomaliesResponse>(`/api/anomalies${query}`);
  const firstLoad = loading && !data;
  const anomalies = data?.anomalies ?? [];
  // Track the selection by its composite id, not the object, so the panel
  // follows the 30s poll: `selected` is re-derived from the LIVE array each
  // render — it picks up updated value/baseline and drops to null (panel
  // auto-closes) once the anomaly resolves and leaves the list.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    anomalies.find((a) => `${a.kind}:${a.metric}:${a.key}` === selectedId) ?? null;

  const counts: Record<AnomalyKind, number> = { retrans: 0, timeout: 0, spike: 0 };
  for (const a of anomalies) counts[a.kind] += 1;

  return (
    <div data-testid="anomalies-page" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('anomalies.title')}</h1>
        <Link
          href="/settings"
          className="text-xs font-medium text-ink/60 hover:text-ink hover:underline dark:text-white/60 dark:hover:text-white"
        >
          {t('nav.settings')} →
        </Link>
      </div>
      <PageIntro page="anomalies" />
      <p className="text-xs text-ink/60 dark:text-white/60">
        {t('anomalies.hint', {
          retrans: settings.retransThreshold,
          timeout: settings.timeoutThreshold,
          sigma: settings.anomalySigma,
        })}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {(['retrans', 'timeout', 'spike'] as const).map((kind) => (
          <StatDelta
            key={kind}
            testId={`anomalies-count-${kind}`}
            label={t(`anomalies.kind.${kind}`)}
            value={firstLoad ? '…' : formatCount(counts[kind])}
            status={firstLoad ? undefined : counts[kind] > 0 ? 'danger' : 'ok'}
          />
        ))}
      </div>

      <Widget title={t('anomalies.list')} testId="anomalies-list">
        <LensState
          loading={firstLoad}
          error={error}
          empty={anomalies.length === 0}
          emptyLabel={t('anomalies.empty')}
        >
          <ul className="flex flex-col gap-2">
            {anomalies.map((a) => {
              const id = `${a.kind}:${a.metric}:${a.key}`;
              return (
                <AnomalyRow
                  key={id}
                  anomaly={a}
                  selected={selectedId === id}
                  onSelect={() => setSelectedId(id)}
                />
              );
            })}
          </ul>
        </LensState>
      </Widget>

      {selected && (
        <AnomalyDetailPanel anomaly={selected} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
