'use client';

// AdjacencyMatrix (Task 5) — source × target traffic matrix of a
// TopologySnapshot at the chosen tier level. buildMatrix aggregates the
// snapshot edges; rendering is delegated to the Phase-2 Heatmap (values
// formatted per metric). Clicking a value cell reports the (row, col)
// entity pair via onCellSelect.
import { useMemo } from 'react';
import type { MetricName, TopologySnapshot } from '@/lib/types';
import { buildMatrix, type TierLevel } from '@/lib/topology';
import { formatMetricValue } from '@/lib/format';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Heatmap from '@/components/charts/Heatmap';

export default function AdjacencyMatrix({
  topology,
  metric,
  level,
  onCellSelect,
}: {
  topology: TopologySnapshot;
  metric: MetricName;
  level: TierLevel;
  onCellSelect?: (row: string, col: string) => void;
}) {
  const { t } = useLanguage();
  const matrix = useMemo(() => buildMatrix(topology, metric, level), [topology, metric, level]);

  if (matrix.rows.length === 0 || matrix.cols.length === 0) {
    return (
      <div
        data-testid="adjacency-matrix"
        className="flex h-40 items-center justify-center text-sm text-ink/50 dark:text-white/50"
      >
        {t('topology.empty')}
      </div>
    );
  }

  return (
    <div data-testid="adjacency-matrix">
      <Heatmap
        rows={matrix.rows}
        cols={matrix.cols}
        cells={matrix.cells}
        valueFormatter={(v) => formatMetricValue(metric, v)}
        onCellSelect={onCellSelect}
      />
    </div>
  );
}
