import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { recentBuckets, queryPodFlows, queryEdgeSeries } from './ddb';

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
