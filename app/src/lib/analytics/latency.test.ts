// app/src/lib/analytics/latency.test.ts
import { it, expect } from 'vitest';
import { percentilesOf, latencyLens } from './latency';
import type { FlowEdge } from '../types';

it('percentilesOf', () => {
  const s = percentilesOf([100,200,300,400]);
  expect(s.min).toBe(100); expect(s.max).toBe(400); expect(s.count).toBe(4); expect(s.p50).toBe(200);
  expect(percentilesOf([]).count).toBe(0);
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
