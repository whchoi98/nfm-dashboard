'use client';

// NetworkGraph (Task 6, health coloring Task 4/Phase 9) — WhaTap-style
// force-directed node-link topology. buildGraphModel(topology) → circle nodes
// sized by traffic (sqrt scale) with status colors + self-loop arcs, and
// curved directional edges labeled with the selected metric. Edge encoding
// (CNM style): STROKE COLOR = retransmission-rate health (STATUS ok/warn/
// danger), WIDTH = selected-metric value (sqrt scale), DASH = DATA_TRANSFERRED
// throughput > threshold.
// Layout (Phase 14 Task 5 — deterministic + persistent): d3-force simulation
// run for ~300 ticks up-front in a memo keyed by the structural node/link id
// set, seeded from `seedPosition` (a hash of the node id — see
// `@/lib/graph-layout`) rather than d3-force's own array-index-based default,
// so the SAME node id always starts from the SAME point and the layout is
// reproducible across reloads. A ref-backed position cache (mirrored to
// localStorage) remembers every node's last computed/dragged position; a
// structural change (filter/level/groupBy) reseeds persisting node ids from
// that cache instead of the id hash, so the layout settles back near where it
// was instead of fully reshuffling. Node positions then live in local state
// (useNodesState): manual drags persist across value-only polls and focus
// changes; positions reset only when the structural layoutKey changes.
// Replaces TierFlowMap in the /topology "graph" view.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  useNodesState,
  type Edge as RFEdge,
  type EdgeProps,
  type Node as RFNode,
  type NodeProps,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import { ArrowLeftRight, TriangleAlert } from 'lucide-react';
import type { MetricName, TopologySnapshot } from '@/lib/types';
import { buildGraphModel, type GraphLink, type GraphModel, type GraphNode, type GroupBy } from '@/lib/topology-graph';
import { neighbors } from '@/lib/graph-focus';
import { graphSignature, seedPosition } from '@/lib/graph-layout';
import { nodeResourceKind } from '@/lib/topology';
import { KIND_META } from './ResourceIcon';
import { STATUS, TOKENS } from '@/lib/chart-tokens';
import { formatMetricValue } from '@/lib/format';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const HOPS: (1 | 2)[] = [1, 2];

const statusColor = (s: GraphNode['status']) => (s === 'idle' ? TOKENS.chartGrey : STATUS[s]);

// ── custom circle node ──────────────────────────────────────────────────────
interface CircleNodeData extends GraphNode {
  focused: boolean;
  /** Active metric — the self-loop label must match the edge labels' unit. */
  metric: MetricName;
  selfLoopTitle: string;
  /** Dimmed when a legend health-class filter is active and this node has no edge in that class (Phase 14 Task 1). */
  muted: boolean;
  /** "{n} members" for a group node's badge tooltip (Phase 14 Task 3). */
  membersLabel?: string;
  /** Tooltip for the kind icon (Phase 14 Task 4) — e.g. "Pod"/"Node"/"VPC"/"External". */
  kindLabel: string;
  /** Tooltip for the cross-AZ corner badge. */
  crossAzLabel: string;
  /**
   * True when >=1 rendered edge touching this node is retransmission-rate
   * 'danger' (GraphLink.health, NOT the breach/warn-derived GraphNode.status —
   * this page never wires breaches/warns, so status alone would never fire).
   * Computed in the component from `visibleLinks`, same pattern as
   * `nodesInHealthClass` below (Phase 14 Task 4) — presentational, no model change.
   */
  highRetrans: boolean;
  /** Tooltip for the high-retransmit corner badge. */
  highRetransLabel: string;
}

// Both handles sit invisibly at the circle center so edges run center→center;
// the custom edge trims each end back to the circle boundary.
const centerHandle: React.CSSProperties = {
  left: '50%',
  top: '50%',
  transform: 'translate(-50%,-50%)',
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 0,
  opacity: 0,
  pointerEvents: 'none',
};

