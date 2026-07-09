'use client';

// /topology — tiered icon flow map (TierFlowMap) ↔ adjacency matrix
// (AdjacencyMatrix) over /api/topology, with a Top-edges panel on the side.
// Selecting an edge (ribbon click, matrix cell, or top-edges row) opens a
// dialog that fetches /api/paths for that edge and renders its HopPath.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { FlowEdge, MetricName, TopoEdge, TopologySnapshot } from '@/lib/types';
import { resolveEdge, type TierLevel } from '@/lib/topology';
import { formatMetricValue } from '@/lib/format';
import TierFlowMap from '@/components/topology/TierFlowMap';
import AdjacencyMatrix from '@/components/topology/AdjacencyMatrix';
import TopEdgesPanel from '@/components/topology/TopEdgesPanel';
import HopPath from '@/components/HopPath';
import { CategoryChip } from '@/components/FlowTable';
import { Card, Select } from '@/components/ui/Controls';

const METRICS: MetricName[] = ['DATA_TRANSFERRED', 'RETRANSMISSIONS', 'TIMEOUTS', 'ROUND_TRIP_TIME'];
const LEVELS: { value: TierLevel; labelKey: string }[] = [
  { value: 'cluster', labelKey: 'topology.levelCluster' },
  { value: 'namespace', labelKey: 'topology.levelNamespace' },
  { value: 'service', labelKey: 'topology.levelService' },
  { value: 'pod', labelKey: 'topology.levelPod' },
];

// Edge detail dialog: hop path fetched from /api/paths for the selected edge,
// plus its topology metrics and a link to the full /paths page.
// Desktop: right-side sheet. Mobile: bottom sheet.
function EdgeHopPanel({
  edge,
  labelOf,
  onClose,
}: {
  edge: TopoEdge;
  labelOf: (id: string) => string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<{ series: FlowEdge[]; latest: FlowEdge | null }>(
    `/api/paths?edge=${encodeURIComponent(edge.id)}`,
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('topology.edgeDetail')}
      data-testid="edge-hop-panel"
      className="fixed inset-x-0 bottom-0 z-[60] max-h-[70vh] overflow-y-auto rounded-t-card border border-black/5 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-lg md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:max-h-none md:w-[26rem] md:rounded-card md:pb-5 dark:border-white/10 dark:bg-ink"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('topology.edgeDetail')}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="flex h-8 w-8 items-center justify-center rounded-card text-ink/60 hover:bg-surface dark:text-white/60 dark:hover:bg-white/10"
        >
          <X size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <span className="truncate" title={labelOf(edge.source)}>{labelOf(edge.source)}</span>
        <ArrowRight size={14} strokeWidth={1.5} className="shrink-0 text-ink/40 dark:text-white/40" aria-hidden />
        <span className="truncate" title={labelOf(edge.target)}>{labelOf(edge.target)}</span>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <CategoryChip category={edge.category} />
        {edge.targetPort != null ? (
          <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink/70 dark:bg-white/10 dark:text-white/70">
            :{edge.targetPort}
          </span>
        ) : null}
      </div>
      <div className="mb-4 rounded-card bg-surface p-3 dark:bg-white/5">
        {error ? (
          <p className="text-sm text-ink/60 dark:text-white/60">{t('common.error')}</p>
        ) : loading && !data ? (
          <p className="text-sm text-ink/40 dark:text-white/40">{t('common.loading')}</p>
        ) : data?.latest ? (
          <HopPath edge={data.latest} />
        ) : (
          <p className="text-sm text-ink/40 dark:text-white/40">{t('paths.noData')}</p>
        )}
      </div>
      <dl className="flex flex-col gap-2">
        {METRICS.map((m) => (
          <div key={m} className="flex items-center justify-between gap-2 rounded-card bg-surface px-3 py-2 dark:bg-white/5">
            <dt className="text-xs text-ink/60 dark:text-white/60">{t(`metric.${m}`)}</dt>
            <dd className="text-sm font-semibold tabular-nums">
              {edge.metrics[m] != null ? formatMetricValue(m, edge.metrics[m]!) : '—'}
            </dd>
          </div>
        ))}
      </dl>
      <Link
        href={`/paths?edge=${encodeURIComponent(edge.id)}`}
        className="mt-4 flex h-9 items-center justify-center gap-1.5 rounded-card bg-ink text-xs font-semibold text-white hover:opacity-90 dark:bg-white dark:text-ink"
      >
        {t('topology.viewPath')}
        <ArrowRight size={14} strokeWidth={1.5} aria-hidden />
      </Link>
    </div>
  );
}

