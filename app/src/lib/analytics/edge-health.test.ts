// Task 8 — edge-health adjacency matrix. Pure builder tests (no I/O).
import { it, expect } from 'vitest';
import type { FlowEdge } from '../types';
import { buildHealthMatrix } from './edge-health';
import { RETRANS_RATE_DANGER } from './aggregate';

const f = (src: string, dst: string, metric: any, value: number): FlowEdge => ({ edgeHash: `${src}-${dst}`,
  monitor: 'm', metric, category: 'INTER_AZ', bucket: 'b', value, unit: 'x',
  a: { serviceName: src }, b: { serviceName: dst }, traversedConstructs: [] });

it('buildHealthMatrix: worst-of retrans/timeout status per source→dest', () => {
  const flows = [
    f('a', 'b', 'DATA_TRANSFERRED', 1e9), f('a', 'b', 'RETRANSMISSIONS', 100), // 100/GB → danger
    f('c', 'd', 'DATA_TRANSFERRED', 1e9), f('c', 'd', 'RETRANSMISSIONS', 0),   // 0 → ok
  ];
  const m = buildHealthMatrix(flows, 'service', { retransWarn: 10, retransDanger: 50, timeoutWarn: 10, timeoutDanger: 50 });
  expect(m.cells.find((c) => c.row === 'a' && c.col === 'b')!.status).toBe('danger');
  expect(m.cells.find((c) => c.row === 'c' && c.col === 'd')!.status).toBe('ok');
  expect(m.rows).toContain('a'); expect(m.cols).toContain('b');
});
it('buildHealthMatrix empty → empty matrix', () => {
  expect(buildHealthMatrix([], 'service')).toEqual({ rows: [], cols: [], cells: [] });
});

// Default thresholds (no opts) come from the shared aggregate.ts rate consts —
// NOT the overview-metrics.ts count thresholds. 12/GB retrans clears
// RETRANS_RATE_DANGER (10) → danger; 0/GB never breaches → ok.
it('buildHealthMatrix: default thresholds map a 12/GB retrans edge to danger, 0/GB to ok', () => {
  const flows = [
    f('a', 'b', 'DATA_TRANSFERRED', 1e9), f('a', 'b', 'RETRANSMISSIONS', 12),
    f('c', 'd', 'DATA_TRANSFERRED', 1e9), f('c', 'd', 'RETRANSMISSIONS', 0),
  ];
  const m = buildHealthMatrix(flows, 'service'); // no opts → RETRANS_RATE_WARN/DANGER defaults
  const ab = m.cells.find((c) => c.row === 'a' && c.col === 'b')!;
  const cd = m.cells.find((c) => c.row === 'c' && c.col === 'd')!;
  expect(ab.retransRate).toBeGreaterThanOrEqual(RETRANS_RATE_DANGER);
  expect(ab.status).toBe('danger');
  expect(cd.status).toBe('ok');
});

// Flows missing the level's endpoint key on either side are skipped (not
// bucketed under an 'unknown' row/col like entityKey's default fallback).
it('buildHealthMatrix: skips flows missing either side\'s key for the level', () => {
  const flows: FlowEdge[] = [
    { ...f('a', 'b', 'DATA_TRANSFERRED', 1e6), a: { serviceName: 'a' }, b: {} },
    f('a', 'b', 'DATA_TRANSFERRED', 2e6),
  ];
  const m = buildHealthMatrix(flows, 'service');
  expect(m.cells.find((c) => c.row === 'a' && c.col === 'b')!.bytes).toBe(2e6);
});
