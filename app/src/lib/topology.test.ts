// app/src/lib/topology.test.ts
import { it, expect } from 'vitest';
import { resourceKindOf, endpointKind, buildHops, buildTiers, buildMatrix, rankEdges, resolveEdge, filterTopology } from './topology';
import type { FlowEdge, TopologySnapshot } from './types';

it('resourceKindOf maps component types', () => {
  expect(resourceKindOf('TransitGateway')).toBe('tgw');
  expect(resourceKindOf('NetworkInterface')).toBe('eni');
  expect(resourceKindOf('VpcEndpoint')).toBe('vpce');
  expect(resourceKindOf('Amazon CloudWatch Logs')).toBe('awsservice');
  expect(resourceKindOf(undefined)).toBe('other');
});
it('endpointKind prefers pod > instance > subnet > ip', () => {
  expect(endpointKind({ podName:'p', instanceId:'i' })).toBe('pod');
  expect(endpointKind({ instanceId:'i' })).toBe('instance');
  expect(endpointKind({ ip:'1.1.1.1' })).toBe('other');
});
it('buildHops chains endpoint→traversed→endpoint', () => {
  const edge = { edgeHash:'e', a:{ podName:'api-1', podNamespace:'shop', az:'az1' },
    b:{ instanceId:'i-2', az:'az2' }, traversedConstructs:[{ componentType:'TransitGateway', componentId:'tgw-1' }] } as any as FlowEdge;
  const hops = buildHops(edge);
  expect(hops.map(h=>h.kind)).toEqual(['pod','tgw','instance']);
  expect(hops[0].label).toBe('shop/api-1'); expect(hops[1].id).toBe('tgw-1'); expect(hops[2].label).toBe('i-2');
});
it('buildTiers aggregates to namespace + drops self-links', () => {
  const topo: TopologySnapshot = { generatedAt:'', nodes:[
    { id:'pod:shop/api', kind:'pod', label:'api', namespace:'shop' },
    { id:'pod:shop/db', kind:'pod', label:'db', namespace:'shop' },
    { id:'pod:mon/g', kind:'pod', label:'g', namespace:'mon' } ], edges:[
    { id:'e1', source:'pod:shop/api', target:'pod:mon/g', metrics:{ DATA_TRANSFERRED:100 }, category:'INTER_AZ' },
    { id:'e2', source:'pod:shop/api', target:'pod:shop/db', metrics:{ DATA_TRANSFERRED:50 }, category:'INTRA_AZ' } ] };
  const { nodes, links } = buildTiers(topo, 'namespace');
  expect(nodes.map(n=>n.id).sort()).toEqual(['mon','shop']);
  expect(links).toHaveLength(1);            // shop↔mon; shop↔shop self-link dropped
  expect(links[0].bytes).toBe(100);
});
it('rankEdges desc by metric', () => {
  const topo = { generatedAt:'', nodes:[], edges:[
    { id:'a', source:'x', target:'y', metrics:{ DATA_TRANSFERRED:10 }, category:'INTRA_AZ' },
    { id:'b', source:'x', target:'z', metrics:{ DATA_TRANSFERRED:99 }, category:'INTRA_AZ' } ] } as any;
  expect(rankEdges(topo,'DATA_TRANSFERRED',1)[0].id).toBe('b');
});
it('filterTopology scopes by cluster (both endpoints) and by edge category', () => {
  const topo: TopologySnapshot = { generatedAt:'', nodes:[
    { id:'pod:shop/api', kind:'pod', label:'api', namespace:'shop', cluster:'c1' },
    { id:'pod:shop/db', kind:'pod', label:'db', namespace:'shop', cluster:'c1' },
    { id:'pod:mon/g', kind:'pod', label:'g', namespace:'mon', cluster:'c2' } ], edges:[
    { id:'e1', source:'pod:shop/api', target:'pod:mon/g', metrics:{ DATA_TRANSFERRED:100 }, category:'INTER_AZ' },
    { id:'e2', source:'pod:shop/api', target:'pod:shop/db', metrics:{ DATA_TRANSFERRED:50 }, category:'INTRA_AZ' } ] };
  expect(filterTopology(topo, '', '')).toBe(topo); // no filter → same reference
  const byCluster = filterTopology(topo, 'c1', '');
  expect(byCluster.nodes.map(n=>n.id)).toEqual(['pod:shop/api','pod:shop/db']);
  expect(byCluster.edges.map(e=>e.id)).toEqual(['e2']); // e1 crosses out of c1 → dropped
  const byCategory = filterTopology(topo, '', 'INTER_AZ');
  expect(byCategory.nodes).toHaveLength(3);             // nodes kept as-is
  expect(byCategory.edges.map(e=>e.id)).toEqual(['e1']);
  expect(filterTopology(topo, 'c1', 'INTER_AZ').edges).toHaveLength(0); // combined
});
it('resolveEdge picks the heaviest underlying edge for an aggregated pair', () => {
  const topo: TopologySnapshot = { generatedAt:'', nodes:[
    { id:'pod:shop/api', kind:'pod', label:'api', namespace:'shop' },
    { id:'pod:shop/db', kind:'pod', label:'db', namespace:'shop' },
    { id:'pod:mon/g', kind:'pod', label:'g', namespace:'mon' } ], edges:[
    { id:'e1', source:'pod:shop/api', target:'pod:mon/g', metrics:{ DATA_TRANSFERRED:100 }, category:'INTER_AZ' },
    { id:'e2', source:'pod:shop/db', target:'pod:mon/g', metrics:{ DATA_TRANSFERRED:900 }, category:'INTRA_AZ' } ] };
  expect(resolveEdge(topo, 'namespace', 'shop', 'mon', 'DATA_TRANSFERRED')?.id).toBe('e2');
  expect(resolveEdge(topo, 'namespace', 'mon', 'shop', 'DATA_TRANSFERRED')).toBeNull(); // direction matters
});
