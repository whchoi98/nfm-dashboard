import { describe, it, expect } from 'vitest';
import { buildReportMarkdown, type ReportData, type ReportTranslate } from './report';

// Deterministic t() stub: key alone, or key(v1,v2,…) when params are given —
// lets assertions target translation KEYS instead of a locale.
const t: ReportTranslate = (k, p) => (p ? `${k}(${Object.values(p).join(',')})` : k);

const GENERATED_AT = '2026-07-11T00:00:00.000Z';

const full: ReportData = {
  kpis: {
    dataTransferred: 1_500_000_000, // 1.5 GB
    retransmissions: 12,
    timeouts: 3,
    rtt: 900, // µs
    rttP50: 1500, // 1.5 ms
    rttP95: 3_000_000, // 3 s
    nhi: 0,
  },
  topTalkers: [
    { label: 'default/api ↔ default/web', bytes: 2_000_000_000, usd: 0.04 },
    { label: 'kube-system/dns', bytes: 500_000, usd: 0 },
  ],
  breachCount: 2,
  anomalies: [
    { label: 'default/api', kind: 'retrans', severity: 'critical', detail: 'retrans 25.0/GB > 10/GB' },
  ],
  cost: {
    totalUsd: 0.005,
    monthlyRunRate: 3.6, // 0.005 × (2_592_000 / 3600) = 0.005 × 720
    windowSeconds: 3600,
    ratePerGbPerDirection: 0.01,
    billedCategories: ['INTER_AZ', 'INTER_VPC', 'INTER_REGION'],
    byCategory: [
      { category: 'INTER_AZ', bytes: 2_000_000_000, usd: 0.02 },
      { category: 'INTER_VPC', bytes: 500_000_000, usd: 0.005 },
    ],
  },
};

const empty: ReportData = {
  kpis: {
    dataTransferred: null, retransmissions: null, timeouts: null,
    rtt: null, rttP50: null, rttP95: null, nhi: null,
  },
  topTalkers: [],
  breachCount: 0,
  anomalies: [],
  cost: {
    totalUsd: 0,
    monthlyRunRate: 0,
    windowSeconds: 3600,
    ratePerGbPerDirection: 0.01,
    billedCategories: ['INTER_AZ', 'INTER_VPC', 'INTER_REGION'],
    byCategory: [],
  },
};

describe('buildReportMarkdown', () => {
  it('contains title, generatedAt and every section heading', () => {
    const md = buildReportMarkdown(full, GENERATED_AT, t);
    expect(md).toContain('# report.title');
    expect(md).toContain(GENERATED_AT);
    for (const section of ['report.kpis', 'report.topTalkers', 'report.anomalies', 'report.cost']) {
      expect(md).toContain(`## ${section}`);
    }
  });

  it('formats KPI and cost values with the shared formatters', () => {
    const md = buildReportMarkdown(full, GENERATED_AT, t);
    expect(md).toContain('1.5 GB'); // dataTransferred
    expect(md).toContain('900 µs'); // rtt min
    expect(md).toContain('1.5 ms'); // rtt p50
    expect(md).toContain('3 s'); // rtt p95
    expect(md).toContain('$0.0050'); // tiny non-zero totalUsd keeps 4 decimals
    expect(md).toContain('$0.04'); // talker usd
  });

  it('lists top talkers and anomalies with counts', () => {
    const md = buildReportMarkdown(full, GENERATED_AT, t);
    expect(md).toContain('1. default/api ↔ default/web');
    expect(md).toContain('2. kube-system/dns');
    expect(md).toContain('report.anomaliesCount(1)');
    expect(md).toContain('[critical] default/api — retrans 25.0/GB > 10/GB');
    expect(md).toContain('report.breaches: 2');
  });

  it('handles empty data: placeholder dashes and "none" markers, no crash', () => {
    const md = buildReportMarkdown(empty, GENERATED_AT, t);
    expect(md).toContain('—'); // null KPIs
    expect(md).toContain('report.none');
    expect(md).toContain('report.anomaliesCount(0)');
    expect(md).toContain('$0.00');
  });

  it('is deterministic: same input → identical output (no internal Date.now)', () => {
    const a = buildReportMarkdown(full, GENERATED_AT, t);
    const b = buildReportMarkdown(full, GENERATED_AT, t);
    expect(a).toBe(b);
    // the only timestamp in the document is the injected one
    expect(a.match(/\d{4}-\d{2}-\d{2}T/g)).toEqual([GENERATED_AT.slice(0, 11)]);
  });

  it('emits the cost-estimation basis and per-category breakdown', () => {
    const md = buildReportMarkdown(full, GENERATED_AT, t);
    expect(md).toContain('report.basis.title');
    expect(md).toContain('report.basis.rate(0.01)'); // rate param threaded through t()
    expect(md).toContain('report.basis.runRate: $3.60'); // monthly run-rate
    expect(md).toContain('INTER_AZ'); // per-category line present
    expect(md).toContain('2 GB'); // INTER_AZ bytes formatted
    expect(md).toContain('$0.02'); // INTER_AZ usd
  });
});
