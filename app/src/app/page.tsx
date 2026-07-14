'use client';

// Overview (Phase 6 Task 1): fleet-wide §15.4 KPI tiles (StatDelta with
// half-window delta + sparkline), NHI badge, hover-synced traffic chart with
// a CloudWatch deep link, top cost talkers and breach count teasers linking
// into the insights hub, plus collection status + agent coverage.
import Link from 'next/link';
import { ExternalLink, Hourglass } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { CollectionStatus, Coverage } from '@/lib/types';
import type { NfmSeries } from '@/lib/cw-metrics';
import {
  RETRANS_DANGER,
  RETRANS_WARN,
  TIMEOUT_DANGER,
  TIMEOUT_WARN,
  type ErrorRatePoint,
  type OverviewKpis,
  type OverviewSummary,
} from '@/lib/overview-metrics';
import { STATUS } from '@/lib/chart-tokens';
import { cloudWatchMetricsUrl } from '@/lib/cloudwatch-url';
import { formatBytes, formatCount, formatMicros } from '@/lib/format';
import { formatUsd } from '@/app/insights/tabs/shared';
import StatDelta, { type StatStatus } from '@/components/charts/StatDelta';
import StatusBadge from '@/components/cards/StatusBadge';
import AnomalyBadge from '@/components/AnomalyBadge';
import CollectionStatusCard from '@/components/cards/CollectionStatusCard';
import TimeSeries, { type TimeSeriesInput } from '@/components/charts/TimeSeries';
import Widget from '@/components/analytics/Widget';
import Toplist, { type ToplistRow } from '@/components/analytics/Toplist';
import { HoverSyncProvider, useHoverSync } from '@/components/analytics/HoverSync';
import { Card } from '@/components/ui/Controls';
import PageIntro from '@/components/PageIntro';

interface OverviewData extends OverviewKpis {
  topTalkers: { label: string; usd: number; bytes: number }[];
  breachCount: number;
  errorRates: ErrorRatePoint[];
  series: Record<string, NfmSeries>;
  status: CollectionStatus | null;
  coverage: Coverage | null;
  /** At-a-glance headline block (Phase 12) — optional so stale APIs degrade to '—'. */
  summary?: OverviewSummary;
}

// Lab-scale status threshold for the breach teaser (RETRANS/TIMEOUT thresholds
// moved to overview-metrics.ts, shared with the /monitors card chips).
const BREACH_DANGER = 5;

// Fleet DNS failure-fraction thresholds for the summary card (0..1 scale).
const DNS_FAIL_WARN = 0.01;
const DNS_FAIL_DANGER = 0.05;

function statusFor(
  v: number | null | undefined,
  warnAt: number,
  dangerAt: number,
): StatStatus | undefined {
  if (v == null) return undefined;
  return v >= dangerAt ? 'danger' : v >= warnAt ? 'warn' : 'ok';
}

function trafficSeries(series: Record<string, NfmSeries>): TimeSeriesInput[] {
  return Object.values(series)
    .filter((s) => s.metric === 'DataTransferred')
    .map((s) => ({
      name: s.monitor,
      points: s.timestamps.map((t, i) => ({ t, v: s.values[i] })),
    }));
}

/** Traffic chart wired to the shared hover context (crosshair sync). */
function SyncedTrafficChart({ series }: { series: TimeSeriesInput[] }) {
  const { activeT, setActiveT } = useHoverSync();
  return (
    <TimeSeries
      series={series}
      valueFormatter={formatBytes}
      activeT={activeT}
      onActiveTimeChange={setActiveT}
    />
  );
}

/** Golden-signal strip input: fleet retrans/timeout rate (events per GB) per bucket. */
function errorRateChartSeries(
  errorRates: ErrorRatePoint[],
  labels: { retrans: string; timeout: string },
): TimeSeriesInput[] {
  return [
    { name: labels.retrans, color: STATUS.warn, points: errorRates.map((p) => ({ t: p.t, v: p.retransRate })) },
    { name: labels.timeout, color: STATUS.danger, points: errorRates.map((p) => ({ t: p.t, v: p.timeoutRate })) },
  ];
}

/** Error-rate chart on the same shared hover context as the traffic chart. */
function SyncedErrorRateChart({ series }: { series: TimeSeriesInput[] }) {
  const { activeT, setActiveT } = useHoverSync();
  return (
    <TimeSeries
      series={series}
      valueFormatter={(n) => n.toFixed(1)}
      activeT={activeT}
      onActiveTimeChange={setActiveT}
    />
  );
}

/**
 * Whole-card deep link for the at-a-glance summary strip (Phase 12):
 * label + big value + optional sub line. Status is dual-encoded like
 * StatDelta (STATUS dot + sr-only word next to the number) — never
 * color-only. Chrome mirrors Card/StatDelta (ui-hairline + bg-surface).
 */
