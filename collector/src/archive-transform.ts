// collector/src/archive-transform.ts
// DynamoDB Streams (nfm-dashboard-flows, NEW_IMAGE) -> flat JSON -> Kinesis Firehose -> S3 Parquet.
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { FirehoseClient, PutRecordBatchCommand } from '@aws-sdk/client-firehose';
import type { DynamoDBStreamEvent } from 'aws-lambda';
import type { EndpointInfo, TraversedComponent } from './types.js';

export interface FlatFlowRow {
  edge_hash: string; monitor: string; metric: string; category: string; bucket: string;
  value: number; unit: string;
  a_ip: string; a_instance_id: string; a_subnet_id: string; a_az: string; a_vpc_id: string;
  a_region: string; a_pod_name: string; a_pod_namespace: string; a_service_name: string;
  b_ip: string; b_instance_id: string; b_subnet_id: string; b_az: string; b_vpc_id: string;
  b_region: string; b_pod_name: string; b_pod_namespace: string; b_service_name: string;
  snat_ip: string; dnat_ip: string; target_port: number; traversed_constructs: string; dt: string;
}

function flatEndpoint<P extends 'a' | 'b'>(prefix: P, ep: EndpointInfo | undefined) {
  const e = ep ?? {};
  return {
    [`${prefix}_ip`]: e.ip ?? '', [`${prefix}_instance_id`]: e.instanceId ?? '',
    [`${prefix}_subnet_id`]: e.subnetId ?? '', [`${prefix}_az`]: e.az ?? '',
    [`${prefix}_vpc_id`]: e.vpcId ?? '', [`${prefix}_region`]: e.region ?? '',
    [`${prefix}_pod_name`]: e.podName ?? '', [`${prefix}_pod_namespace`]: e.podNamespace ?? '',
    [`${prefix}_service_name`]: e.serviceName ?? '',
  } as Record<string, string>;
}

// Skip STATUS#/TOPO#/COVERAGE# meta rows — only FLOW# edge items get archived.
export function flattenFlowImage(image: Record<string, any>): FlatFlowRow | null {
  const item = unmarshall(image) as Record<string, any>;
  if (typeof item.pk !== 'string' || !item.pk.startsWith('FLOW#')) return null;
  const bucket = String(item.bucket ?? '');
  const traversed: TraversedComponent[] = item.traversedConstructs ?? [];
  return {
    edge_hash: String(item.edgeHash ?? ''), monitor: String(item.monitor ?? ''),
    metric: String(item.metric ?? ''), category: String(item.category ?? ''), bucket,
    value: Number(item.value ?? 0), unit: String(item.unit ?? ''),
    ...flatEndpoint('a', item.a), ...flatEndpoint('b', item.b),
    snat_ip: item.snatIp ?? '', dnat_ip: item.dnatIp ?? '',
    target_port: Number(item.targetPort ?? 0),
    traversed_constructs: JSON.stringify(traversed ?? []),
    dt: bucket.slice(0, 10),
  } as FlatFlowRow;
}

let firehoseClient: FirehoseClient | undefined;
function firehose(): FirehoseClient {
  return (firehoseClient ??= new FirehoseClient({ region: process.env.AWS_REGION ?? 'ap-northeast-2' }));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// DynamoDB Streams event source mapping handler. Batches flattened rows to Firehose;
// a partial PutRecordBatch failure is logged but NOT thrown (the stream still checkpoints
// past this shard batch — dropped rows are an acceptable archive-completeness trade-off).
// A whole-batch send error (network/throttle/auth) IS thrown so Lambda retries the shard batch.
export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  const rows = event.Records
    .filter(r => (r.eventName === 'INSERT' || r.eventName === 'MODIFY') && r.dynamodb?.NewImage)
    .map(r => flattenFlowImage(r.dynamodb!.NewImage as Record<string, any>))
    .filter((row): row is FlatFlowRow => row !== null);
  if (rows.length === 0) return;

  const streamName = process.env.FIREHOSE_STREAM;
  if (!streamName) {
    console.error(JSON.stringify({ level: 'error', msg: 'FIREHOSE_STREAM env var missing', dropped: rows.length }));
    return;
  }

  for (const batch of chunk(rows, 500)) {
    const records = batch.map(row => ({ Data: Buffer.from(JSON.stringify(row) + '\n') }));
    const res = await firehose().send(
      new PutRecordBatchCommand({ DeliveryStreamName: streamName, Records: records }));
    if (res.FailedPutCount && res.FailedPutCount > 0) {
      console.error(JSON.stringify({ level: 'error', msg: 'firehose PutRecordBatch partial failure',
        failedPutCount: res.FailedPutCount, batchSize: records.length }));
    }
  }
};
