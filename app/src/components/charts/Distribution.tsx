'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { TOKENS } from '@/lib/chart-tokens';
import { formatCount } from '@/lib/format';
import ChartTooltip from './ChartTooltip';

export interface DistributionBin {
  bucketMs: number; // lower bound of the bucket
  count: number;
}

/** Latency histogram: one hue, counts per pre-computed bucket. */
export default function Distribution({
  bins,
  unit = 'ms',
  height = 220,
}: {
  bins: DistributionBin[];
  unit?: string;
  height?: number;
}) {
  const { t } = useLanguage();
  const bucketLabel = (v: number) => `${v}${unit}`;

  if (bins.length === 0) {
    return (
      <div
        data-testid="chart-distribution"
        className="flex items-center justify-center text-sm text-ink/40 dark:text-white/40"
        style={{ height }}
      >
        {t('chart.empty')}
      </div>
    );
  }

  return (
    <div data-testid="chart-distribution" className="text-ink dark:text-white">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={bins} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="10%">
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
          <XAxis
            dataKey="bucketMs"
            tickFormatter={bucketLabel}
            tick={{ fill: 'currentColor', fontSize: 11, opacity: 0.55 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatCount}
            tick={{ fill: 'currentColor', fontSize: 11, opacity: 0.55 }}
            axisLine={false}
            tickLine={false}
            width={48}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: 'currentColor', opacity: 0.06 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as DistributionBin;
              return (
                <ChartTooltip
                  title={bucketLabel(d.bucketMs)}
                  rows={[{ name: t('chart.count'), value: formatCount(d.count), color: TOKENS.chartBlue }]}
                />
              );
            }}
          />
          <Bar dataKey="count" fill={TOKENS.chartBlue} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
