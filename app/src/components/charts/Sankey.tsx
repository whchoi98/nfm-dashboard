'use client';

import { useMemo } from 'react';
import { ResponsiveContainer, Sankey as RechartsSankey, Tooltip } from 'recharts';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { SERIES_COLORS, TOKENS } from '@/lib/chart-tokens';
import ChartTooltip from './ChartTooltip';

export interface SankeyInputNode {
  name: string;
}

export interface SankeyInputLink {
  source: number;
  target: number;
  value: number;
}

export interface SankeyInput {
  nodes: SankeyInputNode[];
  links: SankeyInputLink[];
}

// Minimal shape of the props recharts passes to a custom node renderer.
interface NodeShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  payload?: { name?: string; value?: number; depth?: number };
}

/**
 * recharts v3 Sankey throws on empty data, self-links and circular link sets,
 * so the input is sanitized first: out-of-range / self / non-positive links
 * are dropped, and any link that would close a cycle over the already-accepted
 * set is skipped. If nothing valid remains, the empty state renders instead.
 */
function sanitize(data: SankeyInput | null | undefined): {
  nodes: SankeyInputNode[];
  links: SankeyInputLink[];
  maxDepth: number;
} {
  const nodes = data?.nodes ?? [];
  const raw = data?.links ?? [];
  const adj: number[][] = Array.from({ length: nodes.length }, () => []);
  const reaches = (from: number, to: number): boolean => {
    const stack = [from];
    const seen = new Set<number>();
    while (stack.length) {
      const n = stack.pop()!;
      if (n === to) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const m of adj[n]) stack.push(m);
    }
    return false;
  };
  const links: SankeyInputLink[] = [];
  for (const l of raw) {
    if (!Number.isInteger(l.source) || !Number.isInteger(l.target)) continue;
    if (l.source < 0 || l.source >= nodes.length) continue;
    if (l.target < 0 || l.target >= nodes.length) continue;
    if (l.source === l.target) continue; // self-link
    if (!Number.isFinite(l.value) || l.value <= 0) continue;
    if (reaches(l.target, l.source)) continue; // would create a cycle
    adj[l.source].push(l.target);
    links.push({ source: l.source, target: l.target, value: l.value });
  }
  // Longest path over the accepted DAG = depth of the right-most column,
  // used to flip terminal labels inward so they stay inside the viewport.
  const memo = new Map<number, number>();
  const longestFrom = (n: number): number => {
    const cached = memo.get(n);
    if (cached != null) return cached;
    memo.set(n, 0); // adj is acyclic by construction; placeholder for safety
    let best = 0;
    for (const m of adj[n]) best = Math.max(best, 1 + longestFrom(m));
    memo.set(n, best);
    return best;
  };
  let maxDepth = 0;
  for (let n = 0; n < nodes.length; n++) maxDepth = Math.max(maxDepth, longestFrom(n));
  return { nodes: [...nodes], links, maxDepth };
}

function NodeShape({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  index = 0,
  payload,
  maxDepth,
  valueFormatter,
}: NodeShapeProps & { maxDepth: number; valueFormatter: (n: number) => string }) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0) return <g />;
  const atEnd = maxDepth > 0 && (payload?.depth ?? 0) >= maxDepth;
  // Draw-only clamp: tiny flows otherwise get sub-pixel rects that disappear.
  const drawH = Math.max(height, 2);
  return (
    <g>
      <rect x={x} y={y} width={width} height={drawH} rx={2} fill={SERIES_COLORS[index % SERIES_COLORS.length]}>
        <title>{`${payload?.name ?? ''}: ${valueFormatter(Number(payload?.value ?? 0))}`}</title>
      </rect>
      <text
        x={atEnd ? x - 6 : x + width + 6}
        y={y + height / 2}
        dy={4}
        textAnchor={atEnd ? 'end' : 'start'}
        fontSize={11}
        fill="currentColor"
        fillOpacity={0.75}
        pointerEvents="none"
      >
        {payload?.name ?? ''}
      </text>
    </g>
  );
}

/** Flow diagram (e.g. VPC → TGW → VPC transfer volumes) on recharts v3 Sankey. */
export default function Sankey({
  data,
  valueFormatter = (n: number) => String(n),
  height = 300,
}: {
  data: SankeyInput;
  valueFormatter?: (n: number) => string;
  height?: number;
}) {
  const { t } = useLanguage();
  const { nodes, links, maxDepth } = useMemo(() => sanitize(data), [data]);

  // recharts keeps nodePadding FIXED: on dense graphs (~20+ nodes per column at
  // 320px) 24px padding alone exceeds the height budget and node heights go
  // <= 0, so NodeShape drops every rect. Shrink padding as node count grows —
  // padding gets at most half the usable height in the worst-case (densest
  // ~half-the-nodes) column, clamped to [4, 24].
  const nodePadding = useMemo(() => {
    const perColumn = Math.max(2, Math.ceil(nodes.length / 2));
    const usable = Math.max(0, height - 16); // top+bottom margins
    return Math.max(4, Math.min(24, Math.floor((usable * 0.5) / (perColumn - 1))));
  }, [nodes.length, height]);

  if (nodes.length === 0 || links.length === 0) {
    return (
      <div
        data-testid="chart-sankey"
        className="flex items-center justify-center text-sm text-ink/40 dark:text-white/40"
        style={{ height }}
      >
        {t('chart.empty')}
      </div>
    );
  }

  return (
    <div data-testid="chart-sankey" className="text-ink dark:text-white">
      <ResponsiveContainer width="100%" height={height}>
        <RechartsSankey
          data={{ nodes, links }}
          nodePadding={nodePadding}
          nodeWidth={12}
          margin={{ top: 8, right: 90, bottom: 8, left: 8 }}
          link={{ stroke: TOKENS.chartBlue, strokeOpacity: 0.45, fill: 'none' }}
          node={(props: NodeShapeProps) => (
            <NodeShape {...props} maxDepth={maxDepth} valueFormatter={valueFormatter} />
          )}
        >
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.length ? (
                <ChartTooltip
                  rows={payload.map((p, i) => ({
                    name: String(p.name ?? i),
                    value: valueFormatter(Number(p.value ?? 0)),
                    color: TOKENS.chartBlue,
                  }))}
                />
              ) : null
            }
          />
        </RechartsSankey>
      </ResponsiveContainer>
    </div>
  );
}
