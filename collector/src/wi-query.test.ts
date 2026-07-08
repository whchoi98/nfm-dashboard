import { it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { NetworkFlowMonitorClient, ListScopesCommand,
  StartQueryWorkloadInsightsTopContributorsCommand,
  GetQueryStatusWorkloadInsightsTopContributorsCommand,
  GetQueryResultsWorkloadInsightsTopContributorsCommand,
} from '@aws-sdk/client-networkflowmonitor';
import { collectWorkloadInsights } from './wi-query.js';

const nfm = mockClient(NetworkFlowMonitorClient);
beforeEach(() => nfm.reset());

const window = { startTime: new Date(1e12), endTime: new Date(1e12 + 3e5) };
const opts = { pollDelayMs: 0, retryBaseMs: 0 };

it('start→status→results happy path yields WiResult per metric×category', async () => {
  nfm.on(ListScopesCommand).resolves({ scopes: [{ scopeId: 'scope-1', status: 'SUCCEEDED', scopeArn: 'arn:scope-1' }] });
  nfm.on(StartQueryWorkloadInsightsTopContributorsCommand).resolves({ queryId: 'q1' });
  nfm.on(GetQueryStatusWorkloadInsightsTopContributorsCommand).resolves({ status: 'SUCCEEDED' });
  nfm.on(GetQueryResultsWorkloadInsightsTopContributorsCommand).resolves({ topContributors: [
    { accountId: '111', localSubnetId: 'subnet-1', localAz: 'us-east-1a', localVpcId: 'vpc-1',
      remoteIdentifier: 'vpc-2', value: 42 },
  ] });

  const results = await collectWorkloadInsights(new NetworkFlowMonitorClient({}), window, opts);

  expect(results).toHaveLength(9);
  const dtIntraAz = results.find(r => r.metric === 'DATA_TRANSFERRED' && r.category === 'INTRA_AZ');
  expect(dtIntraAz).toBeDefined();
  expect(dtIntraAz!.rows).toEqual([
    { accountId: '111', localSubnetId: 'subnet-1', localAz: 'us-east-1a', localVpcId: 'vpc-1',
      remoteIdentifier: 'vpc-2', value: 42 },
  ]);
});

it('FAILED query is skipped without aborting the other metric×category pairs', async () => {
  nfm.on(ListScopesCommand).resolves({ scopes: [{ scopeId: 'scope-1', status: 'SUCCEEDED', scopeArn: 'arn:scope-1' }] });
  nfm.on(StartQueryWorkloadInsightsTopContributorsCommand).resolves({ queryId: 'q1' });
  nfm.on(GetQueryStatusWorkloadInsightsTopContributorsCommand).resolves({ status: 'FAILED' });

  const results = await collectWorkloadInsights(new NetworkFlowMonitorClient({}), window, opts);

  expect(results).toHaveLength(9);
  for (const r of results) expect(r.rows).toEqual([]);
});

it('no scope found returns [] with a warning and issues no Start command', async () => {
  nfm.on(ListScopesCommand).resolves({ scopes: [] });

  const results = await collectWorkloadInsights(new NetworkFlowMonitorClient({}), window, opts);

  expect(results).toEqual([]);
  expect(nfm.commandCalls(StartQueryWorkloadInsightsTopContributorsCommand)).toHaveLength(0);
});
