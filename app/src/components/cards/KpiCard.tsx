'use client';

import { TrendingDown, TrendingUp } from 'lucide-react';

export type KpiAccent = 'blue' | 'lav' | 'mint' | 'surface';

// SnowUI KPI card: pastel surface, small label, big number, optional delta badge.
// Pastel accents keep dark ink text in both themes (contrast-safe on light fills).
const ACCENTS: Record<KpiAccent, string> = {
  blue: 'bg-accentBlue text-ink',
  lav: 'bg-accentLav text-ink',
  mint: 'bg-accentMint text-ink',
  surface: 'bg-surface text-ink dark:bg-white/5 dark:text-white',
};

export default function KpiCard({
  label,
  value,
  unit,
  delta,
  trend,
  accent = 'surface',
  testId,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  trend?: 'up' | 'down';
  accent?: KpiAccent;
  testId?: string;
}) {
  const sub = accent === 'surface' ? 'text-ink/60 dark:text-white/60' : 'text-ink/60';
  return (
    <div data-testid={testId} className={`rounded-card p-5 ${ACCENTS[accent]}`}>
      <p className={`text-xs font-medium ${sub}`}>{label}</p>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-2xl font-semibold tracking-tight">
          {value}
          {unit ? <span className={`ml-1 text-sm font-medium ${sub}`}>{unit}</span> : null}
        </p>
        {delta ? (
          <span className="flex items-center gap-1 text-xs font-medium">
            {delta}
            {trend === 'down' ? (
              <TrendingDown size={14} strokeWidth={1.5} aria-hidden />
            ) : (
              <TrendingUp size={14} strokeWidth={1.5} aria-hidden />
            )}
          </span>
        ) : null}
      </div>
    </div>
  );
}
