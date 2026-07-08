import { createHash } from 'node:crypto';
import type { DestCategory, EndpointInfo, FlowEdge, MetricName, TraversedComponent } from './types.js';

export interface RawRow {
  localIp?: string; localInstanceId?: string; localSubnetId?: string; localAz?: string;
  localVpcId?: string; localRegion?: string;
  remoteIp?: string; remoteInstanceId?: string; remoteSubnetId?: string; remoteAz?: string;
  remoteVpcId?: string; remoteRegion?: string;
  snatIp?: string; dnatIp?: string; targetPort?: number; value?: number;
  traversedConstructs?: TraversedComponent[];
  kubernetesMetadata?: { localPodName?: string; localPodNamespace?: string; localServiceName?: string;
    remotePodName?: string; remotePodNamespace?: string; remoteServiceName?: string };
}
export interface RowCtx { monitor: string; metric: MetricName; category: DestCategory;
  bucket: string; unit: string; }

export function endpointKey(e: EndpointInfo): string {
  if (e.podName) return `pod:${e.podNamespace ?? '_'}/${e.podName}`;
  if (e.instanceId) return `i:${e.instanceId}`;
  return `ip:${e.ip ?? 'unknown'}`;
}

export function edgeHashOf(a: EndpointInfo, b: EndpointInfo, targetPort?: number): string {
  const [k1, k2] = [endpointKey(a), endpointKey(b)].sort();
  return createHash('sha1').update(`${k1}|${k2}|${targetPort ?? ''}`).digest('hex');
}

function side(row: RawRow, which: 'local' | 'remote'): EndpointInfo {
  const k = row.kubernetesMetadata ?? {};
  return which === 'local'
    ? { ip: row.localIp, instanceId: row.localInstanceId, subnetId: row.localSubnetId,
        az: row.localAz, vpcId: row.localVpcId, region: row.localRegion,
        podName: k.localPodName, podNamespace: k.localPodNamespace, serviceName: k.localServiceName }
    : { ip: row.remoteIp, instanceId: row.remoteInstanceId, subnetId: row.remoteSubnetId,
        az: row.remoteAz, vpcId: row.remoteVpcId, region: row.remoteRegion,
        podName: k.remotePodName, podNamespace: k.remotePodNamespace, serviceName: k.remoteServiceName };
}

export function normalizeRow(row: RawRow, ctx: RowCtx): FlowEdge {
  const local = side(row, 'local'), remote = side(row, 'remote');
  const [a, b] = endpointKey(local) <= endpointKey(remote) ? [local, remote] : [remote, local];
  return { edgeHash: edgeHashOf(local, remote, row.targetPort), monitor: ctx.monitor,
    metric: ctx.metric, category: ctx.category, bucket: ctx.bucket,
    value: row.value ?? 0, unit: ctx.unit, a, b,
    snatIp: row.snatIp, dnatIp: row.dnatIp, targetPort: row.targetPort,
    traversedConstructs: row.traversedConstructs ?? [] };
}

export function dedupeEdges(edges: FlowEdge[]): FlowEdge[] {
  const best = new Map<string, FlowEdge>();
  for (const e of edges) {
    const k = `${e.bucket}|${e.monitor}|${e.metric}|${e.category}|${e.edgeHash}`;
    const prev = best.get(k);
    if (!prev || e.value > prev.value) best.set(k, e);
  }
  return [...best.values()];
}
