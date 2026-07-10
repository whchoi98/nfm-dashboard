'use client';
// Dependencies tab (Task 4b): service sankey, port/namespace/category traffic
// composition, top-talker pareto and the hop-path icicle — DATA_TRANSFERRED
// composition views over the dependencies lens.
import { useMemo } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import { lensQuery } from '@/lib/analytics/filters';
import type { DependenciesLensResult } from '@/lib/analytics/dependencies';
import { CATEGORY_ORDER, type DestCategory } from '@/lib/chart-tokens';
import { formatBytes, formatCount } from '@/lib/format';
import Widget from '@/components/analytics/Widget';
import Toplist, { type ToplistRow } from '@/components/analytics/Toplist';
import Sankey, { type SankeyInput } from '@/components/charts/Sankey';
import Treemap, { type TreemapDatum } from '@/components/charts/Treemap';
import CategoryDonut from '@/components/charts/CategoryDonut';
import Icicle, { type IcicleNode } from '@/components/charts/Icicle';
import Pareto from '@/components/charts/Pareto';
import { LensState, type TabProps } from './shared';

const EMPTY_SANKEY: SankeyInput = { nodes: [], links: [] };
const EMPTY_TREE: IcicleNode = { name: '', value: 0, children: [] };

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
        </LensState>
      </Widget>

      <Widget title={t('insights.deps.ports')} testId="widget-deps-ports">
        <LensState loading={firstLoad} error={error}>
          <Toplist rows={portRows} valueFormatter={formatBytes} testId="toplist-deps-ports" />
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

      <Widget
        title={t('insights.deps.pathTree')}
        testId="widget-deps-path-tree"
        className="md:col-span-2 xl:col-span-3"
      >
        <LensState loading={firstLoad} error={error}>
          <Icicle tree={pathTree} valueFormatter={formatCount} />
        </LensState>
      </Widget>
    </div>
  );
}
