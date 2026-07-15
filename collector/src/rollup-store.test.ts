// collector/src/rollup-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { hflowItem, runRollupStep } from './rollup-store.js';
import type { FlowEdge } from './types.js';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tables = { flows: 'flows-t', meta: 'meta-t' };
beforeEach(() => ddbMock.reset());

const edge = (over: Partial<FlowEdge>): FlowEdge => ({
  edgeHash: 'e1', monitor: 'm1', metric: 'DATA_TRANSFERRED', category: 'INTER_AZ',
  bucket: '2026-07-15T02:00:00Z', value: 7, unit: 'Bytes',
  a: {}, b: {}, traversedConstructs: [], ...over });

it('hflowItem writes HFLOW keys with NO gsi attributes', () => {
  const item = hflowItem(edge({ bucket: '2026-07-15T02:00:00Z',
    a: { podName: 'api-1', podNamespace: 'shop' } }), 123);
  expect(item.pk).toBe('HFLOW#2026-07-15T02:00:00Z#m1');
  expect(item.sk).toBe('DATA_TRANSFERRED#INTER_AZ#e1');
  expect(item.ttl).toBe(123);
  expect(item.gsi1pk).toBeUndefined();
  expect(item.gsi2pk).toBeUndefined();
  expect(item.gsi3pk).toBeUndefined();
});

it('hflowItem strips GSI attributes carried by raw read-backs', () => {
  const raw = { ...edge({ a: { podName: 'api-1', podNamespace: 'shop' } }),
    gsi1pk: 'POD#shop/api-1', gsi1sk: '2026-07-15T02:00:00Z',
    gsi2pk: 'POD#shop/db-0', gsi2sk: '2026-07-15T02:00:00Z',
    gsi3pk: 'EDGE#e1', gsi3sk: '2026-07-15T02:00:00Z#DATA_TRANSFERRED' } as never;
  const item = hflowItem(raw, 123);
  expect(item.gsi1pk).toBeUndefined();
  expect(item.gsi2pk).toBeUndefined();
  expect(item.gsi3pk).toBeUndefined();
  expect(item.gsi1sk).toBeUndefined();
  expect(item.gsi2sk).toBeUndefined();
  expect(item.gsi3sk).toBeUndefined();
});

