'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { CATEGORY_COLORS, CATEGORY_ORDER, type DestCategory } from '@/lib/chart-tokens';
import ChartTooltip from './ChartTooltip';

/**
 * Category share donut (SnowUI "Traffic by Location" style): segments with a
 * gap spacer, plus an HTML legend carrying name + percentage (identity is
 * never color-alone).
 */
export default function CategoryDonut({
  values,
  valueFormatter = (n: number) => String(n),
}: {
  values: Record<DestCategory, number> | null;
  valueFormatter?: (n: number) => string;
}) {
  const { t } = useLanguage();
  const data = CATEGORY_ORDER.map((cat) => ({
    cat,
    name: t(`category.${cat}`),
    value: values?.[cat] ?? 0,
  }));
  const total = data.reduce((s, d) => s + d.value, 0);

  if (!values || total <= 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-ink/40 dark:text-white/40">
        {t('chart.empty')}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="h-48 w-48 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <ChartTooltip
                    rows={payload.map((p) => {
                      const d = p.payload as (typeof data)[number];
                      return { name: d.name, value: valueFormatter(d.value), color: CATEGORY_COLORS[d.cat] };
                    })}
                  />
                ) : null
              }
            />
            <Pie
              data={data.filter((d) => d.value > 0)}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={3}
              cornerRadius={4}
              stroke="none"
              isAnimationActive={false}
            >
              {data
                .filter((d) => d.value > 0)
                .map((d) => (
                  <Cell key={d.cat} fill={CATEGORY_COLORS[d.cat]} />
                ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex w-full flex-col gap-2">
        {data.map((d) => (
          <li key={d.cat} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: CATEGORY_COLORS[d.cat] }}
              aria-hidden
            />
            <span className="text-ink/70 dark:text-white/70">{d.name}</span>
            <span className="ml-auto font-semibold tabular-nums text-ink dark:text-white">
              {total > 0 ? `${((d.value / total) * 100).toFixed(1)}%` : '—'}
            </span>
            <span className="w-16 text-right tabular-nums text-ink/50 dark:text-white/50">
              {valueFormatter(d.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
