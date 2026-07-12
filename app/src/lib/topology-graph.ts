// app/src/lib/topology-graph.ts — pure view-model builder for the WhaTap-style
// force-directed NetworkGraph (Task 6). Turns a TopologySnapshot into circle
// nodes sized by the selected metric (sqrt scale), directional links dashed by
// DATA_TRANSFERRED throughput (independent of the selected metric) and colored
// by retransmission-rate health (CNM style), self-loop totals, and status per
// node. No I/O, no layout — d3-force positioning happens in the component.
import type { DestCategory, MetricName, TopoNode, TopologySnapshot } from './types';

export interface GraphNode {
  id: string;
  label: string;
  kind: TopoNode['kind'];
  radius: number;
  traffic: number;
  /** Self-loop total in the SELECTED metric (historical field name kept). */
  selfBytes: number;
  status: 'ok' | 'warn' | 'danger' | 'idle';
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

/** Events per GB with 0-division guard: bytes=0 → 0 (no traffic ≠ infinitely bad) — same formula as analytics ratePerGb. */
function ratePerGb(events: number, bytes: number): number {
  return bytes === 0 ? 0 : events / Math.max(bytes / 1e9, 1e-9);
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
  const keptIds = new Set(keptNodes.map((n) => n.id));

  const selfBytes = new Map<string, number>();
  const allLinks: GraphLink[] = [];
  for (const e of topo.edges) {
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
  const renderedNodes = orphanedIds.size > 0 ? keptNodes.filter((n) => !orphanedIds.has(n.id)) : keptNodes;

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
    return {
      id: n.id,
      label: n.label,
      kind: n.kind,
      radius: radiusOf(nodeTraffic),
      traffic: nodeTraffic,
      selfBytes: selfBytes.get(n.id) ?? 0,
      status,
    };
  });

  return { nodes, links, total: topo.nodes.length, selected: nodes.length, hiddenEdgeCount };
}
