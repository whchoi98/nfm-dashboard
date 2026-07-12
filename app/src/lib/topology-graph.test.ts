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

  // ── edge health (Phase 9 Task 4): retransmissions per GB of DATA_TRANSFERRED ──
  describe('link health', () => {
    const GB = 1e9;

    it('classifies danger ≥ threshold, warn ≥ half, ok below (10/GB default, inclusive bounds)', () => {
      const t = topo([
        // 10 retrans over 1 GB → rate exactly 10 → danger (inclusive).
        { id: 'danger', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: GB, RETRANSMISSIONS: 10 }, category: 'INTRA_AZ' },
        // 5 retrans over 1 GB → rate exactly 5 (= half) → warn (inclusive).
        { id: 'warn', source: 'b', target: 'c', metrics: { DATA_TRANSFERRED: GB, RETRANSMISSIONS: 5 }, category: 'INTRA_AZ' },
        // 4.99…/GB → ok (just under half).
        { id: 'ok', source: 'c', target: 'd', metrics: { DATA_TRANSFERRED: GB, RETRANSMISSIONS: 4 }, category: 'INTRA_AZ' },
      ]);
      const byId = new Map(buildGraphModel(t).links.map((l) => [l.id, l]));
      expect(byId.get('danger')!.health).toBe('danger');
      expect(byId.get('warn')!.health).toBe('warn');
      expect(byId.get('ok')!.health).toBe('ok');
    });

    it('respects a custom healthThreshold', () => {
      const t = topo([
        { id: 'e1', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: GB, RETRANSMISSIONS: 10 }, category: 'INTRA_AZ' },
      ]);
      // threshold 40 → rate 10 < half(20) → ok; threshold 15 → 10 ≥ 7.5 → warn.
      expect(buildGraphModel(t, { healthThreshold: 40 }).links[0].health).toBe('ok');
      expect(buildGraphModel(t, { healthThreshold: 15 }).links[0].health).toBe('warn');
    });

    it('treats edges without retransmission data as ok', () => {
      const t = topo([
        { id: 'e1', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: GB }, category: 'INTRA_AZ' },
      ]);
      expect(buildGraphModel(t).links[0].health).toBe('ok');
    });

    it('guards zero/missing bytes: no NaN/Infinity, health ok (no traffic ≠ infinitely bad)', () => {
      const t = topo([
        // retrans present but zero bytes → rate must be 0, not Infinity.
        { id: 'zero', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: 0, RETRANSMISSIONS: 99 }, category: 'INTRA_AZ' },
        // retrans present, bytes missing entirely.
        { id: 'missing', source: 'b', target: 'c', metrics: { RETRANSMISSIONS: 99 }, category: 'INTRA_AZ' },
      ]);
      const m = buildGraphModel(t, { metric: 'RETRANSMISSIONS' });
      for (const l of m.links) {
        expect(l.health).toBe('ok');
        expect(Number.isFinite(l.value)).toBe(true);
        expect(Number.isFinite(l.rate)).toBe(true);
      }
    });

    it('derives health from retrans/bytes, independent of the selected metric', () => {
      const t = topo([
        { id: 'e1', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: GB, RETRANSMISSIONS: 100, ROUND_TRIP_TIME: 1 }, category: 'INTRA_AZ' },
      ]);
      for (const metric of ['DATA_TRANSFERRED', 'RETRANSMISSIONS', 'TIMEOUTS', 'ROUND_TRIP_TIME'] as const) {
        expect(buildGraphModel(t, { metric }).links[0].health).toBe('danger');
      }
    });

    // ── tunable warn/danger thresholds (Phase 14 Task 1) ──
    it('reads the warn threshold from options independently of the danger threshold', () => {
      const t = topo([
        { id: 'e1', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: GB, RETRANSMISSIONS: 6 }, category: 'INTRA_AZ' },
      ]);
      // default: healthThreshold=10 → warn boundary = 5 (half) → rate 6 ≥ 5 → warn.
      expect(buildGraphModel(t).links[0].health).toBe('warn');
      // explicit healthWarnThreshold overrides the derived half — 7 > 6 → ok.
      expect(buildGraphModel(t, { healthWarnThreshold: 7 }).links[0].health).toBe('ok');
      // explicit healthThreshold (danger) independent of warn — 6 ≥ 6 → danger,
      // even though today's derived half(10)/2=5 boundary alone would say warn.
      expect(buildGraphModel(t, { healthThreshold: 6 }).links[0].health).toBe('danger');
    });
  });
});

