'use client';

import { useMemo } from 'react';
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter as RechartsScatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { SERIES_COLORS } from '@/lib/chart-tokens';
import ChartTooltip from './ChartTooltip';

export interface ScatterPoint {
  x: number;
  y: number;
  label?: string;
}

const median = (nums: number[]): number => {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Scatter plot with 4-quadrant reference lines at the median x / median y
 * (e.g. latency vs. volume outlier maps). One series, one token hue.
 */
export default function Scatter({
  points,
  xLabel,
  yLabel,
  xFormatter = (n: number) => String(n),
  yFormatter = (n: number) => String(n),
  height = 260,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xFormatter?: (n: number) => string;
  yFormatter?: (n: number) => string;
  height?: number;
}) {
  const { t } = useLanguage();
  const medians = useMemo(
    () =>
      points.length === 0
        ? null
        : { x: median(points.map((p) => p.x)), y: median(points.map((p) => p.y)) },
    [points],
  );

  if (points.length === 0 || !medians) {
    return (
      <div
        data-testid="chart-scatter"
        className="flex items-center justify-center text-sm text-ink/40 dark:text-white/40"
        style={{ height }}
      >
        {t('chart.empty')}
      </div>
    );
  }

  return (
    <div data-testid="chart-scatter" className="text-ink dark:text-white">
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.08} />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel}
            tickFormatter={xFormatter}
            tick={{ fill: 'currentColor', fontSize: 11, opacity: 0.55 }}
            axisLine={false}
            tickLine={false}
            label={{
              value: xLabel,
              position: 'insideBottom',
              offset: -2,
              fill: 'currentColor',
              fontSize: 11,
              opacity: 0.55,
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yLabel}
            tickFormatter={yFormatter}
            tick={{ fill: 'currentColor', fontSize: 11, opacity: 0.55 }}
            axisLine={false}
            tickLine={false}
            width={64}
            label={{
              value: yLabel,
              angle: -90,
              position: 'insideLeft',
              fill: 'currentColor',
              fontSize: 11,
              opacity: 0.55,
            }}
          />
          {/* Median cross → 4 quadrants (high/low on each measure). */}
          <ReferenceLine x={medians.x} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="4 4" />
          <ReferenceLine y={medians.y} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="4 4" />
          <Tooltip
            cursor={{ stroke: 'currentColor', strokeOpacity: 0.2, strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as ScatterPoint;
              return (
                <ChartTooltip
                  title={p.label}
                  rows={[
                    { name: xLabel, value: xFormatter(p.x), color: SERIES_COLORS[0] },
                    { name: yLabel, value: yFormatter(p.y), color: SERIES_COLORS[0] },
                  ]}
                />
              );
            }}
          />
          <RechartsScatter data={points} fill={SERIES_COLORS[0]} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