function CircleNodeView({ data }: NodeProps<CircleNodeData>) {
  const color = statusColor(data.status);
  // Group nodes are drawn as a rounded-SQUARE (shape channel — COLOR stays
  // reserved for health) with a member-count badge (Phase 14 Task 3).
  const isGroup = data.group != null;
  const size = data.radius * 2;
  // Shape distinguishes a group from a pod even at the same health color.
  const cornerCls = isGroup ? 'rounded-2xl' : 'rounded-full';
  // Kind icon (Phase 14 Task 4) — SHAPE-only channel, no per-kind color, so the
  // circle's fill/border stays the sole health-color read. Group nodes render
  // their own rounded-square + member badge instead (no kind — a group folds
  // many kinds together).
  const KindIcon = KIND_META[nodeResourceKind(data.kind)].icon;
  const iconSize = Math.max(12, Math.min(size * 0.42, 26));
  return (
    <div
      className="relative cursor-pointer"
      style={{ width: size, height: size, opacity: data.muted ? 0.25 : 1 }}
      title={isGroup && data.membersLabel ? `${data.label} · ${data.membersLabel}` : data.label}
    >
      <Handle type="target" position={Position.Top} style={centerHandle} />
      <Handle type="source" position={Position.Bottom} style={centerHandle} />
      {/* translucent fill layer (keeps border + ring fully opaque) */}
      <div className={`absolute inset-0 opacity-40 ${cornerCls}`} style={{ backgroundColor: color }} />
      <div
        className={`absolute inset-0 border-2 ${cornerCls}`}
        style={{
          borderColor: color,
          // Group nodes get a heavier ring so they read as containers.
          borderStyle: isGroup ? 'double' : 'solid',
          borderWidth: isGroup ? 4 : 2,
          // Blue focus ring on the clicked node (WhaTap reference).
          boxShadow: data.focused ? `0 0 0 3px ${TOKENS.chartBlue}` : undefined,
        }}
      />
      {/* group member-count badge — dual-encodes the "group" identity with text */}
      {isGroup ? (
        <span
          data-testid="topology-group-badge"
          className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-bold tabular-nums text-white ring-2 ring-white dark:bg-white dark:text-ink dark:ring-ink"
          title={data.membersLabel}
        >
          {data.group!.memberCount}
        </span>
      ) : null}
      {/* kind icon (Phase 14 Task 4) — regular nodes only; group nodes keep their
          distinct shape + member badge instead. currentColor only: shape is the
          encoding, not a new hue. */}
      {!isGroup ? (
        <span
          data-testid="topology-node-kind"
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-ink/55 dark:text-white/70"
          title={data.kindLabel}
        >
          <KindIcon size={iconSize} strokeWidth={1.75} aria-hidden />
        </span>
      ) : null}
      {/* cross-AZ badge (Phase 14 Task 4) — shape + tooltip only, same neutral
          pill as the group badge above: no new color axis. */}
      {data.crossAz ? (
        <span
          data-testid="topology-node-badge-crossaz"
          className="absolute -left-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink text-white ring-2 ring-white dark:bg-white dark:text-ink dark:ring-ink"
          title={data.crossAzLabel}
        >
          <ArrowLeftRight size={9} strokeWidth={2.25} aria-hidden />
        </span>
      ) : null}
      {/* high-retransmit badge (Phase 14 Task 4) — fires when >=1 rendered edge
          touching this node is retransmission-rate 'danger' (the SAME signal
          already drawn as that edge's STATUS.danger stroke), so the badge
          re-states an existing color, never introduces one; shape + tooltip
          make it legible without relying on color at all. */}
      {data.highRetrans ? (
        <span
          data-testid="topology-node-badge-retrans"
          className="absolute -right-1.5 -bottom-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink text-white ring-2 ring-white dark:bg-white dark:text-ink dark:ring-ink"
          title={data.highRetransLabel}
        >
          <TriangleAlert size={9} strokeWidth={2.25} aria-hidden />
        </span>
      ) : null}
      {/* self-loop: arc anchored on top of the circle + its selected-metric total */}
      {data.selfBytes > 0 ? (
        <div
          className="absolute -top-7 left-1/2 flex -translate-x-1/2 flex-col items-center"
          title={data.selfLoopTitle}
        >
          <span className="whitespace-nowrap text-[9px] font-medium tabular-nums text-ink/70 dark:text-white/70">
            {formatMetricValue(data.metric, data.selfBytes)}
          </span>
          <svg width="30" height="16" aria-hidden>
            <path d="M4,15 C4,2 26,2 26,15" fill="none" stroke={color} strokeWidth="1.5" />
            <path d="M23,10 L26,15 L20,14 Z" fill={color} />
          </svg>
        </div>
      ) : null}
      <span
        className="absolute left-1/2 top-full mt-1 max-w-[9rem] -translate-x-1/2 truncate whitespace-nowrap text-center text-[10px] font-semibold text-ink dark:text-white"
        style={{ maxWidth: Math.max(size + 48, 96) }}
      >
        {data.label}
      </span>
    </div>
  );
}

