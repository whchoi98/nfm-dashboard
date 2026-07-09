'use client';

import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { SERIES_COLORS, STATUS } from '@/lib/chart-tokens';

export type GaugeStatus = keyof typeof STATUS;

/**
 * Semicircular gauge (180° → 0°). State is dual-encoded: the status hue fills
 * the arc while the centered numeric value + label carry the same information
 * as text (never color-alone).
 */
export default function Gauge({
  value,
  max,
  label,
  status,
  valueFormatter = (n: number) => String(n),
  height = 160,
}: {
  value: number;
  max: number;
  label: string;
  status?: GaugeStatus;
  valueFormatter?: (n: number) => string;
  height?: number;
}) {
  const { t } = useLanguage();

  if (!Number.isFinite(max) || max <= 0) {
    return (
      <div
        data-testid="chart-gauge"
        className="flex items-center justify-center text-sm text-ink/40 dark:text-white/40"
        style={{ height }}
      >
        {t('chart.empty')}
      </div>
    );
  }

  const clamped = Math.min(Math.max(value, 0), max);
  const color = status ? STATUS[status] : SERIES_COLORS[0];

  return (
    <div data-testid="chart-gauge" className="relative text-ink dark:text-white" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          data={[{ name: label, value: clamped }]}
          startAngle={180}
          endAngle={0}
          innerRadius="130%"
          outerRadius="170%"
          cy="88%"
        >
          <PolarAngleAxis type="number" domain={[0, max]} tick={false} />
          <RadialBar
            dataKey="value"
            cornerRadius={6}
            fill={color}
            background={{ fill: 'currentColor', fillOpacity: 0.08 }}
            isAnimationActive={false}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">{valueFormatter(value)}</p>
        <p className="text-xs font-medium text-ink/60 dark:text-white/60">
          {label}
          {status ? <span className="sr-only">({status})</span> : null}
        </p>
      </div>
    </div>
  );
}
