import { describe, it, expect } from 'vitest';
import { entityKey, percentile, sumByMetric, groupBy, ratePerGb } from './aggregate';
import type { FlowEdge } from '../types';

it('entityKey by kind', () => {
  const e = { podNamespace:'shop', podName:'api-1', serviceName:'api', instanceId:'i-1', az:'az1', vpcId:'vpc-1' };
  expect(entityKey(e,'pod')).toBe('shop/api-1');
  expect(entityKey(e,'service')).toBe('shop/api');
  expect(entityKey(e,'namespace')).toBe('shop');
  expect(entityKey(e,'az')).toBe('az1');
  expect(entityKey(e,'vpc')).toBe('vpc-1');
  expect(entityKey({},'pod')).toBe('unknown');
});
it('percentile nearest-rank + empty', () => {
  expect(percentile([],50)).toBe(0);
  expect(percentile([1,2,3,4],50)).toBe(2);
  expect(percentile([1,2,3,4],100)).toBe(4);
});
it('sumByMetric filters by metric', () => {
  const f = [{metric:'TIMEOUTS',value:3},{metric:'DATA_TRANSFERRED',value:10},{metric:'TIMEOUTS',value:2}] as FlowEdge[];
  expect(sumByMetric(f,'TIMEOUTS')).toBe(5);
});
it('groupBy', () => {
  const g = groupBy([{k:'a'},{k:'b'},{k:'a'}], x => x.k);
  expect(g.get('a')).toHaveLength(2);
});

describe('ratePerGb', () => {
  it('events per GB with 0-division guard', () => {
    expect(ratePerGb(0, 0)).toBe(0);
    expect(ratePerGb(10, 0)).toBe(0);
    expect(ratePerGb(5, 1e9)).toBeCloseTo(5, 6);   // 5 events over 1 GB
    expect(ratePerGb(2, 5e8)).toBeCloseTo(4, 6);   // 2 events over 0.5 GB
  });
});
