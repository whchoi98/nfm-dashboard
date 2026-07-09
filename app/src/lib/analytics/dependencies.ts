// Dependencies analytics lens (spec §6.4). Pure functions, no I/O.
// Consumed by /api/analytics/dependencies — the route exposes these shapes as JSON verbatim.
import type { DestCategory, FlowEdge, MetricName } from '../types';
import { entityKey, groupBy, type EntityKind } from './aggregate';

// Sankey shape shared with the collector's DNS resolution map (collector/src/dns.ts):
// links reference nodes by NUMERIC index (name-collision-safe), index = first-insertion order.
export interface SankeyData {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
}
export interface PortRow { port: number; count: number; bytes: number; }
export interface NamespaceRow { key: string; bytes: number; }
export interface CategoryRow { category: DestCategory; bytes: number; }
export interface HopCount { type: string; count: number; }
export interface PathNode { name: string; value: number; children: PathNode[]; }
export interface ParetoRow { key: string; label: string; value: number; cumulativePct: number; }
export interface DependenciesLensResult {
  sankey: SankeyData;
  ports: PortRow[];
  namespaces: NamespaceRow[];
  categories: CategoryRow[];
  hops: HopCount[];
  pathTree: PathNode;
  pareto: ParetoRow[];
}

/** Unknown/absent componentType bucket for hop views. */
const OTHER = 'OTHER';

/** Only DATA_TRANSFERRED flows carry byte counts; traffic composition starts from these. */
function dataFlows(flows: FlowEdge[]): FlowEdge[] {
  return flows.filter((f) => f.metric === 'DATA_TRANSFERRED');
}

/** Direction-independent endpoint pair at the given granularity (sorted entity keys). */
function pairOf(f: FlowEdge, kind: EntityKind): [string, string] {
  const a = entityKey(f.a, kind);
  const b = entityKey(f.b, kind);
  return a <= b ? [a, b] : [b, a];
}

/**
 * service↔service Sankey from DATA_TRANSFERRED flows: nodes are service entity keys
 * (entityKey 'service' — falls back pod→ip, ns-prefixed), links a→b with bytes summed.
 * Node index is assigned on first insertion; links carry numeric indices.
 * Self-edges (a and b collapse to the same service) are skipped — Sankey layouts
 * reject circular links and a self-loop carries no dependency information.
 */
export function serviceGraph(flows: FlowEdge[]): SankeyData {
  const nodeIndex = new Map<string, number>();
  const links = new Map<string, number>(); // "srcIdx>tgtIdx" -> bytes
  for (const f of dataFlows(flows)) {
    const aKey = entityKey(f.a, 'service');
    const bKey = entityKey(f.b, 'service');
    if (aKey === bKey) continue;
    for (const key of [aKey, bKey]) if (!nodeIndex.has(key)) nodeIndex.set(key, nodeIndex.size);
    const lk = `${nodeIndex.get(aKey)}>${nodeIndex.get(bKey)}`;
    links.set(lk, (links.get(lk) ?? 0) + f.value);
  }
  return {
    nodes: [...nodeIndex.keys()].map((name) => ({ name })),
    links: [...links].map(([k, value]) => {
      const [source, target] = k.split('>').map(Number);
      return { source, target, value };
    }),
  };
}

/**
 * Traffic composition from DATA_TRANSFERRED flows, each list sorted desc by bytes:
 * - ports: per targetPort flow count + bytes (flows without targetPort are skipped),
 * - namespaces: bytes attributed to BOTH endpoint namespaces (same-ns flows counted once),
 * - categories: bytes per DestCategory.
 */
