'use client';
// Latency tab (Task 4b): RTT percentile tiles, intra- vs inter-AZ compare,
// distribution histogram, slowest-path toplist, tail-paths (p95/jitter) table,
// RTT trend and the day×hour heatmap. NFM emits ROUND_TRIP_TIME for few flows,
// so an empty window is the normal case — every widget falls back to the
// dedicated latency empty-state.
import { useMemo } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import { lensQuery } from '@/lib/analytics/filters';
import type { LatencyLensResult, TailPath } from '@/lib/analytics/latency';
import { formatMicros } from '@/lib/format';
import { useSortableRows, type SortColumn } from '@/lib/use-sortable';
import Widget from '@/components/analytics/Widget';
import Toplist, { type ToplistRow } from '@/components/analytics/Toplist';
import { useHoverSync } from '@/components/analytics/HoverSync';
import StatDelta from '@/components/charts/StatDelta';
import TimeSeries from '@/components/charts/TimeSeries';
import Distribution from '@/components/charts/Distribution';
import Heatmap, { type HeatmapCell } from '@/components/charts/Heatmap';
import { SortableHeader } from '@/components/SortableHeader';
import { LensState, type TabProps } from './shared';

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

// Sort on the RAW numeric fields, never the `formatMicros` display text.
const TAIL_COLUMNS: SortColumn<TailPath>[] = [
  { key: 'label', type: 'string', accessor: (r) => r.label },
  { key: 'p50', type: 'number', accessor: (r) => r.p50 },
  { key: 'p95', type: 'number', accessor: (r) => r.p95 },
  { key: 'jitter', type: 'number', accessor: (r) => r.jitter },
];

