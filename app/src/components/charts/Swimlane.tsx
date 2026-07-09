'use client';

import { useMemo } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { STATUS } from '@/lib/chart-tokens';

export interface SwimlanePoint {
  t: string; // ISO timestamp
  healthy: boolean;
}

export interface SwimlaneLane {
  monitor: string;
  points: SwimlanePoint[];
}

const timeLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Health swimlanes: one horizontal band per monitor on a shared time axis.
 * Each sample fills the band from its timestamp to the next sample, colored
 * STATUS.ok / STATUS.danger. Status is dual-encoded via the legend text and a
 * per-segment title + sr-only label (never color alone).
 */
export default function Swimlane({ lanes }: { lanes: SwimlaneLane[] }) {
  const { t } = useLanguage();

  const { parsed, tMin, tMax } = useMemo(() => {
    const parsed = lanes.map((lane) => ({
      monitor: lane.monitor,
      points: lane.points
        .map((p) => ({ ms: Date.parse(p.t), healthy: p.healthy }))
        .filter((p) => Number.isFinite(p.ms))
        .sort((a, b) => a.ms - b.ms),
    }));
    const all = parsed.flatMap((l) => l.points.map((p) => p.ms));
    return {
      parsed,
      tMin: all.length ? Math.min(...all) : 0,
      tMax: all.length ? Math.max(...all) : 0,
    };
  }, [lanes]);

  const hasPoints = parsed.some((l) => l.points.length > 0);
  if (lanes.length === 0 || !hasPoints) {
    return (
      <div
        data-testid="chart-swimlane"
        className="flex h-32 items-center justify-center text-sm text-ink/40 dark:text-white/40"
      >
        {t('chart.empty')}
      </div>
    );
  }

  const span = tMax - tMin;
  const pos = (ms: number) => (span === 0 ? 0 : ((ms - tMin) / span) * 100);

  return (
    <div data-testid="chart-swimlane" className="text-ink dark:text-white">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5 text-xs text-ink/60 dark:text-white/60">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: STATUS.ok }} aria-hidden />
          {t('status.healthy')}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-ink/60 dark:text-white/60">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: STATUS.danger }} aria-hidden />
          {t('status.degraded')}
        </span>
      </div>
      <div className="grid items-center gap-x-3 gap-y-1.5" style={{ gridTemplateColumns: 'minmax(0, auto) 1fr' }}>
        {parsed.map((lane) => (
          <div key={lane.monitor} className="contents">
            <span
              className="truncate text-xs text-ink/60 dark:text-white/60"
              title={lane.monitor}
            >
              {lane.monitor}
            </span>
            <div className="relative h-4 overflow-hidden rounded bg-black/[0.04] dark:bg-white/[0.06]">
              {lane.points.map((p, i) => {
                const left = pos(p.ms);
                const right = i < lane.points.length - 1 ? pos(lane.points[i + 1].ms) : 100;
                const status = p.healthy ? t('status.healthy') : t('status.degraded');
                return (
                  <span
                    key={`${p.ms}-${i}`}
                    className="absolute inset-y-0"
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(right - left, 0.5)}%`,
                      backgroundColor: p.healthy ? STATUS.ok : STATUS.danger,
                    }}
                    title={`${lane.monitor} · ${timeLabel(p.ms)} · ${status}`}
                  >
                    <span className="sr-only">{status}</span>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
        {/* shared time axis */}
        <span aria-hidden />
        <div className="flex justify-between text-[11px] tabular-nums text-ink/40 dark:text-white/40">
          <span>{timeLabel(tMin)}</span>
          {span > 0 ? <span>{timeLabel(tMax)}</span> : null}
        </div>
      </div>
    </div>
  );
}
