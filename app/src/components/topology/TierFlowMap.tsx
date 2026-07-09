'use client';

// TierFlowMap (Task 4) — React Flow icon tiered topology map with drilldown.
// buildTiers(topology, level) aggregates the snapshot to lane entities; nodes
// are laid out left→right by tier (workload → cluster node → vpc/external)
// and stacked vertically within each lane. Node = <ResourceIcon> + label,
// edge = flow ribbon (width ∝ log(bytes), color = CATEGORY_COLORS[category]).
// Clicking a node drills the whole map one level deeper
// (cluster→namespace→service→pod); clicking an edge reports its link id.
// Replaces the old force-graph topology view (deleted in Task 6).
import { memo, useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  type Edge as RFEdge,
  type Node as RFNode,
  type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { TopologySnapshot } from '@/lib/types';
import { buildTiers, type ResourceKind, type TierLevel } from '@/lib/topology';
import { CATEGORY_COLORS, TOKENS } from '@/lib/chart-tokens';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import ResourceIcon, { KIND_META } from './ResourceIcon';

const COL_GAP = 260; // lane pitch (x = tier * COL_GAP)
const ROW_GAP = 64; // stack pitch within a lane (y = index * ROW_GAP)

/** Next deeper drilldown level; pod is the deepest (no-op). */
const NEXT_LEVEL: Record<TierLevel, TierLevel | null> = {
  cluster: 'namespace',
  namespace: 'service',
  service: 'pod',
  pod: null,
};

/** Ribbon width ∝ log10 of aggregated bytes, clamped to [1.5, 8]. */
function ribbonWidth(bytes: number): number {
  return Math.max(1.5, Math.min(8, Math.log10(bytes + 1) * 0.9));
}

interface TierNodeData {
  kind: ResourceKind;
  label: string;
}

// Custom node: circular per-kind icon + truncated label. Handles are the
// invisible left/right anchors the tier ribbons attach to.
function TierNodeView({ data }: NodeProps<TierNodeData>) {
  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-ink/10 bg-surface px-2.5 py-1.5 dark:border-white/15 dark:bg-white/10"
      title={data.label}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: 'none' }} />
      <ResourceIcon kind={data.kind} size={26} />
      <span className="max-w-[140px] truncate text-[11px] font-semibold text-ink dark:text-white">
        {data.label}
      </span>
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} />
    </div>
  );
}

// Defined once at module scope — React Flow warns if nodeTypes is recreated per render.
const nodeTypes = { tier: TierNodeView };

function TierFlowMapInner({
  topology,
  level,
  onLevelChange,
  onEdgeSelect,
}: {
  topology: TopologySnapshot;
  level: TierLevel;
  onLevelChange?: (level: TierLevel) => void;
  onEdgeSelect?: (edgeId: string) => void;
}) {
  const { t } = useLanguage();

  // Layout recomputes only when the snapshot or the drill level changes.
  const { rfNodes, rfEdges } = useMemo(() => {
    const { nodes, links } = buildTiers(topology, level);
    const rowOfTier = new Map<number, number>();
    const rfNodes: RFNode<TierNodeData>[] = nodes.map((n) => {
      const row = rowOfTier.get(n.tier) ?? 0;
      rowOfTier.set(n.tier, row + 1);
      return {
        id: n.id,
        type: 'tier',
        position: { x: n.tier * COL_GAP, y: row * ROW_GAP },
        data: { kind: n.kind, label: n.label },
        draggable: false,
        connectable: false,
      };
    });
    const rfEdges: RFEdge[] = links.map((l) => ({
      id: l.id,
      source: l.source,
      target: l.target,
      style: { stroke: CATEGORY_COLORS[l.category] ?? TOKENS.chartBlue, strokeWidth: ribbonWidth(l.bytes) },
      // Thin ribbons stay clickable via a wide invisible hit area.
      interactionWidth: 14,
    }));
    return { rfNodes, rfEdges };
  }, [topology, level]);

  const handleNodeClick = useCallback(() => {
    const next = NEXT_LEVEL[level];
    if (next && onLevelChange) onLevelChange(next);
  }, [level, onLevelChange]);

  return (
    <div data-testid="tier-flow-map" className="h-[560px] w-full">
      {rfNodes.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-ink/50 dark:text-white/50">
          {t('topology.empty')}
        </div>
      ) : (
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.1}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={handleNodeClick}
          onEdgeClick={(_, edge) => onEdgeSelect?.(edge.id)}
        >
          <Background gap={24} size={1} color="currentColor" style={{ opacity: 0.15 }} />
          {/* bottom-left: the fixed chat FAB sits over the graph's bottom-right corner */}
          <Controls showInteractive={false} position="bottom-left" />
          {/* top-right: keeps clear of the chat FAB pinned bottom-right */}
          <MiniMap
            position="top-right"
            pannable
            nodeColor={(n) => KIND_META[(n.data as TierNodeData | undefined)?.kind ?? 'other'].color}
            maskColor="rgba(128,128,128,0.15)"
            style={{ background: 'transparent' }}
          />
        </ReactFlow>
      )}
    </div>
  );
}

export default memo(TierFlowMapInner);
