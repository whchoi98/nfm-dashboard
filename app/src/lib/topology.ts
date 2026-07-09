// app/src/lib/topology.ts — pure builders for the Phase 3 topology/paths redesign.
// Transforms TopologySnapshot (/api/topology) and FlowEdge (/api/paths) payloads into
// view models for HopPath / TierFlowMap / AdjacencyMatrix / TopEdgesPanel. No I/O.
import type {
  DestCategory, EndpointInfo, FlowEdge, MetricName, TopoEdge, TopoNode, TopologySnapshot,
} from './types';

export type ResourceKind = 'pod' | 'namespace' | 'service' | 'cluster' | 'instance' | 'eni' | 'subnet' | 'az'
  | 'vpc' | 'vpce' | 'tgw' | 'awsservice' | 'region' | 'internet' | 'other';

export interface Hop { kind: ResourceKind; label: string; id?: string; context?: string; }

export type TierLevel = 'cluster' | 'namespace' | 'service' | 'pod';
export interface TierNode { id: string; kind: ResourceKind; label: string; tier: number; }
export interface TierLink { id: string; source: string; target: string; bytes: number; category: DestCategory; }
export interface MatrixData { rows: string[]; cols: string[]; cells: { row: string; col: string; value: number }[]; }

// Ordered case-insensitive contains-rules. More specific substrings MUST come first:
// 'VpcEndpoint' must hit 'endpoint' (vpce) before 'vpc'; 'NetworkInterface' before generic checks.
const KIND_RULES: [needle: string, kind: ResourceKind][] = [
  ['transitgateway', 'tgw'], ['tgw', 'tgw'],
  ['networkinterface', 'eni'], ['eni', 'eni'],
  ['vpcendpoint', 'vpce'], ['endpoint', 'vpce'], ['vpce', 'vpce'],
  ['subnet', 'subnet'],
  ['instance', 'instance'],
  ['s3', 'awsservice'], ['dynamodb', 'awsservice'], ['cloudwatch', 'awsservice'], ['logs', 'awsservice'],
  ['internet', 'internet'], ['igw', 'internet'],
  ['region', 'region'],
  ['vpc', 'vpc'], // after vpce/endpoint so 'VpcEndpoint' never lands here
];

/** Map a traversedConstructs componentType to a ResourceKind (case-insensitive contains). */
export function resourceKindOf(componentType?: string): ResourceKind {
  if (!componentType) return 'other';
  const t = componentType.toLowerCase();
  for (const [needle, kind] of KIND_RULES) if (t.includes(needle)) return kind;
  return 'other';
}

/** Classify a flow endpoint: pod > instance > subnet > plain ip. */
export function endpointKind(e: EndpointInfo): ResourceKind {
  if (e.podName) return 'pod';
  if (e.instanceId) return 'instance';
  if (e.subnetId) return 'subnet';
  return 'other';
}

function endpointHop(e: EndpointInfo): Hop {
  const kind = endpointKind(e);
  const label = kind === 'pod'
    ? (e.podNamespace ? `${e.podNamespace}/${e.podName}` : e.podName ?? '')
    : kind === 'instance' ? e.instanceId ?? ''
    : e.ip ?? e.subnetId ?? '';
  const context = [e.az, e.region, e.vpcId].filter(Boolean).join(' · ') || undefined;
  return { kind, label, id: e.instanceId ?? e.podName, context };
}

/** Chain a FlowEdge into hops: src endpoint → traversed constructs → dst endpoint. */
export function buildHops(edge: FlowEdge): Hop[] {
  const traversed: Hop[] = (edge.traversedConstructs ?? []).map((tc) => ({
    kind: resourceKindOf(tc.componentType),
    label: tc.serviceName || tc.componentType || tc.componentId || '',
    id: tc.componentId,
  }));
  return [endpointHop(edge.a), ...traversed, endpointHop(edge.b)];
}

// Strip k8s generated pod-name suffixes to approximate the owning service/workload:
// Deployment "<svc>-<rs-hash>-<pod-hash>", StatefulSet "<svc>-<ordinal>".
function serviceOf(podLabel: string): string {
  const stripped = podLabel
    .replace(/-[a-z0-9]{5}$/, '')
    .replace(/-[0-9a-f]{6,10}$/, '')
    .replace(/-\d+$/, '');
  return stripped || podLabel;
}

interface TierEntity { id: string; label: string; kind: ResourceKind; tier: number; }

// Lane per TopoNode.kind: workload = 0, cluster nodes/instances = 1, vpc/external = 2.
const TIER_OF: Record<TopoNode['kind'], number> = { pod: 0, node: 1, vpc: 2, external: 2 };
const NONPOD_KIND: Record<Exclude<TopoNode['kind'], 'pod'>, ResourceKind> = {
  node: 'instance', vpc: 'vpc', external: 'other',
};

// Aggregate a topology node to the chosen level entity. Only pods roll up;
// infra/external nodes stay as themselves so the outer lanes remain meaningful.
function levelEntityOf(n: TopoNode, level: TierLevel): TierEntity {
  const tier = TIER_OF[n.kind];
  if (n.kind !== 'pod') return { id: n.id, label: n.label, kind: NONPOD_KIND[n.kind], tier };
  switch (level) {
    case 'pod':
      return { id: n.id, label: n.label, kind: 'pod', tier };
    case 'service': {
      const svc = serviceOf(n.label);
      if (!svc) return { id: n.id, label: n.label, kind: 'pod', tier }; // fallback pod
      const id = n.namespace ? `${n.namespace}/${svc}` : svc;
      return { id, label: id, kind: 'service', tier };
    }
    case 'namespace':
      if (!n.namespace) return { id: n.id, label: n.label, kind: 'pod', tier };
      return { id: n.namespace, label: n.namespace, kind: 'namespace', tier };
    case 'cluster': {
      const c = n.cluster || '—';
      return { id: c, label: c, kind: 'cluster', tier };
    }
  }
}

