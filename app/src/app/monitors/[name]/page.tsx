'use client';

// /monitors/[name] — per-monitor detail with two tabs (?view=):
//  - overview: NHI badge + 4 traffic-summary tiles (AWS semantics: avg/sum/
//    sum/min), NHI band + DataTransferred timeseries, CloudWatch deep link.
//  - historical: metric-filterable FlowTable of the monitor's flows; a row
//    click opens a HopPath sheet (topology EdgeHopPanel pattern).
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ExternalLink, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import { cloudWatchMetricsUrl } from '@/lib/cloudwatch-url';
import type { FlowEdge, MetricName } from '@/lib/types';
import type { MonitorDetail } from '@/lib/monitors';
import { formatBytes, formatCount, formatMetricValue, formatMicros } from '@/lib/format';
import StatDelta from '@/components/charts/StatDelta';
import TimeSeries from '@/components/charts/TimeSeries';
import StatusBadge from '@/components/cards/StatusBadge';
import FlowTable, { CategoryChip } from '@/components/FlowTable';
import HopPath from '@/components/HopPath';
import { Card, Select } from '@/components/ui/Controls';

const METRICS: MetricName[] = [
  'DATA_TRANSFERRED',
  'RETRANSMISSIONS',
  'TIMEOUTS',
  'ROUND_TRIP_TIME',
];

const VIEWS = ['overview', 'historical'] as const;
type View = (typeof VIEWS)[number];

/** Route segments arrive percent-encoded; NFM names are URL-safe, so a failed
 *  decode (stray '%') just falls back to the raw segment. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function Overview({ d }: { d: MonitorDetail }) {
  const { t } = useLanguage();
  const { traffic } = d;
  return (
    <section data-testid="monitor-overview" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatDelta
          testId="monitor-stat-data"
          label={t('monitors.traffic.dataTransferred')}
          value={formatBytes(traffic.dataTransferredAvg)}
          spark={d.dataSeries.points.map((p) => p.v)}
        />
        <StatDelta
          testId="monitor-stat-retrans"
          label={t('monitors.traffic.retransmissions')}
          value={formatCount(traffic.retransmissionsSum)}
        />
        <StatDelta
          testId="monitor-stat-timeouts"
          label={t('monitors.traffic.timeouts')}
          value={formatCount(traffic.timeoutsSum)}
        />
        <StatDelta
          testId="monitor-stat-rtt"
          label={t('monitors.traffic.rtt')}
          value={traffic.rttMin != null ? formatMicros(traffic.rttMin) : '—'}
        />
      </div>
      {traffic.rttP50 != null && traffic.rttP95 != null ? (
        <p className="text-[11px] text-ink/50 dark:text-white/50">
          {t('monitors.rttPercentiles', {
            p50: formatMicros(traffic.rttP50),
            p95: formatMicros(traffic.rttP95),
          })}
        </p>
      ) : null}

      <Card title={t('monitors.nhi')}>
        <TimeSeries
          series={[{ name: t('monitors.nhi'), points: d.nhiTimeline.points }]}
          height={140}
          valueFormatter={(n) => String(n)}
        />
      </Card>

      <Card
        title={t('metric.DATA_TRANSFERRED')}
        action={
          <a
            href={cloudWatchMetricsUrl({ monitorArn: d.monitorArn })}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-medium text-ink/60 hover:text-ink dark:text-white/60 dark:hover:text-white"
          >
            {t('monitors.viewInCloudWatch')}
            <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
          </a>
        }
      >
        <TimeSeries
          series={[{ name: t('metric.DATA_TRANSFERRED'), points: d.dataSeries.points }]}
          valueFormatter={formatBytes}
        />
      </Card>
    </section>
  );
}

/** Bottom sheet (mobile) / right sheet (desktop) with the flow's hop path. */
function HopSheet({ flow, onClose }: { flow: FlowEdge; onClose: () => void }) {
  const { t } = useLanguage();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('paths.networkPath')}
      data-testid="monitor-hop-panel"
      className="fixed inset-x-0 bottom-0 z-[60] max-h-[70vh] overflow-y-auto rounded-t-card border border-black/5 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-lg md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:max-h-none md:w-[28rem] md:rounded-card md:pb-5 dark:border-white/10 dark:bg-ink"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryChip category={flow.category} />
          <span className="text-sm font-semibold tabular-nums">
            {formatMetricValue(flow.metric, flow.value)}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card text-ink/60 hover:bg-surface dark:text-white/60 dark:hover:bg-white/10"
        >
          <X size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <HopPath edge={flow} metricLabel={t(`metric.${flow.metric}`)} />
    </div>
  );
}

