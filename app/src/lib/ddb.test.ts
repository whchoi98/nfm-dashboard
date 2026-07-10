import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { recentBuckets, queryPodFlows, queryEdgeSeries, getFlowsWindow, getDns } from './ddb';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => { ddbMock.reset(); });
afterEach(() => { vi.useRealTimers(); });

describe('recentBuckets', () => {
  it('returns n descending ISO strings on the 5-min grid in collector format', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T11:47:33.123Z'));
    expect(recentBuckets(3)).toEqual([
      '2026-07-08T11:45:00Z',
      '2026-07-08T11:40:00Z',
      '2026-07-08T11:35:00Z',
    ]);
  });

  it('emits exact grid boundary when now is on the boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T12:00:00.000Z'));
    expect(recentBuckets(1)).toEqual(['2026-07-08T12:00:00Z']);
  });
});

describe('queryPodFlows', () => {
  const item = (edgeHash: string, bucket: string) => ({
    pk: `FLOW#${bucket}#nfm-eks-demo`,
    sk: `DATA_TRANSFERRED#INTRA_AZ#${edgeHash}`,
    edgeHash, bucket, monitor: 'nfm-eks-demo',
    metric: 'DATA_TRANSFERRED', category: 'INTRA_AZ', value: 1, unit: 'Bytes',
    a: { podName: 'api-1', podNamespace: 'shop' }, b: {}, traversedConstructs: [],
  });

  it('queries GSI1 and GSI2, merges, dedupes and sorts by bucket desc', async () => {
    const a = item('aaa', '2026-07-08T11:40:00Z');
    const b = item('bbb', '2026-07-08T11:45:00Z');
    const c = item('ccc', '2026-07-08T11:35:00Z');
    ddbMock.on(QueryCommand).callsFake((input) => {
      if (input.IndexName === 'GSI1') return { Items: [a, b] };
      if (input.IndexName === 'GSI2') return { Items: [b, c] }; // b duplicated across GSIs
      throw new Error(`unexpected index ${input.IndexName}`);
    });

    const flows = await queryPodFlows('shop', 'api-1', 10);

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(2);
    const indexes = calls.map((call) => call.args[0].input.IndexName).sort();
    expect(indexes).toEqual(['GSI1', 'GSI2']);
    for (const call of calls) {
      const input = call.args[0].input;
      expect(Object.values(input.ExpressionAttributeValues ?? {})).toContain('POD#shop/api-1');
    }
    expect(flows).toHaveLength(3); // deduped: a, b, c
    expect(flows.map((f) => f.edgeHash)).toEqual(['bbb', 'aaa', 'ccc']); // bucket desc
  });

  it('slices to the requested limit after merging', async () => {
    const a = item('aaa', '2026-07-08T11:40:00Z');
    const b = item('bbb', '2026-07-08T11:45:00Z');
    const c = item('ccc', '2026-07-08T11:35:00Z');
    ddbMock.on(QueryCommand).callsFake((input) =>
      input.IndexName === 'GSI1' ? { Items: [a, b] } : { Items: [c] });
    const flows = await queryPodFlows('shop', 'api-1', 2);
    expect(flows.map((f) => f.edgeHash)).toEqual(['bbb', 'aaa']);
  });
});

describe('getFlowsWindow', () => {
  const prevMonitors = process.env.MONITORS;
  beforeEach(() => { process.env.MONITORS = 'nfm-eks-demo=eks-demo'; });
  afterEach(() => {
    if (prevMonitors === undefined) delete process.env.MONITORS;
    else process.env.MONITORS = prevMonitors;
  });

  it('queries each of the n recent buckets and concats the flows', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T11:47:33.123Z'));
    ddbMock.on(QueryCommand).callsFake((input) => {
      const pk = (input.ExpressionAttributeValues ?? {})[':pk'] as string;
      return { Items: [{ edgeHash: `e-${pk}`, bucket: pk.split('#')[1], monitor: 'nfm-eks-demo' }] };
    });

    const flows = await getFlowsWindow(3);

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(3);
    const pks = calls.map((c) => (c.args[0].input.ExpressionAttributeValues ?? {})[':pk']).sort();
    expect(pks).toEqual([
      'FLOW#2026-07-08T11:35:00Z#nfm-eks-demo',
      'FLOW#2026-07-08T11:40:00Z#nfm-eks-demo',
      'FLOW#2026-07-08T11:45:00Z#nfm-eks-demo',
    ]);
    expect(flows).toHaveLength(3); // 1 flow per bucket, concatenated
  });
});

