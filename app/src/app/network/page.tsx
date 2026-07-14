'use client';
// Network Analytics (Phase 9 Task 2) — Datadog-CNM-style source→dest view:
// scope selects + metric toggle + time range on top, a FacetRail (namespace/
// category → lensQuery params) on the left, and a dense health-colored pair
// table with inline sparklines. Row click drills down to /flows (namespace
// source scope) or /topology.
import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MoveRight } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import {
  type AnalyticsFilters,
  TIME_RANGES,
  type TimeRange,
  lensQuery,
} from '@/lib/analytics/filters';
import {
  NET_METRICS,
  SCOPES,
  type NetMetric,
  type NetPair,
  type NetworkAnalyticsResult,
  type Scope,
} from '@/lib/analytics/network-analytics';
import type { TopologySnapshot } from '@/lib/types';
import { CATEGORY_ORDER, STATUS } from '@/lib/chart-tokens';
import { formatBytes, formatCount, formatMicros } from '@/lib/format';
import { useSortableRows, type SortColumn } from '@/lib/use-sortable';
import { Card, Select } from '@/components/ui/Controls';
import FacetRail, { type FacetGroup } from '@/components/analytics/FacetRail';
import Sparkline from '@/components/charts/Sparkline';
import { SortableHeader } from '@/components/SortableHeader';
import { LensState } from '@/app/insights/tabs/shared';
import PageIntro from '@/components/PageIntro';
import { initialFacetSel } from './ns-param';

/** Selected-metric cell, formatted per metric unit. */
function metricValue(metric: NetMetric, p: NetPair): string {
  switch (metric) {
    case 'volume':
      return formatBytes(p.bytes);
    case 'throughput':
      return `${formatBytes(p.throughput)}/s`;
    case 'retransmits':
      return formatCount(p.retransmissions);
    case 'rtt':
      return p.rtt == null ? '—' : formatMicros(p.rtt);
  }
}

/** RAW value of the selected metric — sort input (never the formatted string
 *  from `metricValue`). `rtt` stays `null` (not NaN) so it sorts LAST, matching
 *  the pairs' own null-RTT semantics. */
function metricRawValue(metric: NetMetric, p: NetPair): number | null {
  switch (metric) {
    case 'volume':
      return p.bytes;
    case 'throughput':
      return p.throughput;
    case 'retransmits':
      return p.retransmissions;
    case 'rtt':
      return p.rtt;
  }
}

