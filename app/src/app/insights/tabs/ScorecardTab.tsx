'use client';
// Reliability scorecard tab (Phase 7 Task 2): per-monitor SLO cards (composite
// score + NHI availability + retrans/timeout rates), overall availability gauge,
// degraded-monitor breach timeline and the worst-services toplist. NHI is often
// all-healthy/sparse in the lab, so every widget degrades to an empty state.
import { useMemo } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import { lensQuery } from '@/lib/analytics/filters';
import { scoreStatus, type MonitorScore, type ScorecardResult } from '@/lib/analytics/scorecard';
import { DEFAULT_RETRANS_RATE, DEFAULT_TIMEOUT_RATE } from '@/lib/analytics/reliability';
import { STATUS } from '@/lib/chart-tokens';
import { formatBytes, formatCount } from '@/lib/format';
import Widget from '@/components/analytics/Widget';
import Toplist, { type ToplistRow } from '@/components/analytics/Toplist';
import { useHoverSync } from '@/components/analytics/HoverSync';
import Gauge from '@/components/charts/Gauge';
import TimeSeries from '@/components/charts/TimeSeries';
import { LensState, type TabProps } from './shared';

const rate = (v: number) => `${v.toFixed(1)}/GB`;

/** Score status badge, dual-encoded (STATUS dot + text — never color alone). */
function ScoreBadge({ status }: { status: MonitorScore['status'] }) {
  const { t } = useLanguage();
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-semibold text-ink dark:bg-white/10 dark:text-white">
      <span
        aria-hidden
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: STATUS[status] }}
      />
      {t(`toplist.status.${status}`)}
    </span>
  );
}

export default function ScorecardTab({ filters }: TabProps) {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<ScorecardResult>(
    `/api/analytics/scorecard${lensQuery(filters)}`,
  );
  const firstLoad = loading && !data;
  const { activeT, setActiveT } = useHoverSync();

  const monitors = data?.monitors ?? [];
  const overall = data?.overall;

  const timelineSeries = useMemo(
    () => [
      {
        name: t('insights.scorecard.degradedSeries'),
        points: (data?.breachTimeline ?? []).map((p) => ({ t: p.t, v: p.count })),
      },
    ],
    [data, t],
  );

  // Toplist contract: rows pre-sorted desc by value (the lens already sorts by
  // retransRate desc); breach-level rates get the danger dot.
  const worstRows: ToplistRow[] = useMemo(
    () =>
      (data?.worst ?? []).map((r) => ({
        label: r.label,
        value: r.retransRate,
        sub: t('insights.scorecard.timeoutsSub', { n: r.timeoutRate.toFixed(1) }),
        status:
          r.retransRate > DEFAULT_RETRANS_RATE || r.timeoutRate > DEFAULT_TIMEOUT_RATE
            ? ('danger' as const)
            : undefined,
      })),
    [data, t],
  );

  return (
    <div
      data-testid="insights-scorecard-panel"
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
    >
      <Widget title={t('insights.scorecard.overall')} testId="widget-scorecard-overall">
        <LensState
          loading={firstLoad}
          error={error}
          empty={overall?.availabilityPct == null}
          emptyLabel={t('insights.scorecard.noCw')}
        >
          <Gauge
            value={overall?.availabilityPct ?? 0}
            max={100}
            label={t('insights.scorecard.overallLabel')}
            status={overall ? scoreStatus(overall.score) : undefined}
            valueFormatter={(n) => `${n.toFixed(1)}%`}
          />
        </LensState>
      </Widget>

      <Widget
        title={t('insights.scorecard.monitors')}
        testId="widget-scorecard-monitors"
        className="md:col-span-2 xl:row-span-2"
      >
        <LensState
          loading={firstLoad}
          error={error}
          empty={monitors.length === 0}
          emptyLabel={t('insights.scorecard.empty')}
        >
          <ul className="flex max-h-96 flex-col gap-2 overflow-auto">
            {monitors.map((m) => (
              <li
                key={m.monitor}
                data-testid="scorecard-monitor-row"
                className="rounded-xl border border-black/5 p-3 dark:border-white/10"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium" title={m.monitor}>
                    {m.monitor}
                  </span>
                  <ScoreBadge status={m.status} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div>
                    <p className="text-ink/50 dark:text-white/50">{t('insights.scorecard.score')}</p>
                    <p className="text-lg font-semibold tabular-nums">{m.score.toFixed(0)}</p>
                  </div>
                  <div>
                    <p className="text-ink/50 dark:text-white/50">
                      {t('insights.scorecard.availability')}
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {m.nhiAvailabilityPct == null
                        ? t('status.unknown')
                        : `${m.nhiAvailabilityPct.toFixed(1)}%`}
                    </p>
                  </div>
                  <div>
                    <p className="text-ink/50 dark:text-white/50">
                      {t('insights.scorecard.retransRate')}
                    </p>
                    <p className="tabular-nums">{rate(m.retransRate)}</p>
                    <p className="text-[11px] text-ink/40 dark:text-white/40">{formatBytes(m.bytes)}</p>
                  </div>
                  <div>
                    <p className="text-ink/50 dark:text-white/50">
                      {t('insights.scorecard.timeoutRate')}
                    </p>
                    <p className="tabular-nums">{rate(m.timeoutRate)}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </LensState>
      </Widget>

      <Widget title={t('insights.scorecard.worst')} testId="widget-scorecard-worst">
        <LensState loading={firstLoad} error={error}>
          <Toplist rows={worstRows} valueFormatter={rate} testId="toplist-scorecard-worst" />
        </LensState>
      </Widget>

      <Widget
        title={t('insights.scorecard.breachTimeline')}
        testId="widget-scorecard-timeline"
        className="md:col-span-2 xl:col-span-3"
      >
        <LensState
          loading={firstLoad}
          error={error}
          empty={(data?.breachTimeline ?? []).length === 0}
          emptyLabel={t('insights.scorecard.noCw')}
        >
          <TimeSeries
            series={timelineSeries}
            valueFormatter={formatCount}
            height={220}
            activeT={activeT}
            onActiveTimeChange={setActiveT}
          />
        </LensState>
      </Widget>
    </div>
  );
}
