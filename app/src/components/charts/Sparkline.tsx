'use client';
// Tiny inline SVG line/area sparkline (no axes, no labels) — token-colored and
// scaled to its container via preserveAspectRatio="none". Values are drawn
// LEFT→RIGHT in array order; callers holding newest-first series (e.g. the
// network-analytics lens spark) must reverse before passing.
import { TOKENS } from '@/lib/chart-tokens';

const W = 100;
const H = 32;
const PAD = 2; // vertical padding so the stroke is not clipped at the extremes

export default function Sparkline({
  values,
  color = TOKENS.chartViolet,
  className = '',
  ariaLabel,
}: {
  values: number[];
  color?: string;
  className?: string;
  ariaLabel?: string;
}) {
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  // Flat series (span 0) sit on the middle line instead of dividing by zero.
  const y = (v: number) => (span === 0 ? H / 2 : H - PAD - ((v - min) / span) * (H - PAD * 2));
  // A single point still renders a visible full-width flat line.
  const points =
    values.length === 1
      ? `0,${y(values[0])} ${W},${y(values[0])}`
      : values.map((v, i) => `${(i / (values.length - 1)) * W},${y(v)}`).join(' ');

  return (
    <svg
      data-testid="sparkline"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={`block h-8 w-full ${className}`}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <polygon points={`0,${H} ${points} ${W},${H}`} fill={color} opacity={0.15} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
