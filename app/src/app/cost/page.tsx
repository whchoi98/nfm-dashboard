'use client';

// /cost — Cost Explorer (Phase 8 Task 4): a deeper billed-cost view than the
// insights Efficiency tab. Polls /api/cost-explorer over a selectable range:
// window total + monthly run-rate, billed cost grouped by cluster / namespace /
// monitor / category, savings recommendations and the billed-USD trend.
// All USD figures are estimates derived from cost.ts bytesToUsd.
import { useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import { rangeToBuckets, TIME_RANGES, type TimeRange } from '@/lib/analytics/filters';
import type { CostExplorerResult, CostGroupRow } from '@/lib/analytics/cost-explorer';
import { CATEGORY_ORDER, type DestCategory } from '@/lib/chart-tokens';
import { formatBytes } from '@/lib/format';
import { Select } from '@/components/ui/Controls';
import Widget from '@/components/analytics/Widget';
import Toplist, { type ToplistRow } from '@/components/analytics/Toplist';
import StatDelta from '@/components/charts/StatDelta';
import CategoryDonut from '@/components/charts/CategoryDonut';
import TimeSeries from '@/components/charts/TimeSeries';
import { formatUsd, LensState } from '@/app/insights/tabs/shared';

/** Toplist rows from a lens group: value = USD, sub = bytes, pre-sorted by the lens. */
function groupRows(rows: CostGroupRow[] | undefined): ToplistRow[] {
  return (rows ?? []).map((r) => ({ label: r.label, value: r.usd, sub: formatBytes(r.bytes) }));
}

export default function CostExplorerPage() {
  const { t } = useLanguage();
  const [range, setRange] = useState<TimeRange>('1h');
  const { data, error, loading } = usePolling<CostExplorerResult>(
    `/api/cost-explorer?buckets=${rangeToBuckets(range)}`,
  );
  const firstLoad = loading && !data;

  // Sparkline for the run-rate tile: billed USD per bucket from the trend.
  const spark = useMemo(() => (data?.trend.points ?? []).map((p) => p.v), [data]);

  const clusterRows = useMemo(() => groupRows(data?.byCluster), [data]);
  const namespaceRows = useMemo(() => groupRows(data?.byNamespace), [data]);
  const monitorRows = useMemo(() => groupRows(data?.byMonitor), [data]);

  // Egress toplist: label = domain, value = USD, sub = bytes — same shape as
  // the other cost-group toplists (cost.ts egressBytesToUsd, not bytesToUsd).
  const egressDomainRows = useMemo(
    () =>
      (data?.egressDomains ?? []).map((r) => ({
        label: r.domain,
        value: r.usd,
        sub: formatBytes(r.bytes),
      })),
    [data],
  );

  // Savings toplist: label + estimated USD; the sub carries the translated hint.
  const savingsRows: ToplistRow[] = useMemo(
    () => (data?.savings ?? []).map((s) => ({ label: s.label, value: s.usd, sub: t(s.hint) })),
    [data, t],
  );

  // Billed USD per category (free categories are $0 → only billed slices render).
  const donutValues = useMemo(() => {
    if (!data) return null;
    return Object.fromEntries(
      CATEGORY_ORDER.map((c) => [c, data.byCategory[c]?.usd ?? 0]),
    ) as Record<DestCategory, number>;
  }, [data]);

  const trendSeries = useMemo(
    () => [{ name: t('cost.trendSeries'), points: data?.trend.points ?? [] }],
    [data, t],
  );

  return (
    <div data-testid="cost-explorer-page" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t('cost.title')}</h1>
          <p className="text-xs text-ink/50 dark:text-white/50">{t('cost.estimateNote')}</p>
        </div>
        <Select
          label={t('filter.range')}
          value={range}
          onChange={(v) => setRange(v as TimeRange)}
          options={TIME_RANGES.map((r) => ({ value: r, label: t(`filter.range.${r}`) }))}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Widget title={t('cost.summary')} testId="widget-cost-summary">
          <LensState loading={firstLoad} error={error}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatDelta
                label={t('cost.windowTotal')}
                value={formatUsd(data?.totalUsd ?? 0)}
                testId="stat-cost-total"
              />
              <StatDelta
                label={t('cost.monthly')}
                value={formatUsd(data?.monthlyRunRate ?? 0)}
                spark={spark}
                testId="stat-cost-monthly"
              />
            </div>
          </LensState>
        </Widget>

        <Widget title={t('cost.byCluster')} testId="widget-cost-cluster">
          <LensState loading={firstLoad} error={error}>
            <Toplist
              rows={clusterRows}
              valueFormatter={formatUsd}
              testId="toplist-cost-cluster"
              sortable
              valueHeader={t('common.usd')}
            />
          </LensState>
        </Widget>

        <Widget title={t('cost.byNamespace')} testId="widget-cost-namespace">
          <LensState loading={firstLoad} error={error}>
            <Toplist
              rows={namespaceRows}
              valueFormatter={formatUsd}
              testId="toplist-cost-namespace"
              sortable
              valueHeader={t('common.usd')}
            />
          </LensState>
        </Widget>

        <Widget title={t('cost.byMonitor')} testId="widget-cost-monitor">
          <LensState loading={firstLoad} error={error}>
            <Toplist
              rows={monitorRows}
              valueFormatter={formatUsd}
              testId="toplist-cost-monitor"
              sortable
              valueHeader={t('common.usd')}
            />
          </LensState>
        </Widget>

        <Widget title={t('cost.byCategory')} testId="widget-cost-category">
          <LensState loading={firstLoad} error={error}>
            <CategoryDonut values={donutValues} valueFormatter={formatUsd} />
          </LensState>
        </Widget>

        <Widget title={t('cost.egressByDomain')} testId="widget-cost-egress-domain">
          <LensState loading={firstLoad} error={error}>
            <Toplist
              rows={egressDomainRows}
              valueFormatter={formatUsd}
              testId="toplist-cost-egress-domain"
              sortable
              valueHeader={t('common.usd')}
            />
          </LensState>
        </Widget>

        <Widget title={t('cost.savings')} testId="widget-cost-savings">
          <LensState loading={firstLoad} error={error}>
            <Toplist
              rows={savingsRows}
              valueFormatter={formatUsd}
              testId="toplist-cost-savings"
              sortable
              valueHeader={t('common.usd')}
            />
          </LensState>
        </Widget>

        <Widget
          title={t('cost.trend')}
          testId="widget-cost-trend"
          className="md:col-span-2 xl:col-span-3"
        >
          <LensState loading={firstLoad} error={error}>
            <TimeSeries series={trendSeries} valueFormatter={formatUsd} height={240} />
          </LensState>
        </Widget>
      </div>
    </div>
  );
}
