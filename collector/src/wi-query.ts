import { NetworkFlowMonitorClient, ListScopesCommand,
  StartQueryWorkloadInsightsTopContributorsCommand,
  GetQueryStatusWorkloadInsightsTopContributorsCommand,
  GetQueryResultsWorkloadInsightsTopContributorsCommand,
  StopQueryWorkloadInsightsTopContributorsCommand,
  type DestinationCategory } from '@aws-sdk/client-networkflowmonitor';
import type { DestCategory } from './types.js';

export type WiMetricName = 'DATA_TRANSFERRED' | 'RETRANSMISSIONS' | 'TIMEOUTS';
// WI queries cover every NFM destination category (all 11, verified against the live API).
export type WiCategory = DestCategory;

export interface WiRow { accountId?: string; localSubnetId?: string; localAz?: string;
  localVpcId?: string; remoteIdentifier?: string; value?: number; }
export interface WiResult { metric: string; category: string; rows: WiRow[]; }

const METRICS: WiMetricName[] = ['DATA_TRANSFERRED', 'RETRANSMISSIONS', 'TIMEOUTS'];
// All 11 categories every cycle: 3 metrics × 11 = 33 query lifecycles at concurrency 5
// (~7 waves × ~3-7s typical ≈ 25-50s) — comfortably inside the 270s Lambda timeout
// alongside the flows matrix, so no rotation/merge is needed.
const CATEGORIES: WiCategory[] = ['INTRA_AZ', 'INTER_AZ', 'INTER_VPC', 'INTER_REGION',
  'AMAZON_S3', 'AMAZON_DYNAMODB', 'UNCLASSIFIED',
  'INTERNET', 'TRANSIT_GATEWAY', 'LOCAL_ZONE', 'AWS_SERVICE'];

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
        // Cast: the bundled SDK's DestinationCategory enum is stale (7 values); the live API
        // accepts all 11 (incl. INTERNET/AWS_SERVICE/TRANSIT_GATEWAY/LOCAL_ZONE, verified 2026-07).
        destinationCategory: category as DestinationCategory,
        startTime: window.startTime, endTime: window.endTime,
        limit: 100 })), base);
    for (let i = 0; i < 30; i++) {
      const { status } = await withRetry(() => client.send(
        new GetQueryStatusWorkloadInsightsTopContributorsCommand({ scopeId, queryId: queryId! })), base);
      if (status === 'SUCCEEDED') break;
      if (status === 'FAILED' || status === 'CANCELED') return { metric, category, rows: [] };
      if (i === 29) {
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
  const jobs: Array<{ metric: WiMetricName; category: WiCategory }> = [];
  for (const metric of METRICS) for (const category of CATEGORIES) jobs.push({ metric, category });
  const results: WiResult[] = new Array(jobs.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(5, jobs.length) }, async () => {
    while (idx < jobs.length) {
      const i = idx++;
      const { metric, category } = jobs[i];
      results[i] = await runOne(client, scopeId!, metric, category, window, resolved);
    }
  }));
  return results;
}
