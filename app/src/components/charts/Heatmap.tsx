'use client';

import { Fragment, useMemo } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { TOKENS } from '@/lib/chart-tokens';

export interface HeatmapCell {
  row: string;
  col: string;
  value: number;
}

/** Token hex → rgba() so intensity can be encoded as alpha without new hex values. */
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Composite (row, col) map key; the unit-separator escape avoids collisions with label text. */
const cellKey = (row: string, col: string) => `${row}\x1f${col}`;

/**
 * Matrix heatmap on a CSS grid (AZ×AZ, adjacency, ns×rcode, hour×day).
 * Intensity is the alpha of one token hue (light → dark), and every cell is
 * dual-encoded: the numeric value is printed on the cell (plus a title
 * attribute with the full row × col context), never color alone. A min→max
 * legend anchors the scale.
 */
export default function Heatmap({
  rows,
  cols,
  cells,
  unit,
  colorForValue,
  valueFormatter = (n: number) => String(n),
  onCellSelect,
}: {
  rows: string[];
  cols: string[];
  cells: HeatmapCell[];
  unit?: string;
  /** Optional override: full CSS color for a value given the data min/max. */
  colorForValue?: (value: number, min: number, max: number) => string;
  valueFormatter?: (n: number) => string;
  /** Optional cell click callback; when set, value cells render as buttons. */
  onCellSelect?: (row: string, col: string) => void;
}) {
  const { t } = useLanguage();

  const { byKey, min, max } = useMemo(() => {
    const byKey = new Map<string, number>();
    for (const c of cells) byKey.set(cellKey(c.row, c.col), c.value);
    const values = cells.map((c) => c.value).filter((v) => Number.isFinite(v));
    return {
      byKey,
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
    };
  }, [cells]);

  if (rows.length === 0 || cols.length === 0 || cells.length === 0) {
    return (
      <div
        data-testid="chart-heatmap"
        className="flex h-40 items-center justify-center text-sm text-ink/40 dark:text-white/40"
      >
        {t('chart.empty')}
      </div>
    );
  }

  const intensity = (v: number) => (max === min ? 1 : (v - min) / (max - min));
  const cellColor = (v: number) =>
    colorForValue ? colorForValue(v, min, max) : withAlpha(TOKENS.chartViolet, 0.12 + 0.88 * intensity(v));
  const fmt = (v: number) => `${valueFormatter(v)}${unit ? ` ${unit}` : ''}`;

  return (
    <div data-testid="chart-heatmap" className="text-ink dark:text-white">
      <div
        className="grid gap-px overflow-x-auto"
        style={{ gridTemplateColumns: `minmax(0, auto) repeat(${cols.length}, minmax(48px, 1fr))` }}
      >
        {/* header row */}
        <div aria-hidden />
        {cols.map((c) => (
          <div
            key={`col-${c}`}
            className="truncate px-1 pb-1 text-center text-[11px] font-medium text-ink/60 dark:text-white/60"
            title={c}
          >
            {c}
          </div>
        ))}
        {rows.map((r) => (
          <Fragment key={r}>
            <div
              className="truncate py-1 pr-2 text-right text-[11px] font-medium text-ink/60 dark:text-white/60"
              title={r}
            >
              {r}
            </div>
            {cols.map((c) => {
              const v = byKey.get(cellKey(r, c));
              if (v == null || !Number.isFinite(v)) {
                return (
                  <div
                    key={`${r}-${c}`}
                    className="flex h-9 items-center justify-center rounded-sm bg-black/[0.03] text-[11px] text-ink/25 dark:bg-white/[0.06] dark:text-white/25"
                    title={`${r} × ${c}: —`}
                  >
                    –
                  </div>
                );
              }
              const strong = !colorForValue && intensity(v) > 0.55;
              const style = {
                backgroundColor: cellColor(v),
                // High-alpha pastel fills are light in both themes → keep ink text readable.
                color: strong ? TOKENS.ink : undefined,
              };
              const title = `${r} × ${c}: ${fmt(v)}`;
              // Same visual cell either way; a real <button> only when clicks are wired.
              if (onCellSelect) {
                return (
                  <button
                    key={`${r}-${c}`}
                    type="button"
                    onClick={() => onCellSelect(r, c)}
                    className="flex h-9 cursor-pointer items-center justify-center rounded-sm text-[11px] font-medium tabular-nums"
                    style={style}
                    title={title}
                  >
                    {valueFormatter(v)}
                  </button>
                );
              }
              return (
                <div
                  key={`${r}-${c}`}
                  className="flex h-9 items-center justify-center rounded-sm text-[11px] font-medium tabular-nums"
                  style={style}
                  title={title}
                >
                  {valueFormatter(v)}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
      {/* min→max legend (only meaningful for the default single-hue scale) */}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-ink/60 dark:text-white/60">
        <span className="tabular-nums">{fmt(min)}</span>
        <span
          aria-hidden
          className="h-2 w-24 rounded-full"
          style={{
            background: `linear-gradient(to right, ${
              colorForValue ? colorForValue(min, min, max) : withAlpha(TOKENS.chartViolet, 0.12)
            }, ${colorForValue ? colorForValue(max, min, max) : TOKENS.chartViolet})`,
          }}
        />
        <span className="tabular-nums">{fmt(max)}</span>
      </div>
    </div>
  );
}
