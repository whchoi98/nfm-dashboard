// app/src/lib/topology-graph.ts — pure view-model builder for the WhaTap-style
// force-directed NetworkGraph (Task 6). Turns a TopologySnapshot into circle
// nodes sized by the selected metric (sqrt scale), directional links dashed by
// DATA_TRANSFERRED throughput (independent of the selected metric), self-loop
// totals, and status per node. No I/O, no layout — d3-force positioning
// happens in the component.
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
  category: DestCategory;
}

export interface GraphModel {
  nodes: GraphNode[];
  links: GraphLink[];
  /** All nodes in the input snapshot (before tag selection). */
  total: number;
  /** Nodes actually rendered (after tag selection). */
  selected: number;
}

export interface BuildGraphOpts {
  metric?: MetricName;
  /** Snapshot aggregation window used to derive per-second rates. */
  windowSeconds?: number;
  /** Links whose DATA_TRANSFERRED bytes/s rate exceeds this are drawn dashed. */
  rateThreshold?: number;
  /** Tag filter: non-empty set keeps only those nodes (+ links with both ends kept). */
  selectedIds?: Set<string> | null;
  /** Node ids in reliability breach → status danger. */
  breaches?: Set<string>;
  /** Node ids in reliability warning → status warn. */
  warns?: Set<string>;
  /** [min, max] circle radius in px for the sqrt traffic scale. */
  radiusRange?: [number, number];
}

export const DEFAULT_RATE_THRESHOLD = 128;
export const DEFAULT_WINDOW_SECONDS = 300;
export const DEFAULT_RADIUS_RANGE: [number, number] = [18, 56];

export function buildGraphModel(topo: TopologySnapshot, opts: BuildGraphOpts = {}): GraphModel {
  const metric = opts.metric ?? 'DATA_TRANSFERRED';
  const windowSeconds = opts.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const threshold = opts.rateThreshold ?? DEFAULT_RATE_THRESHOLD;
  const [rMin, rMax] = opts.radiusRange ?? DEFAULT_RADIUS_RANGE;

  // Tag selection: an empty/absent set means "all nodes".
  const wanted = opts.selectedIds && opts.selectedIds.size > 0 ? opts.selectedIds : null;
  const keptNodes = wanted ? topo.nodes.filter((n) => wanted.has(n.id)) : topo.nodes;
  const keptIds = new Set(keptNodes.map((n) => n.id));

  const selfBytes = new Map<string, number>();
  const traffic = new Map<string, number>();
  const links: GraphLink[] = [];
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
    links.push({
      id: e.id,
      source: e.source,
      target: e.target,
      value,
      rate,
      dashed: rate > threshold,
      category: e.category,
    });
    traffic.set(e.source, (traffic.get(e.source) ?? 0) + value);
    traffic.set(e.target, (traffic.get(e.target) ?? 0) + value);
  }
  for (const [id, v] of selfBytes) traffic.set(id, (traffic.get(id) ?? 0) + v);

  const maxTraffic = Math.max(0, ...keptNodes.map((n) => traffic.get(n.id) ?? 0));
  const radiusOf = (v: number) =>
    maxTraffic <= 0 ? rMin : rMin + (rMax - rMin) * Math.sqrt(v / maxTraffic);

  const nodes: GraphNode[] = keptNodes.map((n) => {
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

  return { nodes, links, total: topo.nodes.length, selected: nodes.length };
}