function Historical({ name }: { name: string }) {
  const { t } = useLanguage();
  const [metric, setMetric] = useState('');
  const [selected, setSelected] = useState<FlowEdge | null>(null);
  const { data, error, loading } = usePolling<{ flows: FlowEdge[] }>(
    `/api/flows?monitor=${encodeURIComponent(name)}&limit=200`,
  );
  const flows = useMemo(() => {
    const all = data?.flows ?? [];
    return metric ? all.filter((f) => f.metric === metric) : all;
  }, [data, metric]);

  return (
    <section data-testid="monitor-historical" className="flex flex-col gap-4">
      <Card
        title={t('flows.tableTitle')}
        action={
          <span className="text-xs text-ink/50 dark:text-white/50">
            {loading && !data ? t('common.loading') : t('flows.count', { n: flows.length })}
          </span>
        }
      >
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Select
            label={t('monitors.selectMetric')}
            value={metric}
            onChange={setMetric}
            allLabel={t('filter.all')}
            options={METRICS.map((m) => ({ value: m, label: t(`metric.${m}`) }))}
          />
        </div>
        {error ? (
          <p className="text-sm text-ink/60 dark:text-white/60">{t('common.error')}</p>
        ) : loading && !data ? (
          <p className="text-sm text-ink/40 dark:text-white/40">{t('common.loading')}</p>
        ) : (
          <FlowTable flows={flows} onSelect={setSelected} />
        )}
      </Card>
      {selected ? <HopSheet flow={selected} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}

function NotFound({ name }: { name: string }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-start gap-3 rounded-card bg-surface p-6 dark:bg-white/5">
      <p className="text-sm text-ink/70 dark:text-white/70">
        {t('monitors.notFound')} — <span className="font-mono">{name}</span>
      </p>
      <Link
        href="/monitors"
        className="flex items-center gap-1.5 text-xs font-medium text-ink underline-offset-2 hover:underline dark:text-white"
      >
        <ArrowLeft size={14} strokeWidth={1.5} aria-hidden />
        {t('monitors.backToList')}
      </Link>
    </div>
  );
}

function MonitorDetailContent() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ name: string }>();
  const raw = Array.isArray(params.name) ? params.name[0] : params.name;
  const name = safeDecode(raw ?? '');

  // Active tab lives in ?view= (default overview); state is the source of
  // truth after hydration, the URL is kept in sync for deep links.
  const urlView = searchParams?.get('view');
  const [view, setView] = useState<View>(urlView === 'historical' ? 'historical' : 'overview');
  const selectView = (v: View) => {
    setView(v);
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    q.set('view', v);
    router.replace(`${window.location.pathname}?${q.toString()}`, { scroll: false });
  };

  const { data, error, loading } = usePolling<MonitorDetail>(
    `/api/monitors/${encodeURIComponent(name)}`,
  );
  const notFound = error === 'monitor not found';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/monitors"
          aria-label={t('monitors.backToList')}
          className="flex h-8 w-8 items-center justify-center rounded-card text-ink/60 hover:bg-surface dark:text-white/60 dark:hover:bg-white/10"
        >
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
        </Link>
        <h1 className="min-w-0 truncate text-lg font-semibold" title={name}>
          {name}
        </h1>
        <StatusBadge value={data?.nhi ?? null} testId="monitor-nhi-badge" />
      </div>

      {notFound ? (
        <NotFound name={name} />
      ) : (
        <>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('monitors.title')}>
            {VIEWS.map((v) => {
              const isActive = v === view;
              return (
                <button
                  key={v}
                  type="button"
                  data-testid={`monitor-tab-${v}`}
                  aria-pressed={isActive}
                  onClick={() => selectView(v)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-ink text-white dark:bg-white dark:text-ink'
                      : 'text-ink/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10'
                  }`}
                >
                  {t(`monitors.${v}`)}
                </button>
              );
            })}
          </div>

          {view === 'historical' ? (
            <Historical name={name} />
          ) : error ? (
            <p className="text-sm text-ink/60 dark:text-white/60">{t('common.error')}</p>
          ) : loading && !data ? (
            <p className="text-sm text-ink/40 dark:text-white/40">{t('common.loading')}</p>
          ) : data ? (
            <Overview d={data} />
          ) : null}
        </>
      )}
    </div>
  );
}

export default function MonitorDetailPage() {
  // useSearchParams needs a Suspense boundary above it during prerender.
  return (
    <Suspense fallback={<PageFallback />}>
      <MonitorDetailContent />
    </Suspense>
  );
}

function PageFallback() {
  const { t } = useLanguage();
  return (
    <p className="py-8 text-center text-sm text-ink/40 dark:text-white/40">{t('common.loading')}</p>
  );
}
