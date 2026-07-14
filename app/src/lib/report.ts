// Report assembly (Phase 8 Task 6). PURE — no I/O and no Date.now():
// `generatedAt` is injected by the caller (the /reports page passes a client
// timestamp) so the same input always yields the same Markdown.
// ReportData is produced by /api/reports; buildReportMarkdown runs client-side
// with the page's t() so the document follows the UI language (ko/en).
import { formatBytes, formatCount, formatMicros } from './format';
import { formatUsd } from '@/app/insights/tabs/shared';
import type { DestCategory } from './types';

export interface ReportKpis {
  /** Avg bytes per bucket (§15.4 DataTransferred). */
  dataTransferred: number | null;
  retransmissions: number | null;
  timeouts: number | null;
  /** RTT µs: window min + pooled percentiles. */
  rtt: number | null;
  rttP50: number | null;
  rttP95: number | null;
  /** Network Health Indicator, 0 = healthy. */
  nhi: number | null;
}

export interface ReportTalker {
  label: string;
  bytes: number;
  usd: number;
}

export interface ReportAnomaly {
  label: string;
  kind: string;
  severity: string;
  detail: string;
}

export interface ReportCostCategory {
  category: DestCategory;
  bytes: number;
  usd: number;
}

export interface ReportCost {
  totalUsd: number;
  /** totalUsd scaled to 30 days: totalUsd × (MONTH_SECONDS / windowSeconds). */
  monthlyRunRate: number;
  windowSeconds: number;
  /** = AZ_TRANSFER_USD_PER_GB (per direction). */
  ratePerGbPerDirection: number;
  billedCategories: DestCategory[];
  /** Billed categories with traffic in the window, desc by usd. */
  byCategory: ReportCostCategory[];
}

export interface ReportData {
  kpis: ReportKpis;
  topTalkers: ReportTalker[];
  /** Reliability lens threshold breaches in the window. */
  breachCount: number;
  anomalies: ReportAnomaly[];
  cost: ReportCost;
}

/** Same shape as useLanguage().t — injectable so the pure fn stays testable. */
export type ReportTranslate = (key: string, params?: Record<string, string | number>) => string;

const DASH = '—';

function fmt(v: number | null, f: (n: number) => string): string {
  return v == null ? DASH : f(v);
}

/** Markdown network-status report: title/timestamp, KPIs, top talkers, anomalies, cost. */
export function buildReportMarkdown(data: ReportData, generatedAt: string, t: ReportTranslate): string {
  const { kpis, topTalkers, anomalies } = data;
  const lines: string[] = [
    `# ${t('report.title')}`,
    '',
    `${t('report.generatedAt')}: ${generatedAt}`,
    '',
    `## ${t('report.kpis')}`,
    '',
    `- ${t('report.kpi.dataTransferred')}: ${fmt(kpis.dataTransferred, formatBytes)}`,
    `- ${t('report.kpi.retransmissions')}: ${fmt(kpis.retransmissions, formatCount)}`,
    `- ${t('report.kpi.timeouts')}: ${fmt(kpis.timeouts, formatCount)}`,
    `- ${t('report.kpi.rtt')}: ${fmt(kpis.rtt, formatMicros)} (p50 ${fmt(kpis.rttP50, formatMicros)} · p95 ${fmt(kpis.rttP95, formatMicros)})`,
    `- ${t('report.kpi.nhi')}: ${kpis.nhi == null ? DASH : formatCount(kpis.nhi)}`,
    '',
    `## ${t('report.topTalkers')}`,
    '',
  ];
  if (topTalkers.length === 0) lines.push(t('report.none'));
  else topTalkers.forEach((tk, i) => lines.push(`${i + 1}. ${tk.label} — ${formatBytes(tk.bytes)} (${formatUsd(tk.usd)})`));
  lines.push(
    '',
    `## ${t('report.anomalies')}`,
    '',
    `${t('report.breaches')}: ${formatCount(data.breachCount)} · ${t('report.anomaliesCount', { count: anomalies.length })}`,
  );
  if (anomalies.length === 0) {
    lines.push('', t('report.none'));
  } else {
    lines.push('');
    for (const a of anomalies) lines.push(`- [${a.severity}] ${a.label} — ${a.detail}`);
  }
  const { cost } = data;
  lines.push(
    '',
    `## ${t('report.cost')}`,
    '',
    `_${t('report.basis.title')}_`,
    `- ${t('report.basis.rate', { rate: cost.ratePerGbPerDirection })}`,
    `- ${t('report.basis.billed')}`,
    `- ${t('report.basis.estimate')}`,
    `- ${t('report.basis.runRate')}: ${formatUsd(cost.monthlyRunRate)}`,
    '',
  );
  if (cost.byCategory.length > 0) {
    for (const c of cost.byCategory) {
      lines.push(`- ${c.category}: ${formatBytes(c.bytes)} (${formatUsd(c.usd)})`);
    }
    lines.push('');
  }
  lines.push(`${t('report.costTotal')}: ${formatUsd(cost.totalUsd)}`, '');
  return lines.join('\n');
}
