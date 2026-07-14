import { Agent as HttpsAgent } from 'node:https';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { listMonitorNames } from './cw-metrics';
import type { CollectionStatus, Coverage, CycleStats, DnsAggregate, FlowEdge, TopologySnapshot,
  WiResult } from './types';

const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';
const TABLE_FLOWS = process.env.TABLE_FLOWS ?? 'nfm-dashboard-flows';
const TABLE_META = process.env.TABLE_META ?? 'nfm-dashboard-meta';

// One window/pair fetch peaks at BUCKET_QUERY_CONCURRENCY x monitors (~200 in
// flight) and two differently-keyed fetches can overlap (~400); the SDK's
// default 50-socket agent queues the excess, which stalls every route on the
// box and retains queued request state in memory (seen live as @smithy
// socket-capacity warnings preceding a task OOM). In-flight concurrency stays
// bounded by mapPool, so the extra capacity is free until demanded.
export const ddbSocketAgent = new HttpsAgent({ keepAlive: true, maxSockets: 512 });

let client: DynamoDBDocumentClient | undefined;
function ddb(): DynamoDBDocumentClient {
  return (client ??= DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION,
    requestHandler: { httpsAgent: ddbSocketAgent } }),
    { marshallOptions: { removeUndefinedValues: true } }));
}

/**
 * n most-recent 5-minute grid buckets as ISO strings, newest first.
 * MUST match the collector bucket formula exactly:
 * new Date(Math.floor(t/300000)*300000).toISOString().replace(/\.\d+Z/,'Z')
 */
export function recentBuckets(n: number): string[] {
  const t = Date.now();
  return Array.from({ length: n }, (_, i) =>
    new Date(Math.floor(t / 300000) * 300000 - i * 300000).toISOString().replace(/\.\d+Z/, 'Z'));
}

export async function getTopology(): Promise<TopologySnapshot | null> {
  const res = await ddb().send(new GetCommand({ TableName: TABLE_META,
    Key: { pk: 'TOPO#latest', sk: 'snapshot' } }));
  return (res.Item?.topology as TopologySnapshot | undefined) ?? null;
}

export async function getCollectionStatus(): Promise<CollectionStatus | null> {
  const res = await ddb().send(new GetCommand({ TableName: TABLE_META,
    Key: { pk: 'STATUS#collect', sk: 'latest' } }));
  if (!res.Item) return null;
  return { cycleTs: res.Item.cycleTs, stats: res.Item.stats } as CollectionStatus;
}

/**
 * Last n collection cycles from the STATUS#collect history rows the collector
 * writes per cycle (sk = cycleTs, 7-day TTL). The partition also holds the
 * 'latest' pointer row, which sorts after every ISO timestamp ('l' > '2') and
 * therefore arrives first in the descending query — hence Limit n+1 and the
 * filter. Returned oldest→newest for left-to-right time sparklines.
 */
export async function getCollectionHistory(n = 24): Promise<CollectionStatus[]> {
  const res = await ddb().send(new QueryCommand({
    TableName: TABLE_META,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': 'STATUS#collect' },
    ScanIndexForward: false,
    Limit: n + 1 }));
  return ((res.Items ?? []) as { sk: string; stats: CycleStats }[])
    .filter((item) => item.sk !== 'latest')
    .slice(0, n)
    .map((item) => ({ cycleTs: item.sk, stats: item.stats }))
    .reverse();
}

export async function getCoverage(): Promise<Coverage | null> {
  const res = await ddb().send(new GetCommand({ TableName: TABLE_META,
    Key: { pk: 'COVERAGE#latest', sk: 'all' } }));
  return (res.Item?.coverage as Coverage | undefined) ?? null;
}

export async function getWorkloadInsights():
    Promise<{ rows: WiResult[]; cycleTs?: string } | null> {
  const res = await ddb().send(new GetCommand({ TableName: TABLE_META,
    Key: { pk: 'WI#latest', sk: 'all' } }));
  if (!res.Item) return null;
  return { rows: (res.Item.rows as WiResult[] | undefined) ?? [], cycleTs: res.Item.cycleTs };
}