// ── custom curved edge ──────────────────────────────────────────────────────
// Edge stroke width range (px) for the selected-metric sqrt scale.
const EDGE_WIDTH_RANGE: [number, number] = [1.25, 4];

interface CurvedEdgeData {
  value: number;
  metric: MetricName;
  dashed: boolean;
  /** Retransmission-rate health — drives the stroke color (STATUS, dual-encoded by the legend). */
  health: GraphLink['health'];
  /** Stroke width in px — selected-metric value on the sqrt EDGE_WIDTH_RANGE scale. */
  width: number;
  muted: boolean;
  sourceRadius: number;
  targetRadius: number;
}

function CurvedEdgeView({ id, sourceX, sourceY, targetX, targetY, data, markerEnd }: EdgeProps<CurvedEdgeData>) {
  if (!data) return null;
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Trim endpoints from circle centers to boundaries (+gap for the arrowhead).
  const sx = sourceX + ux * data.sourceRadius;
  const sy = sourceY + uy * data.sourceRadius;
  const tx = targetX - ux * (data.targetRadius + 3);
  const ty = targetY - uy * (data.targetRadius + 3);
  // Perpendicular bend: opposite directions of a bidirectional pair curve apart.
  const bend = Math.min(44, len * 0.16);
  const cx = (sx + tx) / 2 - uy * bend;
  const cy = (sy + ty) / 2 + ux * bend;
  const path = `M ${sx},${sy} Q ${cx},${cy} ${tx},${ty}`;
  // Quadratic bezier point at t=0.5 → label anchor.
  const labelX = 0.25 * sx + 0.5 * cx + 0.25 * tx;
  const labelY = 0.25 * sy + 0.5 * cy + 0.25 * ty;
  const color = STATUS[data.health];
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: data.width,
          strokeDasharray: data.dashed ? '6 4' : undefined,
          opacity: data.muted ? 0.2 : 1,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute rounded-full bg-white/85 px-1.5 py-px text-[9px] font-medium tabular-nums text-ink/80 dark:bg-ink/85 dark:text-white/80"
          style={{
            transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
            opacity: data.muted ? 0.25 : 1,
            pointerEvents: 'none',
          }}
        >
          {formatMetricValue(data.metric, data.value)}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

// Defined once at module scope — React Flow warns if these are recreated per render.
const nodeTypes = { circle: CircleNodeView };
const edgeTypes = { curved: CurvedEdgeView };

// ── d3-force layout (pure, run to completion) ───────────────────────────────
interface SimNode extends SimulationNodeDatum {
  id: string;
  r: number;
}

/**
 * Any node id already present in `knownPositions` (the persisted cache —
 * prior computed layouts + manual drags) is PINNED there via d3-force's
 * `fx`/`fy` (fixed position): a fresh `forceSimulation` restarts alpha at 1,
 * so merely seeding a node's starting x/y and letting the n-body forces run
 * another 300 ticks does NOT reproduce the same resting point — the
 * full-strength charge/collide/link forces relitigate the whole layout from
 * scratch and chaotically amplify any tiny difference (that's what caused
 * positions to drift on every reload before this fix). Pinning removes the
 * ambiguity entirely: a pinned node cannot move, full stop, while it still
 * exerts/receives forces on its unpinned neighbors. Only a node with NO known
 * position (genuinely new) free-seeds from `seedPosition(id)` (a hash of the
 * id, not the array index, so the SAME id always starts from the SAME point)
 * and settles into the gaps around the pinned nodes via the simulation.
 */
function computeLayout(
  model: GraphModel,
  knownPositions: ReadonlyMap<string, { x: number; y: number }>,
): Map<string, { x: number; y: number }> {
  const simNodes: SimNode[] = model.nodes.map((n) => {
    const known = knownPositions.get(n.id);
    const seed = known ?? seedPosition(n.id);
    return known
      ? { id: n.id, r: n.radius, x: seed.x, y: seed.y, fx: seed.x, fy: seed.y }
      : { id: n.id, r: n.radius, x: seed.x, y: seed.y };
  });
  const simLinks: SimulationLinkDatum<SimNode>[] = model.links.map((l) => ({
    source: l.source,
    target: l.target,
  }));
  const sim = forceSimulation(simNodes)
    .force('link', forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks).id((d) => d.id).distance(170).strength(0.3))
    .force('charge', forceManyBody().strength(-520))
    .force('center', forceCenter(0, 0))
    // Weak gravity keeps disconnected components from drifting far apart,
    // so fitView doesn't shrink the connected core to dots.
    .force('x', forceX(0).strength(0.08))
    .force('y', forceY(0).strength(0.08))
    .force('collide', forceCollide<SimNode>((d) => d.r + 30))
    .stop();
  sim.tick(300);
  return new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
}

