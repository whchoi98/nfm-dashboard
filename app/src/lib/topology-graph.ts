// app/src/lib/topology-graph.ts — pure view-model builder for the WhaTap-style
// force-directed NetworkGraph (Task 6). Turns a TopologySnapshot into circle
// nodes sized by the selected metric (sqrt scale), directional links dashed by
// DATA_TRANSFERRED throughput (independent of the selected metric) and colored
// by retransmission-rate health (CNM style), self-loop totals, and status per
// node. No I/O, no layout — d3-force positioning happens in the component.
import type { DestCategory, MetricName, TopoEdge, TopoNode, TopologySnapshot } from './types';

/** Field a dense pod map can be collapsed on (Phase 14 Task 3). 'none' = no grouping (today). */
export type GroupBy = 'none' | 'namespace' | 'az' | 'cluster';

/** Metadata carried by a collapsed GROUP node (absent on plain/expanded-member nodes). */
export interface GraphNodeGroup {
  /** The field value this group collapses (e.g. a namespace name, or 'unknown'). */
  key: string;
  kind: 'group';
  /** Number of kept member nodes folded into this group. */
  memberCount: number;
  /** Always false on a rendered group node (an expanded group shows members instead). */
  expanded: boolean;
}

export interface GraphNode {
  id: string;
  label: string;
  kind: TopoNode['kind'];
  radius: number;
  traffic: number;
  /** Self-loop total in the SELECTED metric (historical field name kept). */
  selfBytes: number;
  status: 'ok' | 'warn' | 'danger' | 'idle';
  /**
   * True when >=1 rendered (post min-traffic-cut) edge connects this node to
   * an endpoint in a different `az` (Phase 14 Task 4). Either side missing
   * `az` never sets this on either endpoint — no signal, no guess.
   */
  crossAz: boolean;
  /** Present only on collapsed GROUP nodes (Phase 14 Task 3) — distinguishes them for the renderer. */
  group?: GraphNodeGroup;
}

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  /** Selected-metric value — drives the edge label and node sizing. */
  value: number;
  /** DATA_TRANSFERRED bytes/s over the window — always throughput, regardless of the selected metric. */
  rate: number;
  /** rate > rateThreshold → dashed (throughput encoding, WhaTap "bps" reference). */
  dashed: boolean;
  /**
   * Connection health from the retransmission rate (RETRANSMISSIONS per GB of
   * DATA_TRANSFERRED, CNM-style): danger ≥ healthThreshold, warn ≥ half, else
   * ok. Edges without retrans data (or without bytes) are ok.
   */
  health: 'ok' | 'warn' | 'danger';
  category: DestCategory;
}

export interface GraphModel {
  nodes: GraphNode[];
  links: GraphLink[];
  /** All nodes in the input snapshot (before tag selection). */
  total: number;
  /** Nodes actually rendered (after tag selection + min-traffic cut). */
  selected: number;
  /** Links cut by minEdgeValue (below the min-traffic threshold) — drives the "{n} hidden" UI. */
  hiddenEdgeCount: number;
}