/** DNS aggregate precomputed by the collector under DNS#latest/all. */
export async function getDns(): Promise<DnsAggregate | null> {
  const res = await ddb().send(new GetCommand({ TableName: TABLE_META,
    Key: { pk: 'DNS#latest', sk: 'all' } }));
  return (res.Item?.dns as DnsAggregate | undefined) ?? null;
}

/**
 * Bounded-concurrency map: runs `fn` over `items` with at most `limit` in
 * flight at once, using a small worker pool (no dependency). Every item is
 * processed exactly once; results are returned in input order regardless of
 * completion order. A `limit` >= items.length degenerates to Promise.all-like
 * full parallelism.
 */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// Max concurrent per-bucket DynamoDB Queries: a 7d window is 2016 buckets, so
// fanning out unbounded (one Query per bucket) would fire ~2016 concurrent
// requests. This caps the fan-out regardless of window size.
const BUCKET_QUERY_CONCURRENCY = 40;

async function fetchFlowsWindow(n: number): Promise<FlowEdge[]> {
  const results = await mapPool(recentBuckets(n), BUCKET_QUERY_CONCURRENCY, (b) => queryFlowsByBucket(b));
  return results.flat();
}

// In-flight de-dup + short TTL keyed by fetch shape ('w:12' window, 'p:6' pair):
// the analytics routes fire concurrently with identical windows (and /alerts,
// /anomalies, /reports poll the pair fetch), so they share one underlying query
// set. The TTL runs from SETTLE, not fetch start — a slow multi-day fetch must
// keep absorbing callers for as long as it runs, never be swept mid-flight and
// re-launched. Expired entries are dropped on every access (sweep) AND by an
// unref'd timer, so the last big window's flow arrays don't stay pinned in the
// heap when traffic stops. Rejected fetches are evicted immediately — a failure
// is never cached.
const FLOWS_WINDOW_TTL_MS = 10_000;
type FlowsCacheEntry = { p: Promise<unknown>; expiresAt: number | null }; // null = in flight
const flowsWindowCache = new Map<string, FlowsCacheEntry>();

/** Live entry count, for tests/diagnostics. */
export function flowsCacheSize(): number {
  return flowsWindowCache.size;
}

function cachedFetch<T>(key: string, fetch: () => Promise<T>): Promise<T> {
  const now = Date.now();
  for (const [k, v] of flowsWindowCache) {
    if (v.expiresAt !== null && now >= v.expiresAt) flowsWindowCache.delete(k);
  }
  const hit = flowsWindowCache.get(key); // survivors are in flight or fresh
  if (hit) return hit.p as Promise<T>;
  const entry: FlowsCacheEntry = { p: fetch(), expiresAt: null };
  flowsWindowCache.set(key, entry);
  entry.p.then(() => {
    entry.expiresAt = Date.now() + FLOWS_WINDOW_TTL_MS;
    const timer = setTimeout(() => {
      if (flowsWindowCache.get(key) === entry) flowsWindowCache.delete(key);
    }, FLOWS_WINDOW_TTL_MS);
    timer.unref?.();
  }, () => {
    if (flowsWindowCache.get(key) === entry) flowsWindowCache.delete(key);
  });
  return entry.p as Promise<T>;
}

/** All flows across the n most-recent 5-min buckets (all monitors), concatenated. */
export async function getFlowsWindow(n = 12): Promise<FlowEdge[]> {
  return cachedFetch(`w:${n}`, () => fetchFlowsWindow(n));
}

/**
 * Current + prior flow windows of n buckets each for window-over-window lenses
 * (movers): the 2n most-recent buckets from ONE clock read, split in half —
 * two separate recentBuckets() calls could overlap/skip a bucket if a 5-min
 * boundary rolled between them. All 2n buckets run through ONE mapPool so the
 * pair shares a single concurrency budget — two per-half pools would double
 * the fan-out ceiling (2 x BUCKET_QUERY_CONCURRENCY x monitors) past the
 * socket pool.
 */