// ── position persistence (Phase 14 Task 5) ──────────────────────────────────
// Manual drags + computed layouts persist to localStorage so spatial memory
// survives a reload, keyed by a signature of the FULL topology's node-id set
// (not the currently-filtered view) — so flipping a filter/metric/groupBy
// never invalidates positions for nodes outside today's view. Restore is
// opportunistic PER-ID rather than gated on an exact signature match: a pod
// cycling to a new suffix between polls is normal topology drift, not "a
// different graph", so every surviving id simply keeps reusing its last known
// spot regardless of whether the overall set matches byte-for-byte.
const POSITIONS_STORAGE_KEY = 'nfm-topology-positions';
/** Skip persisting past this many entries — a pathological topology shouldn't grow localStorage unbounded. */
const MAX_PERSISTED_NODES = 3000;

interface StoredLayout {
  signature: string;
  positions: Record<string, { x: number; y: number }>;
}

function loadStoredPositions(): Map<string, { x: number; y: number }> {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = window.localStorage.getItem(POSITIONS_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Partial<StoredLayout> | null;
    const entries = Object.entries(parsed?.positions ?? {}).filter(
      (entry): entry is [string, { x: number; y: number }] => {
        const p = entry[1] as { x?: unknown; y?: unknown } | null | undefined;
        return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
      },
    );
    return new Map(entries);
  } catch {
    return new Map(); // corrupt JSON / storage unavailable — start fresh, no crash.
  }
}

function persistPositions(signature: string, cache: ReadonlyMap<string, { x: number; y: number }>) {
  if (typeof window === 'undefined' || cache.size === 0 || cache.size > MAX_PERSISTED_NODES) return;
  try {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const [id, p] of cache) positions[id] = p;
    window.localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify({ signature, positions }));
  } catch {
    // Storage full / unavailable (private mode) — position memory degrades to session-only, no crash.
  }
}

