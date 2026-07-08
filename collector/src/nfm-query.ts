import { NetworkFlowMonitorClient, StartQueryMonitorTopContributorsCommand,
  GetQueryStatusMonitorTopContributorsCommand, GetQueryResultsMonitorTopContributorsCommand,
  StopQueryMonitorTopContributorsCommand } from '@aws-sdk/client-networkflowmonitor';
import type { DestCategory, FlowEdge, MetricName } from './types.js';
import { normalizeRow, dedupeEdges, type RawRow } from './normalize.js';

export interface MatrixSpec { monitors: string[]; metrics: MetricName[]; categories: DestCategory[];
  startTime: Date; endTime: Date; bucket: string; concurrency: number;
  pollDelayMs?: number; retryBaseMs?: number; statusPollMax?: number; }
export interface CycleStats { started: number; succeeded: number; failed: number;
  throttled: number; rows: number; }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, stats: CycleStats, baseMs: number): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if ((e as Error).name === 'ThrottlingException' && i < 4) {
        stats.throttled++;
        await sleep(baseMs * 2 ** i + Math.random() * baseMs);
        continue;
      }
      throw e;
    }
  }
}

async function runOne(client: NetworkFlowMonitorClient, monitor: string, metric: MetricName,
    category: DestCategory, spec: MatrixSpec, stats: CycleStats): Promise<FlowEdge[]> {
  const base = spec.retryBaseMs ?? 1000, poll = spec.pollDelayMs ?? 2000;
  stats.started++;
  try {
    const { queryId } = await withRetry(() => client.send(new StartQueryMonitorTopContributorsCommand({
      monitorName: monitor, metricName: metric, destinationCategory: category,
      startTime: spec.startTime, endTime: spec.endTime, limit: 100 })), stats, base);
    const pollMax = spec.statusPollMax ?? 30;
    for (let i = 0; i < pollMax; i++) {
      const { status } = await withRetry(() => client.send(
        new GetQueryStatusMonitorTopContributorsCommand({ monitorName: monitor, queryId })), stats, base);
      if (status === 'SUCCEEDED') break;
      if (status === 'FAILED' || status === 'CANCELED') { stats.failed++; return []; }
      if (i === pollMax - 1) {
        await client.send(new StopQueryMonitorTopContributorsCommand({ monitorName: monitor, queryId }))
          .catch(() => {});
        stats.failed++; return [];
      }
      await sleep(poll);
    }
    const edges: FlowEdge[] = []; let nextToken: string | undefined;
    do {
      const res = await withRetry(() => client.send(new GetQueryResultsMonitorTopContributorsCommand({
        monitorName: monitor, queryId, nextToken })), stats, base);
      for (const row of res.topContributors ?? []) {
        stats.rows++;
        edges.push(normalizeRow(row as RawRow,
          { monitor, metric, category, bucket: spec.bucket, unit: res.unit ?? 'Count' }));
      }
      nextToken = res.nextToken;
    } while (nextToken);
    stats.succeeded++;
    return edges;
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', msg: 'query failed', monitor, metric, category,
      error: (e as Error).name, detail: (e as Error).message }));
    stats.failed++; return [];
  }
}

export async function runQueryMatrix(client: NetworkFlowMonitorClient, spec: MatrixSpec) {
  const stats: CycleStats = { started: 0, succeeded: 0, failed: 0, throttled: 0, rows: 0 };
  const jobs: Array<() => Promise<FlowEdge[]>> = [];
  for (const m of spec.monitors) for (const met of spec.metrics) for (const c of spec.categories)
    jobs.push(() => runOne(client, m, met, c, spec, stats));
  const results: FlowEdge[] = []; let idx = 0;
  await Promise.all(Array.from({ length: Math.min(spec.concurrency, jobs.length) }, async () => {
    while (idx < jobs.length) { const j = jobs[idx++]; results.push(...await j()); }
  }));
  return { edges: dedupeEdges(results), stats };
}
