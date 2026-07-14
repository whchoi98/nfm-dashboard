'use client';

import { useLanguage } from '@/lib/i18n/LanguageContext';
import { STATUS } from '@/lib/chart-tokens';
import { formatBytes, formatCount, formatMicros } from '@/lib/format';
import { formatUsd } from '@/app/insights/tabs/shared';
import type { ReportData } from '@/lib/report';

const DASH = '—';
const fmt = (v: number | null, f: (n: number) => string) => (v == null ? DASH : f(v));

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/5 bg-surface p-3 dark:border-white/10 dark:bg-white/5">
      <div className="text-[11px] font-medium text-ink/50 dark:text-white/50">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default function ReportDocument({
  data,
  generatedAt,
}: {
  data: ReportData;
  generatedAt: string;
}) {
  const { t } = useLanguage();
  const { kpis, cost, topTalkers, anomalies } = data;
  const maxBytes = Math.max(1, ...topTalkers.map((tk) => tk.bytes));

  return (
    <div data-testid="report-doc" className="report-print-root flex flex-col gap-6">
      {/* Cover header */}
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-black/10 pb-4 dark:border-white/15">
        <h2 className="font-serif text-2xl font-semibold tracking-tight">{t('report.title')}</h2>
        <p className="font-mono text-xs text-ink/50 dark:text-white/50">
          {generatedAt} · {t('report.cost.window')} {Math.round(cost.windowSeconds / 60)}m
        </p>
      </header>

      {/* Cost estimate basis */}
      <section
        data-testid="report-cost-basis"
        className="rounded-xl border border-chartViolet/20 bg-chartViolet/[.04] p-4 text-xs leading-relaxed dark:border-chartViolet/30"
      >
        <div className="mb-2 font-semibold text-ink/80 dark:text-white/80">{t('report.basis.title')}</div>
        <ul className="flex flex-col gap-1 text-ink/60 dark:text-white/60">
          <li>{t('report.basis.rate', { rate: cost.ratePerGbPerDirection })}</li>
          <li>{t('report.basis.billed')}</li>
          <li>{t('report.basis.estimate')}</li>
          <li className="font-medium text-ink/80 dark:text-white/80">
            {t('report.basis.runRate')}: {formatUsd(cost.monthlyRunRate)}
          </li>
        </ul>
      </section>

      {/* KPI tiles */}
      <section data-testid="report-kpis" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label={t('report.kpi.dataTransferred')} value={fmt(kpis.dataTransferred, formatBytes)} />
        <Tile label={t('report.kpi.retransmissions')} value={fmt(kpis.retransmissions, formatCount)} />
        <Tile label={t('report.kpi.timeouts')} value={fmt(kpis.timeouts, formatCount)} />
        <Tile label={t('report.kpi.rtt')} value={`${fmt(kpis.rtt, formatMicros)} · p95 ${fmt(kpis.rttP95, formatMicros)}`} />
        <Tile label={t('report.kpi.nhi')} value={kpis.nhi == null ? DASH : formatCount(kpis.nhi)} />
      </section>

      {/* Cost detail */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t('report.cost')}</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-ink/50 dark:text-white/50">
              <th className="py-1 font-medium">{t('report.cost.colCategory')}</th>
              <th className="py-1 text-right font-medium">{t('report.cost.colBytes')}</th>
              <th className="py-1 text-right font-medium">{t('report.cost.colUsd')}</th>
            </tr>
          </thead>
          <tbody>
            {cost.byCategory.map((c) => (
              <tr
                key={c.category}
                data-testid={`report-cost-row-${c.category}`}
                className={`border-t border-black/5 dark:border-white/10 ${c.category === 'INTER_AZ' ? 'font-semibold' : ''}`}
              >
                <td className="py-1">{c.category}</td>
                <td className="py-1 text-right tabular-nums">{formatBytes(c.bytes)}</td>
                <td className="py-1 text-right tabular-nums">{formatUsd(c.usd)}</td>
              </tr>
            ))}
            <tr className="border-t border-black/20 font-semibold dark:border-white/25">
              <td className="py-1">{t('report.costTotal')}</td>
              <td className="py-1"></td>
              <td className="py-1 text-right tabular-nums">{formatUsd(cost.totalUsd)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Top talkers */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t('report.topTalkers')}</h3>
        {topTalkers.length === 0 ? (
          <p className="text-xs text-ink/50 dark:text-white/50">{t('report.none')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {topTalkers.map((tk, i) => (
              <li key={tk.label} className="flex items-center gap-3 text-xs">
                <span className="w-56 shrink-0 truncate" title={tk.label}>{tk.label}</span>
                <span className="relative h-3 flex-1 overflow-hidden rounded bg-black/5 dark:bg-white/10">
                  <span
                    data-testid={`report-talker-bar-${i}`}
                    className="absolute inset-y-0 left-0 rounded"
                    style={{ width: `${(tk.bytes / maxBytes) * 100}%`, backgroundColor: STATUS.ok }}
                  />
                </span>
                <span className="w-32 shrink-0 text-right tabular-nums">
                  {formatBytes(tk.bytes)} · {formatUsd(tk.usd)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Anomalies */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">
          {t('report.anomalies')} · {t('report.breaches')}: {formatCount(data.breachCount)} · {t('report.anomaliesCount', { count: anomalies.length })}
        </h3>
        {anomalies.length === 0 ? (
          <p data-testid="report-anomalies-empty" className="text-xs text-ink/50 dark:text-white/50">{t('report.none')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {anomalies.map((a) => (
              <li key={`${a.kind}:${a.label}`} className="flex items-baseline gap-2 text-xs">
                <span
                  className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink"
                  style={{ backgroundColor: a.severity === 'critical' ? STATUS.danger : STATUS.warn }}
                >
                  {a.severity}
                </span>
                <span className="font-medium">{a.label}</span>
                <span className="text-ink/60 dark:text-white/60">
                  — <span>{a.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
