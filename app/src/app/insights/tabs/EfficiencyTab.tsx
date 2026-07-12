'use client';
// Efficiency tab (Phase 7 Task 1): bento grid over the efficiency lens —
// billed-ratio gauge, cost run-rate stat tiles, top cross-AZ talkers,
// billed-vs-free category donut and the billed-USD trend.
import { useMemo } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import { lensQuery } from '@/lib/analytics/filters';
import type { EfficiencyResult } from '@/lib/analytics/efficiency';
import { CATEGORY_ORDER, type DestCategory } from '@/lib/chart-tokens';
import { formatBytes } from '@/lib/format';
import Widget from '@/components/analytics/Widget';
import Toplist, { type ToplistRow } from '@/components/analytics/Toplist';
import Gauge from '@/components/charts/Gauge';
import StatDelta from '@/components/charts/StatDelta';
import CategoryDonut from '@/components/charts/CategoryDonut';
import TimeSeries from '@/components/charts/TimeSeries';
import { formatUsd, LensState, type TabProps } from './shared';

// Billed-share heuristics (lab-scale, the USD figures are estimates anyway):
// under 25% of bytes billed is fine, 25–50% deserves a look, ≥ 50% means most
// traffic crosses an AZ/VPC/Region boundary — a re-architecture candidate.
const WARN_RATIO = 0.25;
const DANGER_RATIO = 0.5;

export default function EfficiencyTab({ filters }: TabProps) {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<EfficiencyResult>(
    `/api/analytics/efficiency${lensQuery(filters)}`,
  );
  const firstLoad = loading && !data;

  const billedRatio = data?.billedRatio ?? 0;
  const ratioStatus = billedRatio < WARN_RATIO ? 'ok' : billedRatio < DANGER_RATIO ? 'warn' : 'danger';

  // Sparkline for the run-rate tile: billed USD per bucket from the trend.
  const spark = useMemo(() => (data?.trend.points ?? []).map((p) => p.v), [data]);

  // Toplist contract: rows must arrive pre-sorted desc by value (USD).
  const topRows: ToplistRow[] = useMemo(
    () =>
      [...(data?.topCrossAz ?? [])]
        .sort((a, b) => b.usd - a.usd)
        .map((r) => ({ label: r.label, value: r.usd, sub: formatBytes(r.bytes) })),
    [data],
  );

  // Bytes per category (billed categories carry the cost; free ones are $0).
  const donutValues = useMemo(() => {
    if (!data) return null;
    return Object.fromEntries(
      CATEGORY_ORDER.map((c) => [c, data.byCategory[c]?.bytes ?? 0]),
    ) as Record<DestCategory, number>;
  }, [data]);

  const trendSeries = useMemo(
    () => [{ name: t('insights.efficiency.trendSeries'), points: data?.trend.points ?? [] }],
    [data, t],
  );

  return (
    <div
      data-testid="insights-efficiency-panel"
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
    >
      <Widget title={t('insights.efficiency.billedRatio')} testId="widget-efficiency-ratio">
        <LensState loading={firstLoad} error={error}>
          <Gauge
            value={billedRatio * 100}
            max={100}
            label={t('insights.efficiency.billedRatioLabel')}
            status={ratioStatus}
            valueFormatter={(n) => `${n.toFixed(1)}%`}
          />
        </LensState>
      </Widget>

      <Widget title={t('insights.efficiency.runRate')} testId="widget-efficiency-runrate">
        <LensState loading={firstLoad} error={error}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatDelta
              label={t('insights.efficiency.monthly')}
              value={formatUsd(data?.monthlyUsdRunRate ?? 0)}
              status={ratioStatus}
              spark={spark}
              testId="stat-efficiency-monthly"
            />
            <StatDelta
              label={t('insights.efficiency.window')}
              value={formatUsd(data?.windowUsd ?? 0)}
              testId="stat-efficiency-window"
            />
          </div>
        </LensState>
      </Widget>

      <Widget title={t('insights.efficiency.topCrossAz')} testId="widget-efficiency-top">
        <LensState loading={firstLoad} error={error}>
          <Toplist
            rows={topRows}
            valueFormatter={formatUsd}
            testId="toplist-efficiency-top"
            sortable
            valueHeader={t('common.usd')}
          />
        </LensState>
      </Widget>

      <Widget title={t('insights.efficiency.byCategory')} testId="widget-efficiency-category">
        <LensState loading={firstLoad} error={error}>
          <CategoryDonut values={donutValues} valueFormatter={formatBytes} />
        </LensState>
      </Widget>

      <Widget
        title={t('insights.efficiency.trend')}
        testId="widget-efficiency-trend"
        className="md:col-span-2"
      >
        <LensState loading={firstLoad} error={error}>
          <TimeSeries series={trendSeries} valueFormatter={formatUsd} height={240} />
        </LensState>
      </Widget>
    </div>
  );
}
