import { describe, it, expect } from 'vitest';
import {
  compositeScore,
  scoreStatus,
  scorecardLens,
  RETRANS_SCALE,
  TIMEOUT_SCALE,
} from './scorecard';
import type { Series } from './aggregate';
import type { FlowEdge } from '../types';

function flow(over: Partial<FlowEdge>): FlowEdge {
  return {
    edgeHash: 'h', monitor: 'm1', metric: 'DATA_TRANSFERRED', category: 'INTRA_AZ',
    bucket: 'b1', value: 0, unit: 'Bytes', a: {}, b: {}, traversedConstructs: [],
    ...over,
  } as FlowEdge;
}

function lane(monitor: string, values: number[]): Series {
  return {
    label: monitor,
    points: values.map((v, i) => ({ t: `2026-07-11T00:0${i}:00Z`, v })),
  };
}

describe('compositeScore', () => {
  it('is 100 for fully available + zero rates and 0 at the worst corner', () => {
    expect(compositeScore(1, 0, 0)).toBe(100);
    expect(compositeScore(0, RETRANS_SCALE, TIMEOUT_SCALE)).toBe(0);
  });

  it('applies the documented 0.6/0.2/0.2 weights with rate normalization', () => {
    // availability 0.5 → 0.6×0.5 = 0.3; retrans saturated → +0; timeouts clean → +0.2
    expect(compositeScore(0.5, RETRANS_SCALE, 0)).toBeCloseTo(50);
    // half-scale rates: 0.6 + 0.2×0.5 + 0.2×0.5 = 0.8
    expect(compositeScore(1, RETRANS_SCALE / 2, TIMEOUT_SCALE / 2)).toBeCloseTo(80);
  });

  it('clamps normalized rates at 1 (rates beyond scale cannot go negative)', () => {
    expect(compositeScore(1, RETRANS_SCALE * 100, TIMEOUT_SCALE * 100)).toBeCloseTo(60);
    expect(compositeScore(0, RETRANS_SCALE * 100, TIMEOUT_SCALE * 100)).toBe(0);
  });

  it('treats missing availability (null) as healthy so sparse NHI does not tank the score', () => {
    expect(compositeScore(null, 0, 0)).toBe(100);
    expect(compositeScore(null, RETRANS_SCALE, TIMEOUT_SCALE)).toBeCloseTo(60);
  });
});

describe('scoreStatus', () => {
  it('maps score thresholds: ok ≥ 90, warn ≥ 70, danger < 70', () => {
    expect(scoreStatus(100)).toBe('ok');
    expect(scoreStatus(90)).toBe('ok');
    expect(scoreStatus(89.9)).toBe('warn');
    expect(scoreStatus(70)).toBe('warn');
    expect(scoreStatus(69.9)).toBe('danger');
    expect(scoreStatus(0)).toBe('danger');
  });
});

