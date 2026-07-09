'use client';

import { ResponsiveContainer, Tooltip, Treemap as RechartsTreemap } from 'recharts';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { SERIES_COLORS, TOKENS } from '@/lib/chart-tokens';
import ChartTooltip from './ChartTooltip';

export interface TreemapDatum {
  name: string;
  value: number;
  // recharts v3 TreemapDataType requires a string index signature.
  [key: string]: unknown;
}

// Custom node renderer: token fill by fixed index order + direct name/value
// labels (the pastel palette's mandated contrast relief). Pastel fills keep
// dark ink text readable in both themes.
function TreemapNode(props: {
  depth?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  name?: string;
  value?: number;
  valueFormatter: (n: number) => string;
}) {
  const { depth = 0, x = 0, y = 0, width = 0, height = 0, index = 0, name, value, valueFormatter } = props;
  if (depth === 0 || width <= 0 || height <= 0) return <g />;
  const showName = width > 56 && height > 28;
  const showValue = width > 56 && height > 44;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        fill={SERIES_COLORS[index % SERIES_COLORS.length]}
      />
      {showName ? (
        <text x={x + 8} y={y + 18} fill={TOKENS.ink} fontSize={11} fontWeight={600}>
          {name}
        </text>
      ) : null}
      {showValue && value != null ? (
        <text x={x + 8} y={y + 34} fill={TOKENS.ink} fontSize={11} opacity={0.7}>
          {valueFormatter(value)}
        </text>
      ) : null}
    </g>
  );
}

/** Flat treemap of name/value shares (e.g. bytes per VPC / per talker). */
export default function Treemap({
  data,
  valueFormatter = (n: number) => String(n),
  height = 260,
}: {
  data: TreemapDatum[];
  valueFormatter?: (n: number) => string;
  height?: number;
}) {
  const { t } = useLanguage();

  if (data.length === 0) {
    return (
      <div
        data-testid="chart-treemap"
        className="flex items-center justify-center text-sm text-ink/40 dark:text-white/40"
        style={{ height }}
      >
        {t('chart.empty')}
      </div>
    );
  }

  return (
    <div data-testid="chart-treemap" className="text-ink dark:text-white">
      <ResponsiveContainer width="100%" height={height}>
        <RechartsTreemap
          data={data}
          dataKey="value"
          nameKey="name"
          nodeGap={2}
          isAnimationActive={false}
          content={(node) => <TreemapNode {...node} valueFormatter={valueFormatter} />}
        >
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { name?: string; value?: number; index?: number };
              return (
                <ChartTooltip
                  rows={[
                    {
                      name: String(p.name ?? ''),
                      value: valueFormatter(Number(p.value ?? 0)),
                      color: SERIES_COLORS[(p.index ?? 0) % SERIES_COLORS.length],
                    },
                  ]}
                />
              );
            }}
          />
        </RechartsTreemap>
      </ResponsiveContainer>
    </div>
  );
}
