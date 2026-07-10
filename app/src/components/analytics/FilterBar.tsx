'use client';
// Global analytics-hub filter row: sticky on top, wraps on mobile. Every hub
// widget reads the same AnalyticsFilters; 'all' is passed as an explicit option
// value (Select's allLabel/"" convention is not used — our sentinel is 'all').
import { Select } from '@/components/ui/Controls';
import { CATEGORY_ORDER } from '@/lib/chart-tokens';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import {
  type AnalyticsFilters,
  METRIC_NAMES,
  TIME_RANGES,
  type TimeRange,
} from '@/lib/analytics/filters';
import type { MetricName } from '@/lib/types';

export type FilterBarField = 'range' | 'cluster' | 'namespace' | 'category' | 'metric';

export default function FilterBar({
  filters,
  setFilter,
  clusters = [],
  namespaces = [],
  hide = [],
}: {
  filters: AnalyticsFilters;
  setFilter: <K extends keyof AnalyticsFilters>(k: K, v: AnalyticsFilters[K]) => void;
  clusters?: string[];
  namespaces?: string[];
  /** Controls to omit (e.g. the insights hub hides cluster/metric it does not wire). */
  hide?: FilterBarField[];
}) {
  const { t } = useLanguage();
  const show = (f: FilterBarField) => !hide.includes(f);
  const withAll = (values: string[]) => [
    { value: 'all', label: t('filter.all') },
    ...values.map((v) => ({ value: v, label: v })),
  ];
  return (
    <div
      data-testid="filter-bar"
      className="sticky top-0 z-20 flex flex-wrap items-end gap-3 rounded-card bg-surface p-3 dark:bg-ink"
    >
      {show('range') ? (
        <Select
          label={t('filter.range')}
          value={filters.range}
          onChange={(v) => setFilter('range', v as TimeRange)}
          options={TIME_RANGES.map((r) => ({ value: r, label: t(`filter.range.${r}`) }))}
        />
      ) : null}
      {show('cluster') ? (
        <Select
          label={t('filter.cluster')}
          value={filters.cluster}
          onChange={(v) => setFilter('cluster', v)}
          options={withAll(clusters)}
        />
      ) : null}
      {show('namespace') ? (
        <Select
          label={t('filter.namespace')}
          value={filters.namespace}
          onChange={(v) => setFilter('namespace', v)}
          options={withAll(namespaces)}
        />
      ) : null}
      {show('category') ? (
        <Select
          label={t('filter.category')}
          value={filters.category}
          onChange={(v) => setFilter('category', v)}
          options={[
            { value: 'all', label: t('filter.all') },
            ...CATEGORY_ORDER.map((c) => ({ value: c, label: t(`category.${c}`) })),
          ]}
        />
      ) : null}
      {show('metric') ? (
        <Select
          label={t('filter.metric')}
          value={filters.metric}
          onChange={(v) => setFilter('metric', v as MetricName)}
          options={METRIC_NAMES.map((m) => ({ value: m, label: t(`metric.${m}`) }))}
        />
      ) : null}
    </div>
  );
}
