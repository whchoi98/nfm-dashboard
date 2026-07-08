import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { NetworkFlowMonitorClient, StartQueryMonitorTopContributorsCommand,
  GetQueryStatusMonitorTopContributorsCommand, GetQueryResultsMonitorTopContributorsCommand,
} from '@aws-sdk/client-networkflowmonitor';
import { runQueryMatrix } from './nfm-query.js';

const nfm = mockClient(NetworkFlowMonitorClient);
beforeEach(() => nfm.reset());

const spec = { monitors: ['m1'], metrics: ['DATA_TRANSFERRED' as const],
  categories: ['INTRA_AZ' as const], startTime: new Date(1e12), endTime: new Date(1e12 + 3e5),
  bucket: '2026-07-08T11:45:00Z', concurrency: 2, pollDelayMs: 0 };

it('start→status→results happy path yields normalized edges', async () => {
  nfm.on(StartQueryMonitorTopContributorsCommand).resolves({ queryId: 'q1' });
  nfm.on(GetQueryStatusMonitorTopContributorsCommand).resolves({ status: 'SUCCEEDED' });
  nfm.on(GetQueryResultsMonitorTopContributorsCommand).resolves({ unit: 'Bytes',
    topContributors: [{ localIp: '1.1.1.1', remoteIp: '2.2.2.2', value: 10 }] });
  const { edges, stats } = await runQueryMatrix(new NetworkFlowMonitorClient({}), spec);
  expect(edges).toHaveLength(1);
  expect(edges[0].unit).toBe('Bytes');
  expect(stats).toMatchObject({ started: 1, succeeded: 1, failed: 0, rows: 1 });
});

it('FAILED query is counted but does not abort the cycle', async () => {
  nfm.on(StartQueryMonitorTopContributorsCommand).resolves({ queryId: 'q1' });
  nfm.on(GetQueryStatusMonitorTopContributorsCommand).resolves({ status: 'FAILED' });
  const { edges, stats } = await runQueryMatrix(new NetworkFlowMonitorClient({}), spec);
  expect(edges).toHaveLength(0);
  expect(stats.failed).toBe(1);
});

it('ThrottlingException on Start retries then succeeds', async () => {
  const err = Object.assign(new Error('slow down'), { name: 'ThrottlingException' });
  nfm.on(StartQueryMonitorTopContributorsCommand)
    .rejectsOnce(err).resolves({ queryId: 'q1' });
  nfm.on(GetQueryStatusMonitorTopContributorsCommand).resolves({ status: 'SUCCEEDED' });
  nfm.on(GetQueryResultsMonitorTopContributorsCommand).resolves({ unit: 'Bytes', topContributors: [] });
  const { stats } = await runQueryMatrix(new NetworkFlowMonitorClient({}), { ...spec, retryBaseMs: 0 });
  expect(stats.throttled).toBe(1);
  expect(stats.succeeded).toBe(1);
});

it('paginates results with nextToken', async () => {
  nfm.on(StartQueryMonitorTopContributorsCommand).resolves({ queryId: 'q1' });
  nfm.on(GetQueryStatusMonitorTopContributorsCommand).resolves({ status: 'SUCCEEDED' });
  nfm.on(GetQueryResultsMonitorTopContributorsCommand)
    .resolvesOnce({ unit: 'Bytes', topContributors: [{ localIp: 'a', remoteIp: 'b', value: 1 }], nextToken: 't' })
    .resolvesOnce({ unit: 'Bytes', topContributors: [{ localIp: 'c', remoteIp: 'd', value: 2 }] });
  const { stats } = await runQueryMatrix(new NetworkFlowMonitorClient({}), spec);
  expect(stats.rows).toBe(2);
});