export interface BuildGraphOpts {
  metric?: MetricName;
  /** Snapshot aggregation window used to derive per-second rates. */
  windowSeconds?: number;
  /** Links whose DATA_TRANSFERRED bytes/s rate exceeds this are drawn dashed. */
  rateThreshold?: number;
  /** Danger threshold for link health, in retransmissions per GB. */
  healthThreshold?: number;
  /** Warn threshold for link health, in retransmissions per GB. Defaults to healthThreshold/2 (today's derived formula) when omitted — set explicitly to tune it independently of the danger threshold. */
  healthWarnThreshold?: number;
  /** Tag filter: non-empty set keeps only those nodes (+ links with both ends kept). */
  selectedIds?: Set<string> | null;
  /** Node ids in reliability breach → status danger. */
  breaches?: Set<string>;
  /** Node ids in reliability warning → status warn. */
  warns?: Set<string>;
  /** [min, max] circle radius in px for the sqrt traffic scale. */
  radiusRange?: [number, number];
  /**
   * Min-traffic cut: links whose selected-metric VALUE is below this are
   * dropped from the model; a node left with no remaining link AND no
   * self-loop is dropped too (nodes that already had zero links before the
   * cut are untouched). 0 (default) = no cut — byte-identical to before
   * this option existed.
   */
  minEdgeValue?: number;
  /**
   * Node grouping (Phase 14 Task 3). 'none' (default) → output byte-identical
   * to before this option existed. Otherwise member nodes collapse into GROUP
   * nodes keyed by that field (missing field → the 'unknown' group, matching
   * analytics/aggregate entityKey), and edges between the resulting endpoints
   * aggregate into one edge per unordered pair — metrics summed (RTT averaged
   * weighted by bytes) so the SAME value/rate/health derivation applies.
   */
  groupBy?: GroupBy;
  /**
   * Group keys to re-expand: their member nodes + intra-group edges re-show
   * while every other group stays collapsed. Ignored when groupBy is 'none'.
   */
  expandedGroups?: Set<string> | string[];
}

export const DEFAULT_RATE_THRESHOLD = 128;
export const DEFAULT_WINDOW_SECONDS = 300;
export const DEFAULT_RADIUS_RANGE: [number, number] = [18, 56];
/** Danger threshold in retransmissions per GB — matches network-analytics DEFAULT_RETRANS_THRESHOLD. */
export const DEFAULT_HEALTH_THRESHOLD = 10;
/** Default warn threshold — half of DEFAULT_HEALTH_THRESHOLD (today's formula, now independently tunable via healthWarnThreshold). */
export const DEFAULT_HEALTH_WARN_THRESHOLD = DEFAULT_HEALTH_THRESHOLD / 2;
/** Default min-traffic cut — 0 = no edges hidden (today's behavior). */
export const DEFAULT_MIN_EDGE_VALUE = 0;
/** Shared empty expanded-groups set (avoids allocating one per call). */
const EMPTY_GROUPS: ReadonlySet<string> = new Set<string>();

/** Events per GB with 0-division guard: bytes=0 → 0 (no traffic ≠ infinitely bad) — same formula as analytics ratePerGb. */
function ratePerGb(events: number, bytes: number): number {
  return bytes === 0 ? 0 : events / Math.max(bytes / 1e9, 1e-9);
}

// ── node grouping (Phase 14 Task 3) ──────────────────────────────────────────
/** Fallback group for nodes missing the grouped field — matches analytics/aggregate entityKey's 'unknown'. */
const GROUP_UNKNOWN = 'unknown';

/** TopoNode field for the group level; missing → the 'unknown' group (never dropped). */
function groupKeyOf(n: TopoNode, by: Exclude<GroupBy, 'none'>): string {
  const raw = by === 'namespace' ? n.namespace : by === 'az' ? n.az : n.cluster;
  return raw ?? GROUP_UNKNOWN;
}

/** Synthetic group-node id — the `group:` prefix can't collide with a real TopoNode id. */
const groupNodeId = (by: Exclude<GroupBy, 'none'>, key: string) => `group:${by}:${key}`;

interface GroupMeta {
  key: string;
  memberCount: number;
  expanded: boolean;
}

interface GroupingResult {
  nodes: TopoNode[];
  edges: TopoEdge[];
  /** Group metadata keyed by the synthetic group-node id (collapsed groups only). */
  meta: Map<string, GroupMeta>;
}

/**
 * Collapse `keptNodes` into GROUP nodes keyed by `by` (expanded groups keep
 * their members) and aggregate edges into one per unordered effective-endpoint
 * pair: DATA_TRANSFERRED/RETRANSMISSIONS/TIMEOUTS summed, ROUND_TRIP_TIME
 * bytes-weighted-averaged. Feeds the SAME downstream value/rate/health
 * derivation as ungrouped edges (no health-formula fork). Intra-collapsed-group
 * traffic lands on a source===target self-loop, folded to the group's selfBytes
 * by the shared pipeline. Node + edge order is deterministic (input order,
 * group placed at its first member).
 */
