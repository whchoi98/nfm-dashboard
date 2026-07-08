import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { flowItem, buildTopology, writeCycle } from './storage.js';
import type { FlowEdge } from './types.js';

const edge: FlowEdge = { edgeHash: 'abc', monitor: 'nfm-eks-demo', metric: 'DATA_TRANSFERRED',
  category: 'INTER_AZ', bucket: '2026-07-08T11:45:00Z', value: 100, unit: 'Bytes',
  a: { podName: 'api-1', podNamespace: 'shop', instanceId: 'i-aaa', az: 'az1' },
  b: { podName: 'db-0', podNamespace: 'shop', instanceId: 'i-bbb', az: 'az2' },
  targetPort: 5432, traversedConstructs: [] };

it('flowItem maps keys per schema', () => {
  const item = flowItem(edge, 1234567890);
  expect(item.pk).toBe('FLOW#2026-07-08T11:45:00Z#nfm-eks-demo');
  expect(item.sk).toBe('DATA_TRANSFERRED#INTER_AZ#abc');
  expect(item.gsi1pk).toBe('POD#shop/api-1');
  expect(item.gsi2pk).toBe('POD#shop/db-0');
  expect(item.gsi3pk).toBe('EDGE#abc');
  expect(item.gsi3sk).toBe('2026-07-08T11:45:00Z#DATA_TRANSFERRED');
  expect(item.ttl).toBe(1234567890);
});

it('flowItem omits pod GSIs for non-pod endpoints', () => {
  const e = { ...edge, a: { instanceId: 'i-x' }, b: { ip: '8.8.8.8' } };
  const item = flowItem(e as FlowEdge, 1);
  expect(item.gsi1pk).toBeUndefined();
  expect(item.gsi2pk).toBeUndefined();
});

it('buildTopology merges metrics per edge and classifies nodes', () => {
  const rtt = { ...edge, metric: 'ROUND_TRIP_TIME' as const, value: 900 };
  const topo = buildTopology([edge, rtt], { 'nfm-eks-demo': 'demo' }, '2026-07-08T11:50:00Z');
  expect(topo.nodes.find(n => n.id === 'pod:shop/api-1')?.kind).toBe('pod');
  expect(topo.nodes.find(n => n.id === 'pod:shop/api-1')?.cluster).toBe('demo');
  expect(topo.edges).toHaveLength(1);
  expect(topo.edges[0].metrics.DATA_TRANSFERRED).toBe(100);
  expect(topo.edges[0].metrics.ROUND_TRIP_TIME).toBe(900);
});

it('flowItem key precedence: colliding FlowEdge fields cannot clobber computed keys', () => {
  // A future FlowEdge field literally named pk/sk/gsi3pk/gsi3sk/ttl must not win over
  // the computed DynamoDB keys — ...e has to be spread BEFORE the computed keys are assigned.
  const evil = { ...edge, pk: 'EVIL', sk: 'EVIL', gsi3pk: 'EVIL', gsi3sk: 'EVIL', ttl: -1 } as never;
  const item = flowItem(evil, 1234567890);
  expect(item.pk).toBe('FLOW#2026-07-08T11:45:00Z#nfm-eks-demo');
  expect(item.sk).toBe('DATA_TRANSFERRED#INTER_AZ#abc');
  expect(item.gsi3pk).toBe('EDGE#abc');
  expect(item.gsi3sk).toBe('2026-07-08T11:45:00Z#DATA_TRANSFERRED');
  expect(item.ttl).toBe(1234567890);
});

it('flowItem falls back to "_" namespace for pod GSI keys, matching endpointKey convention', () => {
  const e = { ...edge, a: { ...edge.a, podNamespace: undefined } };
  const item = flowItem(e as FlowEdge, 1);
  expect(item.gsi1pk).toBe('POD#_/api-1');
});

describe('writeCycle', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);
  beforeEach(() => ddbMock.reset());

  const tables = { flows: 'nfm-dashboard-flows', meta: 'nfm-dashboard-meta' };
  const stats = { started: 1, succeeded: 1, failed: 0, throttled: 0, rows: 1 };
  const topology = buildTopology([], {}, '2026-07-08T12:00:00Z');

  it('chunks 30 edges into 2 BatchWriteCommands (25+5) and issues 3 PutCommands with no coverage', async () => {
    ddbMock.on(BatchWriteCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    const edges = Array.from({ length: 30 }, (_, i) => ({ ...edge, edgeHash: `hash-${i}` }));

    await writeCycle(ddb, tables, { edges, topology,
      stats: { ...stats, started: 30, succeeded: 30, rows: 30 }, cycleTs: '2026-07-08T11:45:00Z' });

    const batchCalls = ddbMock.commandCalls(BatchWriteCommand);
    expect(batchCalls).toHaveLength(2);
    expect(batchCalls[0].args[0].input.RequestItems?.['nfm-dashboard-flows']).toHaveLength(25);
    expect(batchCalls[1].args[0].input.RequestItems?.['nfm-dashboard-flows']).toHaveLength(5);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(3);
  });

  it('retries UnprocessedItems from a BatchWrite response before giving up', async () => {
    ddbMock.on(PutCommand).resolves({});
    const unprocessed = [{ PutRequest: { Item: flowItem(edge, 1) } }];
    ddbMock.on(BatchWriteCommand)
      .resolvesOnce({ UnprocessedItems: { 'nfm-dashboard-flows': unprocessed } })
      .resolves({});
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

    await writeCycle(ddb, tables, { edges: [edge], topology, stats, cycleTs: '2026-07-08T11:45:00Z' });

    expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(2);
  });
});
