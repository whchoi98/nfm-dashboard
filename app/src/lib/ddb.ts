import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { listMonitorNames } from './cw-metrics';
import type { CollectionStatus, Coverage, DnsAggregate, FlowEdge, TopologySnapshot,
  WiResult } from './types';

const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';
const TABLE_FLOWS = process.env.TABLE_FLOWS ?? 'nfm-dashboard-flows';
const TABLE_META = process.env.TABLE_META ?? 'nfm-dashboard-meta';

let client: DynamoDBDocumentClient | undefined;
function ddb(): DynamoDBDocumentClient {
  return (client ??= DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }),
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

/** All flows across the n most-recent 5-min buckets (all monitors), concatenated. */
export async function getFlowsWindow(n = 12): Promise<FlowEdge[]> {
  const results = await Promise.all(recentBuckets(n).map(b => queryFlowsByBucket(b)));
  return results.flat();
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