function applyGrouping(
  keptNodes: TopoNode[],
  edges: TopoEdge[],
  by: Exclude<GroupBy, 'none'>,
  expanded: ReadonlySet<string>,
): GroupingResult {
  const keyByNode = new Map<string, string>();
  const memberCount = new Map<string, number>();
  for (const n of keptNodes) {
    const key = groupKeyOf(n, by);
    keyByNode.set(n.id, key);
    memberCount.set(key, (memberCount.get(key) ?? 0) + 1);
  }
  const keptIds = new Set(keyByNode.keys());
  const effIdOf = (id: string): string => {
    const key = keyByNode.get(id)!;
    return expanded.has(key) ? id : groupNodeId(by, key);
  };

  // Effective nodes: expanded groups' members in place; each collapsed group as
  // one node emitted at the position of its first member (stable ordering).
  const nodes: TopoNode[] = [];
  const meta = new Map<string, GroupMeta>();
  const emitted = new Set<string>();
  for (const n of keptNodes) {
    const key = keyByNode.get(n.id)!;
    if (expanded.has(key)) {
      nodes.push(n);
      continue;
    }
    const gid = groupNodeId(by, key);
    if (emitted.has(gid)) continue;
    emitted.add(gid);
    nodes.push({
      id: gid,
      kind: 'node',
      label: key,
      namespace: by === 'namespace' ? key : undefined,
      az: by === 'az' ? key : undefined,
      cluster: by === 'cluster' ? key : undefined,
    });
    meta.set(gid, { key, memberCount: memberCount.get(key) ?? 0, expanded: false });
  }

  // Aggregate edges by unordered effective pair.
  interface Agg {
    source: string;
    target: string;
    bytes: number;
    retrans: number;
    timeouts: number;
    rttWeighted: number; // Σ rtt·bytes
    rttWeightBytes: number; // Σ bytes over edges carrying rtt
    rttSum: number; // Σ rtt (fallback when all weights 0)
    rttCount: number;
    category: DestCategory;
    maxBytes: number;
  }
  const acc = new Map<string, Agg>();
  const sep = '\x1f';
  for (const e of edges) {
    if (!keptIds.has(e.source) || !keptIds.has(e.target)) continue;
    const a = effIdOf(e.source);
    const b = effIdOf(e.target);
    const [source, target] = a <= b ? [a, b] : [b, a];
    const pk = `${source}${sep}${target}`;
    let slot = acc.get(pk);
    if (!slot) {
      slot = {
        source, target,
        bytes: 0, retrans: 0, timeouts: 0,
        rttWeighted: 0, rttWeightBytes: 0, rttSum: 0, rttCount: 0,
        category: e.category, maxBytes: -Infinity,
      };
      acc.set(pk, slot);
    }
    const bytes = e.metrics.DATA_TRANSFERRED ?? 0;
    slot.bytes += bytes;
    slot.retrans += e.metrics.RETRANSMISSIONS ?? 0;
    slot.timeouts += e.metrics.TIMEOUTS ?? 0;
    const rtt = e.metrics.ROUND_TRIP_TIME;
    if (rtt != null) {
      slot.rttWeighted += rtt * bytes;
      slot.rttWeightBytes += bytes;
      slot.rttSum += rtt;
      slot.rttCount += 1;
    }
    // Representative category = the heaviest (by bytes) constituent edge.
    if (bytes >= slot.maxBytes) {
      slot.maxBytes = bytes;
      slot.category = e.category;
    }
  }

  const outEdges: TopoEdge[] = [...acc.values()].map((s) => {
    const metrics: Partial<Record<MetricName, number>> = {
      DATA_TRANSFERRED: s.bytes,
      RETRANSMISSIONS: s.retrans,
      TIMEOUTS: s.timeouts,
    };
    if (s.rttCount > 0) {
      metrics.ROUND_TRIP_TIME =
        s.rttWeightBytes > 0 ? s.rttWeighted / s.rttWeightBytes : s.rttSum / s.rttCount;
    }
    return {
      id: `agg:${s.source}${sep}${s.target}`,
      source: s.source,
      target: s.target,
      metrics,
      category: s.category,
    };
  });

  return { nodes, edges: outEdges, meta };
}