export async function getFlowsWindowPair(
  n: number,
): Promise<{ current: FlowEdge[]; prior: FlowEdge[] }> {
  return cachedFetch(`p:${n}`, async () => {
    const buckets = recentBuckets(2 * n);
    const perBucket = await mapPool(buckets, BUCKET_QUERY_CONCURRENCY, (b) => queryFlowsByBucket(b));
    return { current: perBucket.slice(0, n).flat(), prior: perBucket.slice(n).flat() };
  });
}

async function queryAll(input: ConstructorParameters<typeof QueryCommand>[0]): Promise<FlowEdge[]> {
  const items: FlowEdge[] = [];
  let key: Record<string, unknown> | undefined;
  do {
    const res = await ddb().send(new QueryCommand({ ...input, ExclusiveStartKey: key }));
    items.push(...((res.Items ?? []) as FlowEdge[]));
    key = res.LastEvaluatedKey;
    if (input.Limit && items.length >= input.Limit) break;
  } while (key);
  return items;
}

// Monitor names cache for the no-monitor case (5 min TTL, discovered via CloudWatch ListMetrics
// or the MONITORS env — same `name=cluster` comma format the collector uses).
let monitorCache: { names: string[]; at: number } | undefined;
async function monitorNames(): Promise<string[]> {
  const fromEnv = (process.env.MONITORS ?? '').split(',').filter(Boolean)
    .map(s => s.split('=')[0]).filter(Boolean);
  if (fromEnv.length) return fromEnv;
  if (monitorCache && Date.now() - monitorCache.at < 300000) return monitorCache.names;
  const names = await listMonitorNames();
  monitorCache = { names, at: Date.now() };
  return names;
}

/** Flows in one 5-min bucket; all monitors when `monitor` is omitted. */
export async function queryFlowsByBucket(bucket: string, monitor?: string): Promise<FlowEdge[]> {
  const monitors = monitor ? [monitor] : await monitorNames();
  const results = await Promise.all(monitors.map(m => queryAll({
    TableName: TABLE_FLOWS,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': `FLOW#${bucket}#${m}` } })));
  return results.flat();
}

/** Flows where the pod is either endpoint (GSI1 = source a, GSI2 = dest b), merged+deduped. */
export async function queryPodFlows(ns: string, pod: string, limit: number): Promise<FlowEdge[]> {
  const podKey = `POD#${ns}/${pod}`;
  const query = (index: 'GSI1' | 'GSI2') => queryAll({
    TableName: TABLE_FLOWS, IndexName: index,
    KeyConditionExpression: `${index === 'GSI1' ? 'gsi1pk' : 'gsi2pk'} = :pk`,
    ExpressionAttributeValues: { ':pk': podKey },
    ScanIndexForward: false, Limit: limit });
  const [a, b] = await Promise.all([query('GSI1'), query('GSI2')]);
  const seen = new Map<string, FlowEdge>();
  for (const f of [...a, ...b]) {
    const raw = f as FlowEdge & { pk?: string; sk?: string };
    const key = raw.pk && raw.sk ? `${raw.pk}|${raw.sk}`
      : `${f.bucket}|${f.monitor}|${f.metric}|${f.category}|${f.edgeHash}`;
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()]
    .sort((x, y) => y.bucket.localeCompare(x.bucket))
    .slice(0, limit);
}

/** Time series of raw flow items for one edge (GSI3), newest first. */
export async function queryEdgeSeries(edgeHash: string, limit: number): Promise<FlowEdge[]> {
  const res = await ddb().send(new QueryCommand({
    TableName: TABLE_FLOWS, IndexName: 'GSI3',
    KeyConditionExpression: 'gsi3pk = :pk',
    ExpressionAttributeValues: { ':pk': `EDGE#${edgeHash}` },
    ScanIndexForward: false, Limit: limit }));
  return (res.Items ?? []) as FlowEdge[];
}