// ── min-traffic threshold (Phase 14 Task 1) ──────────────────────────────────
describe('buildGraphModel — min-traffic cut (minEdgeValue)', () => {
  it('minEdgeValue:0 (default) is byte-identical to omitting the option', () => {
    const t = topo([
      { id: 'e1', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: 10 }, category: 'INTRA_AZ' },
      { id: 'e2', source: 'b', target: 'c', metrics: { DATA_TRANSFERRED: 0 }, category: 'INTRA_AZ' },
    ]);
    const withOpt = buildGraphModel(t, { minEdgeValue: 0 });
    const without = buildGraphModel(t);
    expect(withOpt).toEqual(without);
    expect(withOpt.hiddenEdgeCount).toBe(0);
  });

  it('drops edges whose selected-metric value is below minEdgeValue and reports hiddenEdgeCount', () => {
    const t = topo([
      { id: 'big', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: 1000 }, category: 'INTRA_AZ' },
      { id: 'small', source: 'b', target: 'c', metrics: { DATA_TRANSFERRED: 5 }, category: 'INTRA_AZ' },
    ]);
    const m = buildGraphModel(t, { minEdgeValue: 100 });
    expect(m.links.map((l) => l.id)).toEqual(['big']);
    expect(m.hiddenEdgeCount).toBe(1);
  });

  it('drops nodes orphaned by the cut (their only link fell below the threshold)', () => {
    const t = topo([
      { id: 'big', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: 1000 }, category: 'INTRA_AZ' },
      { id: 'small', source: 'b', target: 'c', metrics: { DATA_TRANSFERRED: 5 }, category: 'INTRA_AZ' },
    ]);
    const m = buildGraphModel(t, { minEdgeValue: 100 });
    // c's only edge ('small') was cut → orphaned, dropped. a/b keep 'big'.
    expect(m.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(m.selected).toBe(2);
    expect(m.total).toBe(3); // full topo node count, unaffected by the cut
  });

  it('keeps a node whose only cross-node link is cut but which still carries a self-loop', () => {
    const t = topo(
      [
        { id: 'self', source: 'c', target: 'c', metrics: { DATA_TRANSFERRED: 999 }, category: 'INTRA_AZ' },
        { id: 'small', source: 'b', target: 'c', metrics: { DATA_TRANSFERRED: 5 }, category: 'INTRA_AZ' },
      ],
      [
        { id: 'b', kind: 'pod', label: 'b' },
        { id: 'c', kind: 'pod', label: 'c' },
      ],
    );
    const m = buildGraphModel(t, { minEdgeValue: 100 });
    expect(m.nodes.map((n) => n.id)).toContain('c');
    expect(m.nodes.find((n) => n.id === 'c')!.selfBytes).toBe(999);
  });

  it('leaves nodes that already had zero links before the cut untouched (not newly "orphaned")', () => {
    const t = topo(
      [{ id: 'e1', source: 'a', target: 'b', metrics: { DATA_TRANSFERRED: 5 }, category: 'INTRA_AZ' }],
      [
        { id: 'a', kind: 'pod', label: 'a' },
        { id: 'b', kind: 'pod', label: 'b' },
        { id: 'z', kind: 'pod', label: 'z' }, // isolated from the start, no edges at all
      ],
    );
    const m = buildGraphModel(t, { minEdgeValue: 100 }); // cuts e1 too
    const ids = m.nodes.map((n) => n.id);
    expect(ids).toContain('z'); // untouched — was never linked, cut or not
    expect(ids).not.toContain('a'); // had a link that got cut → orphaned
    expect(ids).not.toContain('b');
  });
});