export function buildGraphModel(topo: TopologySnapshot, opts: BuildGraphOpts = {}): GraphModel {
  const metric = opts.metric ?? 'DATA_TRANSFERRED';
  const windowSeconds = opts.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const threshold = opts.rateThreshold ?? DEFAULT_RATE_THRESHOLD;
  const healthThreshold = opts.healthThreshold ?? DEFAULT_HEALTH_THRESHOLD;
  // Independently tunable; defaults to half of healthThreshold only when
  // healthWarnThreshold itself is omitted (preserves the original formula).
  const healthWarnThreshold = opts.healthWarnThreshold ?? healthThreshold / 2;
  const minEdgeValue = opts.minEdgeValue ?? DEFAULT_MIN_EDGE_VALUE;
  const [rMin, rMax] = opts.radiusRange ?? DEFAULT_RADIUS_RANGE;

  // Tag selection: an empty/absent set means "all nodes".
  const wanted = opts.selectedIds && opts.selectedIds.size > 0 ? opts.selectedIds : null;
  const keptNodes = wanted ? topo.nodes.filter((n) => wanted.has(n.id)) : topo.nodes;

  // Node grouping (Phase 14 Task 3). 'none' → identity: pipelineNodes/Edges are
  // the tag-filtered nodes + raw edges, keeping the model byte-identical. Any
  // other level collapses members into GROUP nodes + aggregate edges here, then
  // the SAME pipeline below runs over the transformed set.
  const groupBy = opts.groupBy ?? 'none';
  const expandedGroups =
    opts.expandedGroups == null
      ? EMPTY_GROUPS
      : opts.expandedGroups instanceof Set
        ? opts.expandedGroups
        : new Set(opts.expandedGroups);
  const grouped = groupBy !== 'none' ? applyGrouping(keptNodes, topo.edges, groupBy, expandedGroups) : null;
  const pipelineNodes = grouped ? grouped.nodes : keptNodes;
  const pipelineEdges = grouped ? grouped.edges : topo.edges;
  const groupMeta = grouped ? grouped.meta : null;
  const keptIds = new Set(pipelineNodes.map((n) => n.id));

  const selfBytes = new Map<string, number>();
  const allLinks: GraphLink[] = [];
  for (const e of pipelineEdges) {
    const value = e.metrics[metric] ?? 0;
    if (e.source === e.target) {
      // Self-loop: rendered as an arc on the node, not a link.
      if (keptIds.has(e.source)) selfBytes.set(e.source, (selfBytes.get(e.source) ?? 0) + value);
      continue;
    }
    if (!keptIds.has(e.source) || !keptIds.has(e.target)) continue; // dangling after selection
    // Solid/dashed always encodes DATA_TRANSFERRED throughput (bytes/s), never
    // the selected sizing/label metric — RTT or counts against a bytes/s
    // threshold would be meaningless.
    const bytes = e.metrics.DATA_TRANSFERRED ?? 0;
    const rate = bytes / windowSeconds;
    // Health always encodes retransmissions per GB of DATA_TRANSFERRED,
    // independent of the selected sizing/label metric (Datadog-CNM style).
    const retransRate = ratePerGb(e.metrics.RETRANSMISSIONS ?? 0, bytes);
    allLinks.push({
      id: e.id,
      source: e.source,
      target: e.target,
      value,
      rate,
      dashed: rate > threshold,
      health:
        retransRate >= healthThreshold ? 'danger' : retransRate >= healthWarnThreshold ? 'warn' : 'ok',
      category: e.category,
    });
  }

  // Min-traffic cut: drop links whose selected-metric VALUE (never `rate`,
  // which always stays DATA_TRANSFERRED throughput) is below minEdgeValue.
  // minEdgeValue<=0 removes nothing, so `links` stays the same array/order as
  // before this option existed — output is byte-identical by construction.
  const links = minEdgeValue > 0 ? allLinks.filter((l) => l.value >= minEdgeValue) : allLinks;
  const hiddenEdgeCount = allLinks.length - links.length;

  // Cross-AZ participation (Phase 14 Task 4): both endpoints of a RENDERED
  // (post min-traffic-cut) edge carry an `az` and the two differ. A cut edge
  // never sets the flag — it isn't drawn, so there's nothing to badge.
  const azById = new Map(pipelineNodes.map((n) => [n.id, n.az]));
  const crossAzIds = new Set<string>();
  for (const l of links) {
    const a = azById.get(l.source);
    const b = azById.get(l.target);
    if (a && b && a !== b) {
      crossAzIds.add(l.source);
      crossAzIds.add(l.target);
    }
  }

  // Nodes orphaned by the cut: had >=1 link before it, but neither a
  // remaining link nor a self-loop after. Nodes with zero links from the
  // start (already-idle floating nodes) are untouched either way.
  let orphanedIds: Set<string> = new Set();
  if (hiddenEdgeCount > 0) {
    const linkedBefore = new Set<string>();
    for (const l of allLinks) {
      linkedBefore.add(l.source);
      linkedBefore.add(l.target);
    }
    const incidentAfter = new Set<string>();
    for (const l of links) {
      incidentAfter.add(l.source);
      incidentAfter.add(l.target);
    }
    for (const [id, v] of selfBytes) if (v > 0) incidentAfter.add(id);
    orphanedIds = new Set([...linkedBefore].filter((id) => !incidentAfter.has(id)));
  }
  const renderedNodes = orphanedIds.size > 0 ? pipelineNodes.filter((n) => !orphanedIds.has(n.id)) : pipelineNodes;

  const traffic = new Map<string, number>();
  for (const l of links) {
    traffic.set(l.source, (traffic.get(l.source) ?? 0) + l.value);
    traffic.set(l.target, (traffic.get(l.target) ?? 0) + l.value);
  }
  for (const [id, v] of selfBytes) traffic.set(id, (traffic.get(id) ?? 0) + v);

  const maxTraffic = Math.max(0, ...renderedNodes.map((n) => traffic.get(n.id) ?? 0));
  const radiusOf = (v: number) =>
    maxTraffic <= 0 ? rMin : rMin + (rMax - rMin) * Math.sqrt(v / maxTraffic);

  const nodes: GraphNode[] = renderedNodes.map((n) => {
    const nodeTraffic = traffic.get(n.id) ?? 0;
    const status: GraphNode['status'] = opts.breaches?.has(n.id)
      ? 'danger'
      : opts.warns?.has(n.id)
        ? 'warn'
        : nodeTraffic === 0
          ? 'idle'
          : 'ok';
    const gm = groupMeta?.get(n.id);
    const node: GraphNode = {
      id: n.id,
      label: n.label,
      kind: n.kind,
      radius: radiusOf(nodeTraffic),
      traffic: nodeTraffic,
      selfBytes: selfBytes.get(n.id) ?? 0,
      status,
      crossAz: crossAzIds.has(n.id),
    };
    // Attach group metadata only for collapsed group nodes — plain/expanded
    // member nodes keep the exact today shape (byte-identical when groupBy=none).
    if (gm) node.group = { key: gm.key, kind: 'group', memberCount: gm.memberCount, expanded: gm.expanded };
    return node;
  });

  return { nodes, links, total: topo.nodes.length, selected: nodes.length, hiddenEdgeCount };
}
