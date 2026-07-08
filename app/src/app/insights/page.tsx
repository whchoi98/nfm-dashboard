'use client';

import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { WiResult } from '@/lib/types';
import { CATEGORY_ORDER, type DestCategory } from '@/lib/chart-tokens';
import { formatBytes } from '@/lib/format';
import CategoryBars, { type ByCategory } from '@/components/charts/CategoryBars';
import CategoryDonut from '@/components/charts/CategoryDonut';
import { Card } from '@/components/ui/Controls';

interface InsightsData {
  byCategory: ByCategory;
  rows: WiResult[];
}

export default function InsightsPage() {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<InsightsData>('/api/insights');

  const byCategory = data?.byCategory ?? null;
  const donutValues = byCategory
    ? (Object.fromEntries(
        CATEGORY_ORDER.map((c) => [c, byCategory[c]?.dataTransferred ?? 0]),
      ) as Record<DestCategory, number>)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t('nav.insights')}</h1>

      {error ? (
        <Card>
          <p className="text-sm text-ink/60 dark:text-white/60">{t('common.error')}</p>
        </Card>
      ) : loading && !data ? (
        <Card>
          <p className="text-sm text-ink/40 dark:text-white/40">{t('common.loading')}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card title={t('insights.byCategory')} className="xl:col-span-2">
            <CategoryBars byCategory={byCategory} />
          </Card>
          <Card title={t('insights.distribution')}>
            <CategoryDonut values={donutValues} valueFormatter={formatBytes} />
            <p className="mt-3 text-[11px] text-ink/50 dark:text-white/50">{t('insights.distributionHint')}</p>
          </Card>
        </div>
      )}
    </div>
  );
}
