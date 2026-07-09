'use client';

import { useMemo } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { SERIES_COLORS, TOKENS } from '@/lib/chart-tokens';
import { formatBytes } from '@/lib/format';

export interface RegionArc {
  from: string;
  to: string;
  bytes: number;
  usd: number;
}

const W = 640;
const H = 230;
const PAD = 56;
const BASE_Y = 178;

/**
 * Schematic inter-region transfer map (NOT geographic): unique regions are
 * laid out as labeled nodes on a horizontal baseline, transfers are quadratic
 * arcs whose stroke width scales with log(bytes). Each arc carries a <title>
 * with from → to, bytes and usd (dual-encoding); the header shows total usd.
 */
export default function RegionArcMap({ arcs }: { arcs: RegionArc[] }) {
  const { t } = useLanguage();

  const { regions, totalUsd, logMin, logMax } = useMemo(() => {
    const regions: string[] = [];
    for (const a of arcs) {
      if (!regions.includes(a.from)) regions.push(a.from);
      if (!regions.includes(a.to)) regions.push(a.to);
    }
    const logs = arcs.map((a) => Math.log10(Math.max(a.bytes, 0) + 1));
    return {
      regions,
      totalUsd: arcs.reduce((s, a) => s + (Number.isFinite(a.usd) ? a.usd : 0), 0),
      logMin: logs.length ? Math.min(...logs) : 0,
      logMax: logs.length ? Math.max(...logs) : 0,
    };
  }, [arcs]);

  if (arcs.length === 0) {
    return (
      <div
        data-testid="chart-region-arc"
        className="flex h-40 items-center justify-center text-sm text-ink/40 dark:text-white/40"
      >
        {t('chart.empty')}
      </div>
    );
  }

  const xOf = (region: string) => {
    const i = regions.indexOf(region);
    if (regions.length === 1) return W / 2;
    return PAD + (i * (W - 2 * PAD)) / (regions.length - 1);
  };
  const strokeOf = (bytes: number) => {
    const lv = Math.log10(Math.max(bytes, 0) + 1);
    if (logMax === logMin) return 4;
    return 1.5 + (6.5 * (lv - logMin)) / (logMax - logMin);
  };

  return (
    <div data-testid="chart-region-arc" className="text-ink dark:text-white">
      <p className="mb-1 text-xs text-ink/60 dark:text-white/60">
        {t('chart.totalCost')}:{' '}
        <span className="font-semibold tabular-nums text-ink dark:text-white">${totalUsd.toFixed(2)}</span>
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full"
        role="img"
      >
        {/* baseline */}
        <line x1={PAD - 24} y1={BASE_Y} x2={W - PAD + 24} y2={BASE_Y} stroke="currentColor" strokeOpacity={0.12} />
        {/* arcs */}
        {arcs.map((a, i) => {
          const x1 = xOf(a.from);
          const x2 = xOf(a.to);
          const color = SERIES_COLORS[i % SERIES_COLORS.length];
          const title = `${a.from} → ${a.to} · ${formatBytes(a.bytes)} · $${a.usd.toFixed(2)}`;
          const d =
            a.from === a.to
              ? // self transfer: small loop above the node
                `M ${x1} ${BASE_Y} C ${x1 - 26} ${BASE_Y - 44}, ${x1 + 26} ${BASE_Y - 44}, ${x1} ${BASE_Y}`
              : `M ${x1} ${BASE_Y} Q ${(x1 + x2) / 2} ${
                  BASE_Y - Math.min(Math.max(Math.abs(x2 - x1) * 0.45, 36), 150)
                } ${x2} ${BASE_Y}`;
          return (
            <path
              key={`${a.from}-${a.to}-${i}`}
              d={d}
              fill="none"
              stroke={color}
              strokeOpacity={0.8}
              strokeWidth={strokeOf(a.bytes)}
              strokeLinecap="round"
            >
              <title>{title}</title>
            </path>
          );
        })}
        {/* region nodes + labels */}
        {regions.map((r) => {
          const x = xOf(r);
          return (
            <g key={r}>
              <circle cx={x} cy={BASE_Y} r={5} fill={TOKENS.chartViolet} stroke="currentColor" strokeOpacity={0.35} />
              <text
                x={x}
                y={BASE_Y + 22}
                textAnchor="middle"
                fontSize={12}
                fill="currentColor"
                fillOpacity={0.7}
              >
                {r}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
