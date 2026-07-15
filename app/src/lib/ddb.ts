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
export function recentBuckets(n: number, now = Date.now()): string[] {
  return Array.from({ length: n }, (_, i) =>
    new Date(Math.floor(now / 300000) * 300000 - i * 300000).toISOString().replace(/\.\d+Z/, 'Z'));
}

export type WindowPart = { grain: 'raw' | 'hourly'; bucket: string };
export interface WindowPlan { parts: WindowPart[]; buckets: string[]; windowSeconds: number }

// Requests over 3h read hour-grain HFLOW rollups (closed hours) plus the open
// hour's 5-min buckets as a live tail; smaller requests stay raw (unchanged).
export const GRAIN_SWITCH_BUCKETS = 36;
const HOUR_MS = 3_600_000;
const isoNoMs = (t: number) => new Date(t).toISOString().replace(/\.\d+Z/, 'Z');

/** Closed-hour keys newest-first: [openHourStart - 1h, …, openHourStart - H h]. */
function closedHourBuckets(hoursBack: number, openHourStartMs: number): string[] {
  return Array.from({ length: hoursBack },
    (_, i) => isoNoMs(openHourStartMs - (i + 1) * HOUR_MS));
}

export function windowPlan(n: number, now = Date.now()): WindowPlan {
  if (n <= GRAIN_SWITCH_BUCKETS) {
    const buckets = recentBuckets(n, now);
    return { parts: buckets.map(b => ({ grain: 'raw' as const, bucket: b })),
      buckets, windowSeconds: n * 300 };
  }
  const H = Math.round(n / 12);
  const openHourStart = Math.floor(now / HOUR_MS) * HOUR_MS;
  const tailCount = Math.floor((Math.floor(now / 300_000) * 300_000 - openHourStart) / 300_000) + 1;
  const tail = recentBuckets(tailCount, now);
  const hours = closedHourBuckets(H, openHourStart);
  const parts: WindowPart[] = [
    ...tail.map(b => ({ grain: 'raw' as const, bucket: b })),
    ...hours.map(b => ({ grain: 'hourly' as const, bucket: b }))];
  return { parts, buckets: parts.map(p => p.bucket),
    windowSeconds: H * 3600 + tailCount * 300 };
}

/**
 * Pair plan: 2H CLOSED hours split symmetrically H/H — no tail on either half.
 * An asymmetric tail would bias every window-over-window delta (movers,
 * anomalies) toward the current window; the pair path trades <=1h of
 * freshness for symmetry (spec 2026-07-15-hourly-rollups).
 */
