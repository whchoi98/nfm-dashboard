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
});
