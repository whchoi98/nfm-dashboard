'use client';
// Shared plumbing for insights-hub tab components (4b's latency/dependencies/dns
// tabs reuse this): the common tab props and a per-widget lens state wrapper.
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { AnalyticsFilters } from '@/lib/analytics/filters';

/** Every hub tab receives the global filters and derives its lens query from them. */
export interface TabProps {
  filters: AnalyticsFilters;
}

/**
 * Widget body wrapper: error → common.error, first load → a shimmer skeleton
 * (announced as common.loading), empty → chart.empty in a dashed hairline box,
 * otherwise the chart itself. Charts with built-in empty states can skip
 * `empty`. Skeleton/empty chrome comes from the .ui-* utilities (globals.css).
 */
export function LensState({
  loading,
  error,
  empty = false,
  emptyLabel,
  children,
}: {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  emptyLabel?: string;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  if (error) {
    return (
      <p className="flex h-32 items-center justify-center text-sm text-ink/45 dark:text-white/45">
        {t('common.error')}
      </p>
    );
  }
  if (loading) {
    return (
      <div role="status" className="flex h-32 flex-col justify-center gap-2.5">
        <div className="ui-skeleton h-3 w-2/5" aria-hidden />
        <div className="ui-skeleton h-3 w-full" aria-hidden />
        <div className="ui-skeleton h-3 w-4/5" aria-hidden />
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    );
  }
  if (empty) {
    return (
      <p className="ui-empty flex h-32 items-center justify-center text-sm text-ink/45 dark:text-white/45">
        {emptyLabel ?? t('chart.empty')}
      </p>
    );
  }
  return <>{children}</>;
}

/** USD display shared by the cost widgets: 2 decimals, but tiny non-zero
 *  estimates (lab traffic is fractions of a cent) get 4 so they don't
 *  collapse to a misleading "$0.00". */
export function formatUsd(v: number): string {
  if (v > 0 && v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}