export function windowPairPlan(n: number, now = Date.now()):
    { current: WindowPart[]; prior: WindowPart[]; windowSeconds: number } {
  if (n <= GRAIN_SWITCH_BUCKETS) {
    const buckets = recentBuckets(2 * n, now);
    const part = (b: string): WindowPart => ({ grain: 'raw', bucket: b });
    return { current: buckets.slice(0, n).map(part), prior: buckets.slice(n).map(part),
      windowSeconds: n * 300 };
  }
  const H = Math.round(n / 12);
  const openHourStart = Math.floor(now / HOUR_MS) * HOUR_MS;
  const hours = closedHourBuckets(2 * H, openHourStart);
  const part = (b: string): WindowPart => ({ grain: 'hourly', bucket: b });
  return { current: hours.slice(0, H).map(part), prior: hours.slice(H).map(part),
    windowSeconds: H * 3600 };
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

async function fetchParts(parts: WindowPart[]): Promise<FlowEdge[][]> {
  const monitors = await monitorNames();
  return mapPool(parts, BUCKET_QUERY_CONCURRENCY, (p) => queryPart(p, monitors));
}

async function fetchFlowsWindow(n: number): Promise<FlowEdge[]> {
  return (await fetchParts(windowPlan(n).parts)).flat();
}

// ── Flows cache versioning ────────────────────────────────────────────────
// Collector data only changes when a cycle is written (~5 min), so cached
// windows / lens outputs stay valid while BOTH hold:
//  (1) the collector hasn't written a new cycle — probed via STATUS#collect
//      latest.cycleTs, memoized CYCLE_MEMO_MS so the probe adds ~zero DDB
//      load and fresh data appears within that memo window; and
//  (2) the 5-min grid hasn't rolled — recentBuckets() shifts at each boundary,
//      so a cached window's bucket list goes stale there even if the collector
//      is down (frozen cycleTs).
// If the probe fails it degrades to boundary-only versioning ('nocycle')
// instead of failing the request.
const CYCLE_MEMO_MS = 15_000;
let cycleMemo: { p: Promise<string>; at: number } | undefined;
let lastCycleId = 'nocycle';
function latestCycleId(): Promise<string> {
  if (cycleMemo && Date.now() - cycleMemo.at < CYCLE_MEMO_MS) return cycleMemo.p;
  cycleMemo = {
    // Probe failures are sticky on the last known cycle: a transient blip
    // (likeliest under DDB load) must not flip the version back and forth and
    // flush every cached window twice.
    p: getCollectionStatus().then(
      (s) => (lastCycleId = s?.cycleTs ?? lastCycleId),
      () => lastCycleId,
    ),
    at: Date.now(),
  };
  return cycleMemo.p;
}

async function flowsVersion(): Promise<string> {
  return `${await latestCycleId()}|${Math.floor(Date.now() / 300_000)}`;
}

// In-flight de-dup + versioned cache keyed by fetch shape ('w:12' window,
// 'p:6' pair, 'r:…' route lens output): the analytics routes fire concurrently
// with identical windows (and /alerts, /anomalies, /reports poll the pair
// fetch), so they share one underlying query set / computation. PENDING
// entries are never dropped by sweep or cap — a slow multi-day fetch keeps
// absorbing callers even across a version roll (its data is at most one cycle
// stale); dropping it would re-launch the same full fan-out concurrently, the
// exact pileup behind the 2026-07-14 OOM. Settled stale entries are dropped on
// every access (sweep) AND by an unref'd max-age timer (idle heap release);
// every drop path clears the timer so no closure pins an evicted window's
// arrays. Rejected fetches are evicted immediately — a failure is never cached.
type FlowsCacheEntry = {
  p: Promise<unknown>;
  version: string;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
};
const flowsWindowCache = new Map<string, FlowsCacheEntry>();
const FLOWS_CACHE_MAX_ENTRIES = 200; // route keys include free-form params — bound them
const FLOWS_CACHE_MAX_AGE_MS = 330_000; // > any version lifetime (5-min grid + probe memo)

/** Live entry count, for tests/diagnostics. */
export function flowsCacheSize(): number {
  return flowsWindowCache.size;
}

function dropEntry(key: string, entry: FlowsCacheEntry): void {
  if (entry.timer !== undefined) clearTimeout(entry.timer);
  if (flowsWindowCache.get(key) === entry) flowsWindowCache.delete(key);
}

async function cachedFetch<T>(key: string, fetch: () => Promise<T>): Promise<T> {
  const version = await flowsVersion();
  for (const [k, v] of flowsWindowCache) {
    if (v.settled && v.version !== version) dropEntry(k, v);
  }
  // Survivors are current-version, or pending (joined regardless of version).
  const hit = flowsWindowCache.get(key);
  if (hit) return hit.p as Promise<T>;
  const entry: FlowsCacheEntry = { p: fetch(), version, settled: false };
  flowsWindowCache.set(key, entry);
  for (const k of flowsWindowCache.keys()) { // insertion order → oldest first
    if (flowsWindowCache.size <= FLOWS_CACHE_MAX_ENTRIES) break;
    const v = flowsWindowCache.get(k);
    if (k === key || !v || !v.settled) continue; // never drop the new or a pending entry
    dropEntry(k, v);
  }
  entry.p.then(() => {
    entry.settled = true;
    if (flowsWindowCache.get(key) !== entry) return; // evicted while in flight — no timer
    const timer = setTimeout(() => dropEntry(key, entry), FLOWS_CACHE_MAX_AGE_MS);
    timer.unref?.();
    entry.timer = timer;
  }, () => {
    entry.settled = true;
    dropEntry(key, entry);
  });
  return entry.p as Promise<T>;
}

/**
 * Versioned cache for a computed route/lens result — same validity as the
 * flow windows it derives from (collector cycle + 5-min grid). ONLY for
 * results that are pure functions of flow data + request params (no CloudWatch
 * alarms/metrics, nothing user-specific — responses are shared across users).
 * `key` must encode every request param the result depends on (lensCacheKey).
 */
export async function cachedLens<T>(key: string, compute: () => Promise<T>): Promise<T> {
  return cachedFetch(`r:${key}`, compute);
}

/**
 * Stable cache key for a lens route: route name + sorted query params,
 * RE-ENCODED via URLSearchParams — joining decoded values by hand would let a
 * value containing '&'/'=' forge a key that collides with a different request
 * (the cache is shared across users).
 */
export function lensCacheKey(route: string, url: string): string {
  const params = [...new URL(url).searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${route}?${new URLSearchParams(params).toString()}`;
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
    const plan = windowPairPlan(n);
    const perPart = await fetchParts([...plan.current, ...plan.prior]);
    return { current: perPart.slice(0, plan.current.length).flat(),
      prior: perPart.slice(plan.current.length).flat() };
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

async function queryPart(part: WindowPart, monitors: string[]): Promise<FlowEdge[]> {
  const prefix = part.grain === 'hourly' ? 'HFLOW' : 'FLOW';
  const results = await Promise.all(monitors.map(m => queryAll({
    TableName: TABLE_FLOWS,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': `${prefix}#${part.bucket}#${m}` } })));
  return results.flat();
}

/** Flows in one 5-min bucket; all monitors when `monitor` is omitted. */
export async function queryFlowsByBucket(bucket: string, monitor?: string): Promise<FlowEdge[]> {
  const monitors = monitor ? [monitor] : await monitorNames();
  return queryPart({ grain: 'raw', bucket }, monitors);
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
