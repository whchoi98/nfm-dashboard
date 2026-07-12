// TDD for neighbors() (Phase 14 Task 2) — pure ego-network computation for
// NetworkGraph's click-to-isolate focus mode. Directionless BFS over
// {id,source,target} edges out to `hops` rings, then the edge set is the
// INDUCED subgraph over the discovered nodes (every edge whose both
// endpoints made it into the ring, not just center-to-neighbor spokes) —
// so isolating a node shows a clean, fully-connected ego view instead of a
// star with gaps between its neighbors.
import { describe, expect, it } from 'vitest';
import { neighbors, type EdgeLike } from './graph-focus';

describe('neighbors', () => {
  // a -- b            (e1)
  // a -- c            (e2)
  // b -- c            (e4)  — connects two 1-hop neighbors of a
  // c -- d            (e3)  — only reachable at 2 hops from a
  const edges: EdgeLike[] = [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'a', target: 'c' },
    { id: 'e4', source: 'b', target: 'c' },
    { id: 'e3', source: 'c', target: 'd' },
  ];

  it('1-hop returns the node + direct neighbors + all edges among them (induced subgraph)', () => {
    const r = neighbors(edges, 'a', 1);
    expect(r.nodeIds).toEqual(new Set(['a', 'b', 'c']));
    // e4 (b-c) is included even though neither end is 'a' — both ends are
    // in the 1-hop node set, so the induced edge set includes it.
    expect(r.edgeIds).toEqual(new Set(['e1', 'e2', 'e4']));
  });

  it('2-hop extends one more ring (and its induced edges)', () => {
    const r = neighbors(edges, 'a', 2);
    expect(r.nodeIds).toEqual(new Set(['a', 'b', 'c', 'd']));
    expect(r.edgeIds).toEqual(new Set(['e1', 'e2', 'e4', 'e3']));
  });

  it('an unknown node id (not present in any edge) returns just itself, no edges', () => {
    const r = neighbors(edges, 'nope', 1);
    expect(r.nodeIds).toEqual(new Set(['nope']));
    expect(r.edgeIds).toEqual(new Set());
  });

  it('a disconnected node (present in the graph but no edges) returns just itself', () => {
    const withIsolated: EdgeLike[] = [...edges, ];
    const r = neighbors(withIsolated, 'z', 2);
    expect(r.nodeIds).toEqual(new Set(['z']));
    expect(r.edgeIds).toEqual(new Set());
  });

  it('is directionless: matches a node whether it is the edge source or target', () => {
    const e: EdgeLike[] = [{ id: 'e1', source: 'x', target: 'y' }];
    // 'y' is only ever a target — must still discover 'x' as a neighbor.
    const fromTarget = neighbors(e, 'y', 1);
    expect(fromTarget.nodeIds).toEqual(new Set(['x', 'y']));
    expect(fromTarget.edgeIds).toEqual(new Set(['e1']));
    // and symmetrically from the source side.
    const fromSource = neighbors(e, 'x', 1);
    expect(fromSource.nodeIds).toEqual(new Set(['x', 'y']));
    expect(fromSource.edgeIds).toEqual(new Set(['e1']));
  });

  it('does not expand past the requested hop count even when more rings exist', () => {
    const chain: EdgeLike[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
      { id: 'e3', source: 'c', target: 'd' },
    ];
    const r = neighbors(chain, 'a', 1);
    expect(r.nodeIds).toEqual(new Set(['a', 'b']));
    expect(r.edgeIds).toEqual(new Set(['e1']));
    // 'd' is 3 hops away — still absent even at hops=2.
    const r2 = neighbors(chain, 'a', 2);
    expect(r2.nodeIds).toEqual(new Set(['a', 'b', 'c']));
    expect(r2.edgeIds).toEqual(new Set(['e1', 'e2']));
  });

  it('ignores self-loop edges for traversal but still reports them when both ends are in range', () => {
    const withSelfLoop: EdgeLike[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'self', source: 'a', target: 'a' },
    ];
    const r = neighbors(withSelfLoop, 'a', 1);
    expect(r.nodeIds).toEqual(new Set(['a', 'b']));
    expect(r.edgeIds).toEqual(new Set(['e1', 'self']));
  });

  it('empty edge list returns just the requested node', () => {
    const r = neighbors([], 'solo', 1);
    expect(r.nodeIds).toEqual(new Set(['solo']));
    expect(r.edgeIds).toEqual(new Set());
  });
});
