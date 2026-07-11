import { describe, it, expect } from 'vitest';
import { moversLens } from './movers';
import type { FlowEdge } from '../types';

function flow(over: Partial<FlowEdge>): FlowEdge {
  return {
    edgeHash: 'h', monitor: 'm', metric: 'DATA_TRANSFERRED', category: 'INTRA_AZ',
    bucket: 'b1', value: 0, unit: 'Bytes', a: {}, b: {}, traversedConstructs: [],
    ...over,
  } as FlowEdge;
}

const svc = (name: string) => ({ podNamespace: 'ns', serviceName: name });

describe('moversLens', () => {
  it('sums per service entity (both endpoints) for current vs prior and computes deltaPct', () => {
    const current = [
      flow({ value: 150, a: svc('api'), b: svc('db') }),
    ];
    const prior = [
      flow({ value: 100, a: svc('api'), b: svc('db') }),
    ];
    const r = moversLens(current, prior);
    const api = r.dataTransferred.find((m) => m.key === 'ns/api');
    const db = r.dataTransferred.find((m) => m.key === 'ns/db');
    // The flow is attributed to BOTH endpoint entities.
    expect(api).toMatchObject({
      label: 'ns/api', metric: 'DATA_TRANSFERRED',
      current: 150, prior: 100, direction: 'up',
    });
    expect(api?.deltaPct).toBeCloseTo(50);
    expect(db?.current).toBe(150);
    expect(db?.prior).toBe(100);
  });

  it('counts a same-entity flow once, not twice', () => {
    const current = [flow({ value: 100, a: svc('self'), b: svc('self') })];
    const r = moversLens(current, []);
    expect(r.dataTransferred.find((m) => m.key === 'ns/self')?.current).toBe(100);
  });

  it('splits per metric and ignores ROUND_TRIP_TIME flows', () => {
    const current = [
      flow({ metric: 'DATA_TRANSFERRED', value: 10, a: svc('a'), b: svc('b') }),
      flow({ metric: 'RETRANSMISSIONS', value: 5, a: svc('a'), b: svc('b') }),
      flow({ metric: 'TIMEOUTS', value: 3, a: svc('a'), b: svc('b') }),
      flow({ metric: 'ROUND_TRIP_TIME', value: 99, a: svc('a'), b: svc('b') }),
    ];
    const r = moversLens(current, []);
    expect(r.dataTransferred.map((m) => m.current)).toEqual([10, 10]);
    expect(r.retransmissions.map((m) => m.current)).toEqual([5, 5]);
    expect(r.timeouts.map((m) => m.current)).toEqual([3, 3]);
    expect(r.retransmissions.every((m) => m.metric === 'RETRANSMISSIONS')).toBe(true);
  });

  it('prior 0 and current > 0 → deltaPct null ("new") with direction up', () => {
    const r = moversLens([flow({ value: 42, a: svc('fresh'), b: svc('fresh') })], []);
    const m = r.dataTransferred.find((x) => x.key === 'ns/fresh');
    expect(m).toMatchObject({ current: 42, prior: 0, deltaPct: null, direction: 'up' });
  });

  it('entities at 0 in both windows are excluded', () => {
    const current = [flow({ value: 0, a: svc('zero'), b: svc('zero') })];
    const prior = [flow({ value: 0, a: svc('zero'), b: svc('zero') })];
    const r = moversLens(current, prior);
    expect(r.dataTransferred).toEqual([]);
  });

  it('prior > 0 and current 0 → deltaPct -100 with direction down', () => {
    const r = moversLens([], [flow({ value: 80, a: svc('gone'), b: svc('gone') })]);
    const m = r.dataTransferred.find((x) => x.key === 'ns/gone');
    expect(m).toMatchObject({ current: 0, prior: 80, direction: 'down' });
    expect(m?.deltaPct).toBeCloseTo(-100);
  });

  it('equal non-zero sums → deltaPct 0 with direction flat', () => {
    const current = [flow({ value: 50, a: svc('same'), b: svc('same') })];
    const prior = [flow({ value: 50, a: svc('same'), b: svc('same') })];
    const m = moversLens(current, prior).dataTransferred.find((x) => x.key === 'ns/same');
    expect(m).toMatchObject({ deltaPct: 0, direction: 'flat' });
  });

  it('ranks by ABSOLUTE change desc — a big decrease outranks a small increase', () => {
    const current = [
      flow({ value: 110, a: svc('small-up'), b: svc('small-up') }), // |Δ| = 10
      flow({ value: 100, a: svc('big-down'), b: svc('big-down') }), // |Δ| = 900
    ];
    const prior = [
      flow({ value: 100, a: svc('small-up'), b: svc('small-up') }),
      flow({ value: 1000, a: svc('big-down'), b: svc('big-down') }),
    ];
    const keys = moversLens(current, prior).dataTransferred.map((m) => m.key);
    expect(keys).toEqual(['ns/big-down', 'ns/small-up']);
  });

  it('caps each metric list at topN (default 8, opts override)', () => {
    const current = Array.from({ length: 12 }, (_, i) =>
      flow({ value: (i + 1) * 10, a: svc(`svc-${i}`), b: svc(`svc-${i}`) }));
    const r = moversLens(current, []);
    expect(r.dataTransferred).toHaveLength(8);
    // topN keeps the LARGEST absolute changes.
    expect(r.dataTransferred[0].current).toBe(120);
    expect(moversLens(current, [], { topN: 3 }).dataTransferred).toHaveLength(3);
  });

  it('direction follows the sign of current - prior', () => {
    const current = [
      flow({ value: 200, a: svc('up'), b: svc('up') }),
      flow({ value: 50, a: svc('down'), b: svc('down') }),
    ];
    const prior = [
      flow({ value: 100, a: svc('up'), b: svc('up') }),
      flow({ value: 100, a: svc('down'), b: svc('down') }),
    ];
    const r = moversLens(current, prior);
    expect(r.dataTransferred.find((m) => m.key === 'ns/up')?.direction).toBe('up');
    expect(r.dataTransferred.find((m) => m.key === 'ns/down')?.direction).toBe('down');
    expect(r.dataTransferred.find((m) => m.key === 'ns/down')?.deltaPct).toBeCloseTo(-50);
  });

  it('empty inputs → empty result lists', () => {
    expect(moversLens([], [])).toEqual({
      dataTransferred: [], retransmissions: [], timeouts: [],
    });
  });
});