export default function LatencyTab({ filters }: TabProps) {
  const { t, lang } = useLanguage();
  const { data, error, loading } = usePolling<LatencyLensResult>(
    `/api/analytics/latency${lensQuery(filters)}`,
  );
  const firstLoad = loading && !data;
  // Shared crosshair: the RTT trend produces activeT on hover and reads it
  // back (badge + reference line), same pattern as ReliabilityTab's NHI widget.
  const { activeT, setActiveT } = useHoverSync();
  const emptyLabel = t('insights.latency.empty');

  // Toplist contract: rows pre-sorted desc by value (mean RTT in µs).
  const slowRows: ToplistRow[] = useMemo(
    () =>
      [...(data?.slowest ?? [])]
        .sort((a, b) => b.rtt - a.rtt)
        .slice(0, 10)
        .map((r) => ({ label: r.label, value: r.rtt })),
    [data],
  );

  // Localized short weekday names, index 0 = Sunday (matches RttHeatmapCell.day).
  const dayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' });
    // 2023-01-01 was a Sunday.
    return Array.from({ length: 7 }, (_, d) => fmt.format(new Date(Date.UTC(2023, 0, 1 + d))));
  }, [lang]);

  // hourHeatmap cells → Heatmap's row/col/cell shape (only observed days/hours).
  const heat = useMemo(() => {
    const src = data?.hourHeatmap ?? [];
    const hourLabel = (h: number) => String(h).padStart(2, '0');
    const days = [...new Set(src.map((c) => c.day))].sort((a, b) => a - b);
    const hours = [...new Set(src.map((c) => c.hour))].sort((a, b) => a - b);
    const cells: HeatmapCell[] = src.map((c) => ({
      row: dayNames[c.day],
      col: hourLabel(c.hour),
      value: c.value,
    }));
    return { rows: days.map((d) => dayNames[d]), cols: hours.map(hourLabel), cells };
  }, [data, dayNames]);

  const overall = data?.overall;
  const trendPoints = data?.trend.points ?? [];
  // Tail-path rows arrive pre-sorted (p95 desc) and capped at 20 by the lens.
  const tailRows = data?.slowestTail ?? [];
  // Default sort = p95 desc (unchanged first render vs. the pre-Phase-15 lens order).
  const { sorted: sortedTail, sort: tailSort, onSort: onTailSort } = useSortableRows(
    tailRows,
    TAIL_COLUMNS,
    { key: 'p95', dir: 'desc' },
  );

  return (
    <div
      data-testid="insights-latency-panel"
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
    >
      <Widget title={t('insights.latency.summary')} testId="widget-latency-summary">
        <LensState
          loading={firstLoad}
          error={error}
          empty={(overall?.count ?? 0) === 0}
          emptyLabel={emptyLabel}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatDelta
              label={t('insights.latency.p50')}
              value={formatMicros(overall?.p50 ?? 0)}
              testId="stat-latency-p50"
            />
            <StatDelta
              label={t('insights.latency.p90')}
              value={formatMicros(overall?.p90 ?? 0)}
              testId="stat-latency-p90"
            />
            <StatDelta
              label={t('insights.latency.p95')}
              value={formatMicros(overall?.p95 ?? 0)}
              testId="stat-latency-p95"
            />
            <StatDelta
              label={t('insights.latency.p99')}
              value={formatMicros(overall?.p99 ?? 0)}
              testId="stat-latency-p99"
            />
            <StatDelta
              label={t('insights.latency.min')}
              value={formatMicros(overall?.min ?? 0)}
              testId="stat-latency-min"
            />
            <StatDelta
              label={t('insights.latency.max')}
              value={formatMicros(overall?.max ?? 0)}
              testId="stat-latency-max"
            />
          </div>
        </LensState>
      </Widget>

      <Widget title={t('insights.latency.intraInter')} testId="widget-latency-intra-inter">
        <LensState
          loading={firstLoad}
          error={error}
          empty={(data?.intra.count ?? 0) === 0 && (data?.inter.count ?? 0) === 0}
          emptyLabel={emptyLabel}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatDelta
              label={`${t('category.INTRA_AZ')} p50`}
              value={formatMicros(data?.intra.p50 ?? 0)}
              testId="stat-latency-intra"
            />
            <StatDelta
              label={`${t('category.INTER_AZ')} p50`}
              value={formatMicros(data?.inter.p50 ?? 0)}
              testId="stat-latency-inter"
            />
          </div>
        </LensState>
      </Widget>

      <Widget title={t('insights.latency.distribution')} testId="widget-latency-distribution">
        <LensState
          loading={firstLoad}
          error={error}
          empty={(data?.distribution ?? []).length === 0}
          emptyLabel={emptyLabel}
        >
          <Distribution bins={data?.distribution ?? []} unit="µs" height={220} />
        </LensState>
      </Widget>

      <Widget title={t('insights.latency.slowest')} testId="widget-latency-slowest">
        <LensState loading={firstLoad} error={error} empty={slowRows.length === 0} emptyLabel={emptyLabel}>
          <Toplist
            rows={slowRows}
            valueFormatter={formatMicros}
            testId="toplist-latency-slowest"
            sortable
            valueHeader={t('metric.ROUND_TRIP_TIME')}
          />
        </LensState>
      </Widget>

      <Widget title={t('insights.latency.tailPaths')} testId="widget-latency-tail">
        <LensState
          loading={firstLoad}
          error={error}
          empty={tailRows.length === 0}
          emptyLabel={emptyLabel}
        >
          {/* Capped height + scroll: keeps up to 20 tail rows inside the bento cell. */}
          <div className="max-h-96 overflow-auto">
            <table data-testid="toplist-latency-tail" className="w-full text-xs">
              <thead>
                <tr className="text-left">
                  <SortableHeader label={t('nav.paths')} columnKey="label" sort={tailSort} onSort={onTailSort} className="pr-2" />
                  <SortableHeader label={t('insights.latency.p50')} columnKey="p50" sort={tailSort} onSort={onTailSort} className="pr-2" />
                  <SortableHeader label={t('insights.latency.p95')} columnKey="p95" sort={tailSort} onSort={onTailSort} className="pr-2" />
                  <SortableHeader label={t('insights.latency.jitter')} columnKey="jitter" sort={tailSort} onSort={onTailSort} />
                </tr>
              </thead>
              <tbody>
                {sortedTail.map((r) => (
                  <tr key={r.key} className="border-t border-black/5 dark:border-white/10">
                    <td className="max-w-48 truncate py-1.5 pr-2 font-medium" title={r.label}>
                      {r.label}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums">{formatMicros(r.p50)}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{formatMicros(r.p95)}</td>
                    <td className="py-1.5 tabular-nums">{formatMicros(r.jitter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LensState>
      </Widget>

      <Widget
        title={t('insights.latency.trend')}
        testId="widget-latency-trend"
        className="md:col-span-2"
        actions={
          activeT ? (
            <span className="text-[11px] tabular-nums text-ink/50 dark:text-white/50">
              {timeLabel(activeT)}
            </span>
          ) : undefined
        }
      >
        <LensState loading={firstLoad} error={error} empty={trendPoints.length === 0} emptyLabel={emptyLabel}>
          <TimeSeries
            series={[{ name: t('metric.ROUND_TRIP_TIME'), points: trendPoints }]}
            valueFormatter={formatMicros}
            height={220}
            activeT={activeT}
            onActiveTimeChange={setActiveT}
          />
        </LensState>
      </Widget>

      <Widget
        title={t('insights.latency.heatmap')}
        testId="widget-latency-heatmap"
        className="md:col-span-2 xl:col-span-3"
      >
        <LensState loading={firstLoad} error={error} empty={heat.cells.length === 0} emptyLabel={emptyLabel}>
          <Heatmap rows={heat.rows} cols={heat.cols} cells={heat.cells} valueFormatter={formatMicros} />
        </LensState>
      </Widget>
    </div>
  );
}
