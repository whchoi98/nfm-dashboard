// app/src/lib/analytics/dependencies.test.ts
import { it, expect } from 'vitest';
import {
  paretoTalkers, hopUsage, pathFrequencyTree, dependenciesLens, serviceGraph,
  capSankeyLinks, capPathTreeBreadth, concentration, SANKEY_MAX_LINKS, PATH_TREE_MAX_CHILDREN,
  type SankeyData, type PathNode,
} from './dependencies';
import type { FlowEdge } from '../types';

it('serviceGraph collapses mutual a→b/b→a into ONE deterministic link (bytes summed)', () => {
  const flow = (src: string, dst: string, value: number) => ({
    metric: 'DATA_TRANSFERRED', value,
    a: { podNamespace: 'n', serviceName: src },
    b: { podNamespace: 'n', serviceName: dst },
  });
  // Same mutual traffic in both scan orders — output must be identical either way.
  const forward = serviceGraph([flow('a', 'b', 3), flow('b', 'a', 5)] as any);
  const reverse = serviceGraph([flow('b', 'a', 5), flow('a', 'b', 3)] as any);
  for (const g of [forward, reverse]) {
    expect(g.links).toHaveLength(1);
    const [link] = g.links;
    expect(link.value).toBe(8);
    // Deterministic orientation: source = lexicographically smaller node name.
    expect(g.nodes[link.source].name).toBe('n/a');
    expect(g.nodes[link.target].name).toBe('n/b');
  }
});

it('paretoTalkers cumulative %', () => {
  const flows = [
    { metric:'DATA_TRANSFERRED', value:90, a:{podNamespace:'n',serviceName:'a'}, b:{podNamespace:'n',serviceName:'z'} },
    { metric:'DATA_TRANSFERRED', value:10, a:{podNamespace:'n',serviceName:'b'}, b:{podNamespace:'n',serviceName:'z'} },
  ] as any;
  const p = paretoTalkers(flows,'service');
  expect(p[0].cumulativePct).toBeCloseTo(90, 0);
  expect(p[p.length-1].cumulativePct).toBeCloseTo(100, 0);
});
it('hopUsage counts componentType, OTHER for missing', () => {
  const flows = [
    { metric:'DATA_TRANSFERRED', value:1, a:{}, b:{}, traversedConstructs:[{componentType:'TransitGateway'},{}] },
  ] as any;
  const h = hopUsage(flows);
  expect(h.find(x=>x.type==='TransitGateway')!.count).toBe(1);
  expect(h.find(x=>x.type==='OTHER')!.count).toBe(1);
});
it('hopUsage/pathTree count each flow once (DATA_TRANSFERRED only)', () => {
  const flows = [
    { metric:'DATA_TRANSFERRED', value:10, a:{}, b:{}, traversedConstructs:[{componentType:'TransitGateway'}] },
    { metric:'RETRANSMISSIONS', value:1, a:{}, b:{}, traversedConstructs:[{componentType:'TransitGateway'}] },
  ] as any;
  expect(hopUsage(flows).find(h=>h.type==='TransitGateway')!.count).toBe(1);
  expect(pathFrequencyTree(flows).value).toBe(1);
});
const dt = (a: string, b: string, bytes: number): FlowEdge => ({ edgeHash: `${a}-${b}`, monitor: 'm',
  metric: 'DATA_TRANSFERRED', category: 'INTRA_AZ', bucket: 'x', value: bytes, unit: 'B',
  a: { serviceName: a }, b: { serviceName: b }, traversedConstructs: [] });
it('concentration: uniform → entropy≈1, gini≈0; dominated → entropy→0, topShare→1', () => {
  const uni = concentration([dt('a','b',100), dt('c','d',100), dt('e','f',100), dt('g','h',100)]);
  expect(uni.entropy).toBeCloseTo(1, 2);
  expect(uni.gini).toBeCloseTo(0, 2);
  expect(uni.topShare).toBeCloseTo(0.25, 2);
  const dom = concentration([dt('a','b',997), dt('c','d',1), dt('e','f',1), dt('g','h',1)]);
  expect(dom.entropy).toBeLessThan(0.2);
  expect(dom.topShare).toBeGreaterThan(0.99);
});
it('concentration: empty → zeros, no NaN', () => {
  const z = concentration([]);
  expect(z).toEqual({ entropy: 0, gini: 0, topShare: 0, n: 0 });
});
it('dependenciesLens shape', () => {
  const l = dependenciesLens([{metric:'DATA_TRANSFERRED',value:1,a:{podNamespace:'n',serviceName:'a'},b:{podNamespace:'n',serviceName:'b'},traversedConstructs:[]}] as any);
  expect(l.sankey.nodes.length).toBeGreaterThan(0);
  expect(Array.isArray(l.pareto)).toBe(true);
  expect(l.pathTree.name).toBe('all');
  // Legibility caps must NOT touch a small graph.
  expect(l.sankeyTruncated).toBe(false);
  expect(l.pathTreeTruncated).toBe(false);
});

