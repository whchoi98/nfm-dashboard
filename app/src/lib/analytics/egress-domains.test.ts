import { describe, it, expect } from 'vitest';
import { egressByDomain } from './egress-domains';
import type { FlowEdge } from '../types';

const inet = (ip: string, value: number): FlowEdge => ({
  edgeHash: ip, monitor: 'm', metric: 'DATA_TRANSFERRED', category: 'INTERNET',
  bucket: 'b', value, unit: 'Bytes', a: {}, b: { ip }, traversedConstructs: [],
});

describe('egressByDomain', () => {
  it('maps external IPs to domains, sums bytes+usd, buckets unmapped as unresolved, desc by usd', () => {
    const nameFlow = [{ ip: '52.1.2.3', name: 's3.ap-northeast-2.amazonaws.com' }];
    const rows = egressByDomain(
      [inet('52.1.2.3', 2e9), inet('52.1.2.3', 1e9), inet('9.9.9.9', 5e8)],
      nameFlow,
    );
    expect(rows[0]).toMatchObject({ domain: 's3.ap-northeast-2.amazonaws.com', bytes: 3e9 });
    expect(rows[0].usd).toBeCloseTo(3 * 0.09, 5);
    expect(rows.find((r) => r.domain === 'unresolved')).toMatchObject({ bytes: 5e8 });
  });
  it('ignores non-INTERNET and non-DATA_TRANSFERRED flows', () => {
    const f: FlowEdge = { ...inet('52.1.2.3', 1e9), category: 'INTRA_AZ' };
    expect(egressByDomain([f], [{ ip: '52.1.2.3', name: 'x.com' }])).toEqual([]);
  });
});
