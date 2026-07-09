'use client';

import { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { CATEGORY_COLORS, SERIES_COLORS, type DestCategory } from '@/lib/chart-tokens';
import ChartTooltip from './ChartTooltip';

export interface StreamPoint {
  t: string; // ISO timestamp
  values: Record<string, number>;
}

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Stream graph: stacked areas with a silhouette (centered) baseline. Colors
 * come from CATEGORY_COLORS when a key is a destination category, otherwise
 * from the fixed series order; an HTML legend dual-encodes key identity.
 */
export default function StreamGraph({
  data,
  keys,
  colors,
  valueFormatter = (n: number) => String(n),
  height = 260,
}: {
  data: StreamPoint[];
  keys: string[];
  colors?: Record<string, string>;
  valueFormatter?: (n: number) => string;
  height?: number;
}) {
  const { t } = useLanguage();
  const rows = useMemo(
    () => data.map((d) => ({ t: d.t, ...d.values })),
    [data],
  );

  if (rows.length === 0 || keys.length === 0) {
    return (
      <div
        data-testid="chart-stream"
        className="flex items-center justify-center text-sm text-ink/40 dark:text-white/40"
        style={{ height }}
      >
        {t('chart.empty')}
      </div>
    );
  }

  const colorOf = (key: string, i: number) =>
    colors?.[key] ??
    CATEGORY_COLORS[key as DestCategory] ??
    SERIES_COLORS[i % SERIES_COLORS.length];

  return (
    <div data-testid="chart-stream" className="text-ink dark:text-white">
      {keys.length >= 2 ? (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          {keys.map((k, i) => (
            <span key={k} className="flex items-center gap-1.5 text-xs text-ink/60 dark:text-white/60">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: colorOf(k, i) }}
                aria-hidden
              />
              {k}
            </span>
          ))}
        </div>
      ) : null}
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={rows} stackOffset="silhouette" margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <XAxis
            dataKey="t"
            tickFormatter={timeLabel}
            tick={{ fill: 'currentColor', fontSize: 11, opacity: 0.55 }}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          {/* Silhouette offsets the baseline, so absolute y positions are meaningless. */}
          <YAxis hide />
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
            <Area
              key={k}
              type="monotone"
              dataKey={k}
              stackId="stream"
              stroke={colorOf(k, i)}
              fill={colorOf(k, i)}
              fillOpacity={0.85}
              strokeWidth={1}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