function NetworkPageInner() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [src, setSrc] = useState<Scope>('service');
  const [dst, setDst] = useState<Scope>('service');
  const [metric, setMetric] = useState<NetMetric>('volume');
  const [range, setRange] = useState<TimeRange>('1h');
  const [facetSel, setFacetSel] = useState<Record<string, string>>(
    () => initialFacetSel(searchParams.get('ns')),
  );

  // Facet selections map onto the standard lens params (namespace/category),
  // applied server-side by applyFlowFilters — same semantics as the hub.
  const filters: AnalyticsFilters = {
    range,
    cluster: 'all',
    namespace: facetSel.namespace ?? 'all',
    category: facetSel.category ?? 'all',
    metric: 'DATA_TRANSFERRED',
  };
  const { data, error, loading } = usePolling<NetworkAnalyticsResult>(
    `/api/network${lensQuery(filters)}&src=${src}&dst=${dst}&metric=${metric}`,
  );
  const firstLoad = loading && !data;
  const pairs = data?.pairs ?? [];

  // The metric-value column tracks whichever metric is currently selected —
  // its accessor must stay in sync so sorting always reflects the visible column.
  const pairColumns: SortColumn<NetPair>[] = useMemo(
    () => [
      { key: 'source', type: 'string', accessor: (p) => p.source },
      { key: 'dest', type: 'string', accessor: (p) => p.dest },
      { key: 'metricValue', type: 'number', accessor: (p) => metricRawValue(metric, p) },
      { key: 'retransRate', type: 'number', accessor: (p) => p.retransRate },
      { key: 'rtt', type: 'number', accessor: (p) => p.rtt },
    ],
    [metric],
  );
  // Default sort = the current metric desc — matches the lens's own pre-sort
  // (server ranks `pairs` desc by the selected metric), so first render is unchanged.
  const { sorted: sortedPairs, sort: pairSort, onSort: onPairSort } = useSortableRows(
    pairs,
    pairColumns,
    { key: 'metricValue', dir: 'desc' },
  );

  // Namespace facet options (with node counts) come from the topology
  // snapshot — stable regardless of the currently selected scopes.
  const { data: topology } = usePolling<TopologySnapshot>('/api/topology');
  const facets: FacetGroup[] = useMemo(() => {
    const nsCounts = new Map<string, number>();
    for (const n of topology?.nodes ?? []) {
      if (n.namespace) nsCounts.set(n.namespace, (nsCounts.get(n.namespace) ?? 0) + 1);
    }
    return [
      {
        key: 'namespace',
        label: t('filter.namespace'),
        options: [
          { value: 'all', label: t('filter.all') },
          ...[...nsCounts.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([ns, count]) => ({ value: ns, label: ns, count })),
        ],
      },
      {
        key: 'category',
        label: t('filter.category'),
        options: [
          { value: 'all', label: t('filter.all') },
          ...CATEGORY_ORDER.map((c) => ({ value: c, label: t(`category.${c}`) })),
        ],
      },
    ];
  }, [topology, t]);

  // Drill-down pivot: namespace sources land on /flows, everything else on
  // /topology (both routes exist; /flows?ns= is a best-effort deep link).
  const drill = (p: NetPair) => {
    router.push(
      src === 'namespace' && p.source !== 'unknown'
        ? `/flows?ns=${encodeURIComponent(p.source)}`
        : '/topology',
    );
  };

  const scopeOptions = SCOPES.map((s) => ({ value: s, label: t(`scope.${s}`) }));

  return (
    <div data-testid="network-page" className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t('nav.network')}</h1>
      <PageIntro page="network" />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={t('network.source')}
            value={src}
            onChange={(v) => setSrc(v as Scope)}
            options={scopeOptions}
          />
          <MoveRight
            size={16}
            strokeWidth={1.5}
            aria-hidden
            className="mb-2.5 shrink-0 text-ink/40 dark:text-white/40"
          />
          <Select
            label={t('network.dest')}
            value={dst}
            onChange={(v) => setDst(v as Scope)}
            options={scopeOptions}
          />
          <Select
            label={t('filter.range')}
            value={range}
            onChange={(v) => setRange(v as TimeRange)}
            options={TIME_RANGES.map((r) => ({ value: r, label: t(`filter.range.${r}`) }))}
          />
          <div
            role="group"
            aria-label={t('filter.metric')}
            className="ml-auto flex flex-wrap gap-1"
          >
            {NET_METRICS.map((m) => {
              const active = m === metric;
              return (
                <button
                  key={m}
                  type="button"
                  data-testid={`net-metric-${m}`}
                  aria-pressed={active}
                  onClick={() => setMetric(m)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-ink text-white dark:bg-white dark:text-ink'
                      : 'text-ink/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10'
                  }`}
                >
                  {t(`netmetric.${m}`)}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <FacetRail
          facets={facets}
          value={facetSel}
          onChange={(key, val) => setFacetSel((prev) => ({ ...prev, [key]: val }))}
        />

        <Card
          title={t('network.tableTitle')}
          action={
            data ? (
              <span className="text-xs tabular-nums text-ink/50 dark:text-white/50">
                {t('network.pairs', { n: pairs.length })} · {formatBytes(data.totalBytes)}
                {' · '}
                <span data-testid="network-total-retrans">
                  {t('network.retransTotal', { n: data.totalRetrans.toLocaleString() })}
                </span>
                {' · '}
                {t('network.retransRate', { r: data.retransRateOverall.toFixed(1) })}
              </span>
            ) : undefined
          }
        >
          <LensState
            loading={firstLoad}
            error={error}
            empty={pairs.length === 0}
            emptyLabel={t('network.empty')}
          >
            {/* relative: contain the absolutely-positioned sr-only health labels
                so they clip with the scroller instead of widening the page. */}
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="text-left text-ink/50 dark:text-white/50">
                    <SortableHeader label={t('network.col.source')} columnKey="source" sort={pairSort} onSort={onPairSort} className="pr-2" />
                    <SortableHeader label={t('network.col.dest')} columnKey="dest" sort={pairSort} onSort={onPairSort} className="pr-2" />
                    <SortableHeader label={t(`netmetric.${metric}`)} columnKey="metricValue" sort={pairSort} onSort={onPairSort} align="right" className="pr-2" />
                    <SortableHeader label={t('network.col.retrans')} columnKey="retransRate" sort={pairSort} onSort={onPairSort} align="right" className="pr-2" />
                    <SortableHeader label={t('network.col.rtt')} columnKey="rtt" sort={pairSort} onSort={onPairSort} align="right" className="pr-2" />
                    <th className="py-1.5 font-medium">{t('network.col.trend')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPairs.map((p) => (
                    <tr
                      key={`${p.source}→${p.dest}`}
                      tabIndex={0}
                      title={t('network.drillHint')}
                      onClick={() => drill(p)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          drill(p);
                        }
                      }}
                      className="cursor-pointer border-t border-black/5 hover:bg-black/[.03] focus:bg-black/[.03] focus:outline-none dark:border-white/10 dark:hover:bg-white/5 dark:focus:bg-white/5"
                    >
                      <td className="max-w-44 truncate py-1.5 pr-2 font-medium" title={p.source}>
                        {p.source}
                      </td>
                      <td className="max-w-44 truncate py-1.5 pr-2" title={p.dest}>
                        {p.dest}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">
                        {metricValue(metric, p)}
                      </td>
                      <td className="py-1.5 pr-2 text-right">
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums text-ink"
                          style={{ backgroundColor: STATUS[p.health] }}
                        >
                          {p.retransRate.toFixed(1)}/GB
                          <span className="sr-only"> ({t(`toplist.status.${p.health}`)})</span>
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-ink/70 dark:text-white/70">
                        {p.rtt == null ? '—' : formatMicros(p.rtt)}
                      </td>
                      <td className="py-1.5">
                        {/* Lens spark is NEWEST-first — reverse for left→right time. */}
                        <div className="w-24">
                          <Sparkline values={[...p.spark].reverse()} className="h-5" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </LensState>
        </Card>
      </div>
    </div>
  );
}

// useSearchParams() requires a Suspense boundary — this wrapper is the page's
// actual default export; NetworkPageInner holds all the existing behavior.
export default function NetworkPage() {
  return (
    <Suspense>
      <NetworkPageInner />
    </Suspense>
  );
}
