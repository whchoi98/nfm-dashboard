// TDD for buildGraphModel (Task 6) — pure WhaTap-style graph view model:
// traffic-scaled radii, self-loop extraction, DATA_TRANSFERRED-throughput
// dashed styling (independent of the selected metric), tag selection
// filtering, and status precedence. No I/O, no rendering.
import { describe, expect, it } from 'vitest';
import type { TopologySnapshot } from './types';
import { buildGraphModel } from './topology-graph';

function topo(edges: TopologySnapshot['edges'], nodes?: TopologySnapshot['nodes']): TopologySnapshot {
  const ids = new Set(edges.flatMap((e) => [e.source, e.target]));
  return {
    generatedAt: '2026-07-09T00:00:00Z',
    nodes:
      nodes ??
      [...ids].map((id) => ({ id, kind: 'pod' as const, label: id.split('/').pop() ?? id })),
    edges,
  };
}

describe('buildGraphModel', () => {
  it('sizes nodes by traffic: monotonic sqrt scale clamped to radiusRange', () => {
    const t = topo([
      { id: 'e1', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: 1_000_000 }, category: 'INTRA_AZ' },
      { id: 'e2', source: 'b', target: 'c', metrics: { DATA_TRANSFERRED: 10_000 }, category: 'INTER_AZ' },
    ]);
    const m = buildGraphModel(t, { radiusRange: [18, 56] });
    const byId = new Map(m.nodes.map((n) => [n.id, n]));
    const a = byId.get('a')!;
    const b = byId.get('b')!;
    const c = byId.get('c')!;
    // b carries both edges → biggest; a > c (1 MB vs 10 KB incident traffic).
    expect(b.traffic).toBe(1_010_000);
    expect(b.radius).toBeGreaterThan(a.radius);
    expect(a.radius).toBeGreaterThan(c.radius);
    // clamped: max-traffic node hits the top of the range, none exceed bounds.
    expect(b.radius).toBe(56);
    for (const n of m.nodes) {
      expect(n.radius).toBeGreaterThanOrEqual(18);
      expect(n.radius).toBeLessThanOrEqual(56);
    }
  });

  it('gives every node the min radius when all traffic is zero', () => {
    const t = topo([{ id: 'e1', source: 'a', target: 'b', metrics: {}, category: 'INTRA_AZ' }]);
    const m = buildGraphModel(t, { radiusRange: [18, 56] });
    for (const n of m.nodes) expect(n.radius).toBe(18);
  });

  it('turns source==target edges into node selfBytes instead of links', () => {
    const t = topo([
      { id: 'self', source: 'a', target: 'a', metrics: { DATA_TRANSFERRED: 4_096 }, category: 'INTRA_AZ' },
      { id: 'e1', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: 100 }, category: 'INTER_AZ' },
    ]);
    const m = buildGraphModel(t);
    expect(m.links).toHaveLength(1);
    expect(m.links[0].id).toBe('e1');
    const a = m.nodes.find((n) => n.id === 'a')!;
    expect(a.selfBytes).toBe(4_096);
    // traffic = incident link values + selfBytes
    expect(a.traffic).toBe(4_196);
  });

  it('marks links dashed only when the DATA_TRANSFERRED rate exceeds the threshold (128 boundary)', () => {
    const t = topo([
      { id: 'solid', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: 128 }, category: 'INTRA_AZ' },
      { id: 'dashed', source: 'b', target: 'c', metrics: { DATA_TRANSFERRED: 129 }, category: 'INTRA_AZ' },
    ]);
    // windowSeconds=1 → rate equals the raw byte value.
    const m = buildGraphModel(t, { windowSeconds: 1, rateThreshold: 128 });
    const byId = new Map(m.links.map((l) => [l.id, l]));
    expect(byId.get('solid')!.rate).toBe(128);
    expect(byId.get('solid')!.dashed).toBe(false);
    expect(byId.get('dashed')!.rate).toBe(129);
    expect(byId.get('dashed')!.dashed).toBe(true);
  });

  it('derives dashed from DATA_TRANSFERRED throughput, independent of the selected metric', () => {
    const t = topo([
      // Huge RTT but tiny bytes → must stay SOLID even when RTT is selected.
      { id: 'slow', source: 'a', target: 'b', metrics: { ROUND_TRIP_TIME: 9_999_999, DATA_TRANSFERRED: 10 }, category: 'INTRA_AZ' },
      // Huge bytes but zero timeouts → must be DASHED even when TIMEOUTS is selected.
      { id: 'busy', source: 'b', target: 'c', metrics: { TIMEOUTS: 0, DATA_TRANSFERRED: 10_000_000 }, category: 'INTER_AZ' },
    ]);
    for (const metric of ['ROUND_TRIP_TIME', 'TIMEOUTS', 'RETRANSMISSIONS', 'DATA_TRANSFERRED'] as const) {
      const m = buildGraphModel(t, { metric, windowSeconds: 1, rateThreshold: 128 });
      const byId = new Map(m.links.map((l) => [l.id, l]));
      // rate is always bytes/s from DATA_TRANSFERRED, never the selected metric.
      expect(byId.get('slow')!.rate).toBe(10);
      expect(byId.get('slow')!.dashed).toBe(false);
      expect(byId.get('busy')!.rate).toBe(10_000_000);
      expect(byId.get('busy')!.dashed).toBe(true);
    }
    // The link VALUE (label/sizing) still tracks the selected metric.
    const rtt = buildGraphModel(t, { metric: 'ROUND_TRIP_TIME', windowSeconds: 1 });
    expect(new Map(rtt.links.map((l) => [l.id, l])).get('slow')!.value).toBe(9_999_999);
  });

  it('treats missing DATA_TRANSFERRED as zero rate (solid) under a non-byte metric', () => {
    const t = topo([
      { id: 'e1', source: 'a', target: 'b', metrics: { RETRANSMISSIONS: 1_000_000 }, category: 'INTRA_AZ' },
    ]);
    const m = buildGraphModel(t, { metric: 'RETRANSMISSIONS', windowSeconds: 1, rateThreshold: 128 });
    expect(m.links[0].value).toBe(1_000_000);
    expect(m.links[0].rate).toBe(0);
    expect(m.links[0].dashed).toBe(false);
  });

  it('defaults rate to value / 300s and threshold to 128', () => {
    const t = topo([
      { id: 'e1', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: 300 * 128 }, category: 'INTRA_AZ' },
      { id: 'e2', source: 'b', target: 'c', metrics: { DATA_TRANSFERRED: 300 * 128 + 300 }, category: 'INTRA_AZ' },
    ]);
    const m = buildGraphModel(t);
    const byId = new Map(m.links.map((l) => [l.id, l]));
    expect(byId.get('e1')!.dashed).toBe(false); // rate exactly 128
    expect(byId.get('e2')!.dashed).toBe(true); // rate 129
  });

  it('keeps only selectedIds nodes and drops links with a dropped endpoint', () => {
    const t = topo([
      { id: 'e1', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: 10 }, category: 'INTRA_AZ' },
      { id: 'e2', source: 'b', target: 'c', metrics: { DATA_TRANSFERRED: 20 }, category: 'INTRA_AZ' },
      { id: 'e3', source: 'a', target: 'c', metrics: { DATA_TRANSFERRED: 30 }, category: 'INTRA_AZ' },
    ]);
    const m = buildGraphModel(t, { selectedIds: new Set(['a', 'b']) });
    expect(m.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(m.links.map((l) => l.id)).toEqual(['e1']); // e2/e3 dangle on dropped c
    expect(m.total).toBe(3); // all topo nodes
    expect(m.selected).toBe(2); // rendered nodes
  });

  it('treats null or empty selectedIds as "all nodes"', () => {
    const t = topo([{ id: 'e1', source: 'a', target: 'b', metrics: {}, category: 'INTRA_AZ' }]);
    expect(buildGraphModel(t, { selectedIds: null }).nodes).toHaveLength(2);
    expect(buildGraphModel(t, { selectedIds: new Set() }).nodes).toHaveLength(2);
    expect(buildGraphModel(t).selected).toBe(2);
  });

  it('applies status precedence danger > warn > idle > ok', () => {
    const t = topo(
      [
        { id: 'e1', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: 10 }, category: 'INTRA_AZ' },
        { id: 'e2', source: 'c', target: 'd', metrics: { DATA_TRANSFERRED: 10 }, category: 'INTRA_AZ' },
      ],
      [
        { id: 'a', kind: 'pod', label: 'a' },
        { id: 'b', kind: 'pod', label: 'b' },
        { id: 'c', kind: 'pod', label: 'c' },
        { id: 'd', kind: 'pod', label: 'd' },
        { id: 'z', kind: 'pod', label: 'z' }, // no traffic at all
      ],
    );
    const m = buildGraphModel(t, {
      breaches: new Set(['a']),
      warns: new Set(['a', 'c', 'z']),
    });
    const status = new Map(m.nodes.map((n) => [n.id, n.status]));
    expect(status.get('a')).toBe('danger'); // breach beats warn
    expect(status.get('c')).toBe('warn');
    expect(status.get('z')).toBe('warn'); // warn beats idle
    expect(status.get('b')).toBe('ok'); // active, no flags
    // idle: traffic 0 and unflagged
    const idleTopo = buildGraphModel(t);
    expect(new Map(idleTopo.nodes.map((n) => [n.id, n.status])).get('z')).toBe('idle');
  });

  it('respects a non-default metric for values and traffic', () => {
    const t = topo([
      { id: 'e1', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: 5, RETRANSMISSIONS: 42 }, category: 'INTRA_AZ' },
    ]);
    const m = buildGraphModel(t, { metric: 'RETRANSMISSIONS' });
    expect(m.links[0].value).toBe(42);
    expect(m.nodes.find((n) => n.id === 'a')!.traffic).toBe(42);
  });

  it('returns an empty model for an empty topology', () => {
    const m = buildGraphModel({ generatedAt: '', nodes: [], edges: [] });
    expect(m.nodes).toEqual([]);
    expect(m.links).toEqual([]);
    expect(m.total).toBe(0);
    expect(m.selected).toBe(0);
  });
});
