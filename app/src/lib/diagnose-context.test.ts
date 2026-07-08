import { describe, it, expect } from 'vitest';
import { buildDiagnoseContext, topAnomalies } from './diagnose-context';
import type { CollectionStatus, TopoEdge, TopologySnapshot } from './types';

const edge = (id: string, source: string, target: string,
  retrans: number, timeouts: number): TopoEdge => ({
  id, source, target, category: 'INTER_AZ',
  metrics: { RETRANSMISSIONS: retrans, TIMEOUTS: timeouts, DATA_TRANSFERRED: 1000 },
});

const topo = (edges: TopoEdge[]): TopologySnapshot => ({
  generatedAt: '2026-07-08T00:00:00Z',
  nodes: [
    { id: 'ns/pod-a', kind: 'pod', label: 'pod-a', namespace: 'ns', cluster: 'eks-a' },
    { id: 'ns/pod-b', kind: 'pod', label: 'pod-b', namespace: 'ns', cluster: 'eks-a' },
    { id: 'ns/pod-c', kind: 'pod', label: 'pod-c', namespace: 'ns', cluster: 'eks-b' },
  ],
  edges,
});

const status: CollectionStatus = { cycleTs: '2026-07-08T00:05:00Z',
  stats: { started: 4, succeeded: 3, failed: 1, throttled: 0, rows: 1234 } };

describe('topAnomalies', () => {
  it('ranks by retransmissions+timeouts desc and truncates to n', () => {
    // 25 edges with strictly increasing sums 1..25 → top 20 are sums 25..6.
    const edges = Array.from({ length: 25 }, (_, i) =>
      edge(`e${i + 1}`, `ns/src-${i + 1}`, `ns/dst-${i + 1}`, i + 1, 0));
    const top = topAnomalies(topo(edges));
    expect(top).toHaveLength(20);
    expect(top[0]).toMatchObject({ edgeId: 'e25', source: 'ns/src-25', target: 'ns/dst-25',
      retransmissions: 25, timeouts: 0, category: 'INTER_AZ' });
    const sums = top.map((a) => a.retransmissions + a.timeouts);
    expect(sums).toEqual(Array.from({ length: 20 }, (_, i) => 25 - i));
    // explicit n
    expect(topAnomalies(topo(edges), 3).map((a) => a.edgeId)).toEqual(['e25', 'e24', 'e23']);
  });

  it('sums both metrics, drops zero-sum edges, tolerates missing metrics', () => {
    const edges = [
      edge('lo', 'ns/a', 'ns/b', 1, 1), // sum 2
      edge('hi', 'ns/c', 'ns/d', 2, 3), // sum 5
      edge('zero', 'ns/e', 'ns/f', 0, 0), // not an anomaly
      { id: 'bare', source: 'ns/g', target: 'ns/h', category: 'INTRA_AZ',
        metrics: { DATA_TRANSFERRED: 9 } } as TopoEdge, // no retrans/timeout keys
    ];
    expect(topAnomalies(topo(edges)).map((a) => a.edgeId)).toEqual(['hi', 'lo']);
    expect(topAnomalies(null)).toEqual([]);
  });
});

describe('buildDiagnoseContext', () => {
  it('marks zero-edge topology as collecting / 수집 준비 중', () => {
    const ctx = buildDiagnoseContext(topo([]), status, []);
    expect(ctx).toContain('수집 준비 중');
    expect(ctx).toContain('collecting');
    // null topology is also "not ready"
    expect(buildDiagnoseContext(null, null, [])).toContain('수집 준비 중');
  });

  it('includes node/edge counts, clusters, status and anomaly endpoints', () => {
    const edges = [edge('e1', 'ns/pod-a', 'ns/pod-b', 12, 3), edge('e2', 'ns/pod-b', 'ns/pod-c', 1, 0)];
    const t = topo(edges);
    const ctx = buildDiagnoseContext(t, status, topAnomalies(t));
    expect(ctx).toContain('nodes: 3');
    expect(ctx).toContain('edges: 2');
    expect(ctx).toContain('eks-a');
    expect(ctx).toContain('eks-b');
    expect(ctx).toContain('2026-07-08T00:05:00Z'); // last cycle
    expect(ctx).toContain('ns/pod-a');
    expect(ctx).toContain('ns/pod-b');
    expect(ctx).toContain('retransmissions=12');
    expect(ctx).not.toContain('수집 준비 중');
  });
});