// ── component ───────────────────────────────────────────────────────────────
function NetworkGraphInner({
  topology,
  metric,
  selectedIds = null,
  breaches,
  warns,
  focusId = null,
  onNodeSelect,
  onLinkSelect,
  minEdgeValue = 0,
  healthThreshold,
  healthWarnThreshold,
  healthFilter = null,
  groupBy = 'none',
  expandedGroups,
  onGroupToggle,
}: {
  topology: TopologySnapshot;
  metric: MetricName;
  selectedIds?: Set<string> | null;
  breaches?: Set<string>;
  warns?: Set<string>;
  focusId?: string | null;
  /** Also fired with `null` to clear focus (ESC / empty-canvas click / clear-focus button). */
  onNodeSelect?: (id: string | null) => void;
  onLinkSelect?: (source: string, target: string) => void;
  /** Min-traffic threshold (Phase 14 Task 1) — links below this VALUE are cut. */
  minEdgeValue?: number;
  /** Tunable edge-health thresholds (retransmissions per GB); default to topology-graph's own defaults when omitted. */
  healthThreshold?: number;
  healthWarnThreshold?: number;
  /** Active legend isolate filter — edges/nodes outside this health class are dimmed. */
  healthFilter?: GraphLink['health'] | null;
  /** Node grouping level (Phase 14 Task 3) — collapses members into group nodes. */
  groupBy?: GroupBy;
  /** Group keys currently expanded to their members. */
  expandedGroups?: Set<string>;
  /** Fired when a collapsed group node is clicked — the page toggles its expansion. */
  onGroupToggle?: (key: string) => void;
}) {
  const { t } = useLanguage();

  const model = useMemo(
    () =>
      buildGraphModel(topology, {
        metric,
        selectedIds,
        breaches,
        warns,
        minEdgeValue,
        healthThreshold,
        healthWarnThreshold,
        groupBy,
        expandedGroups,
      }),
    [topology, metric, selectedIds, breaches, warns, minEdgeValue, healthThreshold, healthWarnThreshold, groupBy, expandedGroups],
  );

  // Layout is keyed by the structural identity (sorted node + link id sets) so
  // poll refreshes that only change metric values keep every position stable.
  const layoutKey = useMemo(
    () =>
      `${model.nodes.map((n) => n.id).sort().join('|')}⇢${model.links.map((l) => l.id).sort().join('|')}`,
    [model],
  );

  // Position persistence (Phase 14 Task 5): lazy-init once from localStorage
  // (same synchronous-during-render pattern as the `synced` ref below), then
  // mutated in place by drags + the layout-merge effect further down — never
  // through setState, since it must be readable synchronously inside the
  // `positions` memo without itself becoming a re-render trigger.
  const positionCacheRef = useRef<Map<string, { x: number; y: number }> | null>(null);
  if (positionCacheRef.current == null) {
    positionCacheRef.current = loadStoredPositions();
  }
  // Keyed on the FULL topology's node-id set (not the filtered view) so a
  // filter/metric/groupBy change never rewrites the storage key.
  const topologySignature = useMemo(() => graphSignature(topology.nodes.map((n) => n.id)), [topology]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on layoutKey by design
  const positions = useMemo(() => computeLayout(model, positionCacheRef.current!), [layoutKey]);

  // Every freshly computed layout (a structural change, incl. the very first
  // mount) feeds back into the durable cache + localStorage, so the NEXT
  // structural change — and the next reload — seeds persisting node ids from
  // here instead of `seedPosition`, which is what keeps them from reshuffling.
  useEffect(() => {
    const cache = positionCacheRef.current;
    if (!cache) return;
    for (const [id, p] of positions) cache.set(id, p);
    persistPositions(topologySignature, cache);
  }, [positions, topologySignature]);

  // Focus only counts while the focused node exists in the current model — a
  // stale focusId (node unchecked, filter narrowed, poll churn) would
  // otherwise isolate down to nothing with no focus ring to recover from.
  const focusPresent = focusId != null && model.nodes.some((n) => n.id === focusId);
  const activeFocusId = focusPresent ? focusId : null;

  // Click-to-isolate ego-network (Phase 14 Task 2): 1 or 2 hop toggle,
  // default 1. Resets to 1 on EVERY focus change (clear or A→B pivot) so
  // focusing any node always starts from the tightest view.
  const [hops, setHops] = useState<1 | 2>(1);
  useEffect(() => {
    setHops(1);
  }, [activeFocusId]);
  const ego = useMemo(
    () => (activeFocusId != null ? neighbors(model.links, activeFocusId, hops) : null),
    [model, activeFocusId, hops],
  );
  // Memoized (not a plain .filter() on every render): the result feeds the
  // layoutNodes memo below, whose array identity drives a state sync during
  // render (see `synced` further down) — a fresh array reference every
  // render there would re-trigger that sync every render, an infinite loop.
  const { visibleNodes, visibleLinks } = useMemo(
    () =>
      ego == null
        ? { visibleNodes: model.nodes, visibleLinks: model.links }
        : {
            visibleNodes: model.nodes.filter((n) => ego.nodeIds.has(n.id)),
            visibleLinks: model.links.filter((l) => ego.edgeIds.has(l.id)),
          },
    [model, ego],
  );

  // Legend isolate filter (Phase 14 Task 1): nodes touching >=1 edge in the
  // active health class stay full-opacity; everything else dims. A self-loop
  // has no health classification, so a node with only a self-loop dims too
  // when a filter is active — it isn't part of that edge-health class.
  const nodesInHealthClass = useMemo(
    () =>
      healthFilter == null
        ? null
        : new Set(visibleLinks.filter((l) => l.health === healthFilter).flatMap((l) => [l.source, l.target])),
    [visibleLinks, healthFilter],
  );

  // High-retransmit badge (Phase 14 Task 4): same shape of derivation as
  // nodesInHealthClass above, unconditionally for the 'danger' class — nodes
  // touching >=1 rendered danger-health edge. Independent of healthFilter
  // (the badge marks danger nodes whether or not the legend is isolating them).
  const dangerNodeIds = useMemo(
    () => new Set(visibleLinks.filter((l) => l.health === 'danger').flatMap((l) => [l.source, l.target])),
    [visibleLinks],
  );

  const { layoutNodes, rfEdges } = useMemo(() => {
    // Radius/width scales stay keyed off the FULL model — isolating a node
    // must not rescale the surviving nodes/edges relative to each other.
    const radii = new Map(model.nodes.map((n) => [n.id, n.radius]));
    // Selected-metric value → stroke width (sqrt scale, like node radii).
    const [wMin, wMax] = EDGE_WIDTH_RANGE;
    const maxValue = Math.max(0, ...model.links.map((l) => l.value));
    const widthOf = (v: number) =>
      maxValue <= 0 ? wMin : wMin + (wMax - wMin) * Math.sqrt(v / maxValue);
    const layoutNodes: RFNode<CircleNodeData>[] = visibleNodes.map((n) => {
      const p = positions.get(n.id) ?? { x: 0, y: 0 };
      return {
        id: n.id,
        type: 'circle',
        // d3-force coordinates are circle centers; RF positions are top-left.
        position: { x: p.x - n.radius, y: p.y - n.radius },
        data: {
          ...n,
          focused: n.id === activeFocusId,
          metric,
          selfLoopTitle: t('graph.selfLoop'),
          muted: nodesInHealthClass != null && !nodesInHealthClass.has(n.id),
          membersLabel: n.group ? t('topology.members', { n: n.group.memberCount }) : undefined,
          kindLabel: t(`topology.kind.${n.kind}`),
          crossAzLabel: t('topology.badge.crossAz'),
          highRetrans: dangerNodeIds.has(n.id),
          highRetransLabel: t('topology.badge.highRetrans'),
        },
        connectable: false,
      };
    });
    // Isolate mode already removes non-neighbor edges from `visibleLinks` —
    // no separate focus-mute condition needed here, only the legend's
    // health-class isolate filter (Phase 14 Task 1) still dims by opacity.
    const rfEdges: RFEdge<CurvedEdgeData>[] = visibleLinks.map((l) => ({
      id: l.id,
      source: l.source,
      target: l.target,
      type: 'curved',
      data: {
        value: l.value,
        metric,
        dashed: l.dashed,
        health: l.health,
        width: widthOf(l.value),
        muted: healthFilter != null && l.health !== healthFilter,
        sourceRadius: radii.get(l.source) ?? 0,
        targetRadius: radii.get(l.target) ?? 0,
      },
      // Arrowhead matches the health stroke so the edge reads as one mark.
      markerEnd: { type: MarkerType.ArrowClosed, color: STATUS[l.health], width: 14, height: 14 },
      // Thin curves stay clickable via a wide invisible hit area.
      interactionWidth: 16,
    }));
    return { layoutNodes, rfEdges };
  }, [model, visibleNodes, visibleLinks, positions, activeFocusId, metric, t, nodesInHealthClass, dangerNodeIds, healthFilter]);

  // Positions live in state so manual drags stick (onNodesChange applies RF's
  // drag deltas). Sync from layoutNodes during render (React's "adjust state
  // on prop change" pattern) so the key-remounted ReactFlow mounts with the
  // fresh node set: structural change → reset to computed layout; value-only
  // poll / focus change → refresh node DATA but keep each (possibly dragged)
  // circle CENTER, compensating for radius changes.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<CircleNodeData>(layoutNodes);
  const synced = useRef({ layoutKey, layoutNodes });
  if (synced.current.layoutNodes !== layoutNodes) {
    const structural = synced.current.layoutKey !== layoutKey;
    synced.current = { layoutKey, layoutNodes };
    if (structural) {
      setRfNodes(layoutNodes);
    } else {
      setRfNodes((prev) => {
        const prevById = new Map(prev.map((n) => [n.id, n]));
        return layoutNodes.map((n) => {
          const p = prevById.get(n.id);
          if (!p) return n;
          const cx = p.position.x + p.data.radius;
          const cy = p.position.y + p.data.radius;
          return { ...n, position: { x: cx - n.data.radius, y: cy - n.data.radius } };
        });
      });
    }
  }

  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: RFEdge) => onLinkSelect?.(edge.source, edge.target),
    [onLinkSelect],
  );

  // A collapsed group node toggles its expansion (page rebuilds the model);
  // every other node feeds the ego-isolate focus (Task 2), unchanged.
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: RFNode<CircleNodeData>) => {
      if (node.data?.group) onGroupToggle?.(node.data.group.key);
      else onNodeSelect?.(node.id);
    },
    [onGroupToggle, onNodeSelect],
  );

  // Position persistence (Phase 14 Task 5): a manual drag writes straight
  // into the durable cache + localStorage (not just RF's own node state), so
  // the drop point survives the NEXT structural change (filter/groupBy) and
  // a page reload, not only value-only polls.
  const handleNodeDragStop = useCallback(
    (_: React.MouseEvent, node: RFNode<CircleNodeData>) => {
      const cache = positionCacheRef.current;
      if (!cache) return;
      cache.set(node.id, { x: node.position.x + node.data.radius, y: node.position.y + node.data.radius });
      persistPositions(topologySignature, cache);
    },
    [topologySignature],
  );

  // ESC clears focus (restores the full graph) — same pattern as
  // EdgeHopPanel's dialog-close handler.
  useEffect(() => {
    if (activeFocusId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onNodeSelect?.(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeFocusId, onNodeSelect]);

  // Imperative pan/zoom to the current ego-network (click-to-isolate target
  // or a canvas search match) — captured via onInit since `layoutKey` stays
  // structural-change-free across focus/hop toggles (positions must NOT
  // reset), so ReactFlow never remounts to re-trigger its own `fitView` prop.
  const rfInstanceRef = useRef<ReactFlowInstance<CircleNodeData, CurvedEdgeData> | null>(null);
  useEffect(() => {
    const inst = rfInstanceRef.current;
    if (!inst) return;
    if (ego != null) {
      inst.fitView({ nodes: [...ego.nodeIds].map((id) => ({ id })), padding: 0.35, duration: 300, maxZoom: 2 });
    } else {
      inst.fitView({ padding: 0.25, duration: 300 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ego` already captures activeFocusId+hops+model; layoutKey guards the remount-triggered initial fitView separately
  }, [ego]);

  return (
    <div data-testid="network-graph" className="h-[560px] w-full">
      {model.nodes.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-ink/50 dark:text-white/50">
          {t('topology.empty')}
        </div>
      ) : (
        <ReactFlow
          // Remount on structural change so fitView re-frames the new layout.
          key={layoutKey}
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          minZoom={0.1}
          maxZoom={2}
          nodesConnectable={false}
          // onNodesChange would otherwise honor Backspace node deletion.
          deleteKeyCode={null}
          elementsSelectable
          onInit={(inst) => {
            rfInstanceRef.current = inst;
          }}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onNodeDragStop={handleNodeDragStop}
          // Empty-canvas click clears focus (restores the full graph).
          onPaneClick={() => onNodeSelect?.(null)}
        >
          <Background gap={24} size={1} color="currentColor" style={{ opacity: 0.15 }} />
          {/* bottom-left: the fixed chat FAB sits over the graph's bottom-right corner */}
          <Controls showInteractive={false} position="bottom-left" />
          {/* Live minimap (Phase 14 Task 5) — node color mirrors health (the
              SAME STATUS read as the circle's own fill/border), so the
              minimap reflects health at a glance even fully zoomed out.
              Hidden below `sm`: the mobile canvas is already tight and a
              corner minimap would crowd it further.
              The `data-testid` lives on this WRAPPER, not on <MiniMap>
              itself: the library component destructures its own named
              props with no `...rest` passthrough, so an unrecognized prop
              like `data-testid` is silently dropped — never reaches the
              rendered <svg>. The wrapper is explicitly sized + absolutely
              positioned (not just a plain div) so it isn't a zero-height
              box that "no children contribute to an auto-sized parent's
              height" would otherwise make it (MiniMap's own svg is itself
              absolutely positioned) — a real box lets visibility checks
              against the testid work as expected, and `hidden sm:block`
              on it removes the whole subtree on mobile. Nudged down when the
              expanded-groups chip panel (also top-right, Phase 14 Task 3) is
              showing — both are plain `.react-flow__panel`s pinned to the
              same corner with no shared stacking logic, so without this they
              paint directly on top of each other. */}
          <div
            data-testid="topology-minimap"
            className={`absolute right-0 hidden h-[180px] w-[230px] sm:block ${
              groupBy !== 'none' && expandedGroups && expandedGroups.size > 0 ? 'top-11' : 'top-0'
            }`}
          >
            <MiniMap
              position="top-right"
              pannable
              ariaLabel={t('topology.minimap')}
              nodeColor={(n) => statusColor((n.data as CircleNodeData | undefined)?.status ?? 'idle')}
              maskColor="rgba(128,128,128,0.15)"
              style={{ background: 'transparent' }}
            />
          </div>
          {activeFocusId != null ? (
            <Panel position="top-left">
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-black/10 bg-white/95 px-2.5 py-1.5 text-[11px] font-medium shadow-sm dark:border-white/15 dark:bg-ink/90">
                <span className="text-ink/70 dark:text-white/70">
                  {t('topology.isolate')}:{' '}
                  <span className="font-semibold text-ink dark:text-white">
                    {model.nodes.find((n) => n.id === activeFocusId)?.label ?? activeFocusId}
                  </span>
                </span>
                <div
                  role="group"
                  aria-label={t('topology.hops')}
                  data-testid="topology-hop-toggle"
                  className="flex items-center gap-0.5 rounded-md border border-black/10 p-0.5 dark:border-white/15"
                >
                  {HOPS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      aria-pressed={hops === h}
                      onClick={() => setHops(h)}
                      data-testid={`topology-hop-toggle-${h}`}
                      className={`h-6 min-w-6 rounded px-1.5 text-[11px] font-semibold ${
                        hops === h
                          ? 'bg-ink text-white dark:bg-white dark:text-ink'
                          : 'text-ink/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10'
                      }`}
                    >
                      {h}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onNodeSelect?.(null)}
                  data-testid="topology-clear-focus"
                  className="h-6 rounded-md border border-black/10 px-2 text-[11px] font-medium text-ink/70 hover:bg-black/5 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/10"
                >
                  {t('topology.clearFocus')}
                </button>
              </div>
            </Panel>
          ) : null}
          {/* Expanded groups: each chip collapses that group back (an expanded
              group has no group node to click, so this is its collapse toggle). */}
          {groupBy !== 'none' && expandedGroups && expandedGroups.size > 0 ? (
            <Panel position="top-right">
              <div
                data-testid="topology-expanded-groups"
                className="flex max-w-[14rem] flex-wrap items-center gap-1 rounded-lg border border-black/10 bg-white/95 px-2 py-1.5 text-[11px] shadow-sm dark:border-white/15 dark:bg-ink/90"
              >
                <span className="font-medium text-ink/60 dark:text-white/60">{t('topology.groupBy')}:</span>
                {[...expandedGroups].map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onGroupToggle?.(key)}
                    data-testid={`topology-collapse-group-${key}`}
                    title={t('topology.groupHint')}
                    className="flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 font-medium text-white dark:bg-white dark:text-ink"
                  >
                    <span className="max-w-[7rem] truncate">{key}</span>
                    <span aria-hidden>×</span>
                  </button>
                ))}
              </div>
            </Panel>
          ) : null}
        </ReactFlow>
      )}
    </div>
  );
}

export default memo(NetworkGraphInner);
