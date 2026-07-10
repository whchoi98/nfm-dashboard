// App-local copy of the collector data shapes (collector/src/types.ts, wi-query.ts, onboard.ts).
// Kept as a small local module instead of a cross-workspace import so the Next.js build stays
// self-contained. Field names MUST stay identical to the collector output.
export type MetricName = 'DATA_TRANSFERRED' | 'RETRANSMISSIONS' | 'TIMEOUTS' | 'ROUND_TRIP_TIME';
// All 11 destination categories accepted by the live NFM API (verified 2026-07 via
// StartQueryWorkloadInsightsTopContributors). INTERNET/AWS_SERVICE/TRANSIT_GATEWAY/LOCAL_ZONE
// are only produced by the Workload Insights collector, never by the flows collector.
export type DestCategory = 'INTRA_AZ' | 'INTER_AZ' | 'INTER_VPC'
  | 'UNCLASSIFIED' | 'AMAZON_S3' | 'AMAZON_DYNAMODB' | 'INTER_REGION'
  | 'INTERNET' | 'AWS_SERVICE' | 'TRANSIT_GATEWAY' | 'LOCAL_ZONE';

export interface EndpointInfo { ip?: string; instanceId?: string; subnetId?: string; az?: string;
  vpcId?: string; region?: string; podName?: string; podNamespace?: string; serviceName?: string; }
export interface TraversedComponent { componentId?: string; componentType?: string;
  componentArn?: string; serviceName?: string; }
export interface FlowEdge { edgeHash: string; monitor: string; metric: MetricName;
  category: DestCategory; bucket: string; value: number; unit: string;
  a: EndpointInfo; b: EndpointInfo; snatIp?: string; dnatIp?: string; targetPort?: number;
  traversedConstructs: TraversedComponent[]; }

export interface TopoNode { id: string; kind: 'pod' | 'node' | 'vpc' | 'external'; label: string;
  namespace?: string; cluster?: string; az?: string; vpcId?: string; }
export interface TopoEdge { id: string; source: string; target: string;
  metrics: Partial<Record<MetricName, number>>; category: DestCategory; targetPort?: number; }
export interface TopologySnapshot { generatedAt: string; nodes: TopoNode[]; edges: TopoEdge[]; }

// Workload Insights rows written by the collector under WI#latest/all (collector/src/wi-query.ts)
export interface WiRow { accountId?: string; localSubnetId?: string; localAz?: string;
  localVpcId?: string; remoteIdentifier?: string; value?: number; }
export interface WiResult { metric: string; category: string; rows: WiRow[]; }

// Agent coverage written under COVERAGE#latest/all (collector/src/onboard.ts)
export interface Coverage {
  standalone: { instanceId: string; tagged: boolean; roleName?: string; policyAttached: boolean }[];
  eksNodeCount: number;
}

export interface CycleStats { started: number; succeeded: number; failed: number;
  throttled: number; rows: number; }
export interface CollectionStatus { cycleTs: string; stats: CycleStats; }

// DNS aggregate written by the collector under DNS#latest/all (collector/src/dns.ts)
export interface DnsAggregate { enabled: boolean;
  topDomains: { name: string; count: number; internal: boolean }[];
  failures: { key: string; label: string; nxdomain: number; servfail: number; total: number; failRate: number }[];
  latency: { p50: number; p90: number; p95: number; max: number; count: number };
  queryTypes: { type: string; count: number }[];
  resolution: { nodes: { name: string }[]; links: { source: number; target: number; value: number }[] };
  nameFlow: { ip: string; name: string }[]; }
