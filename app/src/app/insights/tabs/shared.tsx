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
 * Widget body wrapper: error → common.error, first load → common.loading,
 * empty → chart.empty, otherwise the chart itself. Charts with built-in empty
 * states can skip `empty`.
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
  const notice = (text: string) => (
    <p className="flex h-32 items-center justify-center text-sm text-ink/40 dark:text-white/40">
      {text}
    </p>
  );
  if (error) return notice(t('common.error'));
  if (loading) return notice(t('common.loading'));
  if (empty) return notice(emptyLabel ?? t('chart.empty'));
  return <>{children}</>;
}

/** USD display shared by the cost widgets: 2 decimals, but tiny non-zero
 *  estimates (lab traffic is fractions of a cent) get 4 so they don't
 *  collapse to a misleading "$0.00". */
export function formatUsd(v: number): string {
  if (v > 0 && v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}
