import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ReportDocument from './ReportDocument';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { ReportData } from '@/lib/report';

// No vitest globals in this repo, so testing-library's auto-cleanup does not
// run between tests — clean up explicitly (matches AnomalyDetailPanel tests).
afterEach(cleanup);

const data: ReportData = {
  kpis: { dataTransferred: 1_500_000_000, retransmissions: 12, timeouts: 3, rtt: 900, rttP50: 1500, rttP95: 3_000_000, nhi: 0 },
  topTalkers: [
    { label: 'default/api ↔ default/web', bytes: 2_000_000_000, usd: 0.04 },
    { label: 'kube-system/dns', bytes: 500_000, usd: 0 },
  ],
  breachCount: 2,
  anomalies: [{ label: 'default/api', kind: 'retrans', severity: 'critical', detail: 'retrans 25.0/GB > 10/GB' }],
  cost: {
    totalUsd: 0.025, monthlyRunRate: 18, windowSeconds: 3600, ratePerGbPerDirection: 0.01,
    billedCategories: ['INTER_AZ', 'INTER_VPC', 'INTER_REGION'],
    byCategory: [{ category: 'INTER_AZ', bytes: 2_000_000_000, usd: 0.02 }],
  },
};

const renderDoc = (d: ReportData = data) =>
  render(<LanguageProvider><ReportDocument data={d} generatedAt="2026-07-14T00:00:00.000Z" /></LanguageProvider>);

describe('ReportDocument', () => {
  it('renders the cost-estimation basis block with the rate and billed categories', () => {
    renderDoc();
    expect(screen.getByTestId('report-cost-basis')).toBeTruthy();
    // ko default: rate string includes 0.01; INTER_AZ appears in the billed list
    expect(screen.getByText(/0\.01/)).toBeTruthy();
    expect(screen.getByTestId('report-doc')).toBeTruthy();
  });

  it('renders KPI tiles and the INTER_AZ cost-detail row', () => {
    renderDoc();
    expect(screen.getByTestId('report-kpis')).toBeTruthy();
    expect(screen.getByText('1.5 GB')).toBeTruthy(); // dataTransferred tile
    const azRow = screen.getByTestId('report-cost-row-INTER_AZ');
    expect(azRow.textContent).toContain('2 GB');
    expect(azRow.textContent).toContain('$0.02');
  });

  it('renders top-talker bars and the anomaly row', () => {
    renderDoc();
    expect(screen.getByText('default/api ↔ default/web')).toBeTruthy();
    expect(screen.getByTestId('report-talker-bar-0')).toBeTruthy(); // widest bar
    expect(screen.getByText('retrans 25.0/GB > 10/GB')).toBeTruthy();
  });

  it('shows the empty-state when there are no anomalies', () => {
    renderDoc({ ...data, anomalies: [] });
    expect(screen.getByTestId('report-anomalies-empty')).toBeTruthy();
  });
});
