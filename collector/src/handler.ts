import { NetworkFlowMonitorClient } from '@aws-sdk/client-networkflowmonitor';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EC2Client } from '@aws-sdk/client-ec2';
import { IAMClient } from '@aws-sdk/client-iam';
import { runQueryMatrix } from './nfm-query.js';
import { buildTopology, writeCycle } from './storage.js';
import { discoverOnboarding } from './onboard.js';
import { collectWorkloadInsights } from './wi-query.js';
import type { DestCategory, MetricName } from './types.js';

const nfm = new NetworkFlowMonitorClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true } });
const ec2 = new EC2Client({}), iam = new IAMClient({});

export const handler = async () => {
  const monitorPairs = (process.env.MONITORS ?? '').split(',').filter(Boolean)
    .map(s => s.split('=') as [string, string]);
  const monitorToCluster = Object.fromEntries(monitorPairs.filter(([, c]) => c));
  const now = new Date();
  const bucket = new Date(Math.floor(now.getTime() / 300000) * 300000).toISOString().replace(/\.\d+Z/, 'Z');
  const endTime = new Date(now.getTime() - 2 * 60000);
  const startTime = new Date(now.getTime() - 7 * 60000);
  const coverage = await discoverOnboarding(ec2, iam).catch(err => {
    console.error('onboarding failed', err); return undefined; });
  const { edges, stats } = await runQueryMatrix(nfm, {
    monitors: monitorPairs.map(([m]) => m),
    metrics: ['DATA_TRANSFERRED', 'RETRANSMISSIONS', 'TIMEOUTS', 'ROUND_TRIP_TIME'] as MetricName[],
    categories: ['INTRA_AZ', 'INTER_AZ', 'INTER_VPC'] as DestCategory[],
    startTime, endTime, bucket, concurrency: Number(process.env.CONCURRENCY ?? 5) });
  const topology = buildTopology(edges, monitorToCluster, now.toISOString());
  await writeCycle(ddb, { flows: process.env.TABLE_FLOWS!, meta: process.env.TABLE_META! },
    { edges, topology, stats, cycleTs: now.toISOString(), coverage });
  const wi = await collectWorkloadInsights(nfm, { startTime, endTime })
    .catch(err => { console.error('wi failed', err); return undefined; });
  if (wi) await ddb.send(new PutCommand({ TableName: process.env.TABLE_META!,
    Item: { pk: 'WI#latest', sk: 'all', rows: wi, cycleTs: now.toISOString() } }));
  console.log(JSON.stringify({ level: 'info', msg: 'cycle done', stats, edges: edges.length }));
  return { ok: true, stats };
};
