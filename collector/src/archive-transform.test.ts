import { describe, it, expect } from 'vitest';
import { marshall } from '@aws-sdk/util-dynamodb';
import { flattenFlowImage } from './archive-transform.js';
import { flowItem } from './storage.js';
import type { FlowEdge } from './types.js';

const edge: FlowEdge = { edgeHash: 'abc', monitor: 'nfm-eks-demo', metric: 'DATA_TRANSFERRED',
  category: 'INTER_AZ', bucket: '2026-07-08T11:45:00Z', value: 100, unit: 'Bytes',
  a: { podName: 'api-1', podNamespace: 'shop', instanceId: 'i-aaa', az: 'az1' },
  b: { podName: 'db-0', podNamespace: 'shop', instanceId: 'i-bbb', az: 'az2', vpcId: 'vpc-1',
    region: 'ap-northeast-2', serviceName: 'db-svc', ip: '10.0.0.2', subnetId: 'subnet-2' },
  targetPort: 5432, traversedConstructs: [{ componentType: 'TRANSIT_GATEWAY', componentId: 'tgw-1' }] };

function marshalledImage(e: FlowEdge, ttl = 1234567890) {
  return marshall(flowItem(e, ttl), { removeUndefinedValues: true });
}

describe('flattenFlowImage', () => {
  it('flattens a FLOW# NEW_IMAGE into a flat row with every column mapped', () => {
    const row = flattenFlowImage(marshalledImage(edge));
    expect(row).not.toBeNull();
    expect(row!.edge_hash).toBe('abc');
    expect(row!.monitor).toBe('nfm-eks-demo');
    expect(row!.metric).toBe('DATA_TRANSFERRED');
    expect(row!.category).toBe('INTER_AZ');
    expect(row!.bucket).toBe('2026-07-08T11:45:00Z');
    expect(row!.value).toBe(100);
    expect(typeof row!.value).toBe('number');
    expect(row!.unit).toBe('Bytes');
    expect(row!.a_pod_name).toBe('api-1');
    expect(row!.a_pod_namespace).toBe('shop');
    expect(row!.a_instance_id).toBe('i-aaa');
    expect(row!.a_az).toBe('az1');
    expect(row!.b_service_name).toBe('db-svc');
    expect(row!.b_az).toBe('az2');
    expect(row!.b_vpc_id).toBe('vpc-1');
    expect(row!.b_region).toBe('ap-northeast-2');
    expect(row!.b_ip).toBe('10.0.0.2');
    expect(row!.b_subnet_id).toBe('subnet-2');
    expect(row!.target_port).toBe(5432);
    expect(typeof row!.target_port).toBe('number');
    expect(row!.traversed_constructs).toBe(JSON.stringify(edge.traversedConstructs));
    expect(row!.dt).toBe('2026-07-08');
  });

  it('defaults missing optional endpoint/snat/dnat fields to empty string, never undefined', () => {
    const row = flattenFlowImage(marshalledImage(edge));
    // edge.a has no serviceName/vpcId/region/ip/subnetId, and no snatIp/dnatIp anywhere
    expect(row!.a_service_name).toBe('');
    expect(row!.a_vpc_id).toBe('');
    expect(row!.a_region).toBe('');
    expect(row!.a_ip).toBe('');
    expect(row!.a_subnet_id).toBe('');
    expect(row!.snat_ip).toBe('');
    expect(row!.dnat_ip).toBe('');
    for (const v of Object.values(row!)) expect(v).not.toBeUndefined();
  });

  it('coerces target_port to 0 when absent from the edge', () => {
    const noPort: FlowEdge = { ...edge, targetPort: undefined };
    const row = flattenFlowImage(marshalledImage(noPort));
    expect(row!.target_port).toBe(0);
  });

  it('serializes traversedConstructs to "[]" when the edge has none', () => {
    const noConstructs: FlowEdge = { ...edge, traversedConstructs: [] };
    const row = flattenFlowImage(marshalledImage(noConstructs));
    expect(row!.traversed_constructs).toBe('[]');
  });

  it('returns null for a non-FLOW image (e.g. STATUS#collect)', () => {
    const image = marshall({ pk: 'STATUS#collect', sk: 'latest', cycleTs: '2026-07-08T11:45:00Z' });
    expect(flattenFlowImage(image)).toBeNull();
  });

  it('returns null when pk is missing entirely', () => {
    const image = marshall({ sk: 'no-pk-here' });
    expect(flattenFlowImage(image)).toBeNull();
  });

  it('excludes HFLOW hourly rollup rows from the Parquet archive', () => {
    const image = marshall({ pk: 'HFLOW#2026-07-15T03:00:00Z#m1',
      sk: 'DATA_TRANSFERRED#INTER_AZ#e1', edgeHash: 'e1', monitor: 'm1',
      metric: 'DATA_TRANSFERRED', category: 'INTER_AZ',
      bucket: '2026-07-15T03:00:00Z', value: 1, unit: 'Bytes' });
    expect(flattenFlowImage(image as never)).toBeNull();
  });
});
