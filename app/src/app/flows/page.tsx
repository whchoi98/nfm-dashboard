'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { FlowEdge } from '@/lib/types';
import type { CategoryStreamPoint } from '@/lib/analytics/cost';
import { flowAggregates } from '@/lib/flow-aggregates';
import { CATEGORY_ORDER } from '@/lib/chart-tokens';
import { formatBytes } from '@/lib/format';
import FlowTable from '@/components/FlowTable';
import Widget from '@/components/analytics/Widget';
import Toplist from '@/components/analytics/Toplist';
import CategoryDonut from '@/components/charts/CategoryDonut';
import StreamGraph from '@/components/charts/StreamGraph';
import { LensState } from '@/app/insights/tabs/shared';
import { Card, Select, TextInput } from '@/components/ui/Controls';

/** n most-recent 5-minute grid buckets, newest first (mirrors collector formula). */
function recentBuckets(n: number): string[] {
  const t = Date.now();
  return Array.from({ length: n }, (_, i) =>
    new Date(Math.floor(t / 300000) * 300000 - i * 300000).toISOString().replace(/\.\d+Z/, 'Z'),
  );
}

const bucketLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

const LIMITS = ['50', '100', '200', '500'];

export default function FlowsPage() {
  const { t } = useLanguage();
  // The 12 most-recent 5-min buckets, refreshed so the list tracks the current grid.
  // Start empty so SSR and the first client render agree (recentBuckets() reads
  // Date.now() + toLocaleTimeString, which differ between server and client and
  // would trip a hydration mismatch); populated client-side on mount below.
  const [buckets, setBuckets] = useState<string[]>([]);
  // '' = follow the latest complete bucket (the newest one is usually still being written);
  // a concrete value = explicit user pick, which is kept as-is.
  const [bucket, setBucket] = useState('');
  const [monitor, setMonitor] = useState('');
  const [ns, setNs] = useState('');
  const [pod, setPod] = useState('');
  const [applied, setApplied] = useState<{ ns: string; pod: string }>({ ns: '', pod: '' });
  const [limit, setLimit] = useState('200');

  useEffect(() => {
    setBuckets(recentBuckets(12)); // client-only initial fill (avoids SSR hydration mismatch)
    const id = setInterval(() => {
      setBuckets((prev) => {
        const next = recentBuckets(12);
        return next[0] === prev[0] ? prev : next;
      });
    }, 30000);
    return () => clearInterval(id);
  }, []);

  const effectiveBucket = bucket || buckets[1];

  const url = useMemo(() => {
    const p = new URLSearchParams({ limit });
    if (applied.ns && applied.pod) {
      p.set('ns', applied.ns);
      p.set('pod', applied.pod);
    } else {
      p.set('bucket', effectiveBucket);
      if (monitor) p.set('monitor', monitor);
    }
    return `/api/flows?${p.toString()}`;
  }, [effectiveBucket, monitor, applied, limit]);

  const { data, error, loading } = usePolling<{ flows: FlowEdge[] }>(url);
  const flows = useMemo(() => data?.flows ?? [], [data]);

  // Superset of every monitor seen across fetches, so applying a monitor
  // filter (which narrows the fetched rows) never removes the other options.
  const [monitors, setMonitors] = useState<string[]>([]);
  useEffect(() => {
    if (!data?.flows?.length) return;
    setMonitors((prev) => {
      const merged = new Set(prev);
      for (const f of data.flows) merged.add(f.monitor);
      return merged.size === prev.length ? prev : [...merged].sort();
    });
  }, [data]);

  // Keep an explicitly selected bucket selectable even after it ages out of the list.
  const bucketOptions = useMemo(() => {
    const list = bucket && !buckets.includes(bucket) ? [...buckets, bucket] : buckets;
    return list.map((b) => ({ value: b, label: bucketLabel(b) }));
  }, [buckets, bucket]);

  const podMode = !!(applied.ns && applied.pod);

  // Aggregate strip inputs: pure client-side rollups over the CURRENT result
  // set (top talkers + category mix), plus the server-cached cost-lens stream
  // for the window-wide activity chart.
  const aggregates = useMemo(() => flowAggregates(flows), [flows]);
  const activity = usePolling<{ stream: CategoryStreamPoint[] }>('/api/analytics/cost?buckets=12');
  const stream = useMemo(() => activity.data?.stream ?? [], [activity.data]);
  const streamKeys = useMemo(
    () => CATEGORY_ORDER.filter((c) => stream.some((p) => (p.values[c] ?? 0) > 0)),
    [stream],
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t('nav.flows')}</h1>

      <Card>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied({ ns: ns.trim(), pod: pod.trim() });
          }}
        >
          <Select
            label={t('flows.bucket')}
            value={bucket}
            onChange={setBucket}
            allLabel={t('flows.latestBucket', { time: bucketLabel(buckets[1]) })}
            options={bucketOptions}
          />
          <Select
            label={t('flows.monitor')}
            value={monitor}
            onChange={setMonitor}
            allLabel={t('filter.all')}
            options={monitors.map((m) => ({ value: m, label: m }))}
          />
          <TextInput label={t('flows.namespace')} value={ns} onChange={setNs} placeholder="default" />
          <TextInput label={t('flows.pod')} value={pod} onChange={setPod} placeholder="my-pod-abc" />
          <Select
            label={t('flows.limit')}
            value={limit}
            onChange={setLimit}
            options={LIMITS.map((l) => ({ value: l, label: l }))}
          />
          <button
            type="submit"
            className="h-9 rounded-lg bg-ink px-4 text-xs font-semibold text-white hover:opacity-90 dark:bg-white dark:text-ink"
          >
            {t('filter.apply')}
          </button>
          {podMode ? (
            <button
              type="button"
              onClick={() => {
                setNs('');
                setPod('');
                setApplied({ ns: '', pod: '' });
              }}
              className="h-9 rounded-lg bg-surface px-4 text-xs font-medium text-ink/70 hover:text-ink dark:bg-white/10 dark:text-white/70 dark:hover:text-white"
            >
              {t('filter.clear')}
            </button>
          ) : null}
        </form>
        {podMode ? (
          <p className="mt-2 text-[11px] text-ink/50 dark:text-white/50">
            {t('flows.podModeHint', { ns: applied.ns, pod: applied.pod })}
          </p>
        ) : null}
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Widget title={t('flows.topTalkers')} testId="widget-flows-top-talkers">
          <Toplist
            rows={aggregates.topTalkers}
            valueFormatter={formatBytes}
            testId="toplist-flows-talkers"
          />
        </Widget>
        <Widget title={t('flows.categoryMix')} testId="widget-flows-category-mix">
          <CategoryDonut values={aggregates.byCategory} valueFormatter={formatBytes} />
        </Widget>
        <Widget title={t('flows.activity')} testId="widget-flows-activity">
          <LensState loading={activity.loading && !activity.data} error={activity.error}>
            <StreamGraph data={stream} keys={streamKeys} valueFormatter={formatBytes} height={192} />
          </LensState>
        </Widget>
      </div>

      <Card
        title={t('flows.tableTitle')}
        action={
          <span className="text-xs text-ink/50 dark:text-white/50">
            {loading && !data ? t('common.loading') : t('flows.count', { n: flows.length })}
          </span>
        }
      >
        {error ? (
          <p className="text-sm text-ink/60 dark:text-white/60">{t('common.error')}</p>
        ) : (
          <FlowTable flows={flows} />
        )}
      </Card>
    </div>
  );
}
