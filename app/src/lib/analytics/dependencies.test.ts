// app/src/lib/analytics/dependencies.test.ts
import { it, expect } from 'vitest';
import { paretoTalkers, hopUsage, dependenciesLens } from './dependencies';
import type { FlowEdge } from '../types';

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
it('dependenciesLens shape', () => {
  const l = dependenciesLens([{metric:'DATA_TRANSFERRED',value:1,a:{podNamespace:'n',serviceName:'a'},b:{podNamespace:'n',serviceName:'b'},traversedConstructs:[]}] as any);
  expect(l.sankey.nodes.length).toBeGreaterThan(0);
  expect(Array.isArray(l.pareto)).toBe(true);
  expect(l.pathTree.name).toBe('all');
});
