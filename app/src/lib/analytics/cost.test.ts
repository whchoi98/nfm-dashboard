import { it, expect } from 'vitest';
import { bytesToUsd, costLens } from './cost';
import type { FlowEdge } from '../types';

it('bytesToUsd bills only inter-az/vpc/region', () => {
  expect(bytesToUsd(1e9,'INTER_AZ')).toBeCloseTo(0.01);
  expect(bytesToUsd(1e9,'INTER_VPC')).toBeCloseTo(0.01);
  expect(bytesToUsd(1e9,'INTER_REGION')).toBeCloseTo(0.01);
  expect(bytesToUsd(1e9,'INTRA_AZ')).toBe(0);
  expect(bytesToUsd(1e9,'AMAZON_S3')).toBe(0);
});
it('costLens totals + region arcs', () => {
  const flows = [
    { metric:'DATA_TRANSFERRED', category:'INTER_AZ', bucket:'b1', value:2e9, a:{az:'a'}, b:{az:'b'} },
    { metric:'DATA_TRANSFERRED', category:'INTER_REGION', bucket:'b1', value:1e9,
      a:{region:'ap-northeast-2'}, b:{region:'us-east-1'} },
    { metric:'DATA_TRANSFERRED', category:'INTRA_AZ', bucket:'b1', value:5e9, a:{az:'a'}, b:{az:'a'} },
  ] as any;
  const c = costLens(flows);
  expect(c.totalUsd).toBeCloseTo(0.03);  // 2e9*.01 + 1e9*.01 (intra=0)
  expect(c.regionArcs).toContainEqual(expect.objectContaining({ from:'ap-northeast-2', to:'us-east-1' }));
  expect(c.byCategory.INTER_AZ.usd).toBeCloseTo(0.02);
});
