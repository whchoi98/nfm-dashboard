'use client';

// NetworkGraph (Task 6, health coloring Task 4/Phase 9) — WhaTap-style
// force-directed node-link topology. buildGraphModel(topology) → circle nodes
// sized by traffic (sqrt scale) with status colors + self-loop arcs, and
// curved directional edges labeled with the selected metric. Edge encoding
// (CNM style): STROKE COLOR = retransmission-rate health (STATUS ok/warn/
// danger), WIDTH = selected-metric value (sqrt scale), DASH = DATA_TRANSFERRED
// throughput > threshold.
// Layout: d3-force simulation run for ~300 ticks up-front in a memo keyed by
// the structural node/link id set. Node positions then live in local state
// (useNodesState): manual drags persist across value-only polls and focus
// changes; positions reset only when the structural layoutKey changes.
// Replaces TierFlowMap in the /topology "graph" view.
import { memo, useCallback, useMemo, useRef } from 'react';
import ReactFlow, {
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  useNodesState,
  type Edge as RFEdge,
  type EdgeProps,
  type Node as RFNode,
  type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import type { MetricName, TopologySnapshot } from '@/lib/types';
import { buildGraphModel, type GraphLink, type GraphModel, type GraphNode } from '@/lib/topology-graph';
import { STATUS, TOKENS } from '@/lib/chart-tokens';
import { formatMetricValue } from '@/lib/format';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const statusColor = (s: GraphNode['status']) => (s === 'idle' ? TOKENS.chartGrey : STATUS[s]);

// ── custom circle node ──────────────────────────────────────────────────────
interface CircleNodeData extends GraphNode {
  focused: boolean;
  /** Active metric — the self-loop label must match the edge labels' unit. */
  metric: MetricName;
  selfLoopTitle: string;
  /** Dimmed when a legend health-class filter is active and this node has no edge in that class (Phase 14 Task 1). */
  muted: boolean;
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
  const size = data.radius * 2;
  return (
    <div
      className="relative"
      style={{ width: size, height: size, opacity: data.muted ? 0.25 : 1 }}
      title={data.label}
    >
      <Handle type="target" position={Position.Top} style={centerHandle} />
      <Handle type="source" position={Position.Bottom} style={centerHandle} />
      {/* translucent fill layer (keeps border + ring fully opaque) */}
      <div className="absolute inset-0 rounded-full opacity-40" style={{ backgroundColor: color }} />
      <div
        className="absolute inset-0 rounded-full border-2"
        style={{
          borderColor: color,
          // Blue focus ring on the clicked node (WhaTap reference).
          boxShadow: data.focused ? `0 0 0 3px ${TOKENS.chartBlue}` : undefined,
        }}
      />
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

function computeLayout(model: GraphModel): Map<string, { x: number; y: number }> {
  const simNodes: SimNode[] = model.nodes.map((n) => ({ id: n.id, r: n.radius }));
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
}: {
  topology: TopologySnapshot;
  metric: MetricName;
  selectedIds?: Set<string> | null;
  breaches?: Set<string>;
  warns?: Set<string>;
  focusId?: string | null;
  onNodeSelect?: (id: string) => void;
  onLinkSelect?: (source: string, target: string) => void;
  /** Min-traffic threshold (Phase 14 Task 1) — links below this VALUE are cut. */
  minEdgeValue?: number;
  /** Tunable edge-health thresholds (retransmissions per GB); default to topology-graph's own defaults when omitted. */
  healthThreshold?: number;
  healthWarnThreshold?: number;
  /** Active legend isolate filter — edges/nodes outside this health class are dimmed. */
  healthFilter?: GraphLink['health'] | null;
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
      }),
    [topology, metric, selectedIds, breaches, warns, minEdgeValue, healthThreshold, healthWarnThreshold],
  );

  // Layout is keyed by the structural identity (sorted node + link id sets) so
  // poll refreshes that only change metric values keep every position stable.
  const layoutKey = useMemo(
    () =>
      `${model.nodes.map((n) => n.id).sort().join('|')}⇢${model.links.map((l) => l.id).sort().join('|')}`,
    [model],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on layoutKey by design
  const positions = useMemo(() => computeLayout(model), [layoutKey]);

  // Focus only counts while the focused node exists in the current model — a
  // stale focusId (node unchecked, filter narrowed, poll churn) would
  // otherwise mute EVERY edge with no focus ring to recover from.
  const focusPresent = focusId != null && model.nodes.some((n) => n.id === focusId);
  const activeFocusId = focusPresent ? focusId : null;

  // Legend isolate filter (Phase 14 Task 1): nodes touching >=1 edge in the
  // active health class stay full-opacity; everything else dims. A self-loop
  // has no health classification, so a node with only a self-loop dims too
  // when a filter is active — it isn't part of that edge-health class.
  const nodesInHealthClass = useMemo(
    () =>
      healthFilter == null
        ? null
        : new Set(model.links.filter((l) => l.health === healthFilter).flatMap((l) => [l.source, l.target])),
    [model, healthFilter],
  );

  const { layoutNodes, rfEdges } = useMemo(() => {
    const radii = new Map(model.nodes.map((n) => [n.id, n.radius]));
    // Selected-metric value → stroke width (sqrt scale, like node radii).
    const [wMin, wMax] = EDGE_WIDTH_RANGE;
    const maxValue = Math.max(0, ...model.links.map((l) => l.value));
    const widthOf = (v: number) =>
      maxValue <= 0 ? wMin : wMin + (wMax - wMin) * Math.sqrt(v / maxValue);
    const layoutNodes: RFNode<CircleNodeData>[] = model.nodes.map((n) => {
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
        },
        connectable: false,
      };
    });
    const rfEdges: RFEdge<CurvedEdgeData>[] = model.links.map((l) => ({
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
        muted:
          (activeFocusId != null && l.source !== activeFocusId && l.target !== activeFocusId) ||
          (healthFilter != null && l.health !== healthFilter),
        sourceRadius: radii.get(l.source) ?? 0,
        targetRadius: radii.get(l.target) ?? 0,
      },
      // Arrowhead matches the health stroke so the edge reads as one mark.
      markerEnd: { type: MarkerType.ArrowClosed, color: STATUS[l.health], width: 14, height: 14 },
      // Thin curves stay clickable via a wide invisible hit area.
      interactionWidth: 16,
    }));
    return { layoutNodes, rfEdges };
  }, [model, positions, activeFocusId, metric, t, nodesInHealthClass, healthFilter]);

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
          onNodeClick={(_, node) => onNodeSelect?.(node.id)}
          onEdgeClick={handleEdgeClick}
        >
          <Background gap={24} size={1} color="currentColor" style={{ opacity: 0.15 }} />
          {/* bottom-left: the fixed chat FAB sits over the graph's bottom-right corner */}
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
      )}
    </div>
  );
}

export default memo(NetworkGraphInner);
