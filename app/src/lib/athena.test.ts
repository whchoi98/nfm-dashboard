import { describe, it, expect } from 'vitest';
import { buildHistorySql, HistoryValidationError } from './athena';

describe('buildHistorySql', () => {
  it('builds a partition-pruned query with the default db/table and LIMIT', () => {
    const sql = buildHistorySql({ from: '2026-07-01', to: '2026-07-08' });
    expect(sql).toContain("dt BETWEEN '2026-07-01' AND '2026-07-08'");
    expect(sql).toContain('nfm_dashboard.flows_archive');
    expect(sql).toContain('ORDER BY bucket DESC');
    expect(sql).toContain('LIMIT 1000');
  });

  it('adds a monitor equality filter', () => {
    const sql = buildHistorySql({ from: '2026-07-01', to: '2026-07-08', monitor: 'eks-cluster' });
    expect(sql).toContain("monitor = 'eks-cluster'");
  });

  it('adds a namespace OR filter across both endpoints', () => {
    const sql = buildHistorySql({ from: '2026-07-01', to: '2026-07-08', namespace: 'payments' });
    expect(sql).toContain("(a_pod_namespace = 'payments' OR b_pod_namespace = 'payments')");
  });

  it('adds a metric equality filter', () => {
    const sql = buildHistorySql({ from: '2026-07-01', to: '2026-07-08', metric: 'RETRANSMISSIONS' });
    expect(sql).toContain("metric = 'RETRANSMISSIONS'");
  });

  it('clamps limit above 5000 down to 5000', () => {
    const sql = buildHistorySql({ from: '2026-07-01', to: '2026-07-08', limit: 999999 });
    expect(sql).toContain('LIMIT 5000');
  });

  it('clamps limit below 1 up to 1', () => {
    const sql = buildHistorySql({ from: '2026-07-01', to: '2026-07-08', limit: -5 });
    expect(sql).toContain('LIMIT 1');
  });

  it('rejects a malformed from date (single-digit month/day)', () => {
    expect(() => buildHistorySql({ from: '2026-7-1', to: '2026-07-08' })).toThrow('invalid date');
    expect(() => buildHistorySql({ from: '2026-7-1', to: '2026-07-08' }))
      .toThrow(HistoryValidationError);
  });

  it('rejects a from date with an injection payload', () => {
    expect(() => buildHistorySql({ from: "2026-01-01'; DROP TABLE flows_archive; --", to: '2026-07-08' }))
      .toThrow('invalid date');
    expect(() => buildHistorySql({ from: "2026-01-01'; DROP TABLE flows_archive; --", to: '2026-07-08' }))
      .toThrow(HistoryValidationError);
  });

  it('rejects a malformed to date', () => {
    expect(() => buildHistorySql({ from: '2026-07-01', to: '2026/07/08' })).toThrow('invalid date');
    expect(() => buildHistorySql({ from: '2026-07-01', to: '2026/07/08' }))
      .toThrow(HistoryValidationError);
  });

  it('rejects a monitor filter containing a quote (injection guard)', () => {
    expect(() => buildHistorySql({ from: '2026-07-01', to: '2026-07-08', monitor: "x' OR '1'='1" }))
      .toThrow(HistoryValidationError);
  });

  it('rejects a namespace filter containing a semicolon', () => {
    expect(() => buildHistorySql({ from: '2026-07-01', to: '2026-07-08', namespace: 'ns; DROP TABLE x' }))
      .toThrow(HistoryValidationError);
  });

  it('rejects a metric filter containing whitespace (injection guard)', () => {
    expect(() => buildHistorySql({ from: '2026-07-01', to: '2026-07-08', metric: 'a b' }))
      .toThrow(HistoryValidationError);
  });

  it('allows the permitted charset [A-Za-z0-9._/-] in filters', () => {
    const sql = buildHistorySql({
      from: '2026-07-01', to: '2026-07-08',
      monitor: 'eks-cluster.prod', namespace: 'ns-1/sub_2.3',
    });
    expect(sql).toContain("monitor = 'eks-cluster.prod'");
    expect(sql).toContain("a_pod_namespace = 'ns-1/sub_2.3'");
  });
});
