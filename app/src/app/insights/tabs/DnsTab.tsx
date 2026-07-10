'use client';
// DNS tab (Task 4b): renders the precomputed DNS#latest aggregate — the route
// takes NO lens query (the aggregate is independent of range/namespace/category
// filters, so the tab ignores TabProps). When resolver query logging is off a
// single guidance card replaces the grid.
import { useMemo } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import { capSankeyLinks, SANKEY_MAX_LINKS } from '@/lib/analytics/dependencies';
import type { DnsAggregate } from '@/lib/types';
import { formatCount } from '@/lib/format';
import Widget from '@/components/analytics/Widget';
import Toplist, { type ToplistRow } from '@/components/analytics/Toplist';
import StatDelta from '@/components/charts/StatDelta';
import Sankey from '@/components/charts/Sankey';
import { LensState } from './shared';

/** DNS resolver latency is MILLISECONDS (durationMs) — never formatMicros. */
const formatMs = (v: number) => `${v.toFixed(1)} ms`;
/** failRate is a 0–1 fraction (collector/src/dns.ts). */
const formatPct = (v: number) => `${(v * 100).toFixed(1)}%`;

// Accepts no props on purpose: () => JSX is assignable to ComponentType<TabProps>,
// and the DNS aggregate has no filter inputs to consume.
export default function DnsTab() {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<DnsAggregate>('/api/analytics/dns');
  const firstLoad = loading && !data;

  // Toplist contract: rows pre-sorted desc by value.
  const domainRows: ToplistRow[] = useMemo(
    () =>
      [...(data?.topDomains ?? [])]
        .sort((a, b) => b.count - a.count)
        .slice(0, 12)
        .map((r) => ({
          label: r.name,
          value: r.count,
          sub: t(r.internal ? 'dns.internal' : 'dns.external'),
        })),
    [data, t],
  );

  const typeRows: ToplistRow[] = useMemo(
    () =>
      [...(data?.queryTypes ?? [])]
        .sort((a, b) => b.count - a.count)
        .map((r) => ({ label: r.type, value: r.count })),
    [data],
  );

  // The resolution sankey is collector-built (can't cap at the source): live
  // aggregates carry 500+ links which render as a hairball, so cap client-side
  // to the top links (capSankeyLinks reindexes nodes/links consistently).
  const resolution = useMemo(
    () => (data?.resolution ? capSankeyLinks(data.resolution) : null),
    [data],
  );

  const failureRows: ToplistRow[] = useMemo(
    () =>
      [...(data?.failures ?? [])]
        .sort((a, b) => b.failRate - a.failRate)
        .slice(0, 10)
        .map((r) => ({
          label: r.label,
          value: r.failRate,
          sub: `${formatCount(r.nxdomain)} NXDOMAIN / ${formatCount(r.servfail)} SERVFAIL`,
          status: r.failRate > 0 ? ('warn' as const) : ('ok' as const),
        })),
    [data],
  );

  // First load (aggregate not fetched yet): a pulsing skeleton approximating
  // the real widget grid, so `widget-dns-disabled` renders ONLY once the
  // aggregate is loaded and enabled===false — never as a flash while loading.
  // A first-load error falls through to the guidance card (LensState shows it).
  if (!data && !error) {
    return (
      <div
        data-testid="dns-skeleton"
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        aria-busy="true"
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-card bg-surface p-5 dark:bg-white/5">
            <div className="mb-4 h-4 w-32 rounded-card bg-ink/10 dark:bg-white/10" />
            <div className="h-28 rounded-card bg-ink/5 dark:bg-white/10" />
          </div>
        ))}
        <div className="animate-pulse rounded-card bg-surface p-5 md:col-span-2 dark:bg-white/5">
          <div className="mb-4 h-4 w-40 rounded-card bg-ink/10 dark:bg-white/10" />
          <div className="h-64 rounded-card bg-ink/5 dark:bg-white/10" />
        </div>
      </div>
    );
  }

  // Error / logging-disabled collapse to a single guidance card.
  if (!data?.enabled) {
    return (
      <div className="grid grid-cols-1 gap-4">
        <Widget title={t('insights.dns.title')} testId="widget-dns-disabled">
          <LensState loading={firstLoad} error={error}>
            <p className="flex min-h-24 items-center justify-center px-4 text-center text-sm text-ink/60 dark:text-white/60">
              {t('dns.notEnabled')}
            </p>
          </LensState>
        </Widget>
      </div>
    );
  }

  const lat = data.latency;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Widget title={t('insights.dns.latency')} testId="widget-dns-latency">
        <LensState loading={firstLoad} error={error} empty={lat.count === 0}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatDelta label={t('insights.latency.p50')} value={formatMs(lat.p50)} testId="stat-dns-p50" />
            <StatDelta label={t('insights.latency.p90')} value={formatMs(lat.p90)} testId="stat-dns-p90" />
            <StatDelta label={t('insights.latency.p95')} value={formatMs(lat.p95)} testId="stat-dns-p95" />
          </div>
        </LensState>
      </Widget>

      <Widget title={t('insights.dns.topDomains')} testId="widget-dns-domains">
        <LensState loading={firstLoad} error={error}>
          <Toplist rows={domainRows} valueFormatter={formatCount} testId="toplist-dns-domains" />
        </LensState>
      </Widget>

      <Widget title={t('insights.dns.queryTypes')} testId="widget-dns-query-types">
        <LensState loading={firstLoad} error={error}>
          <Toplist rows={typeRows} valueFormatter={formatCount} testId="toplist-dns-query-types" />
        </LensState>
      </Widget>

      <Widget title={t('insights.dns.failures')} testId="widget-dns-failures">
        <LensState loading={firstLoad} error={error}>
          <Toplist rows={failureRows} valueFormatter={formatPct} testId="toplist-dns-failures" />
        </LensState>
      </Widget>

      <Widget
        title={t('insights.dns.resolution')}
        testId="widget-dns-resolution"
        className="md:col-span-2"
      >
        <LensState loading={firstLoad} error={error}>
          <Sankey
            data={resolution?.data ?? { nodes: [], links: [] }}
            valueFormatter={formatCount}
            height={320}
          />
          {resolution?.truncated ? (
            <p className="mt-2 text-[11px] text-ink/50 dark:text-white/50">
              {t('insights.capFlows', { n: SANKEY_MAX_LINKS })}
            </p>
          ) : null}
        </LensState>
      </Widget>
    </div>
  );
}
