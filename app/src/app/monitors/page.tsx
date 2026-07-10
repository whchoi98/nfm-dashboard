'use client';

// /monitors — one card per NFM monitor: name + latest NHI StatusBadge +
// window traffic total + a DataTransferred sparkline. Each card links to the
// per-monitor overview/historical page (/monitors/[name]).
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { MonitorListItem } from '@/lib/monitors';
import { formatBytes } from '@/lib/format';
import { SERIES_COLORS } from '@/lib/chart-tokens';
import StatusBadge from '@/components/cards/StatusBadge';
import { Line, LineChart, ResponsiveContainer } from 'recharts';

/** Tiny inline sparkline (StatDelta's mini-chart, without the tile chrome). */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const rows = values.map((v, i) => ({ i, v }));
  return (
    <div className="h-10 w-24 shrink-0" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={SERIES_COLORS[0]}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function MonitorsPage() {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<{ monitors: MonitorListItem[] }>('/api/monitors');
  const monitors = data?.monitors ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t('monitors.title')}</h1>

      {error ? (
        <p className="text-sm text-ink/60 dark:text-white/60">{t('common.error')}</p>
      ) : loading && !data ? (
        <p className="text-sm text-ink/40 dark:text-white/40">{t('common.loading')}</p>
      ) : monitors.length === 0 ? (
        <p className="text-sm text-ink/40 dark:text-white/40">{t('monitors.noMonitors')}</p>
      ) : (
        <div
          data-testid="monitors-list"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {monitors.map((m) => (
            <Link
              key={m.name}
              href={`/monitors/${encodeURIComponent(m.name)}`}
              data-testid="monitor-card"
              className="rounded-card bg-surface p-5 text-ink transition-colors hover:bg-black/5 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-semibold" title={m.name}>
                  {m.name}
                </p>
                <StatusBadge value={m.nhi} />
              </div>
              {m.cluster ? (
                <p className="mt-1 truncate text-[11px] text-ink/50 dark:text-white/50">
                  {m.cluster}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] text-ink/50 dark:text-white/50">
                    {t('monitors.trafficWindow')}
                  </p>
                  <p className="text-xl font-semibold tabular-nums">
                    {formatBytes(m.dataTransferred)}
                  </p>
                </div>
                <Spark values={m.spark} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
