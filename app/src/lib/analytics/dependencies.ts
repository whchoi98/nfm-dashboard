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
export interface ConcentrationResult {
  /** Shannon entropy normalized by ln(n): 0 = all traffic in one pair, 1 = evenly spread. */
  entropy: number;
  /** Gini coefficient over pair shares: 0 = perfectly even, →1 = concentrated. */
  gini: number;
  /** Largest single pair's share of total traffic (0..1). */
  topShare: number;
  /** Number of pairs with a positive total. */
  n: number;
}
export interface DependenciesLensResult {
  sankey: SankeyData;
  /** True when the sankey was capped to SANKEY_MAX_LINKS (UI shows a top-N caption). */
  sankeyTruncated: boolean;
  ports: PortRow[];
  namespaces: NamespaceRow[];
  categories: CategoryRow[];
  hops: HopCount[];
  pathTree: PathNode;
  /** True when pathTree breadth was capped to PATH_TREE_MAX_CHILDREN. */
  pathTreeTruncated: boolean;
  pareto: ParetoRow[];
  /** Traffic-concentration scalars over the same pair grouping as `pareto`. */
  concentration: ConcentrationResult;
}

// Legibility caps (§16 polish). Live windows produce hundreds of sankey links
// (observed ~268 nodes / 461 links) whose node rects render sub-pixel — an
// unreadable hairball. Only the top flows survive; the UI shows a caption when
// a cap actually dropped anything. Raise with care: legibility degrades fast
// past ~50 links at widget width.
export const SANKEY_MAX_LINKS = 40;
export const PATH_TREE_MAX_CHILDREN = 12;

/**
 * Cap a SankeyData to the top `maxLinks` links by value, keeping ONLY nodes
 * referenced by a kept link and remapping link indices to the compacted node
 * array. Graphs already within the cap pass through by reference (unchanged).
 * Also used client-side for the collector-built DNS resolution sankey, so
 * out-of-range link indices are dropped defensively before remapping.
 */
export function capSankeyLinks(
  data: SankeyData,
  maxLinks: number = SANKEY_MAX_LINKS,
): { data: SankeyData; truncated: boolean } {
  if (data.links.length <= maxLinks) return { data, truncated: false };
  const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < data.nodes.length;
  const kept = data.links
    .filter((l) => inRange(l.source) && inRange(l.target))
    .sort((a, b) => b.value - a.value)
    .slice(0, maxLinks);
  const remap = new Map<number, number>(); // old node index -> compacted index
  for (const l of kept) {
    for (const i of [l.source, l.target]) if (!remap.has(i)) remap.set(i, remap.size);
  }
  return {
    data: {
      nodes: [...remap.keys()].map((i) => data.nodes[i]),
      links: kept.map((l) => ({
        source: remap.get(l.source)!,
        target: remap.get(l.target)!,
        value: l.value,
      })),
    },
    truncated: true,
  };
}

/**
 * Cap a PathNode tree's breadth: at every level keep only the top
 * `maxChildren` children by value (first-insertion order preserved among
 * survivors) and drop the rest — dropped weight simply narrows the icicle row
 * (layout divides by the children sum, so no over-100% widths). Trees already
 * within the cap pass through by reference; the input is never mutated.
 */
