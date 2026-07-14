'use client';

// Workload Insights (/workload) — reproduces the AWS CloudWatch NFM console's
// "Workload insights" tab with OUR collected WI#latest snapshot: a flow-type
// (category) selector plus per-metric Top Contributors (ranked toplist + table).
// The snapshot is top-contributors only (no per-category timeseries), so the
// view is ranked lists — faithful to the console's core content.
import { useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { WiResult } from '@/lib/types';
import { formatMetricValue } from '@/lib/format';
import { contributorLabel, contributorRows, presentCategories, regionFromAz, type WiContributor } from '@/lib/workload';
import { useSortableRows, type SortColumn } from '@/lib/use-sortable';
import Widget from '@/components/analytics/Widget';
import Toplist from '@/components/analytics/Toplist';
import { CategoryChip } from '@/components/FlowTable';
import { SortableHeader } from '@/components/SortableHeader';
import { Card, Select, TextInput } from '@/components/ui/Controls';
import PageIntro from '@/components/PageIntro';

// WI metrics present in the snapshot (the collector does not query RTT).
const METRICS = ['DATA_TRANSFERRED', 'RETRANSMISSIONS', 'TIMEOUTS'] as const;
type WiMetric = (typeof METRICS)[number];

const TOPLIST_N = 8;

const tdCls = 'py-2.5 pr-3 text-xs text-ink/80 dark:text-white/80';

// Sort on the RAW fields (e.g. `r.value`), never the `formatMetricValue` display
// text or a formatted region string. `region` is derived from `localAz` but is
// itself a raw identifier, not a display format.
const CONTRIBUTOR_COLUMNS: SortColumn<WiContributor>[] = [
  { key: 'category', type: 'string', accessor: (r) => r.category },
  { key: 'localSubnetId', type: 'string', accessor: (r) => r.localSubnetId },
  { key: 'localAz', type: 'string', accessor: (r) => r.localAz },
  { key: 'localVpcId', type: 'string', accessor: (r) => r.localVpcId },
  { key: 'region', type: 'string', accessor: (r) => regionFromAz(r.localAz) },
  { key: 'accountId', type: 'string', accessor: (r) => r.accountId },
  { key: 'remoteIdentifier', type: 'string', accessor: (r) => r.remoteIdentifier },
  { key: 'value', type: 'number', accessor: (r) => r.value },
];

/** One metric section: ranked toplist + the full Top Contributors table. */
function MetricSection({
  metric,
  results,
  category,
}: {
  metric: WiMetric;
  results: WiResult[];
  category: string; // '' = all categories
}) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState('');
  const all = category === '';

  const rows = useMemo(() => contributorRows(results, metric, category), [results, metric, category]);
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.localSubnetId, r.localAz, r.localVpcId, r.accountId, r.remoteIdentifier, r.category]
        .some((v) => v?.toLowerCase().includes(q)),
    );
  }, [rows, filter]);

  // Sort is applied AFTER the text filter, so the two features compose.
  // Default sort = value desc (unchanged first render vs. contributorRows' own pre-sort).
  const { sorted, sort, onSort } = useSortableRows(filtered, CONTRIBUTOR_COLUMNS, {
    key: 'value',
    dir: 'desc',
  });

  // Stable React keys per row: identity fields only (never the post-sort index,
  // which would remount every row on each sort toggle). All WiRow fields are
  // optional, so duplicates of the same identity tuple get a deterministic
  // ordinal from the ORIGINAL unsorted `rows` order — stable across sorting,
  // since sorting reorders `filtered`/`sorted` but never `rows` itself.
  const rowKeys = useMemo(() => {
    const keys = new Map<WiContributor, string>();
    const seen = new Map<string, number>();
    for (const r of rows) {
      const base = `${r.category}-${contributorLabel(r)}-${r.remoteIdentifier ?? r.localSubnetId ?? ''}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      keys.set(r, n === 0 ? base : `${base}-${n}`);
    }
    return keys;
  }, [rows]);

  // contributorRows is already sorted desc — the Toplist contract requires it.
  const top = useMemo(
    () =>
      rows.slice(0, TOPLIST_N).map((r) => ({
        label: contributorLabel(r),
        value: r.value ?? 0,
        sub: all ? t(`category.${r.category}`) : undefined,
      })),
    [rows, all, t],
  );

  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Widget title={t(`metric.${metric}`)} testId={`workload-widget-${metric}`}>
        <Toplist
          rows={top}
          valueFormatter={(v) => formatMetricValue(metric, v)}
          testId={`workload-metric-${metric}`}
        />
      </Widget>

      <Card
        title={t('workload.contributors')}
        className="lg:col-span-2"
        action={
          <span className="text-xs text-ink/50 dark:text-white/50">
            {t('workload.count', { n: filtered.length })}
          </span>
        }
        testId={`workload-contributors-${metric}`}
      >
        {rows.length === 0 ? (
          <p className="flex h-32 items-center justify-center text-sm text-ink/40 dark:text-white/40">
            {t('workload.empty')}
          </p>
        ) : (
          <>
            <div className="mb-3">
              <TextInput
                label={t('workload.filter')}
                value={filter}
                onChange={setFilter}
                placeholder="subnet-…"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-black/5 text-left dark:border-white/10">
                    {all ? (
                      <SortableHeader label={t('workload.colCategory')} columnKey="category" sort={sort} onSort={onSort} className="pr-3" />
                    ) : null}
                    <SortableHeader label={t('workload.colSubnet')} columnKey="localSubnetId" sort={sort} onSort={onSort} className="pr-3" />
                    <SortableHeader label={t('workload.colAz')} columnKey="localAz" sort={sort} onSort={onSort} className="pr-3" />
                    <SortableHeader label={t('workload.colVpc')} columnKey="localVpcId" sort={sort} onSort={onSort} className="pr-3" />
                    <SortableHeader label={t('workload.colRegion')} columnKey="region" sort={sort} onSort={onSort} className="pr-3" />
                    <SortableHeader label={t('workload.colAccount')} columnKey="accountId" sort={sort} onSort={onSort} className="pr-3" />
                    <SortableHeader label={t('workload.colRemote')} columnKey="remoteIdentifier" sort={sort} onSort={onSort} className="pr-3" />
                    <SortableHeader label={t('workload.colValue')} columnKey="value" sort={sort} onSort={onSort} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr
                      key={rowKeys.get(r)}
                      className="border-b border-black/5 dark:border-white/5"
                    >
                      {all ? (
                        <td className="py-2.5 pr-3"><CategoryChip category={r.category} /></td>
                      ) : null}
                      <td className={`${tdCls} font-medium text-ink dark:text-white`}>
                        {r.localSubnetId ?? '—'}
                      </td>
                      <td className={tdCls}>{r.localAz ?? '—'}</td>
                      <td className={tdCls}>{r.localVpcId ?? '—'}</td>
                      <td className={tdCls}>{regionFromAz(r.localAz) ?? '—'}</td>
                      <td className={`${tdCls} tabular-nums`}>{r.accountId ?? '—'}</td>
                      <td className={`${tdCls} max-w-56 truncate`}>{r.remoteIdentifier ?? '—'}</td>
                      <td className="py-2.5 text-right font-semibold tabular-nums">
                        {r.value != null ? formatMetricValue(metric, r.value) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

export default function WorkloadPage() {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<{ rows: WiResult[]; cycleTs?: string }>('/api/workload');
  const results = useMemo(() => data?.rows ?? [], [data]);
  const [category, setCategory] = useState('');

  // Only categories PRESENT in the snapshot are offered; a previously selected
  // category that ages out of the data stays selectable (flows-page pattern).
  const categories = useMemo(() => {
    const cats = presentCategories(results);
    return category && !cats.includes(category) ? [...cats, category] : cats;
  }, [results, category]);

  const asOf = data?.cycleTs ? new Date(data.cycleTs).toLocaleString() : null;

  const notice = (text: string) => (
    <Card>
      <p className="flex h-32 items-center justify-center text-sm text-ink/40 dark:text-white/40">
        {text}
      </p>
    </Card>
  );

  return (
    <div data-testid="workload-page" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('workload.title')}</h1>
        {asOf ? (
          <span className="text-[11px] text-ink/50 dark:text-white/50">
            {t('workload.asOf', { time: asOf })}
          </span>
        ) : null}
      </div>

      <PageIntro page="workload" />

      {error ? (
        notice(t('common.error'))
      ) : loading && !data ? (
        notice(t('common.loading'))
      ) : results.length === 0 ? (
        notice(t('workload.emptyHint'))
      ) : (
        <>
          <Card>
            <Select
              label={t('filter.category')}
              value={category}
              onChange={setCategory}
              allLabel={t('filter.all')}
              options={categories.map((c) => ({ value: c, label: t(`category.${c}`) }))}
            />
          </Card>

          {METRICS.map((m) => (
            <MetricSection key={m} metric={m} results={results} category={category} />
          ))}
        </>
      )}
    </div>
  );
}
