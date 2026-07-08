'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { CATEGORY_COLORS, CATEGORY_ORDER, type DestCategory } from '@/lib/chart-tokens';
import { formatBytes, formatCount } from '@/lib/format';
import ChartTooltip from './ChartTooltip';

export interface CategoryTotals {
  dataTransferred: number;
  retransmissions: number;
  timeouts: number;
}
export type ByCategory = Record<DestCategory, CategoryTotals>;

// Bytes and counts live on different scales — never share one axis (no dual-axis):
// render one small-multiple panel per metric instead.
const PANELS: { key: keyof CategoryTotals; labelKey: string; fmt: (n: number) => string }[] = [
  { key: 'dataTransferred', labelKey: 'kpi.dataTransferred', fmt: formatBytes },
  { key: 'retransmissions', labelKey: 'kpi.retransmissions', fmt: formatCount },
  { key: 'timeouts', labelKey: 'kpi.timeouts', fmt: formatCount },
];

/** Per-category metric totals as small multiples of rounded-cap bar charts. */
export default function CategoryBars({ byCategory }: { byCategory: ByCategory | null }) {
  const { t } = useLanguage();

  if (!byCategory) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-ink/40 dark:text-white/40">
        {t('chart.empty')}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 text-ink sm:grid-cols-3 dark:text-white">
      {PANELS.map(({ key, labelKey, fmt }) => {
        const data = CATEGORY_ORDER.map((cat) => ({
          cat,
          label: t(`category.${cat}`),
          value: byCategory[cat]?.[key] ?? 0,
        }));
        return (
          <div key={key}>
            <p className="mb-1 text-xs font-medium text-ink/60 dark:text-white/60">{t(labelKey)}</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={data} margin={{ top: 28, right: 4, bottom: 0, left: 4 }} barCategoryGap="25%">
                <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'currentColor', fontSize: 10, opacity: 0.55 }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis hide />
                <Tooltip
                  cursor={{ fill: 'currentColor', opacity: 0.06 }}
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <ChartTooltip
                        rows={payload.map((p) => {
                          const d = p.payload as (typeof data)[number];
                          return { name: d.label, value: fmt(d.value), color: CATEGORY_COLORS[d.cat] };
                        })}
                      />
                    ) : null
                  }
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {/* Direct value labels satisfy the pastel-palette contrast relief. */}
                  <LabelList
                    dataKey="value"
                    position="top"
                    formatter={(v) => fmt(Number(v))}
                    style={{ fill: 'currentColor', fontSize: 10, opacity: 0.7 }}
                  />
                  {data.map((d) => (
                    <Cell key={d.cat} fill={CATEGORY_COLORS[d.cat]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}