export default function TopologyPage() {
  const { t } = useLanguage();
  const { data, loading, error } = usePolling<TopologySnapshot>('/api/topology');
  const [view, setView] = useState<'graph' | 'matrix'>('graph');
  const [level, setLevel] = useState<TierLevel>('namespace');
  const [metric, setMetric] = useState<MetricName>('DATA_TRANSFERRED');
  // Kept as the edge object (not id) so a poll refresh can't blank the panel.
  const [selectedEdge, setSelectedEdge] = useState<TopoEdge | null>(null);

  const labelOf = useMemo(() => {
    const labels = new Map((data?.nodes ?? []).map((n) => [n.id, n.label]));
    return (id: string) => labels.get(id) ?? id;
  }, [data]);

  // Top-edges rows carry a real TopoEdge id.
  const selectEdgeId = (id: string) => {
    const e = data?.edges.find((x) => x.id === id);
    if (e) setSelectedEdge(e);
  };
  // Matrix cells / tier ribbons carry aggregated entity ids → resolve to the
  // heaviest underlying edge for the current metric.
  const selectPair = (source: string, target: string) => {
    if (!data) return;
    const e = resolveEdge(data, level, source, target, metric);
    if (e) setSelectedEdge(e);
  };
  const selectTierLink = (linkId: string) => {
    const i = linkId.indexOf('→'); // TierLink id = `${source}→${target}`
    if (i >= 0) selectPair(linkId.slice(0, i), linkId.slice(i + 1));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-lg font-semibold">{t('nav.topology')}</h1>
        <div className="flex flex-wrap items-end gap-2">
          <div
            role="group"
            aria-label={t('topology.view')}
            className="flex h-9 items-center gap-0.5 rounded-lg border border-black/10 bg-white p-0.5 dark:border-white/15 dark:bg-ink"
          >
            {(['graph', 'matrix'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                data-testid={`topology-view-${v}`}
                className={`h-full rounded-md px-3 text-xs font-medium ${
                  view === v
                    ? 'bg-ink text-white dark:bg-white dark:text-ink'
                    : 'text-ink/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10'
                }`}
              >
                {v === 'graph' ? t('topology.viewGraph') : t('topology.viewMatrix')}
              </button>
            ))}
          </div>
          <Select
            label={t('topology.level')}
            value={level}
            onChange={(v) => setLevel(v as TierLevel)}
            options={LEVELS.map((l) => ({ value: l.value, label: t(l.labelKey) }))}
          />
          <Select
            label={t('topology.metric')}
            value={metric}
            onChange={(v) => setMetric(v as MetricName)}
            options={METRICS.map((m) => ({ value: m, label: t(`metric.${m}`) }))}
          />
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="min-w-0">
          {error ? (
            <div className="flex h-96 items-center justify-center text-sm text-ink/40 dark:text-white/40">
              {t('common.error')}
            </div>
          ) : loading && !data ? (
            <div className="flex h-96 items-center justify-center text-sm text-ink/40 dark:text-white/40">
              {t('common.loading')}
            </div>
          ) : data ? (
            view === 'graph' ? (
              <TierFlowMap
                topology={data}
                level={level}
                onLevelChange={setLevel}
                onEdgeSelect={selectTierLink}
              />
            ) : (
              <AdjacencyMatrix topology={data} metric={metric} level={level} onCellSelect={selectPair} />
            )
          ) : (
            <div className="flex h-96 items-center justify-center text-sm text-ink/40 dark:text-white/40">
              {t('topology.empty')}
            </div>
          )}
        </Card>
        <Card className="min-w-0">
          {data ? (
            <TopEdgesPanel topology={data} metric={metric} onEdgeSelect={selectEdgeId} />
          ) : (
            <p className="text-sm text-ink/40 dark:text-white/40">{t('common.loading')}</p>
          )}
        </Card>
      </div>

      {selectedEdge ? (
        <EdgeHopPanel edge={selectedEdge} labelOf={labelOf} onClose={() => setSelectedEdge(null)} />
      ) : null}
    </div>
  );
}