export function capPathTreeBreadth(
  root: PathNode,
  maxChildren: number = PATH_TREE_MAX_CHILDREN,
): { tree: PathNode; truncated: boolean } {
  let truncated = false;
  const walk = (n: PathNode): PathNode => {
    let children = n.children;
    if (children.length > maxChildren) {
      truncated = true;
      const keep = new Set([...children].sort((a, b) => b.value - a.value).slice(0, maxChildren));
      children = children.filter((c) => keep.has(c));
    }
    return { ...n, children: children.map(walk) };
  };
  const tree = walk(root);
  return truncated ? { tree, truncated: true } : { tree: root, truncated: false };
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
 * (entityKey 'service' — falls back pod→ip, ns-prefixed), ONE link per UNORDERED
 * service pair with bytes of both directions summed. Mutual a→b/b→a traffic would
 * otherwise form a 2-node cycle whose losing direction the Sankey cycle-guard drops
 * in scan order (non-deterministic under-report); collapsing here orients each link
 * deterministically: source = lexicographically smaller key, target = larger.
 * Node index is assigned on first insertion; links carry numeric indices.
 * Self-edges (a and b collapse to the same service) are skipped — Sankey layouts
 * reject circular links and a self-loop carries no dependency information.
 */
export function serviceGraph(flows: FlowEdge[]): SankeyData {
  const nodeIndex = new Map<string, number>();
  // "lo\x1fhi" (sorted keys, unit-separator escape avoids label collisions) -> bytes.
  const pairs = new Map<string, number>();
  for (const f of dataFlows(flows)) {
    const [lo, hi] = pairOf(f, 'service');
    if (lo === hi) continue;
    for (const key of [lo, hi]) if (!nodeIndex.has(key)) nodeIndex.set(key, nodeIndex.size);
    const pk = `${lo}\x1f${hi}`;
    pairs.set(pk, (pairs.get(pk) ?? 0) + f.value);
  }
  return {
    nodes: [...nodeIndex.keys()].map((name) => ({ name })),
    links: [...pairs].map(([pk, value]) => {
      const [lo, hi] = pk.split('\x1f');
      return { source: nodeIndex.get(lo)!, target: nodeIndex.get(hi)!, value };
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

/**
 * Traversed-construct componentType counts (missing → 'OTHER'), desc by count.
 * Only DATA_TRANSFERRED rows are counted — the collector emits one row per metric
 * per edge, so counting all rows would tally the same physical flow up to 4 times.
 */
export function hopUsage(flows: FlowEdge[]): HopCount[] {
  const counts = new Map<string, number>();
  for (const f of dataFlows(flows)) {
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
 * children keep first-insertion order. Only DATA_TRANSFERRED rows are counted so
 * each physical flow contributes exactly once (see hopUsage).
 */
export function pathFrequencyTree(flows: FlowEdge[]): PathNode {
  const root: PathNode = { name: 'all', value: 0, children: [] };
  for (const f of dataFlows(flows)) {
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
 * Per-pair totals of `metric`, grouped by direction-independent entity pair
 * (insertion order). Single source of the pair-keying/summing shared by
 * paretoTalkers and concentration — do not fork this grouping.
 */
function pairTotals(
  flows: FlowEdge[],
  kind: EntityKind,
  metric: MetricName,
): { key: string; label: string; value: number }[] {
  const groups = groupBy(flows.filter((f) => f.metric === metric), (f) => pairOf(f, kind).join('|'));
  const rows: { key: string; label: string; value: number }[] = [];
  for (const [key, group] of groups) {
    const [a, b] = pairOf(group[0], kind);
    let value = 0;
    for (const f of group) value += f.value;
    rows.push({ key, label: a === b ? a : `${a} ↔ ${b}`, value });
  }
  return rows;
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
  const rows = pairTotals(flows, kind, metric);
  let total = 0;
  for (const r of rows) total += r.value;
  rows.sort((x, y) => y.value - x.value || x.key.localeCompare(y.key));
  let running = 0;
  return rows.slice(0, n).map((r) => {
    running += r.value;
    return { ...r, cumulativePct: total === 0 ? 0 : (running / total) * 100 };
  });
}

/**
 * Traffic-concentration scalars over per-pair totals (same grouping as
 * paretoTalkers): normalized Shannon entropy (0 = one pair carries everything,
 * 1 = evenly spread), Gini coefficient, and the top pair's share of the total.
 * Pairs with non-positive totals are ignored; empty input → all zeros (no NaN).
 */
export function concentration(
  flows: FlowEdge[],
  kind: EntityKind = 'service',
  metric: MetricName = 'DATA_TRANSFERRED',
): ConcentrationResult {
  const vals = pairTotals(flows, kind, metric)
    .map((r) => r.value)
    .filter((v) => v > 0)
    .sort((x, y) => y - x);
  const n = vals.length;
  if (n === 0) return { entropy: 0, gini: 0, topShare: 0, n: 0 };
  const total = vals.reduce((s, v) => s + v, 0);
  const shares = vals.map((v) => v / total);
  const entropy =
    n === 1 ? 0 : -shares.reduce((s, p) => s + (p > 0 ? p * Math.log(p) : 0), 0) / Math.log(n);
  // Gini: G = (2*Σ i*x_i)/(n*Σ x_i) - (n+1)/n over ascending totals, i 1-based.
  const asc = [...vals].sort((x, y) => x - y);
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * asc[i];
  const gini = n === 1 ? 0 : (2 * cum) / (n * total) - (n + 1) / n;
  return { entropy, gini, topShare: shares[0], n };
}

/** Spec §6.4 response for /api/analytics/dependencies (sankey/pathTree capped for legibility). */
export function dependenciesLens(flows: FlowEdge[]): DependenciesLensResult {
  const { ports, namespaces, categories } = composition(flows);
  const sankey = capSankeyLinks(serviceGraph(flows));
  const pathTree = capPathTreeBreadth(pathFrequencyTree(flows));
  return {
    sankey: sankey.data,
    sankeyTruncated: sankey.truncated,
    ports,
    namespaces,
    categories,
    hops: hopUsage(flows),
    pathTree: pathTree.tree,
    pathTreeTruncated: pathTree.truncated,
    pareto: paretoTalkers(flows),
    concentration: concentration(flows),
  };
}
