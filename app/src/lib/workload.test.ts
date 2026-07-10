import { describe, expect, it } from 'vitest';
import type { WiResult } from './types';
import { contributorLabel, contributorRows, presentCategories, regionFromAz } from './workload';

const wi = (metric: string, category: string, values: number[]): WiResult => ({
  metric,
  category,
  rows: values.map((value, i) => ({
    localSubnetId: `subnet-${category.toLowerCase()}-${i}`,
    localAz: 'ap-northeast-2a',
    localVpcId: 'vpc-1',
    accountId: '111122223333',
    remoteIdentifier: `remote-${i}`,
    value,
  })),
});

const RESULTS: WiResult[] = [
  wi('DATA_TRANSFERRED', 'INTER_AZ', [10, 300]),
  wi('DATA_TRANSFERRED', 'INTRA_AZ', [200]),
  wi('RETRANSMISSIONS', 'INTER_VPC', [5]),
  { metric: 'TIMEOUTS', category: 'AMAZON_S3', rows: [] }, // empty → not "present"
];

describe('presentCategories', () => {
  it('returns only categories with rows, in CATEGORY_ORDER', () => {
    expect(presentCategories(RESULTS)).toEqual(['INTRA_AZ', 'INTER_AZ', 'INTER_VPC']);
  });

  it('appends unknown categories alphabetically and handles empty input', () => {
    expect(presentCategories([])).toEqual([]);
    const withUnknown = [...RESULTS, wi('TIMEOUTS', 'ZZ_NEW', [1])];
    expect(presentCategories(withUnknown)).toEqual(['INTRA_AZ', 'INTER_AZ', 'INTER_VPC', 'ZZ_NEW']);
  });
});

describe('contributorRows', () => {
  it('filters by metric, tags category and sorts by value desc', () => {
    const rows = contributorRows(RESULTS, 'DATA_TRANSFERRED');
    expect(rows.map((r) => r.value)).toEqual([300, 200, 10]);
    expect(rows.map((r) => r.category)).toEqual(['INTER_AZ', 'INTRA_AZ', 'INTER_AZ']);
  });

  it('filters by category when one is selected ("all"/"" mean every category)', () => {
    expect(contributorRows(RESULTS, 'DATA_TRANSFERRED', 'INTRA_AZ')).toHaveLength(1);
    expect(contributorRows(RESULTS, 'DATA_TRANSFERRED', 'all')).toHaveLength(3);
    expect(contributorRows(RESULTS, 'ROUND_TRIP_TIME')).toEqual([]);
  });

  it('treats missing values as 0 when sorting', () => {
    const sparse: WiResult[] = [
      { metric: 'TIMEOUTS', category: 'INTER_AZ', rows: [{ localSubnetId: 'a' }, { localSubnetId: 'b', value: 7 }] },
    ];
    expect(contributorRows(sparse, 'TIMEOUTS').map((r) => r.localSubnetId)).toEqual(['b', 'a']);
  });
});

describe('contributorLabel', () => {
  it('prefers subnet, then remote resource, then account', () => {
    expect(contributorLabel({ localSubnetId: 's-1', remoteIdentifier: 'r-1', accountId: 'a-1' })).toBe('s-1');
    expect(contributorLabel({ remoteIdentifier: 'r-1', accountId: 'a-1' })).toBe('r-1');
    expect(contributorLabel({ accountId: 'a-1' })).toBe('a-1');
    expect(contributorLabel({})).toBe('—');
  });
});

describe('regionFromAz', () => {
  it('derives the region from an AZ name', () => {
    expect(regionFromAz('ap-northeast-2a')).toBe('ap-northeast-2');
    expect(regionFromAz('us-east-1b')).toBe('us-east-1');
    expect(regionFromAz('us-gov-west-1a')).toBe('us-gov-west-1');
  });

  it('returns undefined for AZ IDs and missing input', () => {
    expect(regionFromAz('apne2-az1')).toBeUndefined();
    expect(regionFromAz(undefined)).toBeUndefined();
    expect(regionFromAz('')).toBeUndefined();
  });
});
