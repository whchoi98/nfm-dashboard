import { it, expect } from 'vitest';
import { flowAggregates } from './flow-aggregates';
import type { FlowEdge } from './types';

const flow = (over: Partial<FlowEdge>): FlowEdge => ({
  edgeHash: 'h', monitor: 'm', metric: 'DATA_TRANSFERRED', category: 'INTRA_AZ',
  bucket: 'b1', value: 0, unit: 'Bytes', a: {}, b: {}, traversedConstructs: [],
  ...over,
});

it('aggregates DATA_TRANSFERRED bytes per local endpoint (a), sorted desc', () => {
  const r = flowAggregates([
    flow({ value: 100, a: { podNamespace: 'default', podName: 'web-1' } }),
    flow({ value: 50, a: { podNamespace: 'default', podName: 'web-1' } }),
    flow({ value: 300, a: { ip: '10.0.0.9' } }),
  ]);
  expect(r.topTalkers).toEqual([
    { label: '10.0.0.9', value: 300 },
    { label: 'default/web-1', value: 150 },
  ]);
});

it('labels endpoints pod ns/name > serviceName > ip > instanceId > unknown', () => {
  const r = flowAggregates([
    flow({ value: 5, a: { podName: 'p', ip: '1.1.1.1' } }),
    flow({ value: 4, a: { serviceName: 'svc-a', ip: '2.2.2.2' } }),
    flow({ value: 3, a: { instanceId: 'i-0abc' } }),
    flow({ value: 2, a: {} }),
  ]);
  expect(r.topTalkers.map((t) => t.label)).toEqual(['unknown/p', 'svc-a', 'i-0abc', 'unknown']);
});

it('caps top talkers at n (default 8)', () => {
  const flows = Array.from({ length: 10 }, (_, i) =>
    flow({ value: i + 1, a: { ip: `10.0.0.${i}` } }),
  );
  const r = flowAggregates(flows);
  expect(r.topTalkers).toHaveLength(8);
  expect(r.topTalkers[0].value).toBe(10);
  expect(r.topTalkers[7].value).toBe(3);
  expect(flowAggregates(flows, 2).topTalkers).toHaveLength(2);
});

it('sums bytes per category with every DestCategory key present (0-filled)', () => {
  const r = flowAggregates([
    flow({ value: 5, category: 'INTER_AZ' }),
    flow({ value: 7, category: 'INTER_AZ' }),
    flow({ value: 3, category: 'AMAZON_S3' }),
  ]);
  expect(r.byCategory.INTER_AZ).toBe(12);
  expect(r.byCategory.AMAZON_S3).toBe(3);
  expect(r.byCategory.INTRA_AZ).toBe(0);
  expect(r.byCategory.INTER_VPC).toBe(0);
  expect(r.byCategory.INTER_REGION).toBe(0);
  expect(r.byCategory.AMAZON_DYNAMODB).toBe(0);
  expect(r.byCategory.UNCLASSIFIED).toBe(0);
});

it('ignores non-DATA_TRANSFERRED rows entirely', () => {
  const r = flowAggregates([
    flow({ value: 10, category: 'INTER_AZ', a: { ip: '10.0.0.1' } }),
    flow({ metric: 'RETRANSMISSIONS', value: 999, category: 'INTER_AZ', a: { ip: '10.0.0.2' } }),
    flow({ metric: 'ROUND_TRIP_TIME', value: 5000, category: 'INTRA_AZ', a: { ip: '10.0.0.3' } }),
    flow({ metric: 'TIMEOUTS', value: 42, category: 'AMAZON_S3', a: { ip: '10.0.0.4' } }),
  ]);
  expect(r.topTalkers).toEqual([{ label: '10.0.0.1', value: 10 }]);
  expect(r.byCategory.INTER_AZ).toBe(10);
  expect(r.byCategory.INTRA_AZ).toBe(0);
  expect(r.byCategory.AMAZON_S3).toBe(0);
});

it('empty input -> no talkers, all-zero categories', () => {
  const r = flowAggregates([]);
  expect(r.topTalkers).toEqual([]);
  expect(Object.values(r.byCategory).every((v) => v === 0)).toBe(true);
});
