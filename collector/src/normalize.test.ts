import { describe, it, expect } from 'vitest';
import { endpointKey, edgeHashOf, normalizeRow, dedupeEdges } from './normalize.js';

const ctx = { monitor: 'nfm-eks-demo', metric: 'DATA_TRANSFERRED' as const,
  category: 'INTER_AZ' as const, bucket: '2026-07-08T11:45:00Z', unit: 'Bytes' };
const row = {
  localIp: '10.0.1.10', localInstanceId: 'i-aaa', localSubnetId: 'subnet-a',
  localAz: 'apne2-az1', localVpcId: 'vpc-1', localRegion: 'ap-northeast-2',
  remoteIp: '10.0.2.20', remoteInstanceId: 'i-bbb', remoteSubnetId: 'subnet-b',
  remoteAz: 'apne2-az2', remoteVpcId: 'vpc-1', remoteRegion: 'ap-northeast-2',
  targetPort: 8080, value: 1234,
  traversedConstructs: [{ componentId: 'tgw-1', componentType: 'TransitGateway' }],
  kubernetesMetadata: { localPodName: 'api-1', localPodNamespace: 'shop',
    localServiceName: 'api', remotePodName: 'db-0', remotePodNamespace: 'shop',
    remoteServiceName: 'db' } };

it('endpointKey prefers pod > instance > ip', () => {
  expect(endpointKey({ podNamespace: 'shop', podName: 'api-1', instanceId: 'i-a', ip: 'x' }))
    .toBe('pod:shop/api-1');
  expect(endpointKey({ instanceId: 'i-a', ip: 'x' })).toBe('i:i-a');
  expect(endpointKey({ ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
});

it('edgeHash is direction-independent', () => {
  const a = { podNamespace: 'shop', podName: 'api-1' }, b = { podNamespace: 'shop', podName: 'db-0' };
  expect(edgeHashOf(a, b, 8080)).toBe(edgeHashOf(b, a, 8080));
  expect(edgeHashOf(a, b, 8080)).not.toBe(edgeHashOf(a, b, 9090));
});

it('normalizeRow maps row → FlowEdge with sorted endpoints', () => {
  const e = normalizeRow(row, ctx);
  expect(e.monitor).toBe('nfm-eks-demo');
  expect(e.a.podName).toBe('api-1');       // 'pod:shop/api-1' < 'pod:shop/db-0'
  expect(e.b.podName).toBe('db-0');
  expect(e.value).toBe(1234);
  expect(e.traversedConstructs[0].componentId).toBe('tgw-1');
  expect(e.edgeHash).toMatch(/^[0-9a-f]{40}$/);
});

it('normalizeRow keeps endpoint fields attached to the right side after sort', () => {
  const flipped = { ...row,
    kubernetesMetadata: { ...row.kubernetesMetadata,
      localPodName: 'db-0', remotePodName: 'api-1' } };
  const e = normalizeRow(flipped as never, ctx);
  expect(e.a.podName).toBe('api-1');
  expect(e.a.instanceId).toBe('i-bbb');    // api-1은 remote측이었으므로 remote 필드가 따라감
});

it('dedupeEdges keeps max value per (metric,category,edgeHash)', () => {
  const e1 = normalizeRow(row, ctx), e2 = { ...e1, value: 99 };
  expect(dedupeEdges([e1, e2])).toHaveLength(1);
  expect(dedupeEdges([e1, e2])[0].value).toBe(1234);
});
