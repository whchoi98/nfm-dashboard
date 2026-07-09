'use client';

import { useMemo } from 'react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { SERIES_COLORS, STATUS } from '@/lib/chart-tokens';

export type StatStatus = keyof typeof STATUS;
export type StatTrend = 'up' | 'down' | 'flat';

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const TREND_ICONS: Record<StatTrend, typeof TrendingUp> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

/**
 * SnowUI-style stat tile: big value + delta badge + mini sparkline.
 * Trend is dual-encoded (lucide icon direction + signed %), never color-alone;
 * an optional status hue tints the sparkline and the status dot.
 */
export default function StatDelta({
  label,
  value,
  unit,
  deltaPct,
  trend,
  spark,
  status,
}: {
  label: string;
  value: string | number;
  unit?: string;
  deltaPct?: number;
  trend?: StatTrend;
  spark?: number[];
  status?: StatStatus;
}) {
  const effectiveTrend: StatTrend =
    trend ?? (deltaPct == null || deltaPct === 0 ? 'flat' : deltaPct > 0 ? 'up' : 'down');
  const TrendIcon = TREND_ICONS[effectiveTrend];
  const sparkColor = status ? STATUS[status] : SERIES_COLORS[0];
  const sparkRows = useMemo(() => (spark ?? []).map((v, i) => ({ i, v })), [spark]);

  return (
    <div
      data-testid={`stat-${slug(label)}`}
      className="rounded-card bg-surface p-5 text-ink dark:bg-white/5 dark:text-white"
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink/60 dark:text-white/60">
        {status ? (
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: STATUS[status] }}
            aria-hidden
          />
        ) : null}
        {label}
        {status ? <span className="sr-only">({status})</span> : null}
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold tracking-tight tabular-nums">
            {value}
            {unit ? (
              <span className="ml-1 text-sm font-medium text-ink/60 dark:text-white/60">{unit}</span>
            ) : null}
          </p>
          {deltaPct != null ? (
            <span className="mt-1 flex items-center gap-1 text-xs font-medium text-ink/70 dark:text-white/70">
              <TrendIcon size={14} strokeWidth={1.5} aria-label={effectiveTrend} />
              <span className="tabular-nums">
                {deltaPct > 0 ? '+' : ''}
                {deltaPct.toFixed(1)}%
              </span>
            </span>
          ) : null}
        </div>
        {sparkRows.length > 1 ? (
          <div className="h-10 w-24" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkRows} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke={sparkColor}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </div>
    </div>
  );
}
