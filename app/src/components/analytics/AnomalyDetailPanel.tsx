'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Clock, Repeat, TrendingUp, X, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { STATUS } from '@/lib/chart-tokens';
import { formatAnomalyValue, type Anomaly, type AnomalyKind, type AnomalySeverity } from '@/lib/analytics/anomalies';

const SEVERITY_COLOR: Record<AnomalySeverity, string> = {
  critical: STATUS.danger,
  warn: STATUS.warn,
};
const KIND_ICON: Record<AnomalyKind, LucideIcon> = {
  retrans: Repeat,
  timeout: Clock,
  spike: TrendingUp,
};

export default function AnomalyDetailPanel({
  anomaly,
  onClose,
}: {
  anomaly: Anomaly;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const Icon = KIND_ICON[anomaly.kind];
  const namespace = anomaly.label.split('/')[0];
  const overshoot = anomaly.value / Math.max(anomaly.baseline, 1e-9);

  // Escape closes the panel (dialog convention).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop — click to close. */}
      <div
        className="fixed inset-0 z-40 bg-black/20 dark:bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label={anomaly.label}
        data-testid="anomaly-detail"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col gap-4 overflow-y-auto bg-surface p-5 shadow-xl dark:bg-ink sm:w-96"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon size={18} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink/60 dark:text-white/60" />
            <h2 className="truncate text-base font-semibold" title={anomaly.label}>
              {anomaly.label}
            </h2>
          </div>
          <button
            type="button"
            data-testid="anomaly-detail-close"
            aria-label={t('anomalies.detail.close')}
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-ink/50 hover:bg-black/5 hover:text-ink dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/70 dark:bg-white/10 dark:text-white/70">
            {t(`anomalies.kind.${anomaly.kind}`)}
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SEVERITY_COLOR[anomaly.severity] }} aria-hidden />
            {t(`anomalies.severity.${anomaly.severity}`)}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <dt className="text-ink/50 dark:text-white/50">{t('anomalies.detail.metric')}</dt>
          <dd className="text-right font-medium">{anomaly.metric}</dd>
          <dt className="text-ink/50 dark:text-white/50">{t('anomalies.detail.current')}</dt>
          <dd className="text-right font-semibold tabular-nums">{formatAnomalyValue(anomaly, anomaly.value)}</dd>
          <dt className="text-ink/50 dark:text-white/50">{t('anomalies.detail.baseline')}</dt>
          <dd className="text-right tabular-nums">{formatAnomalyValue(anomaly, anomaly.baseline)}</dd>
          <dt className="text-ink/50 dark:text-white/50">{t('anomalies.detail.overshoot')}</dt>
          <dd className="text-right font-semibold tabular-nums">×{overshoot.toFixed(1)}</dd>
        </dl>

        <p className="rounded-lg bg-black/5 px-3 py-2 text-xs text-ink/70 dark:bg-white/5 dark:text-white/70">
          {anomaly.detail}
        </p>

        <div className="mt-auto flex flex-col gap-2">
          <Link
            href={`/topology?focus=${encodeURIComponent(anomaly.label)}`}
            data-testid="anomaly-link-topology"
            className="rounded-lg bg-ink px-3 py-2 text-center text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-ink"
          >
            {t('anomalies.detail.openTopology')}
          </Link>
          <Link
            href={`/network?ns=${encodeURIComponent(namespace)}`}
            data-testid="anomaly-link-network"
            className="rounded-lg border border-black/10 px-3 py-2 text-center text-sm font-medium hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
          >
            {t('anomalies.detail.openNetwork')}
          </Link>
        </div>
      </aside>
    </>
  );
}