export function composition(flows: FlowEdge[]): {
  ports: PortRow[]; namespaces: NamespaceRow[]; categories: CategoryRow[];
} {
  const ports = new Map<number, { count: number; bytes: number }>();
  const namespaces = new Map<string, number>();
  const categories = new Map<DestCategory, number>();
  for (const f of dataFlows(flows)) {
    if (typeof f.targetPort === 'number') {
      const slot = ports.get(f.targetPort) ?? { count: 0, bytes: 0 };
      slot.count += 1;
      slot.bytes += f.value;
      ports.set(f.targetPort, slot);
    }
    for (const ns of new Set([entityKey(f.a, 'namespace'), entityKey(f.b, 'namespace')])) {
      namespaces.set(ns, (namespaces.get(ns) ?? 0) + f.value);
    }
    categories.set(f.category, (categories.get(f.category) ?? 0) + f.value);
  }
  return {
    ports: [...ports.entries()]
      .map(([port, s]) => ({ port, ...s }))
      .sort((x, y) => y.bytes - x.bytes || y.count - x.count || x.port - y.port),
    namespaces: [...namespaces.entries()]
      .map(([key, bytes]) => ({ key, bytes }))
      .sort((x, y) => y.bytes - x.bytes || x.key.localeCompare(y.key)),
    categories: [...categories.entries()]
      .map(([category, bytes]) => ({ category, bytes }))
      .sort((x, y) => y.bytes - x.bytes || x.category.localeCompare(y.category)),
  };
}

/** Hop-type sequence of one flow: componentType per traversed construct, missing/empty → 'OTHER'. */
function hopSequence(f: FlowEdge): string[] {
  return (f.traversedConstructs ?? []).map((c) => c.componentType || OTHER);
}

/** Traversed-construct componentType counts across all flow rows (missing → 'OTHER'), desc by count. */
export function hopUsage(flows: FlowEdge[]): HopCount[] {
  const counts = new Map<string, number>();
  for (const f of flows) {
    for (const type of hopSequence(f)) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((x, y) => y.count - x.count || x.type.localeCompare(y.type));
}

/**
 * Prefix tree of hop-type sequences for flame/icicle charts: every flow's sequence
 * (componentType order, missing → 'OTHER') is merged under a root named 'all'.
 * `value` = number of flows whose path passes through the node (root = all flows);
 * children keep first-insertion order.
 */
export function pathFrequencyTree(flows: FlowEdge[]): PathNode {
  const root: PathNode = { name: 'all', value: 0, children: [] };
  for (const f of flows) {
    root.value += 1;
    let node = root;
    for (const type of hopSequence(f)) {
      let child = node.children.find((c) => c.name === type);
      if (!child) { child = { name: type, value: 0, children: [] }; node.children.push(child); }
      child.value += 1;
      node = child;
    }
  }
  return root;
}

/**
 * Top-n talkers with a cumulative-% line: flows of `metric` grouped by
 * direction-independent entity pair, value summed, sorted desc.
 * `cumulativePct` accumulates against the grand total over ALL pairs, so the
 * last returned row reaches ≈100 only when n covers every pair (Pareto semantics).
 */
export function paretoTalkers(
  flows: FlowEdge[],
  kind: EntityKind = 'service',
  metric: MetricName = 'DATA_TRANSFERRED',
  n = 20,
): ParetoRow[] {
  const groups = groupBy(flows.filter((f) => f.metric === metric), (f) => pairOf(f, kind).join('|'));
  const rows: { key: string; label: string; value: number }[] = [];
  let total = 0;
  for (const [key, group] of groups) {
    const [a, b] = pairOf(group[0], kind);
    let value = 0;
    for (const f of group) value += f.value;
    total += value;
    rows.push({ key, label: a === b ? a : `${a} ↔ ${b}`, value });
  }
  rows.sort((x, y) => y.value - x.value || x.key.localeCompare(y.key));
  let running = 0;
  return rows.slice(0, n).map((r) => {
    running += r.value;
    return { ...r, cumulativePct: total === 0 ? 0 : (running / total) * 100 };
  });
}

/** Spec §6.4 response for /api/analytics/dependencies. */
export function dependenciesLens(flows: FlowEdge[]): DependenciesLensResult {
  const { ports, namespaces, categories } = composition(flows);
  return {
    sankey: serviceGraph(flows),
    ports,
    namespaces,
    categories,
    hops: hopUsage(flows),
    pathTree: pathFrequencyTree(flows),
    pareto: paretoTalkers(flows),
  };
}