// nodeId → level entity, plus deduped entities in first-seen order.
function aggregateNodes(topo: TopologySnapshot, level: TierLevel) {
  const byNodeId = new Map<string, TierEntity>();
  const entities = new Map<string, TierEntity>();
  for (const n of topo.nodes) {
    const ent = levelEntityOf(n, level);
    byNodeId.set(n.id, ent);
    if (!entities.has(ent.id)) entities.set(ent.id, ent);
  }
  return { byNodeId, entities };
}

/** Aggregate topology to tiered lane nodes + links at the given level. Self-links dropped. */
export function buildTiers(topo: TopologySnapshot, level: TierLevel): { nodes: TierNode[]; links: TierLink[] } {
  const { byNodeId, entities } = aggregateNodes(topo, level);
  const nodes: TierNode[] = [...entities.values()].map(({ id, kind, label, tier }) => ({ id, kind, label, tier }));

  const links = new Map<string, TierLink>();
  for (const e of topo.edges) {
    const s = byNodeId.get(e.source)?.id ?? e.source;
    const t = byNodeId.get(e.target)?.id ?? e.target;
    if (s === t) continue; // drop self-links after aggregation
    const id = `${s}→${t}`;
    const bytes = e.metrics.DATA_TRANSFERRED ?? 0;
    const prev = links.get(id);
    if (prev) prev.bytes += bytes;
    else links.set(id, { id, source: s, target: t, bytes, category: e.category }); // first-seen category is representative
  }
  return { nodes, links: [...links.values()] };
}

/** rows = source entities, cols = target entities; cells = summed metric per (row, col). */
export function buildMatrix(topo: TopologySnapshot, metric: MetricName, level: TierLevel): MatrixData {
  const { byNodeId } = aggregateNodes(topo, level);
  const rows: string[] = [];
  const cols: string[] = [];
  const sums = new Map<string, { row: string; col: string; value: number }>();
  for (const e of topo.edges) {
    const row = byNodeId.get(e.source)?.id ?? e.source;
    const col = byNodeId.get(e.target)?.id ?? e.target;
    if (!rows.includes(row)) rows.push(row);
    if (!cols.includes(col)) cols.push(col);
    const key = `${row}→${col}`;
    const cell = sums.get(key) ?? { row, col, value: 0 };
    cell.value += e.metrics[metric] ?? 0;
    sums.set(key, cell);
  }
  return { rows, cols, cells: [...sums.values()] };
}

/**
 * Pre-filter a snapshot before the tier/matrix/top-edges builders run.
 * `cluster` keeps nodes of that cluster — leniently: nodes WITHOUT a cluster
 * (only pods carry one per collector/src/storage.ts; node/vpc/external don't)
 * also survive so the outer TierFlowMap lanes stay populated — plus edges whose
 * BOTH endpoints survive. `category` keeps only edges of that category. When
 * any filter is active, nodes left with no surviving edge are pruned. Empty
 * string = no filtering on that axis; returns the input unchanged when nothing
 * is filtered so referential equality is preserved for memoization.
 */
export function filterTopology(
  topo: TopologySnapshot,
  cluster: string,
  category: DestCategory | '',
): TopologySnapshot {
  if (!cluster && !category) return topo;
  let nodes = topo.nodes;
  let edges = topo.edges;
  if (cluster) {
    nodes = nodes.filter((n) => !n.cluster || n.cluster === cluster);
    const ids = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  }
  if (category) edges = edges.filter((e) => e.category === category);
  // A filter is active here: drop nodes no surviving edge references, so the
  // lenient rule can't leave disconnected infra floating in the views.
  const referenced = new Set(edges.flatMap((e) => [e.source, e.target]));
  nodes = nodes.filter((n) => referenced.has(n.id));
  return { ...topo, nodes, edges };
}

/** Top-n edges sorted desc by the metric (missing metric counts as 0; ties keep input order). */
export function rankEdges(topo: TopologySnapshot, metric: MetricName, n: number): TopoEdge[] {
  return [...topo.edges]
    .sort((a, b) => (b.metrics[metric] ?? 0) - (a.metrics[metric] ?? 0))
    .slice(0, n);
}

/**
 * Resolve an aggregated pair (TierLink source/target or matrix row/col entity
 * ids at the given level) back to the heaviest underlying TopoEdge by the
 * metric — the topology page uses it to open the hop-path panel with a real
 * `/api/paths?edge=` hash. Returns null when no underlying edge matches.
 */
export function resolveEdge(
  topo: TopologySnapshot,
  level: TierLevel,
  sourceId: string,
  targetId: string,
  metric: MetricName,
): TopoEdge | null {
  const { byNodeId } = aggregateNodes(topo, level);
  let best: TopoEdge | null = null;
  for (const e of topo.edges) {
    const s = byNodeId.get(e.source)?.id ?? e.source;
    const t = byNodeId.get(e.target)?.id ?? e.target;
    if (s !== sourceId || t !== targetId) continue;
    if (!best || (e.metrics[metric] ?? 0) > (best.metrics[metric] ?? 0)) best = e;
  }
  return best;
}
