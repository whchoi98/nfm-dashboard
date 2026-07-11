import { describe, it, expect } from 'vitest';
import {
  internalExternalSplit,
  topNxdomainSources,
  rcodeBreakdown,
  topResolvers,
} from './dns-insights';
import type { DnsAggregate } from '../types';

const dom = (
  name: string,
  count: number,
  internal: boolean,
): DnsAggregate['topDomains'][number] => ({ name, count, internal });

const failure = (
  over: Partial<DnsAggregate['failures'][number]>,
): DnsAggregate['failures'][number] => ({
  key: 'k',
  label: 'k',
  nxdomain: 0,
  servfail: 0,
  total: 1,
  failRate: 0,
  ...over,
});

describe('internalExternalSplit', () => {
  it('sums query counts by the internal flag and computes internalPct 0..100', () => {
    const r = internalExternalSplit([
      dom('db.ns.svc.cluster.local', 30, true),
      dom('api.ns.svc.cluster.local', 10, true),
      dom('example.com', 60, false),
    ]);
    expect(r).toEqual({ internalCount: 40, externalCount: 60, internalPct: 40 });
  });

  it('all internal → 100, all external → 0', () => {
    expect(internalExternalSplit([dom('a.internal', 5, true)]).internalPct).toBe(100);
    expect(internalExternalSplit([dom('x.com', 5, false)]).internalPct).toBe(0);
  });

  it('empty or undefined → zeros, never NaN', () => {
    expect(internalExternalSplit([])).toEqual({ internalCount: 0, externalCount: 0, internalPct: 0 });
    expect(internalExternalSplit(undefined)).toEqual({
      internalCount: 0,
      externalCount: 0,
      internalPct: 0,
    });
  });

  it('zero-count rows still yield internalPct 0 (no divide-by-zero)', () => {
    const r = internalExternalSplit([dom('a.internal', 0, true), dom('x.com', 0, false)]);
    expect(r.internalPct).toBe(0);
  });
});

describe('topNxdomainSources', () => {
  it('sorts by nxdomain desc and drops rows with nxdomain 0', () => {
    const r = topNxdomainSources([
      failure({ key: 'a', label: 'a', nxdomain: 2, total: 10, failRate: 0.2 }),
      failure({ key: 'b', label: 'b', nxdomain: 0, servfail: 3, total: 10, failRate: 0.3 }),
      failure({ key: 'c', label: 'c', nxdomain: 7, total: 20, failRate: 0.35 }),
    ]);
    expect(r).toEqual([
      { label: 'c', nxdomain: 7, total: 20, failRate: 0.35 },
      { label: 'a', nxdomain: 2, total: 10, failRate: 0.2 },
    ]);
  });

  it('caps at n', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      failure({ key: `s${i}`, label: `s${i}`, nxdomain: i + 1, total: 100, failRate: 0.1 }),
    );
    const r = topNxdomainSources(many, 8);
    expect(r).toHaveLength(8);
    expect(r[0].nxdomain).toBe(12);
    expect(r[7].nxdomain).toBe(5);
  });

  it('empty or undefined → []', () => {
    expect(topNxdomainSources([])).toEqual([]);
    expect(topNxdomainSources(undefined)).toEqual([]);
  });
});

describe('rcodeBreakdown', () => {
  it('sums nxdomain and servfail across all failure rows', () => {
    const r = rcodeBreakdown([
      failure({ nxdomain: 2, servfail: 1 }),
      failure({ nxdomain: 3, servfail: 0 }),
      failure({ nxdomain: 0, servfail: 4 }),
    ]);
    expect(r).toEqual({ nxdomain: 5, servfail: 5 });
  });

  it('empty or undefined → zeros', () => {
    expect(rcodeBreakdown([])).toEqual({ nxdomain: 0, servfail: 0 });
    expect(rcodeBreakdown(undefined)).toEqual({ nxdomain: 0, servfail: 0 });
  });
});

describe('topResolvers', () => {
  // Collector graph: source = querying client/pod (srcId ?? clientIp),
  // target = domain. Heaviest SOURCE nodes by summed link value.
  const resolution: DnsAggregate['resolution'] = {
    nodes: [{ name: 'pod-a' }, { name: 'example.com' }, { name: 'pod-b' }, { name: 'other.io' }],
    links: [
      { source: 0, target: 1, value: 5 },
      { source: 0, target: 3, value: 2 },
      { source: 2, target: 1, value: 10 },
    ],
  };

  it('aggregates summed link value per source node, sorted desc', () => {
    expect(topResolvers(resolution)).toEqual([
      { label: 'pod-b', value: 10 },
      { label: 'pod-a', value: 7 },
    ]);
  });

  it('caps at n', () => {
    const r = topResolvers(resolution, 1);
    expect(r).toEqual([{ label: 'pod-b', value: 10 }]);
  });

  it('ignores links whose source index has no node', () => {
    const r = topResolvers({
      nodes: [{ name: 'pod-a' }],
      links: [
        { source: 0, target: 0, value: 3 },
        { source: 9, target: 0, value: 99 },
      ],
    });
    expect(r).toEqual([{ label: 'pod-a', value: 3 }]);
  });

  it('empty or undefined → []', () => {
    expect(topResolvers({ nodes: [], links: [] })).toEqual([]);
    expect(topResolvers(undefined)).toEqual([]);
  });
});