describe('scorecardLens', () => {
  it('computes nhiAvailabilityPct as the healthy (==0) fraction of HealthIndicator points', () => {
    const r = scorecardLens([], {
      byMonitor: {
        m1: lane('m1', [0, 0, 0, 2]), // 3 of 4 healthy → 75 %
        m2: lane('m2', [0, 0]), // all healthy → 100 %
      },
    });
    const m1 = r.monitors.find((m) => m.monitor === 'm1');
    const m2 = r.monitors.find((m) => m.monitor === 'm2');
    expect(m1?.nhiAvailabilityPct).toBeCloseTo(75);
    expect(m2?.nhiAvailabilityPct).toBe(100);
  });

  it('yields null availability for monitors seen only in flows (no CW points)', () => {
    const r = scorecardLens([flow({ monitor: 'm1', value: 1e9 })], { byMonitor: {} });
    expect(r.monitors).toHaveLength(1);
    expect(r.monitors[0].nhiAvailabilityPct).toBeNull();
    // Missing availability is treated as healthy: clean rates → perfect score.
    expect(r.monitors[0].score).toBe(100);
    expect(r.monitors[0].status).toBe('ok');
  });

  it('groups per-monitor retrans/timeout rates (events per GB) and bytes from flows', () => {
    const flows = [
      flow({ monitor: 'm1', metric: 'DATA_TRANSFERRED', value: 2e9 }),
      flow({ monitor: 'm1', metric: 'RETRANSMISSIONS', value: 4 }),
      flow({ monitor: 'm1', metric: 'TIMEOUTS', value: 1 }),
      flow({ monitor: 'm2', metric: 'DATA_TRANSFERRED', value: 1e9 }),
      // RTT flows carry no reliability events and must be ignored.
      flow({ monitor: 'm2', metric: 'ROUND_TRIP_TIME', value: 5000 }),
    ];
    const r = scorecardLens(flows, {});
    const m1 = r.monitors.find((m) => m.monitor === 'm1');
    const m2 = r.monitors.find((m) => m.monitor === 'm2');
    expect(m1).toMatchObject({ bytes: 2e9 });
    expect(m1?.retransRate).toBeCloseTo(2); // 4 events / 2 GB
    expect(m1?.timeoutRate).toBeCloseTo(0.5);
    expect(m2).toMatchObject({ bytes: 1e9, retransRate: 0, timeoutRate: 0 });
  });

  it('unions monitors from flows and CW, sorted worst-first (score asc, then name)', () => {
    const r = scorecardLens(
      [flow({ monitor: 'flows-only', value: 1e9 })],
      { byMonitor: { 'cw-only': lane('cw-only', [0, 3]) } }, // 50 % availability → score 70
    );
    expect(r.monitors.map((m) => m.monitor)).toEqual(['cw-only', 'flows-only']);
    expect(r.monitors[0].score).toBeCloseTo(70);
    expect(r.monitors[0].bytes).toBe(0);
  });

  it('overall = mean availability over monitors WITH data and mean score', () => {
    const r = scorecardLens([], {
      byMonitor: { m1: lane('m1', [0, 0]), m2: lane('m2', [0, 5]) }, // 100 % and 50 %
    });
    expect(r.overall.availabilityPct).toBeCloseTo(75);
    // scores: 100 and 0.6×0.5+0.4 = 70 → mean 85
    expect(r.overall.score).toBeCloseTo(85);
  });

  it('breachTimeline counts degraded monitors (>0) per timestamp over the union of times', () => {
    const t = (i: number) => `2026-07-11T00:0${i}:00Z`;
    const r = scorecardLens([], {
      byMonitor: {
        m1: { label: 'm1', points: [{ t: t(0), v: 0 }, { t: t(1), v: 1 }, { t: t(2), v: 0 }] },
        m2: { label: 'm2', points: [{ t: t(0), v: 2 }, { t: t(1), v: 3 }] },
      },
    });
    expect(r.breachTimeline).toEqual([
      { t: t(0), count: 1 },
      { t: t(1), count: 2 },
      { t: t(2), count: 0 },
    ]);
  });

  it('worst keeps only services with non-zero event rates, desc by retransRate, capped at 8', () => {
    const flows = [
      // clean high-traffic service must NOT appear
      flow({ value: 9e9, a: { podNamespace: 'ns', serviceName: 'clean' }, b: { podNamespace: 'ns', serviceName: 'clean' } }),
      ...Array.from({ length: 10 }, (_, i) => [
        flow({ value: 1e9, a: { podNamespace: 'ns', serviceName: `svc-${i}` }, b: { podNamespace: 'ns', serviceName: `svc-${i}` } }),
        flow({ metric: 'RETRANSMISSIONS' as const, value: i + 1, a: { podNamespace: 'ns', serviceName: `svc-${i}` }, b: { podNamespace: 'ns', serviceName: `svc-${i}` } }),
      ]).flat(),
    ];
    const r = scorecardLens(flows, {});
    expect(r.worst).toHaveLength(8);
    const rates = r.worst.map((w) => w.retransRate);
    expect([...rates].sort((a, b) => b - a)).toEqual(rates);
    expect(r.worst.some((w) => w.label.includes('clean'))).toBe(false);
  });

  it('empty flows + no CW → empty scorecard with nulls/zeros and no NaN', () => {
    for (const cw of [{}, { byMonitor: {} }]) {
      const r = scorecardLens([], cw);
      expect(r.monitors).toEqual([]);
      expect(r.overall.availabilityPct).toBeNull();
      expect(r.overall.score).toBe(0);
      expect(r.breachTimeline).toEqual([]);
      expect(r.worst).toEqual([]);
      expect(Number.isFinite(r.overall.score)).toBe(true);
    }
  });

  it('never emits NaN even with zero-byte monitors carrying events', () => {
    const r = scorecardLens([flow({ monitor: 'm1', metric: 'RETRANSMISSIONS', value: 5 })], {});
    const m1 = r.monitors[0];
    // ratePerGb guard: no bytes → rate 0 (no traffic ≠ infinitely bad)
    expect(m1.retransRate).toBe(0);
    expect(Number.isFinite(m1.score)).toBe(true);
  });
});
