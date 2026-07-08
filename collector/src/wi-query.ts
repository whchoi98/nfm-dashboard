import { NetworkFlowMonitorClient, ListScopesCommand,
  StartQueryWorkloadInsightsTopContributorsCommand,
  GetQueryStatusWorkloadInsightsTopContributorsCommand,
  GetQueryResultsWorkloadInsightsTopContributorsCommand,
  StopQueryWorkloadInsightsTopContributorsCommand } from '@aws-sdk/client-networkflowmonitor';

export type WiMetricName = 'DATA_TRANSFERRED' | 'RETRANSMISSIONS' | 'TIMEOUTS';
export type WiCategory = 'INTRA_AZ' | 'INTER_AZ' | 'INTER_VPC';

export interface WiRow { accountId?: string; localSubnetId?: string; localAz?: string;
  localVpcId?: string; remoteIdentifier?: string; value?: number; }
export interface WiResult { metric: string; category: string; rows: WiRow[]; }

const METRICS: WiMetricName[] = ['DATA_TRANSFERRED', 'RETRANSMISSIONS', 'TIMEOUTS'];
const CATEGORIES: WiCategory[] = ['INTRA_AZ', 'INTER_AZ', 'INTER_VPC'];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, baseMs: number): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if ((e as Error).name === 'ThrottlingException' && i < 4) {
        await sleep(baseMs * 2 ** i + Math.random() * baseMs);
        continue;
      }
      throw e;
    }
  }
}

async function runOne(client: NetworkFlowMonitorClient, scopeId: string, metric: WiMetricName,
    category: WiCategory, window: { startTime: Date; endTime: Date },
    opts: { pollDelayMs: number; retryBaseMs: number }): Promise<WiResult> {
  const { retryBaseMs: base, pollDelayMs: poll } = opts;
  try {
    const { queryId } = await withRetry(() => client.send(
      new StartQueryWorkloadInsightsTopContributorsCommand({ scopeId, metricName: metric,
        destinationCategory: category, startTime: window.startTime, endTime: window.endTime,
        limit: 100 })), base);
    for (let i = 0; i < 60; i++) {
      const { status } = await withRetry(() => client.send(
        new GetQueryStatusWorkloadInsightsTopContributorsCommand({ scopeId, queryId: queryId! })), base);
      if (status === 'SUCCEEDED') break;
      if (status === 'FAILED' || status === 'CANCELED') return { metric, category, rows: [] };
      if (i === 59) {
        await client.send(new StopQueryWorkloadInsightsTopContributorsCommand({ scopeId, queryId: queryId! }))
          .catch(() => {});
        return { metric, category, rows: [] };
      }
      await sleep(poll);
    }
    const rows: WiRow[] = []; let nextToken: string | undefined;
    do {
      const res = await withRetry(() => client.send(new GetQueryResultsWorkloadInsightsTopContributorsCommand(
        { scopeId, queryId: queryId!, nextToken })), base);
      for (const row of res.topContributors ?? []) {
        rows.push({ accountId: row.accountId, localSubnetId: row.localSubnetId, localAz: row.localAz,
          localVpcId: row.localVpcId, remoteIdentifier: row.remoteIdentifier, value: row.value });
      }
      nextToken = res.nextToken;
    } while (nextToken);
    return { metric, category, rows };
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', msg: 'wi query failed', metric, category,
      error: (e as Error).name, detail: (e as Error).message }));
    return { metric, category, rows: [] };
  }
}

export async function collectWorkloadInsights(client: NetworkFlowMonitorClient,
    window: { startTime: Date; endTime: Date },
    opts?: { pollDelayMs?: number; retryBaseMs?: number }): Promise<WiResult[]> {
  const resolved = { pollDelayMs: opts?.pollDelayMs ?? 2000, retryBaseMs: opts?.retryBaseMs ?? 1000 };
  let scopeId: string | undefined;
  try {
    const { scopes } = await withRetry(() => client.send(new ListScopesCommand({})), resolved.retryBaseMs);
    scopeId = scopes?.[0]?.scopeId;
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', msg: 'list scopes failed',
      error: (e as Error).name, detail: (e as Error).message }));
    return [];
  }
  if (!scopeId) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'no scope found; skipping workload insights' }));
    return [];
  }
  const results: WiResult[] = [];
  for (const metric of METRICS) for (const category of CATEGORIES) {
    results.push(await runOne(client, scopeId, metric, category, window, resolved));
  }
  return results;
}
