import { describe, it, expect } from 'vitest';
import { flowItem, buildTopology } from './storage.js';
import type { FlowEdge } from './types.js';

const edge: FlowEdge = { edgeHash: 'abc', monitor: 'nfm-eks-demo', metric: 'DATA_TRANSFERRED',
  category: 'INTER_AZ', bucket: '2026-07-08T11:45:00Z', value: 100, unit: 'Bytes',
  a: { podName: 'api-1', podNamespace: 'shop', instanceId: 'i-aaa', az: 'az1' },
  b: { podName: 'db-0', podNamespace: 'shop', instanceId: 'i-bbb', az: 'az2' },
  targetPort: 5432, traversedConstructs: [] };

it('flowItem maps keys per schema', () => {
  const item = flowItem(edge, 1234567890);
  expect(item.pk).toBe('FLOW#2026-07-08T11:45:00Z#nfm-eks-demo');
  expect(item.sk).toBe('DATA_TRANSFERRED#INTER_AZ#abc');
  expect(item.gsi1pk).toBe('POD#shop/api-1');
  expect(item.gsi2pk).toBe('POD#shop/db-0');
  expect(item.gsi3pk).toBe('EDGE#abc');
  expect(item.gsi3sk).toBe('2026-07-08T11:45:00Z#DATA_TRANSFERRED');
  expect(item.ttl).toBe(1234567890);
});

it('flowItem omits pod GSIs for non-pod endpoints', () => {
  const e = { ...edge, a: { instanceId: 'i-x' }, b: { ip: '8.8.8.8' } };
  const item = flowItem(e as FlowEdge, 1);
  expect(item.gsi1pk).toBeUndefined();
  expect(item.gsi2pk).toBeUndefined();
});

it('buildTopology merges metrics per edge and classifies nodes', () => {
  const rtt = { ...edge, metric: 'ROUND_TRIP_TIME' as const, value: 900 };
  const topo = buildTopology([edge, rtt], { 'nfm-eks-demo': 'demo' }, '2026-07-08T11:50:00Z');
  expect(topo.nodes.find(n => n.id === 'pod:shop/api-1')?.kind).toBe('pod');
  expect(topo.nodes.find(n => n.id === 'pod:shop/api-1')?.cluster).toBe('demo');
  expect(topo.edges).toHaveLength(1);
  expect(topo.edges[0].metrics.DATA_TRANSFERRED).toBe(100);
  expect(topo.edges[0].metrics.ROUND_TRIP_TIME).toBe(900);
});
