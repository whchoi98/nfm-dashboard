// app/src/lib/analytics/dependencies.test.ts
import { it, expect } from 'vitest';
import { paretoTalkers, hopUsage, pathFrequencyTree, dependenciesLens, serviceGraph } from './dependencies';
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
it('dependenciesLens shape', () => {
  const l = dependenciesLens([{metric:'DATA_TRANSFERRED',value:1,a:{podNamespace:'n',serviceName:'a'},b:{podNamespace:'n',serviceName:'b'},traversedConstructs:[]}] as any);
  expect(l.sankey.nodes.length).toBeGreaterThan(0);
  expect(Array.isArray(l.pareto)).toBe(true);
  expect(l.pathTree.name).toBe('all');
});
