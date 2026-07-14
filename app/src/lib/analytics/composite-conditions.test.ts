import { describe, it, expect } from 'vitest';
import { compositeConditions } from './composite-conditions';
import type { FlowEdge } from '../types';

// helper builds a service-entity flow with retrans + a volume drop.
// Fields verified against the real FlowEdge (app/src/lib/types.ts): all
// required fields present (edgeHash/monitor/metric/category/bucket/value/unit/
// a/b/traversedConstructs); snatIp/dnatIp/targetPort are optional, omitted.
const edge = (a: string, metric: FlowEdge['metric'], value: number, bucket = 'b1'): FlowEdge => ({
  edgeHash: `${a}-${metric}-${bucket}`, monitor: 'm', metric, category: 'INTER_AZ', bucket, value,
  unit: 'Bytes', a: { serviceName: a, podNamespace: 'ns' }, b: { serviceName: 'peer', podNamespace: 'ns' },
  traversedConstructs: [],
});

describe('compositeConditions', () => {
  it('flags an entity breaching >=2 conditions (high retrans rate + volume drop)', () => {
    // current: heavy retrans, low volume; prior: high volume → volume dropped
    const current = [edge('svc', 'DATA_TRANSFERRED', 1e6), edge('svc', 'RETRANSMISSIONS', 1000)];
    const prior = [edge('svc', 'DATA_TRANSFERRED', 1e9, 'b0')];
    const rows = compositeConditions(current, prior);
    const svc = rows.find((r) => r.label.includes('svc'));
    expect(svc).toBeTruthy();
    expect(svc!.conditions.length).toBeGreaterThanOrEqual(2);
  });
  it('does not flag an entity breaching only one condition', () => {
    const current = [edge('quiet', 'DATA_TRANSFERRED', 1e9)];
    const prior = [edge('quiet', 'DATA_TRANSFERRED', 1e9, 'b0')];
    expect(compositeConditions(current, prior).find((r) => r.label.includes('quiet'))).toBeUndefined();
  });

  it('flags a low-traffic entity with a severe relative volume drop even when 9 other entities are bigger absolute movers (topN cap must not exclude it)', () => {
    const current: FlowEdge[] = [];
    const prior: FlowEdge[] = [];
    // 9 large ABSOLUTE-change movers (huge volume increase, no retrans) — each
    // would occupy a slot in the default top-8-by-absolute-change ranking,
    // but none breaches >=2 conditions themselves (increase, not a drop; no
    // retrans metric at all), so they stay unflagged regardless of the cap.
    for (let i = 1; i <= 9; i++) {
      const label = `big${i}`;
      current.push(edge(label, 'DATA_TRANSFERRED', 1e9 + i, 'cur'));
      prior.push(edge(label, 'DATA_TRANSFERRED', 1000, 'b0'));
    }
    // One small-absolute-traffic entity: tiny bytes, but a >=50% relative
    // drop AND high retrans — a genuine 2-condition breach that the old
    // topN=8 mover cap would silently drop from the `dataTransferred` list.
    current.push(edge('small1', 'DATA_TRANSFERRED', 1000, 'cur'));
    current.push(edge('small1', 'RETRANSMISSIONS', 50, 'cur'));
    prior.push(edge('small1', 'DATA_TRANSFERRED', 100000, 'b0'));

    const rows = compositeConditions(current, prior);
    const small = rows.find((r) => r.label.includes('small1'));
    expect(small).toBeTruthy();
    expect(small!.conditions.length).toBeGreaterThanOrEqual(2);
  });

  it('does not flag an entity with high retrans but flat/rising volume (only 1 condition)', () => {
    const current = [
      edge('retransonly', 'DATA_TRANSFERRED', 1000),
      edge('retransonly', 'RETRANSMISSIONS', 50),
    ];
    // Flat volume window-over-window — no drop condition, so only the
    // retrans condition is present. This differs from the existing "ignore"
    // test above, which builds a zero-condition entity (no retrans at all).
    const prior = [edge('retransonly', 'DATA_TRANSFERRED', 1000, 'b0')];
    expect(
      compositeConditions(current, prior).find((r) => r.label.includes('retransonly')),
    ).toBeUndefined();
  });
});
