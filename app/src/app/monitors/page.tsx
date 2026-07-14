'use client';

// /monitors — one card per NFM monitor: name + latest NHI StatusBadge +
// retrans/timeout health chips + window traffic total + a DataTransferred
// sparkline. Each card links to the per-monitor page (/monitors/[name]).
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { MonitorListItem } from '@/lib/monitors';
import {
  ratePerGb,
  RETRANS_RATE_DANGER,
  RETRANS_RATE_WARN,
  TIMEOUT_RATE_DANGER,
  TIMEOUT_RATE_WARN,
} from '@/lib/analytics/aggregate';
import { formatBytes } from '@/lib/format';
import { SERIES_COLORS, STATUS } from '@/lib/chart-tokens';
import StatusBadge from '@/components/cards/StatusBadge';
import PageIntro from '@/components/PageIntro';
import { Line, LineChart, ResponsiveContainer } from 'recharts';

/** overview's statusFor, on per-GB rates: ok < warnAt <= warn < dangerAt <= danger. */
function statusFor(rate: number, warnAt: number, dangerAt: number): keyof typeof STATUS {
  return rate >= dangerAt ? 'danger' : rate >= warnAt ? 'warn' : 'ok';
}

/** Pastel status pill, dual-encoded (localized label text + STATUS color). */
function HealthChip({
  testId,
  label,
  status,
}: {
  testId: string;
  label: string;
  status: keyof typeof STATUS;
}) {
  return (
    <span
      data-testid={testId}
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums text-ink"
      style={{ backgroundColor: STATUS[status] }}
    >
      {label}
    </span>
  );
}

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
      <PageIntro page="monitors" />

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
          {monitors.map((m) => {
            const retransRate = ratePerGb(m.retransmissions, m.dataTransferred);
            const timeoutRate = ratePerGb(m.timeouts, m.dataTransferred);
            return (
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
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <HealthChip
                    testId="monitor-chip-retrans"
                    label={t('monitors.retransChip', { r: retransRate.toFixed(1) })}
                    status={statusFor(retransRate, RETRANS_RATE_WARN, RETRANS_RATE_DANGER)}
                  />
                  <HealthChip
                    testId="monitor-chip-timeouts"
                    label={t('monitors.timeoutChip', { r: timeoutRate.toFixed(1) })}
                    status={statusFor(timeoutRate, TIMEOUT_RATE_WARN, TIMEOUT_RATE_DANGER)}
                  />
                </div>
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
            );
          })}
        </div>
      )}
    </div>
  );
}
