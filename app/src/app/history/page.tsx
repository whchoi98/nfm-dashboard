'use client';

// /history — Athena-backed query over the S3/Parquet flow archive
// (nfm_dashboard.flows_archive). Unlike every other page (which reads the
// live 7-day DynamoDB hot path), this covers arbitrary date ranges — up to
// the archive's start (~2 years of retention). Athena queries are async and
// billed per byte scanned, so this is strictly on-demand: nothing fires until
// the user clicks "Run query" (no polling, no query-on-keystroke).
import { useEffect, useState } from 'react';
import { History as HistoryIcon, TriangleAlert } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Card, Select, TextInput } from '@/components/ui/Controls';
import Widget from '@/components/analytics/Widget';
import { STATUS } from '@/lib/chart-tokens';
import { formatBytes } from '@/lib/format';
import type { MetricName } from '@/lib/types';

// Local mirror of the /api/history success shape (app/src/lib/athena.ts
// HistoryQueryResult) — kept independent so this client page never imports
// the server-only athena.ts module (it pulls in @aws-sdk/client-athena).
interface HistoryResult {
  columns: string[];
  rows: string[][];
  scannedBytes: number;
  queryId: string;
}

const METRICS: MetricName[] = ['DATA_TRANSFERRED', 'RETRANSMISSIONS', 'TIMEOUTS', 'ROUND_TRIP_TIME'];

const dateFieldCls =
  'h-9 max-w-full rounded-lg border border-black/10 bg-white px-2.5 text-xs text-ink outline-none focus:border-chartViolet dark:border-white/15 dark:bg-ink dark:text-white';

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function HistoryPage() {
  const { t } = useLanguage();
  // Start empty so SSR and the first client render agree (isoDaysAgo() reads
  // Date.now(), which differs between the static prerender and the client and
  // would trip a hydration mismatch — React #418); populated on mount below.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [monitor, setMonitor] = useState('');
  const [namespace, setNamespace] = useState('');
  const [metric, setMetric] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HistoryResult | null>(null);
  const [queriedRange, setQueriedRange] = useState<{ from: string; to: string } | null>(null);

  useEffect(() => {
    // Client-only initial fill of the last-7d default (avoids SSR hydration mismatch).
    setFrom(isoDaysAgo(7));
    setTo(isoDaysAgo(0));
  }, []);

  const run = async () => {
    if (!from || !to || from > to) {
      setError(t('history.invalidRange'));
      setResult(null);
      setQueriedRange(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (monitor.trim()) params.set('monitor', monitor.trim());
      if (namespace.trim()) params.set('namespace', namespace.trim());
      if (metric) params.set('metric', metric);
      const res = await fetch(`/api/history?${params.toString()}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // A 400 means the archive route rejected our own input (bad date/filter) —
        // show its specific {error} message. Anything else (500, network-level
        // failure) is opaque server/infra trouble, so fall back to the generic
        // common.error copy rather than leaking internals.
        setError(res.status === 400 && typeof body?.error === 'string' ? body.error : t('common.error'));
        setResult(null);
        setQueriedRange(null);
        return;
      }
      setResult(body as HistoryResult);
      setQueriedRange({ from, to });
    } catch {
      setError(t('common.error'));
      setResult(null);
      setQueriedRange(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-testid="history-page" className="flex flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <HistoryIcon size={18} strokeWidth={1.75} className="text-ink/60 dark:text-white/60" aria-hidden />
          {t('history.title')}
        </h1>
        <p className="mt-1 max-w-2xl text-xs text-ink/50 dark:text-white/50">{t('history.hint')}</p>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex max-w-full flex-col gap-1 text-[11px] font-medium text-ink/60 dark:text-white/60">
            {t('history.from')}
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="history-from"
              className={dateFieldCls}
            />
          </label>
          <label className="flex max-w-full flex-col gap-1 text-[11px] font-medium text-ink/60 dark:text-white/60">
            {t('history.to')}
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="history-to"
              className={dateFieldCls}
            />
          </label>
          <TextInput label={t('history.monitor')} value={monitor} onChange={setMonitor} />
          <TextInput label={t('history.namespace')} value={namespace} onChange={setNamespace} />
          <Select
            label={t('history.metric')}
            value={metric}
            onChange={setMetric}
            allLabel={t('filter.all')}
            options={METRICS.map((m) => ({ value: m, label: t(`metric.${m}`) }))}
          />
          <button
            type="button"
            onClick={run}
            disabled={loading}
            data-testid="history-run"
            className="h-9 rounded-lg bg-ink px-4 text-xs font-medium text-white transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-ink dark:hover:bg-white/90"
          >
            {loading ? t('history.loading') : t('history.run')}
          </button>
        </div>
      </Card>

      <Widget title={t('history.results')} testId="history-results">
        {error ? (
          <p
            className="flex h-32 items-center justify-center gap-2 text-center text-sm"
            style={{ color: STATUS.danger }}
          >
            <TriangleAlert size={16} strokeWidth={1.75} aria-hidden />
            {error}
          </p>
        ) : loading ? (
          <div role="status" className="flex h-32 flex-col justify-center gap-2.5">
            <div className="ui-skeleton h-3 w-2/5" aria-hidden />
            <div className="ui-skeleton h-3 w-full" aria-hidden />
            <div className="ui-skeleton h-3 w-4/5" aria-hidden />
            <span className="sr-only">{t('history.loading')}</span>
          </div>
        ) : !queriedRange || !result ? (
          <p className="ui-empty flex h-32 items-center justify-center text-center text-sm text-ink/45 dark:text-white/45">
            {t('history.prompt')}
          </p>
        ) : result.rows.length === 0 ? (
          <p className="ui-empty flex h-32 items-center justify-center text-sm text-ink/45 dark:text-white/45">
            {t('history.empty')}
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-ink/50 dark:text-white/50">
              {t('history.rowsCount', { n: result.rows.length, bytes: formatBytes(result.scannedBytes) })}
              {' · '}
              {queriedRange.from} → {queriedRange.to}
            </p>
            <div className="overflow-x-auto">
              <table className="ui-table-dense w-full min-w-max border-collapse text-xs">
                <thead>
                  <tr className="text-left">
                    {result.columns.map((c) => (
                      <th
                        key={c}
                        className="whitespace-nowrap py-1.5 pr-3 text-[11px] font-semibold uppercase tracking-wide text-ink/50 dark:text-white/50"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j} className="whitespace-nowrap py-1.5 pr-3">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Widget>
    </div>
  );
}
