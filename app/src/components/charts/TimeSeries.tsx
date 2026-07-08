'use client';

import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { SERIES_COLORS } from '@/lib/chart-tokens';
import ChartTooltip from './ChartTooltip';

export interface TimePoint {
  t: string; // ISO timestamp
  v: number;
}
export interface TimeSeriesInput {
  name: string;
  color?: string;
  points: TimePoint[];
}

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Multi-series line chart on a shared time axis. Colors come from the fixed
 * token order; a legend is rendered for >= 2 series (dataviz rule).
 */
export default function TimeSeries({
  series,
  valueFormatter = (n: number) => String(n),
  height = 260,
}: {
  series: TimeSeriesInput[];
  valueFormatter?: (n: number) => string;
  height?: number;
}) {
  const { t } = useLanguage();

  const { rows, keys } = useMemo(() => {
    const byTime = new Map<string, Record<string, number | string>>();
    for (const s of series) {
      for (const p of s.points) {
        const row = byTime.get(p.t) ?? { t: p.t };
        row[s.name] = p.v;
        byTime.set(p.t, row);
      }
    }
    const rows = [...byTime.values()].sort((a, b) =>
      String(a.t).localeCompare(String(b.t)),
    );
    return { rows, keys: series.map((s) => s.name) };
  }, [series]);

  if (rows.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-ink/40 dark:text-white/40"
        style={{ height }}
      >
        {t('chart.empty')}
      </div>
    );
  }

  const colorOf = (i: number) => series[i].color ?? SERIES_COLORS[i % SERIES_COLORS.length];

  return (
    <div className="text-ink dark:text-white">
      {keys.length >= 2 ? (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          {keys.map((k, i) => (
            <span key={k} className="flex items-center gap-1.5 text-xs text-ink/60 dark:text-white/60">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: colorOf(i) }}
                aria-hidden
              />
              {k}
            </span>
          ))}
        </div>
      ) : null}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
          <XAxis
            dataKey="t"
            tickFormatter={timeLabel}
            tick={{ fill: 'currentColor', fontSize: 11, opacity: 0.55 }}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={valueFormatter}
            tick={{ fill: 'currentColor', fontSize: 11, opacity: 0.55 }}
            axisLine={false}
            tickLine={false}
            width={64}
          />
          <Tooltip
            cursor={{ stroke: 'currentColor', strokeOpacity: 0.2 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <ChartTooltip
                  title={timeLabel(String(label))}
                  rows={payload.map((p) => ({
                    name: String(p.name),
                    value: valueFormatter(Number(p.value)),
                    color: String(p.color),
                  }))}
                />
              ) : null
            }
          />
          {keys.map((k, i) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              stroke={colorOf(i)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
