'use client';

// /reports — exportable summary of the current network state. /api/reports
// supplies ReportData; the Markdown is built CLIENT-side (buildReportMarkdown
// with a client timestamp + the active language's t()) so the preview and the
// downloaded .md match what the user sees. Downloads are Blob-based
// (downloadText); Print uses the browser dialog on the current page.
import { useMemo } from 'react';
import { Download, Printer } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import { buildReportMarkdown, type ReportData } from '@/lib/report';
import { downloadText, toCsv } from '@/lib/csv';
import Markdown from '@/components/Markdown';
import Widget from '@/components/analytics/Widget';
import { LensState } from '@/app/insights/tabs/shared';

const btnCls =
  'inline-flex items-center gap-1 rounded-md bg-ink/[.06] px-2 py-1 text-[11px] font-medium text-ink/60 transition-colors hover:bg-ink/10 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/20 dark:hover:text-white';

/** nfm-report-2026-07-11.md style filename stamp (client clock). */
const dateStamp = () => new Date().toISOString().slice(0, 10);

export default function ReportsPage() {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<ReportData>('/api/reports');
  const firstLoad = loading && !data;

  // Recomputed when the data refreshes (or the language flips) — the pure fn
  // itself never reads the clock, the timestamp is injected here.
  const markdown = useMemo(
    () => (data ? buildReportMarkdown(data, new Date().toISOString(), t) : ''),
    [data, t],
  );

  const downloadMd = () => downloadText(`nfm-report-${dateStamp()}.md`, markdown, 'text/markdown');
  const downloadCsv = () => {
    if (!data) return;
    const rows = data.topTalkers.map(({ label, bytes, usd }) => ({ label, bytes, usd }));
    downloadText(`nfm-top-talkers-${dateStamp()}.csv`, toCsv(rows, [
      { key: 'label', header: 'label' },
      { key: 'bytes', header: 'bytes' },
      { key: 'usd', header: 'usd' },
    ]));
  };

  return (
    <div data-testid="reports-page" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('reports.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={downloadMd} disabled={!data} className={btnCls}>
            <Download size={12} strokeWidth={1.5} aria-hidden />
            {t('reports.downloadMd')}
          </button>
          <button type="button" onClick={downloadCsv} disabled={!data} className={btnCls}>
            <Download size={12} strokeWidth={1.5} aria-hidden />
            {t('reports.downloadCsv')}
          </button>
          <button type="button" onClick={() => window.print()} className={btnCls}>
            <Printer size={12} strokeWidth={1.5} aria-hidden />
            {t('reports.print')}
          </button>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-ink/50 dark:text-white/50">
        {t('reports.hint')}
      </p>

      <Widget title={t('reports.preview')} testId="report-preview">
        <LensState loading={firstLoad} error={error} empty={!markdown}>
          <Markdown>{markdown}</Markdown>
        </LensState>
      </Widget>
    </div>
  );
}