function SummaryCard({
  testId,
  href,
  label,
  value,
  sub,
  status,
}: {
  testId: string;
  href: string;
  label: string;
  value: string;
  sub?: string;
  status?: StatStatus;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="group ui-hairline block rounded-card bg-surface p-4 text-ink dark:bg-white/5 dark:text-white"
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink/60 dark:text-white/60">
        {status ? (
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: STATUS[status] }}
            aria-hidden
          />
        ) : null}
        <span className="min-w-0 truncate">{label}</span>
        {status ? <span className="sr-only">({status})</span> : null}
        <span
          className="ml-auto shrink-0 text-ink/40 group-hover:text-ink dark:text-white/40 dark:group-hover:text-white"
          aria-hidden
        >
          →
        </span>
      </p>
      <p className="mt-2 truncate text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {sub ? (
        <p className="mt-1 truncate text-xs text-ink/50 dark:text-white/50">{sub}</p>
      ) : null}
    </Link>
  );
}

export default function OverviewPage() {
  const { t } = useLanguage();
  const { data, loading, error } = usePolling<OverviewData>('/api/overview');
  // Lightweight anomaly-count poll for the badge (default window/thresholds).
  const anomaliesPoll = usePolling<{ anomalies: unknown[] }>('/api/anomalies');
  const anomalyCount = anomaliesPoll.data?.anomalies?.length ?? 0;
  const firstLoad = loading && !data;

  const kpis = data?.kpis;
  const traffic = data ? trafficSeries(data.series) : [];
  // `?? []` keeps the strip empty-safe if a stale API responds without the field.
  const errorSeries = errorRateChartSeries(data?.errorRates ?? [], {
    retrans: t('overview.retransRate'),
    timeout: t('overview.timeoutRate'),
  });
  const isEmpty =
    !!data &&
    !data.status &&
    traffic.length === 0 &&
    (kpis?.dataTransferred.value ?? 0) === 0 &&
    (kpis?.retransmissions.value ?? 0) === 0;

  const coverage = data?.coverage;
  const taggedCount = coverage?.standalone.filter((s) => s.tagged).length ?? 0;
  const policyCount = coverage?.standalone.filter((s) => s.policyAttached).length ?? 0;

  // Toplist contract: rows pre-sorted desc by value (USD); sub = bytes moved.
  const talkerRows: ToplistRow[] = [...(data?.topTalkers ?? [])]
    .sort((a, b) => b.usd - a.usd)
    .map((r) => ({ label: r.label, value: r.usd, sub: formatBytes(r.bytes) }));

  const breachCount = data?.breachCount ?? 0;

  // At-a-glance summary strip. `…` while first loading, `—` when a loaded
  // payload lacks the block or a value is null (stale API / no samples).
  const summary = data?.summary;
  const summaryValue = (fmt: (s: OverviewSummary) => string) =>
    firstLoad ? '…' : summary ? fmt(summary) : '—';
  const monitorsStatus: StatStatus | undefined =
    !summary || summary.monitorsTotal === 0
      ? undefined
      : summary.monitorsDegraded === 0
        ? 'ok'
        : summary.monitorsDegraded >= summary.monitorsTotal
          ? 'danger'
          : 'warn';
  const rttUnit =
    data && data.rttP50 != null && data.rttP95 != null
      ? t('overview.rttPercentiles', {
          p50: formatMicros(data.rttP50),
          p95: formatMicros(data.rttP95),
        })
      : undefined;

  const insightsLink = (tab: string) => (
    <Link
      href={`/insights?tab=${tab}`}
      className="text-xs font-medium text-ink/60 hover:text-ink hover:underline dark:text-white/60 dark:hover:text-white"
    >
      {t('nav.insights')} →
    </Link>
  );

  const bodyNotice = (text: string) => (
    <p className="flex h-32 items-center justify-center text-sm text-ink/40 dark:text-white/40">
      {text}
    </p>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('nav.overview')}</h1>
        <StatusBadge value={data?.nhi ?? null} testId="nhi-badge" />
      </div>

      <PageIntro page="overview" />

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

      {/* At-a-glance summary strip (Phase 12) — additive; KPI tiles below unchanged. */}
      <div data-testid="overview-summary" className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <SummaryCard
          testId="summary-card-reliability"
          href="/insights?tab=scorecard"
          label={t('overview.summary.reliability')}
          value={summaryValue((s) => `${Math.round(s.reliabilityScore)}/100`)}
          sub={
            summary
              ? summary.availabilityPct != null
                ? t('overview.summary.availability', { p: summary.availabilityPct.toFixed(1) })
                : '—'
              : undefined
          }
          status={summary?.reliabilityStatus}
        />
        <SummaryCard
          testId="summary-card-cost"
          href="/cost"
          label={t('overview.summary.monthlyCost')}
          value={summaryValue((s) => formatUsd(s.monthlyUsdRunRate))}
        />
        <SummaryCard
          testId="summary-card-billed"
          href="/insights?tab=efficiency"
          label={t('overview.summary.billedRatio')}
          value={summaryValue((s) => `${(s.billedRatio * 100).toFixed(0)}%`)}
        />
        <SummaryCard
          testId="summary-card-dns"
          href="/insights?tab=dns"
          label={t('overview.summary.dns')}
          value={summaryValue((s) =>
            !s.dnsEnabled
              ? t('overview.summary.dnsOff')
              : s.dnsFailRate != null
                ? `${(s.dnsFailRate * 100).toFixed(1)}%`
                : '—',
          )}
          sub={
            summary?.dnsEnabled && summary.dnsResolverP95 != null
              ? t('overview.summary.resolverP95', { ms: Math.round(summary.dnsResolverP95) })
              : undefined
          }
          status={
            summary?.dnsEnabled
              ? statusFor(summary.dnsFailRate, DNS_FAIL_WARN, DNS_FAIL_DANGER)
              : undefined
          }
        />
        <SummaryCard
          testId="summary-card-concentration"
          href="/insights?tab=dependencies"
          label={t('overview.summary.concentration')}
          value={summaryValue((s) => `${(s.concentrationTopShare * 100).toFixed(0)}%`)}
        />
        <SummaryCard
          testId="summary-card-monitors"
          href="/monitors"
          label={t('overview.summary.monitors')}
          value={summaryValue((s) => `${s.monitorsTotal - s.monitorsDegraded}/${s.monitorsTotal}`)}
          status={monitorsStatus}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatDelta
          testId="kpi-dataTransferred"
          label={t('kpi.dataTransferred')}
          value={firstLoad ? '…' : formatBytes(kpis?.dataTransferred.value ?? 0)}
          deltaPct={kpis?.dataTransferred.deltaPct ?? undefined}
          spark={kpis?.dataTransferred.spark}
        />
        <StatDelta
          testId="kpi-retransmissions"
          label={t('kpi.retransmissions')}
          value={firstLoad ? '…' : formatCount(kpis?.retransmissions.value ?? 0)}
          deltaPct={kpis?.retransmissions.deltaPct ?? undefined}
          spark={kpis?.retransmissions.spark}
          status={statusFor(kpis?.retransmissions.value, RETRANS_WARN, RETRANS_DANGER)}
        />
        <StatDelta
          testId="kpi-timeouts"
          label={t('kpi.timeouts')}
          value={firstLoad ? '…' : formatCount(kpis?.timeouts.value ?? 0)}
          deltaPct={kpis?.timeouts.deltaPct ?? undefined}
          spark={kpis?.timeouts.spark}
          status={statusFor(kpis?.timeouts.value, TIMEOUT_WARN, TIMEOUT_DANGER)}
        />
        {/* RTT is often sparse — value stays "—" until a sample exists. */}
        <StatDelta
          testId="kpi-rtt"
          label={t('kpi.rtt')}
          value={firstLoad ? '…' : kpis?.rtt.value != null ? formatMicros(kpis.rtt.value) : '—'}
          unit={rttUnit}
          deltaPct={kpis?.rtt.deltaPct ?? undefined}
          spark={kpis?.rtt.spark}
        />
      </div>

      <HoverSyncProvider>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Widget
            title={t('overview.traffic')}
            className="md:col-span-2"
            testId="widget-overview-traffic"
            actions={
              <a
                href={cloudWatchMetricsUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-medium text-ink/60 hover:text-ink dark:text-white/60 dark:hover:text-white"
              >
                {t('monitors.viewInCloudWatch')}
                <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
              </a>
            }
          >
            {firstLoad ? bodyNotice(t('common.loading')) : <SyncedTrafficChart series={traffic} />}
          </Widget>

          {/* Golden-signal strip: fleet retrans/timeout rate per GB per 5-min bucket. */}
          <Widget title={t('overview.goldenSignals')} testId="widget-overview-golden">
            {firstLoad ? bodyNotice(t('common.loading')) : <SyncedErrorRateChart series={errorSeries} />}
          </Widget>

          <Widget
            title={t('overview.topTalkers')}
            testId="widget-overview-talkers"
            actions={insightsLink('cost')}
          >
            {firstLoad ? (
              bodyNotice(t('common.loading'))
            ) : (
              <Toplist rows={talkerRows} valueFormatter={formatUsd} testId="toplist-overview-talkers" />
            )}
          </Widget>

          <Widget
            title={t('insights.reliability.breaches')}
            testId="widget-overview-breaches"
            actions={insightsLink('reliability')}
          >
            <StatDelta
              testId="stat-overview-breaches"
              label={t('overview.breachesWindow')}
              value={firstLoad ? '…' : formatCount(breachCount)}
              status={data ? statusFor(breachCount, 1, BREACH_DANGER) : undefined}
            />
            {/* Additive anomaly teaser — row only exists when count > 0. */}
            {anomalyCount > 0 ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <AnomalyBadge count={anomalyCount} />
                <Link
                  href="/anomalies"
                  className="text-xs font-medium text-ink/60 hover:text-ink hover:underline dark:text-white/60 dark:hover:text-white"
                >
                  {t('nav.anomalies')} →
                </Link>
              </div>
            ) : null}
          </Widget>

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
      </HoverSyncProvider>
    </div>
  );
}
