'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { TOKENS } from '@/lib/chart-tokens';
import ChartTooltip from './ChartTooltip';

export interface ParetoRow {
  label: string;
  value: number;
  cumulativePct: number; // 0-100, precomputed by the caller
}

/**
 * Pareto chart: value bars (left axis) + cumulative-% line on a fixed 0-100
 * right axis. The right axis is the derived share of the same measure, not a
 * second measure, so the twin axes stay legitimate.
 */
export default function Pareto({
  rows,
  valueFormatter = (n: number) => String(n),
  height = 260,
}: {
  rows: ParetoRow[];
  valueFormatter?: (n: number) => string;
  height?: number;
}) {
  const { t } = useLanguage();

  if (rows.length === 0) {
    return (
      <div
        data-testid="chart-pareto"
        className="flex items-center justify-center text-sm text-ink/40 dark:text-white/40"
        style={{ height }}
      >
        {t('chart.empty')}
      </div>
    );
  }

  return (
    <div data-testid="chart-pareto" className="text-ink dark:text-white">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
          <XAxis
            dataKey="label"
            tick={{ fill: 'currentColor', fontSize: 11, opacity: 0.55 }}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <YAxis
            yAxisId="value"
            tickFormatter={valueFormatter}
            tick={{ fill: 'currentColor', fontSize: 11, opacity: 0.55 }}
            axisLine={false}
            tickLine={false}
            width={64}
          />
          <YAxis
            yAxisId="pct"
            orientation="right"
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fill: 'currentColor', fontSize: 11, opacity: 0.55 }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ fill: 'currentColor', opacity: 0.06 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <ChartTooltip
                  title={String(label)}
                  rows={payload.map((p) => ({
                    name: String(p.name),
                    value:
                      p.dataKey === 'cumulativePct'
                        ? `${Number(p.value).toFixed(1)}%`
                        : valueFormatter(Number(p.value)),
                    color: String(p.color ?? p.fill),
                  }))}
                />
              ) : null
            }
          />
          <Bar
            yAxisId="value"
            dataKey="value"
            fill={TOKENS.chartViolet}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="cumulativePct"
            stroke={TOKENS.chartRose}
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 0, fill: TOKENS.chartRose }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
