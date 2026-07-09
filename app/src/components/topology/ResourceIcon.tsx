'use client';

// Circular per-kind resource badge for the Phase 3 topology/paths redesign.
// Hue comes from KIND_META (SnowUI chart tokens only — no ad-hoc hex); the
// glyph strokes in currentColor so it inherits ink/white and stays dark-safe.
// Color is never the sole encoding: every kind has a distinct lucide glyph.
import {
  Box,
  Boxes,
  Circle,
  Cloud,
  Database,
  GitFork,
  Globe,
  Globe2,
  Grid2x2,
  Layers,
  Link2,
  MapPin,
  Network,
  PlugZap,
  Server,
  type LucideIcon,
} from 'lucide-react';
import type { ResourceKind } from '@/lib/topology';
import { TOKENS } from '@/lib/chart-tokens';

/** Per-kind lucide glyph + token hue. Kinds that never share a view may reuse a hue. */
export const KIND_META: Record<ResourceKind, { icon: LucideIcon; color: string }> = {
  pod: { icon: Box, color: TOKENS.chartBlue },
  namespace: { icon: Boxes, color: TOKENS.chartViolet },
  service: { icon: Network, color: TOKENS.chartSky },
  cluster: { icon: Layers, color: TOKENS.chartTeal },
  instance: { icon: Server, color: TOKENS.chartAmber },
  eni: { icon: PlugZap, color: TOKENS.chartRose },
  subnet: { icon: Grid2x2, color: TOKENS.accentMint },
  az: { icon: MapPin, color: TOKENS.accentLav },
  vpc: { icon: Cloud, color: TOKENS.chartViolet },
  vpce: { icon: Link2, color: TOKENS.chartSky },
  tgw: { icon: GitFork, color: TOKENS.chartTeal },
  awsservice: { icon: Database, color: TOKENS.accentBlue },
  region: { icon: Globe, color: TOKENS.chartSky },
  internet: { icon: Globe2, color: TOKENS.chartGrey },
  other: { icon: Circle, color: TOKENS.chartGrey },
};

/**
 * Circular bordered badge with the kind's icon centered. Border is the kind's
 * token hue, background a translucent wash of the same hue, icon currentColor.
 */
export default function ResourceIcon({ kind, size = 28 }: { kind: ResourceKind; size?: number }) {
  const { icon: Icon, color } = KIND_META[kind];
  return (
    <span
      data-testid={`resicon-${kind}`}
      className="inline-flex shrink-0 items-center justify-center rounded-full border"
      style={{
        width: size,
        height: size,
        borderColor: color,
        backgroundColor: `color-mix(in srgb, ${color} 22%, transparent)`,
      }}
    >
      <Icon size={Math.round(size * 0.55)} strokeWidth={1.75} aria-hidden />
    </span>
  );
}
