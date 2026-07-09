'use client';

// NetworkGraph (Task 6) — WhaTap-style force-directed node-link topology.
// buildGraphModel(topology) → circle nodes sized by traffic (sqrt scale) with
// status colors + self-loop arcs, and curved directional edges with byte
// labels (dashed when rate > threshold). Layout: d3-force simulation run for
// ~300 ticks up-front in a memo keyed by the node/link id set, then fed to
// React Flow as static positions (nodes stay draggable). Replaces TierFlowMap
// in the /topology "graph" view.
import { memo, useCallback, useMemo } from 'react';
import ReactFlow, {
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  type Edge as RFEdge,
  type EdgeProps,
  type Node as RFNode,
  type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import type { MetricName, TopologySnapshot } from '@/lib/types';
import { buildGraphModel, type GraphModel, type GraphNode } from '@/lib/topology-graph';
import { CATEGORY_COLORS, STATUS, TOKENS } from '@/lib/chart-tokens';
import { formatBytes, formatMetricValue } from '@/lib/format';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const statusColor = (s: GraphNode['status']) => (s === 'idle' ? TOKENS.chartGrey : STATUS[s]);

// ── custom circle node ──────────────────────────────────────────────────────
interface CircleNodeData extends GraphNode {
  focused: boolean;
  selfLoopTitle: string;
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
    <div className="relative" style={{ width: size, height: size }} title={data.label}>
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
      {/* self-loop: arc anchored on top of the circle + its byte total */}
      {data.selfBytes > 0 ? (
        <div
          className="absolute -top-7 left-1/2 flex -translate-x-1/2 flex-col items-center"
          title={data.selfLoopTitle}
        >
          <span className="whitespace-nowrap text-[9px] font-medium tabular-nums text-ink/70 dark:text-white/70">
            {formatBytes(data.selfBytes)}
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
interface CurvedEdgeData {
  value: number;
  metric: MetricName;
  dashed: boolean;
  category: keyof typeof CATEGORY_COLORS;
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
  const color = CATEGORY_COLORS[data.category] ?? TOKENS.chartBlue;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: 1.5,
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
}: {
  topology: TopologySnapshot;
  metric: MetricName;
  selectedIds?: Set<string> | null;
  breaches?: Set<string>;
  warns?: Set<string>;
  focusId?: string | null;
  onNodeSelect?: (id: string) => void;
  onLinkSelect?: (source: string, target: string) => void;
}) {
  const { t } = useLanguage();

  const model = useMemo(
    () => buildGraphModel(topology, { metric, selectedIds, breaches, warns }),
    [topology, metric, selectedIds, breaches, warns],
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

  const { rfNodes, rfEdges } = useMemo(() => {
    const radii = new Map(model.nodes.map((n) => [n.id, n.radius]));
    const rfNodes: RFNode<CircleNodeData>[] = model.nodes.map((n) => {
      const p = positions.get(n.id) ?? { x: 0, y: 0 };
      return {
        id: n.id,
        type: 'circle',
        // d3-force coordinates are circle centers; RF positions are top-left.
        position: { x: p.x - n.radius, y: p.y - n.radius },
        data: { ...n, focused: n.id === focusId, selfLoopTitle: t('graph.selfLoop') },
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
        category: l.category,
        muted: focusId != null && l.source !== focusId && l.target !== focusId,
        sourceRadius: radii.get(l.source) ?? 0,
        targetRadius: radii.get(l.target) ?? 0,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: CATEGORY_COLORS[l.category], width: 14, height: 14 },
      // Thin curves stay clickable via a wide invisible hit area.
      interactionWidth: 16,
    }));
    return { rfNodes, rfEdges };
  }, [model, positions, focusId, metric, t]);

  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: RFEdge) => onLinkSelect?.(edge.source, edge.target),
    [onLinkSelect],
  );

  return (
    <div data-testid="network-graph" className="h-[560px] w-full">
      {rfNodes.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-ink/50 dark:text-white/50">
          {t('topology.empty')}
        </div>
      ) : (
        <ReactFlow
          // Remount on structural change so fitView re-frames the new layout.
          key={layoutKey}
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          minZoom={0.1}
          maxZoom={2}
          nodesConnectable={false}
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