// ---- Legibility caps (§16 polish) ------------------------------------------

/** Star graph: hub node 0 → spokes 1..n with value = spoke index. */
function starSankey(n: number): SankeyData {
  return {
    nodes: Array.from({ length: n + 1 }, (_, i) => ({ name: i === 0 ? 'hub' : `s${i}` })),
    links: Array.from({ length: n }, (_, i) => ({ source: 0, target: i + 1, value: i + 1 })),
  };
}

it('capSankeyLinks keeps the top-N links by value and only their nodes (reindexed)', () => {
  const capped = capSankeyLinks(starSankey(10), 3);
  expect(capped.truncated).toBe(true);
  expect(capped.data.links).toHaveLength(3);
  // Top 3 by value = spokes 10, 9, 8 (a subset of the original link values).
  expect(capped.data.links.map((l) => l.value).sort((a, b) => b - a)).toEqual([10, 9, 8]);
  // Only referenced nodes survive: hub + 3 spokes.
  expect(capped.data.nodes.map((n) => n.name).sort()).toEqual(['hub', 's10', 's8', 's9']);
  // Every remapped index is in range and every kept node is referenced by a kept link.
  const referenced = new Set<number>();
  for (const l of capped.data.links) {
    expect(Number.isInteger(l.source) && l.source >= 0 && l.source < capped.data.nodes.length).toBe(true);
    expect(Number.isInteger(l.target) && l.target >= 0 && l.target < capped.data.nodes.length).toBe(true);
    referenced.add(l.source);
    referenced.add(l.target);
  }
  expect(referenced.size).toBe(capped.data.nodes.length);
});

it('capSankeyLinks passes small graphs through unchanged (same reference)', () => {
  const small = starSankey(3);
  const out = capSankeyLinks(small, 3);
  expect(out.truncated).toBe(false);
  expect(out.data).toBe(small);
});

it('capSankeyLinks defaults to SANKEY_MAX_LINKS=40', () => {
  expect(SANKEY_MAX_LINKS).toBe(40);
  const out = capSankeyLinks(starSankey(60));
  expect(out.truncated).toBe(true);
  expect(out.data.links).toHaveLength(40);
});

it('capPathTreeBreadth keeps top-K children per level and flags truncation', () => {
  const wide: PathNode = {
    name: 'all',
    value: 100,
    children: Array.from({ length: 5 }, (_, i) => ({
      name: `hop${i}`,
      value: i + 1,
      children: Array.from({ length: 4 }, (_, j) => ({ name: `leaf${j}`, value: j + 1, children: [] })),
    })),
  };
  const out = capPathTreeBreadth(wide, 2);
  expect(out.truncated).toBe(true);
  const assertBreadth = (n: PathNode) => {
    expect(n.children.length).toBeLessThanOrEqual(2);
    n.children.forEach(assertBreadth);
  };
  assertBreadth(out.tree);
  // Top-K by value, original (first-insertion) order preserved among survivors.
  expect(out.tree.children.map((c) => c.name)).toEqual(['hop3', 'hop4']);
  expect(out.tree.children[0].children.map((c) => c.name)).toEqual(['leaf2', 'leaf3']);
  // Input tree is not mutated.
  expect(wide.children).toHaveLength(5);
  expect(wide.children[3].children).toHaveLength(4);
});

it('capPathTreeBreadth passes narrow trees through unchanged (same reference)', () => {
  const narrow: PathNode = {
    name: 'all', value: 2,
    children: [{ name: 'a', value: 2, children: [{ name: 'b', value: 1, children: [] }] }],
  };
  const out = capPathTreeBreadth(narrow, 2);
  expect(out.truncated).toBe(false);
  expect(out.tree).toBe(narrow);
  expect(PATH_TREE_MAX_CHILDREN).toBe(12);
});
