'use client';

// TopEdgesPanel (Task 5) — top-15 topology edges ranked by the chosen metric.
// Each row: source → target labels, formatMetricValue(metric, value), and a
// category chip; clicking a row reports the edge id (the topology page links
// it to /paths?edge=). Fluid width only — usable as bottom-sheet content on
// mobile.
import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import type { MetricName, TopologySnapshot } from '@/lib/types';
import { rankEdges } from '@/lib/topology';
import { formatMetricValue } from '@/lib/format';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { CategoryChip } from '@/components/FlowTable';

const TOP_N = 15;

export default function TopEdgesPanel({
  topology,
  metric,
  onEdgeSelect,
}: {
  topology: TopologySnapshot;
  metric: MetricName;
  onEdgeSelect?: (edgeId: string) => void;
}) {
  const { t } = useLanguage();

  const { edges, labelOf } = useMemo(() => {
    const labels = new Map(topology.nodes.map((n) => [n.id, n.label]));
    return {
      edges: rankEdges(topology, metric, TOP_N),
      labelOf: (id: string) => labels.get(id) ?? id,
    };
  }, [topology, metric]);

  return (
    <div data-testid="top-edges-panel" className="w-full">
      <h3 className="mb-2 text-sm font-semibold text-ink dark:text-white">{t('topology.topEdges')}</h3>
      {edges.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-sm text-ink/50 dark:text-white/50">
          {t('topology.noEdges')}
        </div>
      ) : (
        <ol className="flex flex-col gap-1">
          {edges.map((e, i) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onEdgeSelect?.(e.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              >
                <span className="w-5 shrink-0 text-right tabular-nums text-ink/40 dark:text-white/40">
                  {i + 1}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  <span
                    className="truncate font-medium text-ink dark:text-white"
                    title={labelOf(e.source)}
                  >
                    {labelOf(e.source)}
                  </span>
                  <ArrowRight size={12} className="shrink-0 text-ink/40 dark:text-white/40" aria-hidden />
                  <span
                    className="truncate font-medium text-ink dark:text-white"
                    title={labelOf(e.target)}
                  >
                    {labelOf(e.target)}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-ink dark:text-white">
                  {formatMetricValue(metric, e.metrics[metric] ?? 0)}
                </span>
                <CategoryChip category={e.category} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