describe('runRollupStep', () => {
  // now = 04:10 → newest eligible hour is 03:00; markers say 02:00 is done.
  const nowMs = Date.parse('2026-07-15T04:10:00Z');

  it('rolls up the newest missing eligible hour: 12 buckets x monitors queried, HFLOW + marker written', async () => {
    ddbMock.on(QueryCommand, { TableName: tables.meta }).resolves({
      Items: Array.from({ length: 167 }, (_, i) => // every eligible hour except 03:00 done
        ({ pk: 'HROLL#done', sk: new Date(Date.parse('2026-07-15T03:00:00Z') - (i + 1) * 3_600_000)
          .toISOString().replace(/\.\d+Z/, 'Z') })) });
    ddbMock.on(QueryCommand, { TableName: tables.flows }).callsFake((input) => {
      const pk = input.ExpressionAttributeValues[':pk'] as string;
      // Raw read-backs carry flowItem's GSI keys — the pipeline must strip them.
      return { Items: [{ ...edge({ bucket: pk.split('#')[1], monitor: pk.split('#')[2], value: 2 }),
        gsi1pk: 'POD#shop/api-1', gsi1sk: pk.split('#')[1],
        gsi3pk: 'EDGE#e1', gsi3sk: `${pk.split('#')[1]}#DATA_TRANSFERRED` }] };
    });
    ddbMock.on(BatchWriteCommand).resolves({ UnprocessedItems: {} });
    ddbMock.on(PutCommand).resolves({});

    const res = await runRollupStep({ ddb, tables, monitors: ['m1', 'm2'], nowMs });

    expect(res.hoursDone).toEqual(['2026-07-15T03:00:00Z']);
    const flowQueries = ddbMock.commandCalls(QueryCommand)
      .filter(c => c.args[0].input.TableName === tables.flows);
    expect(flowQueries).toHaveLength(24); // 12 buckets x 2 monitors
    const batch = ddbMock.commandCalls(BatchWriteCommand)[0].args[0].input;
    const written = batch.RequestItems!['flows-t'].map((r: any) => r.PutRequest.Item);
    // one merged edge per monitor (12 buckets x value 2 = 24), hour-stamped:
    expect(written).toHaveLength(2);
    expect(written[0].pk).toMatch(/^HFLOW#2026-07-15T03:00:00Z#/);
    expect(written[0].value).toBe(24);
    // No HFLOW item may carry ANY gsi key (index pollution — see hflowItem):
    for (const item of written) {
      expect(Object.keys(item).filter(k => k.startsWith('gsi'))).toEqual([]);
    }
    const marker = ddbMock.commandCalls(PutCommand).find(c =>
      c.args[0].input.Item!.pk === 'HROLL#done')!.args[0].input.Item!;
    expect(marker.sk).toBe('2026-07-15T03:00:00Z');
    expect(typeof marker.ttl).toBe('number');
  });

  it('writes marker only (no BatchWrite) for an hour with no raw data', async () => {
    ddbMock.on(QueryCommand, { TableName: tables.meta }).resolves({ Items: [] });
    ddbMock.on(QueryCommand, { TableName: tables.flows }).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});
    const res = await runRollupStep({ ddb, tables, monitors: ['m1'], nowMs });
    expect(res.hoursDone).toHaveLength(6); // maxPerCycle empty hours, marker-only
    expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(6);
  });

  it('withholds the HROLL#done marker when BatchWrite persistently drops items', async () => {
    ddbMock.on(QueryCommand, { TableName: tables.meta }).resolves({
      Items: Array.from({ length: 167 }, (_, i) => // only 03:00 missing
        ({ pk: 'HROLL#done', sk: new Date(Date.parse('2026-07-15T03:00:00Z') - (i + 1) * 3_600_000)
          .toISOString().replace(/\.\d+Z/, 'Z') })) });
    ddbMock.on(QueryCommand, { TableName: tables.flows }).callsFake((input) => {
      const pk = input.ExpressionAttributeValues[':pk'] as string;
      return { Items: [edge({ bucket: pk.split('#')[1], monitor: pk.split('#')[2], value: 2 })] };
    });
    // Every attempt reports the same item unprocessed → batchWriteAll drops it.
    ddbMock.on(BatchWriteCommand).resolves({ UnprocessedItems:
      { 'flows-t': [{ PutRequest: { Item: { pk: 'stuck', sk: 's' } } }] } });
    ddbMock.on(PutCommand).resolves({});

    const res = await runRollupStep({ ddb, tables, monitors: ['m1'], nowMs });

    // A dropped item means the hour-sum is silently incomplete: no marker, not
    // in hoursDone — the idempotent hour is retried next cycle.
    expect(res.hoursDone).toEqual([]);
    const markers = ddbMock.commandCalls(PutCommand)
      .filter(c => c.args[0].input.Item!.pk === 'HROLL#done');
    expect(markers).toHaveLength(0);
  });

  it('paginates the raw-hour query (LastEvaluatedKey)', async () => {
    ddbMock.on(QueryCommand, { TableName: tables.meta }).resolves({
      Items: Array.from({ length: 167 }, (_, i) =>
        ({ pk: 'HROLL#done', sk: new Date(Date.parse('2026-07-15T03:00:00Z') - (i + 1) * 3_600_000)
          .toISOString().replace(/\.\d+Z/, 'Z') })) });
    let first = true;
    ddbMock.on(QueryCommand, { TableName: tables.flows }).callsFake((input) => {
      if (input.ExpressionAttributeValues[':pk'].endsWith('T03:00:00Z#m1') && first) {
        first = false;
        return { Items: [edge({ value: 1 })], LastEvaluatedKey: { pk: 'x', sk: 'y' } };
      }
      return { Items: [] };
    });
    ddbMock.on(BatchWriteCommand).resolves({ UnprocessedItems: {} });
    ddbMock.on(PutCommand).resolves({});
    await runRollupStep({ ddb, tables, monitors: ['m1'], nowMs });
    const flowQueries = ddbMock.commandCalls(QueryCommand)
      .filter(c => c.args[0].input.TableName === tables.flows);
    expect(flowQueries).toHaveLength(13); // 12 buckets + 1 continuation page
  });
});
