// collector/src/types.ts
export type MetricName = 'DATA_TRANSFERRED'|'RETRANSMISSIONS'|'TIMEOUTS'|'ROUND_TRIP_TIME';
export type DestCategory = 'INTRA_AZ'|'INTER_AZ'|'INTER_VPC';
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
