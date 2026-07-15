import { DynamoDBDocumentClient, BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { CycleStats } from './nfm-query.js';
import type { EndpointInfo, FlowEdge, TopologySnapshot, TopoNode } from './types.js';
import { endpointKey } from './normalize.js';

export function flowItem(e: FlowEdge, ttlEpoch: number): Record<string, unknown> {
  // Spread the edge FIRST: any future FlowEdge field literally named pk/sk/gsi3pk/gsi3sk/ttl
  // must never win over the computed DynamoDB keys assigned below.
  const item: Record<string, unknown> = { ...e,
    pk: `FLOW#${e.bucket}#${e.monitor}`, sk: `${e.metric}#${e.category}#${e.edgeHash}`,
    gsi3pk: `EDGE#${e.edgeHash}`, gsi3sk: `${e.bucket}#${e.metric}`, ttl: ttlEpoch };
  if (e.a.podName) { item.gsi1pk = `POD#${e.a.podNamespace ?? '_'}/${e.a.podName}`; item.gsi1sk = e.bucket; }
  if (e.b.podName) { item.gsi2pk = `POD#${e.b.podNamespace ?? '_'}/${e.b.podName}`; item.gsi2sk = e.bucket; }
  return item;
}

function nodeOf(ep: EndpointInfo, cluster?: string): TopoNode {
  const id = endpointKey(ep);
  if (ep.podName) return { id, kind: 'pod', label: ep.podName, namespace: ep.podNamespace,
    cluster, az: ep.az, vpcId: ep.vpcId };
  if (ep.instanceId) return { id, kind: 'node', label: ep.instanceId, az: ep.az, vpcId: ep.vpcId };
  return { id, kind: 'external', label: ep.ip ?? 'unknown' };
}

/** Batch-writes all items (25-chunk, retry w/ backoff). Returns the number of
 *  items DROPPED after retries were exhausted (0 = every item landed) so
 *  callers gating completion markers on a full write can withhold them. */
export async function batchWriteAll(ddb: DynamoDBDocumentClient, table: string,
    rawItems: Record<string, unknown>[]): Promise<number> {
  const items = rawItems.map(item => ({ PutRequest: { Item: item } }));
  let dropped = 0;
  for (let i = 0; i < items.length; i += 25) {
    let pending = items.slice(i, i + 25);
    for (let attempt = 0; pending.length > 0; attempt++) {
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: pending } }));
      pending = (res.UnprocessedItems?.[table] ?? []) as typeof pending;
      if (pending.length === 0) break;
      if (attempt >= 3) {
        console.error(JSON.stringify({ level: 'error', msg: 'unprocessed items dropped', count: pending.length }));
        dropped += pending.length;
        break;
      }
      await new Promise(r => setTimeout(r, 200 * 2 ** attempt));
    }
  }
  return dropped;
}

export function buildTopology(edges: FlowEdge[], monitorToCluster: Record<string, string>,
    now: string): TopologySnapshot {
  const nodes = new Map<string, TopoNode>();
  const merged = new Map<string, TopologySnapshot['edges'][number]>();
  for (const e of edges) {
    const cluster = monitorToCluster[e.monitor];
    for (const ep of [e.a, e.b]) { const n = nodeOf(ep, ep.podName ? cluster : undefined);
      if (!nodes.has(n.id)) nodes.set(n.id, n); }
    const key = e.edgeHash;
    const cur = merged.get(key) ?? { id: key, source: endpointKey(e.a), target: endpointKey(e.b),
      metrics: {}, category: e.category, targetPort: e.targetPort };
    // Duplicate observations of the same flow (two cluster monitors) must not
    // inflate latency: RTT merges with MAX; counts (bytes/retrans/timeouts) sum.
    const prev = cur.metrics[e.metric];
    cur.metrics[e.metric] = e.metric === 'ROUND_TRIP_TIME'
      ? Math.max(prev ?? 0, e.value) : (prev ?? 0) + e.value;
    merged.set(key, cur);
  }
  const top = [...merged.values()]
    .sort((x, y) => (y.metrics.DATA_TRANSFERRED ?? 0) - (x.metrics.DATA_TRANSFERRED ?? 0))
    .slice(0, 2000);
  const used = new Set(top.flatMap(e => [e.source, e.target]));
  return { generatedAt: now, nodes: [...nodes.values()].filter(n => used.has(n.id)), edges: top };
}

export async function writeCycle(ddb: DynamoDBDocumentClient,
    tables: { flows: string; meta: string },
    payload: { edges: FlowEdge[]; topology: TopologySnapshot; stats: CycleStats;
      cycleTs: string; coverage?: unknown; cycle?: number }): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  await batchWriteAll(ddb, tables.flows, payload.edges.map(e => flowItem(e, ttl)));
  await ddb.send(new PutCommand({ TableName: tables.meta,
    Item: { pk: 'STATUS#collect', sk: payload.cycleTs, stats: payload.stats, ttl } }));
  await ddb.send(new PutCommand({ TableName: tables.meta,
    Item: { pk: 'STATUS#collect', sk: 'latest', cycleTs: payload.cycleTs, stats: payload.stats,
      cycle: payload.cycle } }));
  await ddb.send(new PutCommand({ TableName: tables.meta,
    Item: { pk: 'TOPO#latest', sk: 'snapshot', topology: payload.topology } }));
  if (payload.coverage) await ddb.send(new PutCommand({ TableName: tables.meta,
    Item: { pk: 'COVERAGE#latest', sk: 'all', coverage: payload.coverage } }));
}
