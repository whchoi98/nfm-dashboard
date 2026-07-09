import { it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { CloudWatchLogsClient, StartQueryCommand, GetQueryResultsCommand,
  StopQueryCommand } from '@aws-sdk/client-cloudwatch-logs';
import { collectDns } from './dns-collect.js';

const cw = mockClient(CloudWatchLogsClient);
beforeEach(() => cw.reset());

const CORE_LINE = '[INFO] 10.0.1.5:1 - 1 "A IN api.shop.svc.cluster.local. udp 1 false 1" NOERROR qr 1 0.0003s';
const baseOpts = { coreDnsGroups: ['/aws/containerinsights/c/application'],
  resolverGroup: '/nfm-dashboard/resolver-dns', startTime: 0, endTime: 1, pollDelayMs: 0 };

it('runs insights, parses coredns messages, aggregates', async () => {
  cw.on(StartQueryCommand).resolves({ queryId: 'q1' });
  cw.on(GetQueryResultsCommand).resolves({ status: 'Complete', results: [
    [{ field: '@message', value: CORE_LINE }],
  ] });
  const agg = await collectDns(new CloudWatchLogsClient({}), baseOpts);
  expect(agg.enabled).toBe(true);
  expect(agg.topDomains[0].name).toBe('api.shop.svc.cluster.local');
});

it('unwraps Container Insights JSON-wrapped coredns lines via the log field', async () => {
  cw.on(StartQueryCommand).resolves({ queryId: 'q1' });
  cw.on(GetQueryResultsCommand).resolves({ status: 'Complete', results: [] });
  cw.on(StartQueryCommand, { logGroupName: '/aws/containerinsights/c/application' })
    .resolves({ queryId: 'qc' });
  cw.on(GetQueryResultsCommand, { queryId: 'qc' }).resolves({ status: 'Complete', results: [
    [{ field: '@message', value: JSON.stringify({ log: CORE_LINE, stream: 'stdout',
      kubernetes: { container_name: 'coredns' } }) }],
  ] });
  const agg = await collectDns(new CloudWatchLogsClient({}), baseOpts);
  expect(agg.enabled).toBe(true);
  expect(agg.topDomains[0].name).toBe('api.shop.svc.cluster.local');
});

it('parses resolver messages as JSON and correlates answers to flows', async () => {
  cw.on(StartQueryCommand).resolves({ queryId: 'qc' });
  cw.on(GetQueryResultsCommand).resolves({ status: 'Complete', results: [] });
  cw.on(StartQueryCommand, { logGroupName: '/nfm-dashboard/resolver-dns' })
    .resolves({ queryId: 'qr' });
  cw.on(GetQueryResultsCommand, { queryId: 'qr' }).resolves({ status: 'Complete', results: [
    [{ field: '@message', value: JSON.stringify({ query_name: 'ddb.amazonaws.com.',
      query_type: 'A', rcode: 'NOERROR', srcaddr: '10.100.1.20',
      answers: [{ Rdata: '52.1.2.3', Type: 'A' }] }) }],
  ] });
  const flows = [{ edgeHash: 'e1', a: { ip: '10.100.1.20' }, b: { ip: '52.1.2.3' } }] as any;
  const agg = await collectDns(new CloudWatchLogsClient({}), { ...baseOpts, flows });
  expect(agg.enabled).toBe(true);
  expect(agg.topDomains[0].name).toBe('ddb.amazonaws.com');
  expect(agg.nameFlow).toContainEqual({ ip: '52.1.2.3', name: 'ddb.amazonaws.com' });
});

it('polls while Running until Complete', async () => {
  cw.on(StartQueryCommand).resolves({ queryId: 'q1' });
  cw.on(GetQueryResultsCommand)
    .resolvesOnce({ status: 'Running' })
    .resolvesOnce({ status: 'Running' })
    .resolves({ status: 'Complete', results: [[{ field: '@message', value: CORE_LINE }]] });
  const agg = await collectDns(new CloudWatchLogsClient({}),
    { ...baseOpts, coreDnsGroups: ['/aws/containerinsights/c/application'], resolverGroup: '' });
  expect(agg.enabled).toBe(true);
  expect(cw.commandCalls(StopQueryCommand).length).toBe(0);
});

it('stops the query after maxPolls and returns what it has', async () => {
  cw.on(StartQueryCommand).resolves({ queryId: 'q1' });
  cw.on(GetQueryResultsCommand).resolves({ status: 'Running' });
  cw.on(StopQueryCommand).resolves({ success: true });
  const agg = await collectDns(new CloudWatchLogsClient({}),
    { ...baseOpts, coreDnsGroups: ['/aws/containerinsights/c/application'], resolverGroup: '',
      maxPolls: 3 });
  expect(agg.enabled).toBe(false);
  expect(cw.commandCalls(GetQueryResultsCommand).length).toBe(3);
  expect(cw.commandCalls(StopQueryCommand).length).toBe(1);
});

it('a Failed query on one group does not break the others', async () => {
  cw.on(StartQueryCommand, { logGroupName: '/aws/containerinsights/bad/application' })
    .resolves({ queryId: 'qbad' });
  cw.on(StartQueryCommand, { logGroupName: '/aws/containerinsights/good/application' })
    .resolves({ queryId: 'qgood' });
  cw.on(StartQueryCommand, { logGroupName: '/nfm-dashboard/resolver-dns' })
    .rejects(new Error('ResourceNotFoundException'));
  cw.on(GetQueryResultsCommand, { queryId: 'qbad' }).resolves({ status: 'Failed' });
  cw.on(GetQueryResultsCommand, { queryId: 'qgood' }).resolves({ status: 'Complete',
    results: [[{ field: '@message', value: CORE_LINE }]] });
  const agg = await collectDns(new CloudWatchLogsClient({}), { ...baseOpts,
    coreDnsGroups: ['/aws/containerinsights/bad/application', '/aws/containerinsights/good/application'] });
  expect(agg.enabled).toBe(true);
  expect(agg.topDomains[0].name).toBe('api.shop.svc.cluster.local');
});

it('resolver records survive the cap even when coredns volume alone would exceed it', async () => {
  const RESOLVER_MSG = JSON.stringify({ query_name: 'ddb.amazonaws.com.', query_type: 'A',
    rcode: 'NOERROR', srcaddr: '10.100.1.20', answers: [{ Rdata: '52.1.2.3', Type: 'A' }] });
  cw.on(StartQueryCommand, { logGroupName: '/aws/containerinsights/c/application' })
    .resolves({ queryId: 'qc' });
  cw.on(StartQueryCommand, { logGroupName: '/nfm-dashboard/resolver-dns' })
    .resolves({ queryId: 'qr' });
  cw.on(GetQueryResultsCommand, { queryId: 'qc' }).resolves({ status: 'Complete', results: [
    [{ field: '@message', value: CORE_LINE }],
    [{ field: '@message', value: CORE_LINE }],
    [{ field: '@message', value: CORE_LINE }],
  ] });
  cw.on(GetQueryResultsCommand, { queryId: 'qr' }).resolves({ status: 'Complete', results: [
    [{ field: '@message', value: RESOLVER_MSG }],
  ] });
  const flows = [{ edgeHash: 'e1', a: { ip: '10.100.1.20' }, b: { ip: '52.1.2.3' } }] as any;
  // cap = 2: coredns alone (3 records) would fill it — resolver must be processed first
  const agg = await collectDns(new CloudWatchLogsClient({}),
    { ...baseOpts, flows, recordCap: 2 });
  expect(agg.enabled).toBe(true);
  expect(agg.nameFlow).toContainEqual({ ip: '52.1.2.3', name: 'ddb.amazonaws.com' });
  expect(agg.topDomains.map(d => d.name)).toContain('ddb.amazonaws.com');
});

it('caps total parsed records and skips unparseable messages', async () => {
  cw.on(StartQueryCommand).resolves({ queryId: 'q1' });
  cw.on(GetQueryResultsCommand).resolves({ status: 'Complete', results: [
    [{ field: '@message', value: 'not a dns line at all' }],
    [{ field: '@message', value: CORE_LINE }],
    [{ field: '@message', value: CORE_LINE }],
    [{ field: '@message', value: CORE_LINE }],
  ] });
  const agg = await collectDns(new CloudWatchLogsClient({}),
    { ...baseOpts, coreDnsGroups: ['/aws/containerinsights/c/application'], resolverGroup: '',
      recordCap: 2 });
  expect(agg.enabled).toBe(true);
  expect(agg.topDomains[0].count).toBe(2);
});
