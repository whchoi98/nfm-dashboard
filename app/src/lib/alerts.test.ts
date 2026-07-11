import { describe, it, expect } from 'vitest';
import { deriveEvents, SPIKE_DELTA_PCT, type AlertsInput } from './alerts';

const NOW = '2026-07-11T12:00:00.000Z';

const EMPTY: AlertsInput = { nhiByMonitor: [], breaches: [], collectionHistory: [], movers: [] };

describe('deriveEvents', () => {
  it('returns [] for empty input', () => {
    expect(deriveEvents({ ...EMPTY, now: NOW })).toEqual([]);
  });

  it('degraded NHI monitor → critical nhi event linking to the monitor page', () => {
    const events = deriveEvents({
      ...EMPTY,
      now: NOW,
      nhiByMonitor: [
        { monitor: 'eks-cluster', degraded: true },
        { monitor: 'healthy-mon', degraded: false },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'nhi:eks-cluster',
      kind: 'nhi',
      severity: 'critical',
      title: 'alerts.event.nhi',
      ts: NOW,
      href: '/monitors/eks-cluster',
    });
    expect(events[0].detail).toContain('eks-cluster');
  });

  it('each reliability breach → warn breach event with rates in the detail', () => {
    const events = deriveEvents({
      ...EMPTY,
      now: NOW,
      breaches: [{ label: 'ns/api', retransRate: 15.26, timeoutRate: 0.5 }],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'breach:ns/api',
      kind: 'breach',
      severity: 'warn',
      title: 'alerts.event.breach',
      ts: NOW,
      href: '/insights?tab=reliability',
    });
    expect(events[0].detail).toContain('ns/api');
    expect(events[0].detail).toContain('15.3');
    expect(events[0].detail).toContain('0.5');
  });

  it('collection cycle: failed>0 → warn; throttled-only → info; clean → nothing; ts = cycleTs', () => {
    const events = deriveEvents({
      ...EMPTY,
      now: NOW,
      collectionHistory: [
        { cycleTs: '2026-07-11T10:00:00Z', failed: 2, started: 10, throttled: 0 },
        { cycleTs: '2026-07-11T10:05:00Z', failed: 0, started: 10, throttled: 3 },
        { cycleTs: '2026-07-11T10:10:00Z', failed: 0, started: 10, throttled: 0 },
      ],
    });
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.id === 'collection:2026-07-11T10:00:00Z')).toMatchObject({
      kind: 'collection',
      severity: 'warn',
      title: 'alerts.event.collection',
      ts: '2026-07-11T10:00:00Z',
    });
    expect(events.find((e) => e.id === 'collection:2026-07-11T10:05:00Z')).toMatchObject({
      kind: 'collection',
      severity: 'info',
      title: 'alerts.event.collectionThrottled',
      ts: '2026-07-11T10:05:00Z',
    });
  });

  it('spike: up + deltaPct ≥ threshold on retrans/timeout → warn; other movers ignored', () => {
    const events = deriveEvents({
      ...EMPTY,
      now: NOW,
      movers: [
        { label: 'ns/api', metric: 'RETRANSMISSIONS', deltaPct: 250, direction: 'up', current: 50 },
        { label: 'ns/db', metric: 'TIMEOUTS', deltaPct: SPIKE_DELTA_PCT, direction: 'up', current: 12 },
        // wrong metric — traffic growth is not a reliability spike
        { label: 'ns/web', metric: 'DATA_TRANSFERRED', deltaPct: 400, direction: 'up', current: 1e9 },
        // wrong direction
        { label: 'ns/down', metric: 'RETRANSMISSIONS', deltaPct: -80, direction: 'down', current: 1 },
        // small delta
        { label: 'ns/small', metric: 'TIMEOUTS', deltaPct: 20, direction: 'up', current: 5 },
        // no baseline (prior 0 → deltaPct null) — not a measurable spike
        { label: 'ns/new', metric: 'RETRANSMISSIONS', deltaPct: null, direction: 'up', current: 9 },
      ],
    });
    expect(events.map((e) => e.id).sort()).toEqual([
      'spike:RETRANSMISSIONS:ns/api',
      'spike:TIMEOUTS:ns/db',
    ]);
    expect(events.every((e) => e.kind === 'spike' && e.severity === 'warn')).toBe(true);
    const api = events.find((e) => e.id === 'spike:RETRANSMISSIONS:ns/api');
    expect(api?.title).toBe('alerts.event.spikeRetrans');
    expect(api?.detail).toContain('250');
    expect(api?.href).toBe('/insights?tab=movers');
    expect(events.find((e) => e.id === 'spike:TIMEOUTS:ns/db')?.title).toBe('alerts.event.spikeTimeout');
  });

  it('sorts by severity (critical > warn > info) then ts desc', () => {
    const events = deriveEvents({
      now: NOW,
      nhiByMonitor: [{ monitor: 'mon', degraded: true }],
      breaches: [{ label: 'ns/api', retransRate: 20, timeoutRate: 0 }],
      collectionHistory: [
        { cycleTs: '2026-07-11T09:00:00Z', failed: 1, started: 5, throttled: 0 },
        { cycleTs: '2026-07-11T11:00:00Z', failed: 0, started: 5, throttled: 2 },
      ],
      movers: [],
    });
    expect(events.map((e) => e.severity)).toEqual(['critical', 'warn', 'warn', 'info']);
    // within warn, newer first: the breach (ts=now 12:00) before the 09:00 failed cycle
    expect(events[1].id).toBe('breach:ns/api');
    expect(events[2].id).toBe('collection:2026-07-11T09:00:00Z');
  });

  it('defaults ts to a valid ISO timestamp when now is not supplied', () => {
    const [e] = deriveEvents({ ...EMPTY, nhiByMonitor: [{ monitor: 'm', degraded: true }] });
    expect(Number.isNaN(Date.parse(e.ts))).toBe(false);
  });
});
