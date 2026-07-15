// collector/src/rollup-store.ts
// Hour-close rollup I/O: read markers, read one hour's raw 5-min rows,
// write hour-grain HFLOW items + a completion marker. Idempotent — raw
// inputs are immutable, so re-running an hour rewrites identical items.
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { batchWriteAll } from './storage.js';
import { eligibleMissingHours, fiveMinBucketsOfHour, mergeHourEdges } from './rollup.js';
import type { FlowEdge } from './types.js';

// The app's 7d pair path (movers/anomalies) reads 2 x 168 closed hours plus
// the 1-hour shift, so hourly rows must outlive ~2 weeks; markers share the
// TTL (the 168h re-roll lookback stays far below it).
const ROLLUP_TTL_SECONDS = 15 * 24 * 3600;
const RAW_QUERY_CONCURRENCY = 8;

/** HFLOW item: FlowEdge payload at hour grain. NO gsi attrs — the pod/edge
 *  indexes stay 5-min-only concerns. */
export function hflowItem(e: FlowEdge, ttlEpoch: number): Record<string, unknown> {
  const item: Record<string, unknown> = { ...e,
    pk: `HFLOW#${e.bucket}#${e.monitor}`, sk: `${e.metric}#${e.category}#${e.edgeHash}`,
    ttl: ttlEpoch };
  // Raw items read back from DynamoDB carry flowItem's GSI keys (and old
  // pk/sk) through the FlowEdge cast + merge spread — HFLOW rows must never
  // be indexed (pod/edge lookups are 5-min-grain-only; a leaked hour-sum row
  // would double-count drilldowns with a 12x spike).
  for (const k of ['gsi1pk', 'gsi1sk', 'gsi2pk', 'gsi2sk', 'gsi3pk', 'gsi3sk']) delete item[k];
  return item;
}

async function listDoneHours(ddb: DynamoDBDocumentClient, metaTable: string): Promise<Set<string>> {
  const done = new Set<string>();
  let key: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(new QueryCommand({ TableName: metaTable,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': 'HROLL#done' },
      ExclusiveStartKey: key }));
    for (const item of res.Items ?? []) done.add((item as { sk: string }).sk);
    key = res.LastEvaluatedKey;
  } while (key);
  return done;
}

async function queryPartition(ddb: DynamoDBDocumentClient, flowsTable: string,
    pk: string): Promise<FlowEdge[]> {
  const items: FlowEdge[] = [];
  let key: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(new QueryCommand({ TableName: flowsTable,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ExclusiveStartKey: key }));
    items.push(...((res.Items ?? []) as FlowEdge[]));
    key = res.LastEvaluatedKey;
  } while (key);
  return items;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]); }
  }));
  return results;
}

export async function runRollupStep(opts: {
  ddb: DynamoDBDocumentClient; tables: { flows: string; meta: string };
  monitors: string[]; nowMs: number;
}): Promise<{ hoursDone: string[] }> {
  const { ddb, tables, monitors, nowMs } = opts;
  const done = await listDoneHours(ddb, tables.meta);
  const hours = eligibleMissingHours(nowMs, done);
  const ttl = Math.floor(nowMs / 1000) + ROLLUP_TTL_SECONDS;
  const hoursDone: string[] = [];
  for (const hour of hours) {
    const partitions = fiveMinBucketsOfHour(hour)
      .flatMap(b => monitors.map(m => `FLOW#${b}#${m}`));
    const raw = (await mapPool(partitions, RAW_QUERY_CONCURRENCY,
      pk => queryPartition(ddb, tables.flows, pk))).flat();
    const merged = mergeHourEdges(raw, hour);
    if (merged.length > 0) {
      await batchWriteAll(ddb, tables.flows, merged.map(e => hflowItem(e, ttl)));
    }
    // Marker LAST: a crash mid-hour leaves no marker, so the hour is retried.
    await ddb.send(new PutCommand({ TableName: tables.meta,
      Item: { pk: 'HROLL#done', sk: hour, ttl } }));
    hoursDone.push(hour);
  }
  return { hoursDone };
}
