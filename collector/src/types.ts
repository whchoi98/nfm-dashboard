// collector/src/types.ts
export type MetricName = 'DATA_TRANSFERRED'|'RETRANSMISSIONS'|'TIMEOUTS'|'ROUND_TRIP_TIME';
// All 11 destination categories accepted by the live NFM API (verified 2026-07 via
// StartQueryWorkloadInsightsTopContributors). INTERNET/AWS_SERVICE/TRANSIT_GATEWAY/LOCAL_ZONE
// are only produced by the Workload Insights collector, never by the flows collector.
export type DestCategory = 'INTRA_AZ'|'INTER_AZ'|'INTER_VPC'
  |'UNCLASSIFIED'|'AMAZON_S3'|'AMAZON_DYNAMODB'|'INTER_REGION'
  |'INTERNET'|'AWS_SERVICE'|'TRANSIT_GATEWAY'|'LOCAL_ZONE';
export interface EndpointInfo { ip?: string; instanceId?: string; subnetId?: string; az?: string;
  vpcId?: string; region?: string; podName?: string; podNamespace?: string; serviceName?: string; }
export interface TraversedComponent { componentId?: string; componentType?: string;
  componentArn?: string; serviceName?: string; }
export interface FlowEdge { edgeHash: string; monitor: string; metric: MetricName;
  category: DestCategory; bucket: string; value: number; unit: string;
  a: EndpointInfo; b: EndpointInfo; snatIp?: string; dnatIp?: string; targetPort?: number;
  traversedConstructs: TraversedComponent[]; }
export interface TopologySnapshot { generatedAt: string; nodes: TopoNode[]; edges: TopoEdge[]; }
export interface TopoNode { id: string; kind: 'pod'|'node'|'vpc'|'external'; label: string;
  namespace?: string; cluster?: string; az?: string; vpcId?: string; }
export interface TopoEdge { id: string; source: string; target: string;
  metrics: Partial<Record<MetricName, number>>; category: DestCategory; targetPort?: number; }
