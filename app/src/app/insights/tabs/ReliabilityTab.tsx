'use client';
// Reliability tab (Task 4a): summary tiles, retransmission hotspot toplist,
// breach table, NHI timeseries + per-monitor swimlanes and the RTT×retrans
// scatter. Consumes the shared HoverSync context (TimeSeries does not expose
// hover callbacks yet, so 4a only READS activeT — 4b's timeseries widgets can
// start producing it without touching this tab).
import { useMemo } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import { lensQuery } from '@/lib/analytics/filters';
import type { ReliabilityLensResult } from '@/lib/analytics/reliability';
import { formatBytes, formatCount, formatMicros } from '@/lib/format';
import Widget from '@/components/analytics/Widget';
import Toplist, { type ToplistRow } from '@/components/analytics/Toplist';
import { useHoverSync } from '@/components/analytics/HoverSync';
import StatDelta from '@/components/charts/StatDelta';
import TimeSeries from '@/components/charts/TimeSeries';
import Swimlane from '@/components/charts/Swimlane';
import Scatter from '@/components/charts/Scatter';
import { LensState, type TabProps } from './shared';

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export default function ReliabilityTab({ filters }: TabProps) {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<ReliabilityLensResult>(
    `/api/analytics/reliability${lensQuery(filters)}`,
  );
  const firstLoad = loading && !data;
  // Shared crosshair: read-only in 4a (no producer yet) — shows the hovered
  // bucket next to the NHI widget title once a producer exists.
  const { activeT } = useHoverSync();

  const breaches = useMemo(() => data?.breaches ?? [], [data]);
  const breachKeys = useMemo(() => new Set(breaches.map((b) => b.key)), [breaches]);

  // Toplist contract: rows pre-sorted desc by value (retransRate).
  const hotspotRows: ToplistRow[] = useMemo(
    () =>
      [...(data?.hotspots ?? [])]
        .sort((a, b) => b.retransRate - a.retransRate)
        .slice(0, 10)
        .map((r) => ({
          label: r.label,
          value: r.retransRate,
          sub: t('insights.reliability.retrans', { n: formatCount(r.retransmissions) }),
          status: breachKeys.has(r.key) ? ('danger' as const) : ('ok' as const),
        })),
    [data, breachKeys, t],
  );

  const nhiPoints = data?.nhi.points ?? [];
  const nhiLast = nhiPoints.length > 0 ? nhiPoints[nhiPoints.length - 1] : undefined;
  // nhiTimeline normalizes HealthIndicator to 0 = healthy / 1 = degraded.
  const nhiHealthy = nhiLast ? nhiLast.v === 0 : undefined;

  const scatterPoints = useMemo(
    () =>
      (data?.scatter ?? []).map((p) => ({
        x: p.retransmissions,
        y: p.rtt,
        // Scatter has no size channel — bytes ride along in the tooltip label.
        label: `${p.label} · ${formatBytes(p.bytes)}`,
      })),
    [data],
  );

  const rate = (v: number) => `${v.toFixed(1)}/GB`;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Widget title={t('insights.reliability.summary')} testId="widget-reliability-summary">
        <LensState loading={firstLoad} error={error}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatDelta
              label={t('insights.reliability.breaches')}
              value={breaches.length}
              status={breaches.length > 0 ? 'danger' : 'ok'}
              testId="stat-reliability-breaches"
            />
            <StatDelta
              label={t('kpi.nhi')}
              value={
                nhiHealthy === undefined
                  ? t('status.unknown')
                  : nhiHealthy
                    ? t('status.healthy')
                    : t('status.degraded')
              }
              status={nhiHealthy === undefined ? undefined : nhiHealthy ? 'ok' : 'danger'}
              spark={nhiPoints.map((p) => p.v)}
              testId="stat-reliability-nhi"
            />
          </div>
        </LensState>
      </Widget>

      <Widget title={t('insights.reliability.hotspots')} testId="widget-reliability-hotspots">
        <LensState loading={firstLoad} error={error}>
          <Toplist rows={hotspotRows} valueFormatter={rate} testId="toplist-reliability-hotspots" />
        </LensState>
      </Widget>

      <Widget title={t('insights.reliability.breachesTable')} testId="widget-reliability-breaches">
        <LensState
          loading={firstLoad}
          error={error}
          empty={breaches.length === 0}
          emptyLabel={t('insights.reliability.noBreaches')}
        >
          {/* Capped height: dozens of breach rows must not stretch the bento row. */}
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-ink/50 dark:text-white/50">
                  <th className="py-1.5 pr-2 font-medium">{t('insights.reliability.colEntity')}</th>
                  <th className="py-1.5 pr-2 font-medium">{t('insights.reliability.colRetransRate')}</th>
                  <th className="py-1.5 pr-2 font-medium">{t('insights.reliability.colTimeoutRate')}</th>
                  <th className="py-1.5 font-medium">{t('insights.reliability.colBytes')}</th>
                </tr>
              </thead>
              <tbody>
                {breaches.map((r) => (
                  <tr key={r.key} className="border-t border-black/5 dark:border-white/10">
                    <td className="max-w-48 truncate py-1.5 pr-2 font-medium" title={r.label}>
                      {r.label}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums">{r.retransRate.toFixed(1)}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{r.timeoutRate.toFixed(1)}</td>
                    <td className="py-1.5 tabular-nums">{formatBytes(r.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LensState>
      </Widget>

      <Widget
        title={t('kpi.nhi')}
        testId="widget-reliability-nhi"
        className="md:col-span-2"
        actions={
          activeT ? (
            <span className="text-[11px] tabular-nums text-ink/50 dark:text-white/50">
              {timeLabel(activeT)}
            </span>
          ) : undefined
        }
      >
        <LensState loading={firstLoad} error={error}>
          <TimeSeries
            series={[{ name: t('kpi.nhi'), points: nhiPoints }]}
            valueFormatter={(n) => String(n)}
            height={220}
          />
        </LensState>
      </Widget>

      <Widget title={t('insights.reliability.monitors')} testId="widget-reliability-swimlanes">
        <LensState loading={firstLoad} error={error}>
          <Swimlane lanes={data?.nhiSwimlanes ?? []} />
        </LensState>
      </Widget>

      <Widget title={t('insights.reliability.scatter')} testId="widget-reliability-scatter">
        <LensState loading={firstLoad} error={error}>
          <Scatter
            points={scatterPoints}
            xLabel={t('metric.RETRANSMISSIONS')}
            yLabel={t('metric.ROUND_TRIP_TIME')}
            xFormatter={formatCount}
            yFormatter={formatMicros}
            height={220}
          />
        </LensState>
      </Widget>
    </div>
  );
}
