'use client';

import Link from 'next/link';
import { Hourglass } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { CollectionStatus, Coverage } from '@/lib/types';
import type { NfmSeries } from '@/lib/cw-metrics';
import { formatBytes, formatCount, formatMicros } from '@/lib/format';
import KpiCard from '@/components/cards/KpiCard';
import StatusBadge from '@/components/cards/StatusBadge';
import CollectionStatusCard from '@/components/cards/CollectionStatusCard';
import TimeSeries, { type TimeSeriesInput } from '@/components/charts/TimeSeries';
import { Card } from '@/components/ui/Controls';

interface OverviewData {
  kpis: {
    dataTransferred: number;
    retransmissions: number;
    timeouts: number;
    rttAvg: number | null;
    nhi: number | null;
  };
  series: Record<string, NfmSeries>;
  status: CollectionStatus | null;
  coverage: Coverage | null;
}

function trafficSeries(series: Record<string, NfmSeries>): TimeSeriesInput[] {
  return Object.values(series)
    .filter((s) => s.metric === 'DataTransferred')
    .map((s) => ({
      name: s.monitor,
      points: s.timestamps.map((t, i) => ({ t, v: s.values[i] })),
    }));
}

export default function OverviewPage() {
  const { t } = useLanguage();
  const { data, loading, error } = usePolling<OverviewData>('/api/overview');

  const kpis = data?.kpis;
  const traffic = data ? trafficSeries(data.series) : [];
  const isEmpty =
    !!data &&
    !data.status &&
    traffic.length === 0 &&
    (kpis?.dataTransferred ?? 0) === 0 &&
    (kpis?.retransmissions ?? 0) === 0;

  const coverage = data?.coverage;
  const taggedCount = coverage?.standalone.filter((s) => s.tagged).length ?? 0;
  const policyCount = coverage?.standalone.filter((s) => s.policyAttached).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('nav.overview')}</h1>
        <StatusBadge value={kpis?.nhi ?? null} testId="nhi-badge" />
      </div>

      {error ? (
        <Card>
          <p className="text-sm text-ink/60 dark:text-white/60">{t('common.error')}</p>
        </Card>
      ) : null}

      {isEmpty ? (
        <Card>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accentBlue text-ink">
              <Hourglass size={18} strokeWidth={1.5} aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold">{t('common.collecting')}</p>
              <p className="text-xs text-ink/60 dark:text-white/60">{t('overview.collectingHint')}</p>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label={t('kpi.dataTransferred')}
          value={loading && !data ? '…' : formatBytes(kpis?.dataTransferred ?? 0)}
          accent="blue"
          testId="kpi-dataTransferred"
        />
        <KpiCard
          label={t('kpi.retransmissions')}
          value={loading && !data ? '…' : formatCount(kpis?.retransmissions ?? 0)}
          accent="lav"
          testId="kpi-retransmissions"
        />
        <KpiCard
          label={t('kpi.timeouts')}
          value={loading && !data ? '…' : formatCount(kpis?.timeouts ?? 0)}
          accent="blue"
          testId="kpi-timeouts"
        />
        <KpiCard
          label={t('kpi.rtt')}
          value={loading && !data ? '…' : kpis?.rttAvg != null ? formatMicros(kpis.rttAvg) : '—'}
          accent="lav"
          testId="kpi-rtt"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={t('overview.traffic')} className="xl:col-span-2">
          <TimeSeries series={traffic} valueFormatter={formatBytes} />
        </Card>
        <div className="flex flex-col gap-4">
          <CollectionStatusCard status={data?.status ?? null} />
          <Card
            title={t('overview.coverage')}
            action={
              <Link
                href="/agents"
                className="text-xs font-medium text-ink/60 hover:text-ink hover:underline dark:text-white/60 dark:hover:text-white"
              >
                {t('nav.agents')} →
              </Link>
            }
          >
            {coverage ? (
              <dl className="grid grid-cols-2 gap-3">
                <div className="rounded-card bg-white p-3 dark:bg-white/5">
                  <dt className="text-[11px] text-ink/50 dark:text-white/50">{t('overview.eksNodes')}</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums">{formatCount(coverage.eksNodeCount)}</dd>
                </div>
                <div className="rounded-card bg-white p-3 dark:bg-white/5">
                  <dt className="text-[11px] text-ink/50 dark:text-white/50">{t('overview.standaloneAgents')}</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                    {formatCount(coverage.standalone.length)}
                  </dd>
                </div>
                <div className="rounded-card bg-white p-3 dark:bg-white/5">
                  <dt className="text-[11px] text-ink/50 dark:text-white/50">{t('agents.tagged')}</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                    {taggedCount}/{coverage.standalone.length}
                  </dd>
                </div>
                <div className="rounded-card bg-white p-3 dark:bg-white/5">
                  <dt className="text-[11px] text-ink/50 dark:text-white/50">{t('agents.policyAttached')}</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                    {policyCount}/{coverage.standalone.length}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-ink/40 dark:text-white/40">{t('common.collecting')}</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
