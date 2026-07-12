'use client';
// Dependencies tab (Task 4b): service sankey, port/namespace/category traffic
// composition, top-talker pareto and the hop-path icicle — DATA_TRANSFERRED
// composition views over the dependencies lens.
import { useMemo } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import { lensQuery } from '@/lib/analytics/filters';
import {
  PATH_TREE_MAX_CHILDREN,
  SANKEY_MAX_LINKS,
  type DependenciesLensResult,
} from '@/lib/analytics/dependencies';
import { CATEGORY_ORDER, type DestCategory } from '@/lib/chart-tokens';
import { formatBytes, formatCount } from '@/lib/format';
import Widget from '@/components/analytics/Widget';
import Toplist, { type ToplistRow } from '@/components/analytics/Toplist';
import StatDelta from '@/components/charts/StatDelta';
import Sankey, { type SankeyInput } from '@/components/charts/Sankey';
import Treemap, { type TreemapDatum } from '@/components/charts/Treemap';
import CategoryDonut from '@/components/charts/CategoryDonut';
import Icicle, { type IcicleNode } from '@/components/charts/Icicle';
import Pareto from '@/components/charts/Pareto';
import { LensState, type TabProps } from './shared';

const EMPTY_SANKEY: SankeyInput = { nodes: [], links: [] };
const EMPTY_TREE: IcicleNode = { name: '', value: 0, children: [] };

/** Footnote under a capped chart so the top-N truncation is not silent. */
function CapNote({ text }: { text: string }) {
  return <p className="mt-2 text-[11px] text-ink/50 dark:text-white/50">{text}</p>;
}

export default function DependenciesTab({ filters }: TabProps) {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<DependenciesLensResult>(
    `/api/analytics/dependencies${lensQuery(filters)}`,
  );
  const firstLoad = loading && !data;

  // Toplist contract: rows pre-sorted desc by value (bytes per target port).
  const portRows: ToplistRow[] = useMemo(
    () =>
      [...(data?.ports ?? [])]
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 10)
        .map((r) => ({
          label: String(r.port),
          value: r.bytes,
          sub: t('insights.deps.flows', { n: formatCount(r.count) }),
        })),
    [data, t],
  );

  const treemapData: TreemapDatum[] = useMemo(
    () =>
      (data?.namespaces ?? [])
        .filter((r) => r.bytes > 0)
        .map((r) => ({ name: r.key, value: r.bytes })),
    [data],
  );

  // CategoryDonut takes a full Record<DestCategory, number>; absent → null (built-in empty).
  const categoryValues = useMemo(() => {
    if (!data) return null;
    const rec = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<DestCategory, number>;
    for (const row of data.categories) rec[row.category] = row.bytes;
    return rec;
  }, [data]);

  // The lens roots the hop-path tree at literal 'all' — swap in the localized label.
  const pathTree: IcicleNode = useMemo(
    () => (data ? { ...data.pathTree, name: t('insights.deps.pathRoot') } : EMPTY_TREE),
    [data, t],
  );

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Widget
        title={t('insights.deps.sankey')}
        testId="widget-deps-sankey"
        className="md:col-span-2"
      >
        <LensState loading={firstLoad} error={error}>
          <Sankey data={data?.sankey ?? EMPTY_SANKEY} valueFormatter={formatBytes} height={320} />
          {data?.sankeyTruncated ? (
            <CapNote text={t('insights.capFlows', { n: SANKEY_MAX_LINKS })} />
          ) : null}
        </LensState>
      </Widget>

      <Widget title={t('insights.deps.ports')} testId="widget-deps-ports">
        <LensState loading={firstLoad} error={error}>
          <Toplist
            rows={portRows}
            valueFormatter={formatBytes}
            testId="toplist-deps-ports"
            sortable
            labelHeader={t('paths.port')}
            valueHeader={t('metric.DATA_TRANSFERRED')}
          />
        </LensState>
      </Widget>

      <Widget title={t('insights.deps.namespaces')} testId="widget-deps-namespaces">
        <LensState loading={firstLoad} error={error}>
          <Treemap data={treemapData} valueFormatter={formatBytes} height={240} />
        </LensState>
      </Widget>

      <Widget title={t('insights.deps.categories')} testId="widget-deps-categories">
        <LensState loading={firstLoad} error={error}>
          <CategoryDonut values={categoryValues} valueFormatter={formatBytes} />
        </LensState>
      </Widget>

      <Widget title={t('insights.deps.pareto')} testId="widget-deps-pareto">
        <LensState loading={firstLoad} error={error}>
          <Pareto rows={data?.pareto ?? []} valueFormatter={formatBytes} height={240} />
        </LensState>
      </Widget>

      {/* Concentration scalars over the same pair grouping as the pareto —
          dual-encoded: numeric value + scale/percent spelled out in text. */}
      <Widget
        title={t('insights.dependencies.concentration')}
        testId="widget-dependencies-concentration"
      >
        <LensState
          loading={firstLoad}
          error={error}
          empty={!!data && (data.concentration?.n ?? 0) === 0}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatDelta
              label={t('insights.dependencies.entropy')}
              value={(data?.concentration?.entropy ?? 0).toFixed(2)}
              testId="stat-dependencies-entropy"
            />
            <StatDelta
              label={t('insights.dependencies.gini')}
              value={(data?.concentration?.gini ?? 0).toFixed(2)}
              testId="stat-dependencies-gini"
            />
            <StatDelta
              label={t('insights.dependencies.topShare')}
              value={((data?.concentration?.topShare ?? 0) * 100).toFixed(1)}
              unit="%"
              testId="stat-dependencies-top-share"
            />
          </div>
        </LensState>
      </Widget>

      <Widget
        title={t('insights.deps.pathTree')}
        testId="widget-deps-path-tree"
        className="md:col-span-2 xl:col-span-3"
      >
        <LensState loading={firstLoad} error={error}>
          <Icicle tree={pathTree} valueFormatter={formatCount} />
          {data?.pathTreeTruncated ? (
            <CapNote text={t('insights.capBranches', { n: PATH_TREE_MAX_CHILDREN })} />
          ) : null}
        </LensState>
      </Widget>
    </div>
  );
}
