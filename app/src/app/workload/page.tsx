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
import { contributorLabel, contributorRows, presentCategories, regionFromAz } from '@/lib/workload';
import Widget from '@/components/analytics/Widget';
import Toplist from '@/components/analytics/Toplist';
import { CategoryChip } from '@/components/FlowTable';
import { Card, Select, TextInput } from '@/components/ui/Controls';

// WI metrics present in the snapshot (the collector does not query RTT).
const METRICS = ['DATA_TRANSFERRED', 'RETRANSMISSIONS', 'TIMEOUTS'] as const;
type WiMetric = (typeof METRICS)[number];

const TOPLIST_N = 8;

const thCls = 'py-2 pr-3 text-xs font-medium text-ink/60 dark:text-white/60';
const tdCls = 'py-2.5 pr-3 text-xs text-ink/80 dark:text-white/80';

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
                    {all ? <th className={thCls}>{t('workload.colCategory')}</th> : null}
                    <th className={thCls}>{t('workload.colSubnet')}</th>
                    <th className={thCls}>{t('workload.colAz')}</th>
                    <th className={thCls}>{t('workload.colVpc')}</th>
                    <th className={thCls}>{t('workload.colRegion')}</th>
                    <th className={thCls}>{t('workload.colAccount')}</th>
                    <th className={thCls}>{t('workload.colRemote')}</th>
                    <th className={`${thCls} pr-0 text-right`}>{t('workload.colValue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr
                      key={`${r.category}-${contributorLabel(r)}-${i}`}
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
