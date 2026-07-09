'use client';

import { useMemo } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { SERIES_COLORS, TOKENS } from '@/lib/chart-tokens';

export interface IcicleNode {
  name: string;
  value: number;
  children?: IcicleNode[];
}

interface Rect {
  x: number;
  w: number;
  depth: number;
  name: string;
  value: number;
}

const W = 1000;
const ROW = 36;
const MIN_LABEL_W = 70;

/** Effective node weight: own value, or the children sum when it is larger. */
function weight(n: IcicleNode): number {
  const own = Number.isFinite(n.value) ? Math.max(n.value, 0) : 0;
  const kids = (n.children ?? []).reduce((s, c) => s + weight(c), 0);
  return Math.max(own, kids);
}

function layout(node: IcicleNode, x: number, w: number, depth: number, out: Rect[]): void {
  if (w <= 0) return;
  out.push({ x, w, depth, name: node.name, value: weight(node) });
  const kids = node.children ?? [];
  const total = kids.reduce((s, c) => s + weight(c), 0);
  if (total <= 0) return;
  let cx = x;
  for (const child of kids) {
    const cw = (weight(child) / total) * w;
    layout(child, cx, cw, depth + 1, out);
    cx += cw;
  }
}

/**
 * Icicle (top→down flame) for the path-frequency tree: each level subdivides
 * its parent's width proportionally to value. Depth is encoded with the fixed
 * series palette; every node carries a <title> with name + value so narrow
 * slices stay identifiable (labels are drawn only when they fit).
 */
export default function Icicle({
  tree,
  valueFormatter = (n: number) => String(n),
}: {
  tree: IcicleNode;
  valueFormatter?: (n: number) => string;
}) {
  const { t } = useLanguage();

  const rects = useMemo(() => {
    const out: Rect[] = [];
    if (tree && weight(tree) > 0) layout(tree, 0, W, 0, out);
    return out;
  }, [tree]);

  if (rects.length === 0) {
    return (
      <div
        data-testid="chart-icicle"
        className="flex h-40 items-center justify-center text-sm text-ink/40 dark:text-white/40"
      >
        {t('chart.empty')}
      </div>
    );
  }

  const depths = 1 + Math.max(...rects.map((r) => r.depth));
  const height = depths * ROW;

  return (
    <div data-testid="chart-icicle" className="text-ink dark:text-white">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full"
        role="img"
      >
        {rects.map((r, i) => (
          <g key={`${r.depth}-${r.name}-${i}`}>
            <rect
              x={r.x + 0.5}
              y={r.depth * ROW + 0.5}
              width={Math.max(r.w - 1, 0.5)}
              height={ROW - 3}
              rx={3}
              fill={SERIES_COLORS[r.depth % SERIES_COLORS.length]}
            >
              <title>{`${r.name}: ${valueFormatter(r.value)}`}</title>
            </rect>
            {r.w >= MIN_LABEL_W ? (
              // Pastel fills are light in both themes → ink text stays readable.
              <text
                x={r.x + 8}
                y={r.depth * ROW + ROW / 2 + 3}
                fontSize={13}
                fill={TOKENS.ink}
                pointerEvents="none"
              >
                {r.name}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}