// ── node grouping + collapse/expand (Phase 14 Task 3) ────────────────────────
describe('buildGraphModel — node grouping (groupBy)', () => {
  const GB = 1e9;
  // Two namespaces: ns-a = {a1, a2}, ns-b = {b1}. Two cross-ns edges into b1
  // plus one intra-ns-a edge (a1→a2). ids sort so group:namespace:ns-a < ns-b.
  const nsNodes: TopologySnapshot['nodes'] = [
    { id: 'a1', kind: 'pod', label: 'a1', namespace: 'ns-a' },
    { id: 'a2', kind: 'pod', label: 'a2', namespace: 'ns-a' },
    { id: 'b1', kind: 'pod', label: 'b1', namespace: 'ns-b' },
  ];
  const nsEdges: TopologySnapshot['edges'] = [
    { id: 'x1', source: 'a1', target: 'b1', metrics: { DATA_TRANSFERRED: 2 * GB, RETRANSMISSIONS: 30 }, category: 'INTER_AZ' },
    { id: 'x2', source: 'a2', target: 'b1', metrics: { DATA_TRANSFERRED: 1 * GB, RETRANSMISSIONS: 20 }, category: 'INTER_AZ' },
    { id: 'i1', source: 'a1', target: 'a2', metrics: { DATA_TRANSFERRED: 5e8, RETRANSMISSIONS: 1 }, category: 'INTRA_AZ' },
  ];
  const nsTopo: TopologySnapshot = { generatedAt: '2026-07-12T00:00:00Z', nodes: nsNodes, edges: nsEdges };

  it("groupBy:'none' (and the default) is byte-identical to omitting the option", () => {
    const withNone = buildGraphModel(nsTopo, { groupBy: 'none' });
    const without = buildGraphModel(nsTopo);
    expect(withNone).toEqual(without);
    // No node carries a group field in the ungrouped model.
    for (const n of without.nodes) expect(n.group).toBeUndefined();
  });

  it('collapses members into 2 group nodes with correct memberCount + one aggregate cross-ns edge', () => {
    const m = buildGraphModel(nsTopo, { groupBy: 'namespace' });
    // 2 group nodes, emitted at first-member position → ns-a before ns-b.
    expect(m.nodes.map((n) => n.id)).toEqual(['group:namespace:ns-a', 'group:namespace:ns-b']);
    const a = m.nodes[0];
    const b = m.nodes[1];
    expect(a.group).toEqual({ key: 'ns-a', kind: 'group', memberCount: 2, expanded: false });
    expect(b.group).toEqual({ key: 'ns-b', kind: 'group', memberCount: 1, expanded: false });
    // Exactly one cross-group edge (x1+x2 aggregated); the intra-ns-a edge is a self-loop, not a link.
    expect(m.links).toHaveLength(1);
    const link = m.links[0];
    expect(link.source).toBe('group:namespace:ns-a');
    expect(link.target).toBe('group:namespace:ns-b');
    // DATA_TRANSFERRED summed (2GB + 1GB) → link value under the default metric.
    expect(link.value).toBe(3 * GB);
  });

  it('sums metrics across constituent edges (RETRANSMISSIONS) and re-derives health from summed retrans/GB', () => {
    // 50 retrans over 3 GB → 16.7/GB ≥ 10 → danger.
    const danger = buildGraphModel(nsTopo, { groupBy: 'namespace' });
    expect(danger.links[0].health).toBe('danger');
    // Selecting RETRANSMISSIONS exposes the summed count as the link value.
    const retrans = buildGraphModel(nsTopo, { groupBy: 'namespace', metric: 'RETRANSMISSIONS' });
    expect(retrans.links[0].value).toBe(50);
    // Health is unaffected by the selected metric — still danger from retrans/GB.
    expect(retrans.links[0].health).toBe('danger');
  });

  it('folds intra-group traffic into the group node self-loop (no intra link)', () => {
    const twoInOneNs: TopologySnapshot = {
      generatedAt: '',
      nodes: [
        { id: 'p1', kind: 'pod', label: 'p1', namespace: 'ns-a' },
        { id: 'p2', kind: 'pod', label: 'p2', namespace: 'ns-a' },
      ],
      edges: [{ id: 'e', source: 'p1', target: 'p2', metrics: { DATA_TRANSFERRED: 7 * GB }, category: 'INTRA_AZ' }],
    };
    const m = buildGraphModel(twoInOneNs, { groupBy: 'namespace' });
    expect(m.nodes).toHaveLength(1);
    expect(m.links).toHaveLength(0);
    expect(m.nodes[0].id).toBe('group:namespace:ns-a');
    expect(m.nodes[0].selfBytes).toBe(7 * GB);
    // In nsTopo, the ns-a group's self-loop carries the intra a1→a2 edge (5e8).
    const grouped = buildGraphModel(nsTopo, { groupBy: 'namespace' });
    expect(grouped.nodes.find((n) => n.id === 'group:namespace:ns-a')!.selfBytes).toBe(5e8);
  });

  it('expanding one group re-shows its members + intra-edges while the other stays collapsed', () => {
    const m = buildGraphModel(nsTopo, { groupBy: 'namespace', expandedGroups: new Set(['ns-a']) });
    const ids = m.nodes.map((n) => n.id).sort();
    // ns-a expanded to members; ns-b still a collapsed group node.
    expect(ids).toEqual(['a1', 'a2', 'group:namespace:ns-b']);
    expect(m.nodes.find((n) => n.id === 'a1')!.group).toBeUndefined();
    expect(m.nodes.find((n) => n.id === 'group:namespace:ns-b')!.group).toEqual({
      key: 'ns-b', kind: 'group', memberCount: 1, expanded: false,
    });
    // Links: intra a1↔a2, plus a1↔ns-b and a2↔ns-b (each cross edge kept separate now).
    const pairs = m.links.map((l) => [l.source, l.target].sort().join('|')).sort();
    expect(pairs).toEqual([
      'a1|a2',
      'a1|group:namespace:ns-b',
      'a2|group:namespace:ns-b',
    ]);
  });

  it("accepts expandedGroups as a string[] and expands the same way", () => {
    const asArray = buildGraphModel(nsTopo, { groupBy: 'namespace', expandedGroups: ['ns-a'] });
    const asSet = buildGraphModel(nsTopo, { groupBy: 'namespace', expandedGroups: new Set(['ns-a']) });
    expect(asArray).toEqual(asSet);
  });

  it("buckets nodes missing the grouped field into the 'unknown' group", () => {
    const mixed: TopologySnapshot = {
      generatedAt: '',
      nodes: [
        { id: 'p1', kind: 'pod', label: 'p1', namespace: 'ns-a' },
        { id: 'p2', kind: 'pod', label: 'p2' }, // no namespace
      ],
      edges: [{ id: 'e', source: 'p1', target: 'p2', metrics: { DATA_TRANSFERRED: GB }, category: 'INTER_AZ' }],
    };
    const m = buildGraphModel(mixed, { groupBy: 'namespace' });
    expect(m.nodes.map((n) => n.id)).toEqual(['group:namespace:ns-a', 'group:namespace:unknown']);
    expect(m.nodes.find((n) => n.id === 'group:namespace:unknown')!.group!.key).toBe('unknown');
    expect(m.links).toHaveLength(1);
  });

  it('averages ROUND_TRIP_TIME weighted by bytes across aggregated edges', () => {
    // rtt 10 over 3GB and rtt 20 over 1GB → weighted (10·3 + 20·1)/4 = 12.5.
    const rttTopo: TopologySnapshot = {
      generatedAt: '',
      nodes: [
        { id: 'a1', kind: 'pod', label: 'a1', namespace: 'ns-a' },
        { id: 'a2', kind: 'pod', label: 'a2', namespace: 'ns-a' },
        { id: 'b1', kind: 'pod', label: 'b1', namespace: 'ns-b' },
      ],
      edges: [
        { id: 'x1', source: 'a1', target: 'b1', metrics: { DATA_TRANSFERRED: 3 * GB, ROUND_TRIP_TIME: 10 }, category: 'INTER_AZ' },
        { id: 'x2', source: 'a2', target: 'b1', metrics: { DATA_TRANSFERRED: 1 * GB, ROUND_TRIP_TIME: 20 }, category: 'INTER_AZ' },
      ],
    };
    const m = buildGraphModel(rttTopo, { groupBy: 'namespace', metric: 'ROUND_TRIP_TIME' });
    expect(m.links).toHaveLength(1);
    expect(m.links[0].value).toBeCloseTo(12.5, 6);
  });

  it('groups by az and cluster off the corresponding TopoNode fields', () => {
    const azTopo: TopologySnapshot = {
      generatedAt: '',
      nodes: [
        { id: 'p1', kind: 'pod', label: 'p1', az: 'az-1', cluster: 'c1' },
        { id: 'p2', kind: 'pod', label: 'p2', az: 'az-2', cluster: 'c1' },
      ],
      edges: [{ id: 'e', source: 'p1', target: 'p2', metrics: { DATA_TRANSFERRED: GB }, category: 'INTER_AZ' }],
    };
    const byAz = buildGraphModel(azTopo, { groupBy: 'az' });
    expect(byAz.nodes.map((n) => n.id)).toEqual(['group:az:az-1', 'group:az:az-2']);
    expect(byAz.links).toHaveLength(1); // cross-AZ aggregate edge
    // Same nodes collapse to ONE cluster group (both in c1) → intra self-loop, no link.
    const byCluster = buildGraphModel(azTopo, { groupBy: 'cluster' });
    expect(byCluster.nodes.map((n) => n.id)).toEqual(['group:cluster:c1']);
    expect(byCluster.links).toHaveLength(0);
    expect(byCluster.nodes[0].selfBytes).toBe(GB);
  });
});