describe('getFlowsWindow in-flight cache', () => {
  const prevMonitors = process.env.MONITORS;
  beforeEach(() => { process.env.MONITORS = 'nfm-eks-demo=eks-demo'; });
  afterEach(() => {
    if (prevMonitors === undefined) delete process.env.MONITORS;
    else process.env.MONITORS = prevMonitors;
  });

  // The cache is module-level state: each test pins a distinct fake system time far
  // (>> TTL) beyond any earlier test's so entries from previous tests are always expired.
  const flowItem = (pk: string) =>
    ({ edgeHash: `e-${pk}`, bucket: pk.split('#')[1], monitor: 'nfm-eks-demo' });

  it('issues the underlying bucket queries once for concurrent identical calls within the TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T13:00:00.000Z'));
    ddbMock.on(QueryCommand).callsFake((input) =>
      ({ Items: [flowItem((input.ExpressionAttributeValues ?? {})[':pk'] as string)] }));

    const [a, b] = await Promise.all([getFlowsWindow(12), getFlowsWindow(12)]);

    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12); // 12 buckets x 1 monitor, ONCE
    expect(a).toHaveLength(12);
    expect(b).toEqual(a);

    await getFlowsWindow(12); // still within TTL → served from cache, no new queries
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12);
  });

  it('re-queries after the TTL has elapsed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T14:00:00.000Z'));
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await getFlowsWindow(12);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12);

    vi.setSystemTime(new Date('2026-07-08T14:00:10.001Z')); // TTL (10s) just passed
    await getFlowsWindow(12);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(24);
  });

  it('does not cache a rejected fetch (next call within TTL re-queries)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T15:00:00.000Z'));
    ddbMock.on(QueryCommand).rejectsOnce(new Error('boom')).resolves({ Items: [] });

    await expect(getFlowsWindow(12)).rejects.toThrow('boom');

    // Same instant (within TTL) — the rejected promise must have been evicted.
    const flows = await getFlowsWindow(12);
    expect(flows).toEqual([]);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(24);
  });
});

describe('getDns', () => {
  it('returns the dns attribute of DNS#latest/all when present', async () => {
    const dns = { enabled: true, topDomains: [{ name: 'a.svc.cluster.local', count: 3, internal: true }],
      failures: [], latency: { p50: 1, p90: 2, p95: 3, max: 4, count: 5 }, queryTypes: [],
      resolution: { nodes: [], links: [] }, nameFlow: [] };
    ddbMock.on(GetCommand).resolves({ Item: { pk: 'DNS#latest', sk: 'all', dns } });

    await expect(getDns()).resolves.toEqual(dns);

    const input = ddbMock.commandCalls(GetCommand)[0].args[0].input;
    expect(input.Key).toEqual({ pk: 'DNS#latest', sk: 'all' });
  });

  it('returns null when the item is missing', async () => {
    ddbMock.on(GetCommand).resolves({});
    await expect(getDns()).resolves.toBeNull();
  });
});

describe('queryEdgeSeries', () => {
  it('queries GSI3 by EDGE#<hash> newest first with limit', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ edgeHash: 'abc', bucket: '2026-07-08T11:45:00Z' }] });
    const series = await queryEdgeSeries('abc', 50);
    const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(input.IndexName).toBe('GSI3');
    expect(Object.values(input.ExpressionAttributeValues ?? {})).toContain('EDGE#abc');
    expect(input.ScanIndexForward).toBe(false);
    expect(input.Limit).toBe(50);
    expect(series).toHaveLength(1);
  });
});
