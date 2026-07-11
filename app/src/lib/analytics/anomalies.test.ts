import { describe, expect, it } from 'vitest';
import { detectAnomalies } from './anomalies';
import type { FlowEdge } from '../types';

const GB = 1e9;

function flow(over: Partial<FlowEdge>): FlowEdge {
  return {
    edgeHash: 'h', monitor: 'm', metric: 'DATA_TRANSFERRED', category: 'INTRA_AZ',
    bucket: 'b1', value: 0, unit: 'Bytes', a: {}, b: {}, traversedConstructs: [],
    ...over,
  } as FlowEdge;
}

const svc = (name: string) => ({ podNamespace: 'ns', serviceName: name });

const OPTS = { retransThreshold: 10, timeoutThreshold: 5, sigma: 3 };

describe('detectAnomalies', () => {
  it('flags a retransmission-rate threshold exceed (events/GB, strict >)', () => {
    const current = [
      flow({ metric: 'DATA_TRANSFERRED', value: GB, a: svc('api'), b: svc('api') }),
      flow({ metric: 'RETRANSMISSIONS', value: 15, a: svc('api'), b: svc('api') }),
    ];
    const r = detectAnomalies(current, [], OPTS);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      key: 'ns/api', label: 'ns/api', kind: 'retrans', metric: 'RETRANSMISSIONS',
      value: 15, baseline: 10, severity: 'warn',
    });
  });

  it('flags a timeout-rate threshold exceed; > 2× threshold escalates to critical', () => {
    const current = [
      flow({ metric: 'DATA_TRANSFERRED', value: GB, a: svc('db'), b: svc('db') }),
      flow({ metric: 'TIMEOUTS', value: 12, a: svc('db'), b: svc('db') }),
    ];
    const r = detectAnomalies(current, [], OPTS);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      key: 'ns/db', kind: 'timeout', metric: 'TIMEOUTS',
      value: 12, baseline: 5, severity: 'critical', // 12 > 2×5
    });
  });

  it('does not flag rates at or under the threshold (no false positive)', () => {
    const current = [
      flow({ metric: 'DATA_TRANSFERRED', value: GB, a: svc('api'), b: svc('api') }),
      flow({ metric: 'RETRANSMISSIONS', value: 10, a: svc('api'), b: svc('api') }), // = threshold
      flow({ metric: 'TIMEOUTS', value: 4, a: svc('api'), b: svc('api') }), // < threshold
    ];
    expect(detectAnomalies(current, [], OPTS)).toEqual([]);
  });

  it('attributes a threshold anomaly to BOTH endpoint entities', () => {
    const current = [
      flow({ metric: 'DATA_TRANSFERRED', value: GB, a: svc('api'), b: svc('db') }),
      flow({ metric: 'RETRANSMISSIONS', value: 15, a: svc('api'), b: svc('db') }),
    ];
    const r = detectAnomalies(current, [], OPTS);
    expect(r.map((a) => a.key).sort()).toEqual(['ns/api', 'ns/db']);
    expect(r.every((a) => a.kind === 'retrans')).toBe(true);
  });

  it('flags a spike when current > sigma × prior (relative-jump rule)', () => {
    const current = [flow({ metric: 'RETRANSMISSIONS', value: 40, a: svc('api'), b: svc('api') })];
    const prior = [flow({ metric: 'RETRANSMISSIONS', value: 10, a: svc('api'), b: svc('api') })];
    const r = detectAnomalies(current, prior, OPTS);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      key: 'ns/api', kind: 'spike', metric: 'RETRANSMISSIONS',
      value: 40, baseline: 10, severity: 'warn', // 40 ≤ 2×3×10
    });
  });

  it('spike severity escalates to critical above 2 × sigma × prior', () => {
    const current = [flow({ metric: 'TIMEOUTS', value: 70, a: svc('api'), b: svc('api') })];
    const prior = [flow({ metric: 'TIMEOUTS', value: 10, a: svc('api'), b: svc('api') })];
    const r = detectAnomalies(current, prior, OPTS);
    expect(r[0]).toMatchObject({ kind: 'spike', severity: 'critical' }); // 70 > 60
  });

  it('does not flag a spike at exactly sigma × prior (strict >)', () => {
    const current = [flow({ metric: 'RETRANSMISSIONS', value: 30, a: svc('api'), b: svc('api') })];
    const prior = [flow({ metric: 'RETRANSMISSIONS', value: 10, a: svc('api'), b: svc('api') })];
    expect(detectAnomalies(current, prior, OPTS)).toEqual([]);
  });

  it('never flags a spike without a baseline (prior 0 — growth not measurable)', () => {
    const current = [flow({ metric: 'DATA_TRANSFERRED', value: 5 * GB, a: svc('new'), b: svc('new') })];
    expect(detectAnomalies(current, [], OPTS)).toEqual([]);
  });

  it('ignores ROUND_TRIP_TIME for spike detection (sums are meaningless)', () => {
    const current = [flow({ metric: 'ROUND_TRIP_TIME', value: 9000, a: svc('api'), b: svc('api') })];
    const prior = [flow({ metric: 'ROUND_TRIP_TIME', value: 10, a: svc('api'), b: svc('api') })];
    expect(detectAnomalies(current, prior, OPTS)).toEqual([]);
  });

  it('empty inputs → empty result', () => {
    expect(detectAnomalies([], [], OPTS)).toEqual([]);
  });

  it('ranks by severity (critical first), then magnitude (value/baseline) desc', () => {
    const current = [
      // ns/a: retrans rate 30/GB → critical (30 > 2×10), magnitude 3
      flow({ metric: 'DATA_TRANSFERRED', value: GB, a: svc('a'), b: svc('a') }),
      flow({ metric: 'RETRANSMISSIONS', value: 30, a: svc('a'), b: svc('a') }),
      // ns/b: retrans rate 15/GB → warn, magnitude 1.5
      flow({ metric: 'DATA_TRANSFERRED', value: GB, a: svc('b'), b: svc('b') }),
      flow({ metric: 'RETRANSMISSIONS', value: 15, a: svc('b'), b: svc('b') }),
      // ns/c: timeout spike 70 vs 10 → critical (70 > 2×3×10), magnitude 7
      flow({ metric: 'TIMEOUTS', value: 70, a: svc('c'), b: svc('c') }),
    ];
    const prior = [flow({ metric: 'TIMEOUTS', value: 10, a: svc('c'), b: svc('c') })];
    const r = detectAnomalies(current, prior, OPTS);
    expect(r.map((a) => `${a.kind}:${a.key}`)).toEqual([
      'spike:ns/c', // critical, ×7
      'retrans:ns/a', // critical, ×3
      'retrans:ns/b', // warn
    ]);
  });
});
