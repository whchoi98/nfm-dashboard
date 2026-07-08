'use client';

import { useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { FlowEdge } from '@/lib/types';
import FlowTable from '@/components/FlowTable';
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
  // computed once per mount; the 12 most-recent 5-min buckets.
  // Default to the previous bucket — the newest one is usually still being written.
  const buckets = useRef(recentBuckets(12)).current;
  const [bucket, setBucket] = useState(buckets[1]);
  const [monitor, setMonitor] = useState('');
  const [ns, setNs] = useState('');
  const [pod, setPod] = useState('');
  const [applied, setApplied] = useState<{ ns: string; pod: string }>({ ns: '', pod: '' });
  const [limit, setLimit] = useState('200');

  const url = useMemo(() => {
    const p = new URLSearchParams({ limit });
    if (applied.ns && applied.pod) {
      p.set('ns', applied.ns);
      p.set('pod', applied.pod);
    } else {
      p.set('bucket', bucket);
      if (monitor) p.set('monitor', monitor);
    }
    return `/api/flows?${p.toString()}`;
  }, [bucket, monitor, applied, limit]);

  const { data, error, loading } = usePolling<{ flows: FlowEdge[] }>(url);
  const flows = useMemo(() => data?.flows ?? [], [data]);

  const monitors = useMemo(() => [...new Set(flows.map((f) => f.monitor))].sort(), [flows]);
  const podMode = !!(applied.ns && applied.pod);

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
            options={buckets.map((b) => ({ value: b, label: bucketLabel(b) }))}
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
