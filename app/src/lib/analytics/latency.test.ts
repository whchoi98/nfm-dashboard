// app/src/lib/analytics/latency.test.ts
import { it, expect } from 'vitest';
import { percentilesOf, latencyLens, slowestByTail } from './latency';
import type { FlowEdge } from '../types';

it('percentilesOf', () => {
  const s = percentilesOf([100,200,300,400]);
  expect(s.min).toBe(100); expect(s.max).toBe(400); expect(s.count).toBe(4); expect(s.p50).toBe(200);
  expect(percentilesOf([]).count).toBe(0);
});
it('percentilesOf includes p99', () => {
  const s = percentilesOf([100, 200, 300, 400, 500]);
  expect(s.p99).toBe(500);            // nearest-rank top
  expect(percentilesOf([]).p99).toBe(0);
});
it('slowestByTail ranks by p95 and reports jitter', () => {
  const mk = (edge: string, label: string, vals: number[]): FlowEdge[] =>
    vals.map((v) => ({ edgeHash: edge, monitor: 'm', metric: 'ROUND_TRIP_TIME', category: 'INTRA_AZ',
      bucket: 'b', value: v, unit: 'ms', a: { serviceName: 'a' }, b: { serviceName: label },
      traversedConstructs: [] } as FlowEdge));
  const flows = [...mk('e1', 'slow', [10, 100]), ...mk('e2', 'steady', [50, 50])];
  const paths = slowestByTail(flows, 10);
  expect(paths[0].edgeHash).toBe('e1');            // higher p95 ranks first
  expect(paths[0].jitter).toBe(paths[0].p95 - paths[0].p50);
  expect(paths.find((p) => p.edgeHash === 'e2')!.jitter).toBe(0);
});
it('latencyLens splits intra/inter + trend', () => {
  const flows = [
    { metric:'ROUND_TRIP_TIME', category:'INTRA_AZ', bucket:'2026-07-08T11:45:00Z', value:100, edgeHash:'e1', a:{}, b:{} },
    { metric:'ROUND_TRIP_TIME', category:'INTER_AZ', bucket:'2026-07-08T11:45:00Z', value:900, edgeHash:'e2', a:{}, b:{} },
  ] as any;
  const l = latencyLens(flows);
  expect(l.intra.max).toBe(100); expect(l.inter.max).toBe(900);
  expect(l.overall.count).toBe(2); expect(l.trend.points.length).toBeGreaterThan(0);
});
