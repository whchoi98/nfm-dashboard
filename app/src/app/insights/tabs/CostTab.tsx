'use client';
// Cost tab (Task 4a): bento grid over the cost lens — stat tile, category
// treemap, top-contributor toplist, category streamgraph and region arc map.
import { useMemo } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import { lensQuery } from '@/lib/analytics/filters';
import type { CostLensResult } from '@/lib/analytics/cost';
import { CATEGORY_ORDER } from '@/lib/chart-tokens';
import { formatBytes } from '@/lib/format';
import Widget from '@/components/analytics/Widget';
import Toplist, { type ToplistRow } from '@/components/analytics/Toplist';
import StatDelta from '@/components/charts/StatDelta';
import Treemap, { type TreemapDatum } from '@/components/charts/Treemap';
import StreamGraph from '@/components/charts/StreamGraph';
import RegionArcMap from '@/components/charts/RegionArcMap';
import { formatUsd, LensState, type TabProps } from './shared';

// Status thresholds for the estimated cost of the SELECTED WINDOW (lab-scale
// heuristic, spec §6.1 calls the value an estimate anyway): under $1 is
// background noise (ok), $1–10 deserves a look (warn), ≥ $10 is a red flag.
const WARN_USD = 1;
const DANGER_USD = 10;

export default function CostTab({ filters }: TabProps) {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<CostLensResult>(
    `/api/analytics/cost${lensQuery(filters)}`,
  );
  const firstLoad = loading && !data;

  // Sparkline for the stat tile: total estimated USD per bucket (sum of the
  // lens' per-category series).
  const spark = useMemo(() => {
    const byT = new Map<string, number>();
    for (const s of data?.series ?? []) {
      for (const p of s.points) byT.set(p.t, (byT.get(p.t) ?? 0) + p.v);
    }
    return [...byT.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [data]);

  const treemapData: TreemapDatum[] = useMemo(
    () =>
      CATEGORY_ORDER.map((c) => ({
        name: t(`category.${c}`),
        value: data?.byCategory[c]?.usd ?? 0,
      })).filter((d) => d.value > 0),
    [data, t],
  );

  // Toplist contract: rows must arrive pre-sorted desc by value (USD).
  const topRows: ToplistRow[] = useMemo(
    () =>
      [...(data?.top ?? [])]
        .sort((a, b) => b.usd - a.usd)
        .slice(0, 10)
        .map((r) => ({ label: r.label, value: r.usd, sub: formatBytes(r.bytes) })),
    [data],
  );

  const streamKeys = useMemo(
    () =>
      CATEGORY_ORDER.filter((c) =>
        (data?.stream ?? []).some((p) => (p.values[c] ?? 0) > 0),
      ),
    [data],
  );

  const totalUsd = data?.totalUsd ?? 0;
  const status = totalUsd < WARN_USD ? 'ok' : totalUsd < DANGER_USD ? 'warn' : 'danger';

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Widget title={t('insights.cost.total')} testId="widget-cost-total">
        <LensState loading={firstLoad} error={error}>
          <StatDelta
            label={t('insights.cost.estimate')}
            value={formatUsd(totalUsd)}
            status={status}
            spark={spark}
            testId="stat-cost-total"
          />
        </LensState>
      </Widget>

      <Widget title={t('insights.cost.byCategory')} testId="widget-cost-by-category">
        <LensState loading={firstLoad} error={error}>
          <Treemap data={treemapData} valueFormatter={formatUsd} height={220} />
        </LensState>
      </Widget>

      <Widget title={t('insights.cost.topContributors')} testId="widget-cost-top">
        <LensState loading={firstLoad} error={error}>
          <Toplist rows={topRows} valueFormatter={formatUsd} testId="toplist-cost-top" />
        </LensState>
      </Widget>

      <Widget
        title={t('insights.cost.stream')}
        testId="widget-cost-stream"
        className="md:col-span-2"
      >
        <LensState loading={firstLoad} error={error}>
          <StreamGraph
            data={data?.stream ?? []}
            keys={streamKeys}
            valueFormatter={formatBytes}
            height={240}
          />
        </LensState>
      </Widget>

      <Widget title={t('insights.cost.regionArcs')} testId="widget-cost-regions">
        <LensState loading={firstLoad} error={error}>
          <RegionArcMap arcs={data?.regionArcs ?? []} />
        </LensState>
      </Widget>
    </div>
  );
}
