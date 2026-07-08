'use client';

import { memo, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Position,
  type Edge as RFEdge,
  type Node as RFNode,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import type { TopoEdge, TopoNode } from '@/lib/types';
import { CATEGORY_COLORS, TOKENS } from '@/lib/chart-tokens';

const NODE_W = 168;
const NODE_H = 44;

// Node fill per kind (SnowUI pastels); label color stays dark ink on pastel
// fills in both themes; external nodes inherit the page ink for dark safety.
function nodeStyle(kind: TopoNode['kind']): React.CSSProperties {
  const base: React.CSSProperties = {
    width: NODE_W,
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
    padding: '8px 10px',
    border: '1px solid transparent',
    color: TOKENS.ink,
  };
  switch (kind) {
    case 'pod':
      return { ...base, background: TOKENS.accentBlue };
    case 'node':
      return { ...base, background: TOKENS.accentLav };
    case 'vpc':
      return { ...base, background: TOKENS.chartSky };
    default: // external
      return {
        ...base,
        background: 'transparent',
        border: '1.5px dashed rgba(128,128,128,0.7)',
        color: 'inherit',
        fontWeight: 500,
      };
  }
}

/** Edge thickness ≈ log10 of transferred bytes, clamped to [1.2, 6]. */
function edgeWidth(e: TopoEdge): number {
  const dt = e.metrics.DATA_TRANSFERRED ?? 0;
  return Math.max(1.2, Math.min(6, Math.log10(dt + 1) * 0.8));
}

function layout(nodes: TopoNode[], edges: TopoEdge[]): { rf: RFNode[]; rfe: RFEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 90, marginx: 16, marginy: 16 });
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const rf: RFNode[] = nodes.map((n) => {
    const pos = g.node(n.id);
    const sub = n.kind === 'pod' ? n.namespace : n.kind === 'node' ? n.az : n.vpcId;
    return {
      id: n.id,
      position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
      data: {
        label: (
          <span title={n.label} style={{ display: 'block', overflow: 'hidden' }}>
            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {n.label}
            </span>
            {sub ? (
              <span style={{ display: 'block', opacity: 0.55, fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {sub}
              </span>
            ) : null}
          </span>
        ),
      },
      style: nodeStyle(n.kind),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: false,
      connectable: false,
    };
  });

  const rfe: RFEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    // Extended categories (UNCLASSIFIED, AMAZON_S3, ...) have no dedicated hue yet;
    // fall back to chartBlue until the chart palette is widened.
    style: { stroke: CATEGORY_COLORS[e.category as keyof typeof CATEGORY_COLORS] ?? TOKENS.chartBlue, strokeWidth: edgeWidth(e) },
    // Interaction affordance: a wide invisible hit area handles the click.
    interactionWidth: 14,
  }));
  return { rf, rfe };
}

function TopologyGraphInner({
  nodes,
  edges,
  selectedEdgeId,
  onEdgeSelect,
}: {
  nodes: TopoNode[];
  edges: TopoEdge[];
  selectedEdgeId: string | null;
  onEdgeSelect: (id: string | null) => void;
}) {
  // Layout runs once per filtered nodes/edges set (memoized — 117 nodes is fine).
  const { rf, rfe } = useMemo(() => layout(nodes, edges), [nodes, edges]);
  const styled = useMemo(
    () =>
      rfe.map((e) =>
        e.id === selectedEdgeId
          ? { ...e, style: { ...e.style, stroke: TOKENS.chartViolet, strokeWidth: Math.max(3, Number(e.style?.strokeWidth ?? 2)) }, animated: true }
          : e,
      ),
    [rfe, selectedEdgeId],
  );

  return (
    <ReactFlow
      nodes={rf}
      edges={styled}
      fitView
      minZoom={0.1}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      onlyRenderVisibleElements
      onEdgeClick={(_, edge) => onEdgeSelect(edge.id)}
      onPaneClick={() => onEdgeSelect(null)}
      proOptions={{ hideAttribution: false }}
    >
      <Background gap={24} size={1} color="currentColor" style={{ opacity: 0.15 }} />
      {/* bottom-left: the fixed chat FAB sits over the graph's bottom-right corner */}
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}

export default memo(TopologyGraphInner);
