// app/src/lib/analytics/reliability.test.ts
import { it, expect } from 'vitest';
import { ratePer, thresholdBreaches, reliabilityLens, correlation } from './reliability';
import type { FlowEdge } from '../types';

const flows = [
  { edgeHash:'e1', metric:'DATA_TRANSFERRED', value:1e9, a:{podNamespace:'shop',serviceName:'api'}, b:{podNamespace:'shop',serviceName:'db'} },
  { edgeHash:'e1', metric:'RETRANSMISSIONS', value:30, a:{podNamespace:'shop',serviceName:'api'}, b:{podNamespace:'shop',serviceName:'db'} },
  { edgeHash:'e1', metric:'TIMEOUTS', value:2, a:{podNamespace:'shop',serviceName:'api'}, b:{podNamespace:'shop',serviceName:'db'} },
  { edgeHash:'e1', metric:'ROUND_TRIP_TIME', value:900, a:{podNamespace:'shop',serviceName:'api'}, b:{podNamespace:'shop',serviceName:'db'} },
] as any as FlowEdge[];

it('ratePer normalizes per GB', () => {
  const rows = ratePer(flows,'service');
  const api = rows.find(r => r.key==='shop/api')!;
  expect(api.retransRate).toBeCloseTo(30);   // 30 / (1e9/1e9)
  expect(api.timeoutRate).toBeCloseTo(2);
});
it('thresholdBreaches flags high retrans', () => {
  expect(thresholdBreaches(ratePer(flows,'service'),{retransRate:10,timeoutRate:5}).length).toBeGreaterThan(0);
});
it('reliabilityLens scatter joins rtt+retrans', () => {
  const rl = reliabilityLens(flows);
  expect(rl.scatter.find(s => s.rtt===900 && s.retransmissions===30)).toBeTruthy();
});

const pt = (rtt: number, retransmissions: number) => ({ key: `${rtt}`, label: 'x', rtt, retransmissions, bytes: 1 });
it('correlation: perfect positive → ~1, perfect negative → ~-1, <2 points → null', () => {
  expect(correlation([pt(1,1), pt(2,2), pt(3,3)]).r).toBeCloseTo(1, 6);
  expect(correlation([pt(1,3), pt(2,2), pt(3,1)]).r).toBeCloseTo(-1, 6);
  expect(correlation([pt(1,1)]).r).toBeNull();
  expect(correlation([]).n).toBe(0);
});
it('correlation: zero variance → null (no NaN)', () => {
  expect(correlation([pt(5,1), pt(5,2)]).r).toBeNull(); // rtt constant
});
it('reliabilityLens exposes correlation computed from its scatter points', () => {
  const rl = reliabilityLens(flows);
  expect(rl.correlation).toEqual(correlation(rl.scatter));
  expect(rl.correlation.n).toBe(rl.scatter.length);
});
