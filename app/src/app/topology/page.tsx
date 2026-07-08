'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { MetricName, TopoEdge, TopoNode, TopologySnapshot } from '@/lib/types';
import { CATEGORY_ORDER } from '@/lib/chart-tokens';
import { formatMetricValue } from '@/lib/format';
import TopologyGraph from '@/components/topology/TopologyGraph';
import { CategoryChip } from '@/components/FlowTable';
import { Card, Select } from '@/components/ui/Controls';

const METRICS: MetricName[] = ['DATA_TRANSFERRED', 'RETRANSMISSIONS', 'TIMEOUTS', 'ROUND_TRIP_TIME'];

function EdgePanel({
  edge,
  nodeById,
  onClose,
}: {
  edge: TopoEdge;
  nodeById: Map<string, TopoNode>;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const a = nodeById.get(edge.source);
  const b = nodeById.get(edge.target);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    // Desktop: overlay card pinned to the right of the graph. Mobile: bottom sheet.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('topology.edgeDetail')}
      className="fixed inset-x-0 bottom-0 z-[60] max-h-[70vh] overflow-y-auto rounded-t-card border border-black/5 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-lg md:absolute md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:z-10 md:max-h-none md:w-80 md:rounded-card md:pb-5 dark:border-white/10 dark:bg-ink"
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
        <span className="truncate" title={a?.label}>{a?.label ?? edge.source}</span>
        <ArrowRight size={14} strokeWidth={1.5} className="shrink-0 text-ink/40 dark:text-white/40" aria-hidden />
        <span className="truncate" title={b?.label}>{b?.label ?? edge.target}</span>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <CategoryChip category={edge.category} />
        {edge.targetPort != null ? (
          <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink/70 dark:bg-white/10 dark:text-white/70">
            :{edge.targetPort}
          </span>
        ) : null}
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
  const [cluster, setCluster] = useState('');
  const [namespace, setNamespace] = useState('');
  const [category, setCategory] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const nodes = useMemo(() => data?.nodes ?? [], [data]);
  const edges = useMemo(() => data?.edges ?? [], [data]);

  const clusters = useMemo(
    () => [...new Set(nodes.map((n) => n.cluster).filter((c): c is string => !!c))].sort(),
    [nodes],
  );
  const namespaces = useMemo(
    () => [...new Set(nodes.map((n) => n.namespace).filter((c): c is string => !!c))].sort(),
    [nodes],
  );

  const { fNodes, fEdges, nodeById } = useMemo(() => {
    // Nodes whose cluster/namespace is set and differs are dropped; nodes without
    // the attribute (vpc/external) survive and are pruned later if isolated.
    const keep = nodes.filter(
      (n) =>
        (!cluster || !n.cluster || n.cluster === cluster) &&
        (!namespace || !n.namespace || n.namespace === namespace),
    );
    const ids = new Set(keep.map((n) => n.id));
    const fEdges = edges.filter(
      (e) => ids.has(e.source) && ids.has(e.target) && (!category || e.category === category),
    );
    const filtering = !!(cluster || namespace || category);
    const touched = new Set(fEdges.flatMap((e) => [e.source, e.target]));
    const fNodes = filtering ? keep.filter((n) => touched.has(n.id)) : keep;
    return { fNodes, fEdges, nodeById: new Map(nodes.map((n) => [n.id, n])) };
  }, [nodes, edges, cluster, namespace, category]);

  const selectedEdge = selectedEdgeId ? fEdges.find((e) => e.id === selectedEdgeId) ?? null : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-lg font-semibold">{t('nav.topology')}</h1>
        <div className="flex flex-wrap items-end gap-2">
          <Select
            label={t('topology.cluster')}
            value={cluster}
            onChange={setCluster}
            allLabel={t('filter.all')}
            options={clusters.map((c) => ({ value: c, label: c }))}
          />
          <Select
            label={t('topology.namespace')}
            value={namespace}
            onChange={setNamespace}
            allLabel={t('filter.all')}
            options={namespaces.map((n) => ({ value: n, label: n }))}
          />
          <Select
            label={t('topology.category')}
            value={category}
            onChange={setCategory}
            allLabel={t('filter.all')}
            options={CATEGORY_ORDER.map((c) => ({ value: c, label: t(`category.${c}`) }))}
          />
        </div>
      </div>

      {/* Legend: node kinds + edge categories, dual-encoded with shape + label */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink/60 dark:text-white/60">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded bg-accentBlue" aria-hidden /> {t('topology.kindPod')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded bg-accentLav" aria-hidden /> {t('topology.kindNode')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded bg-chartSky" aria-hidden /> {t('topology.kindVpc')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded border border-dashed border-ink/40 dark:border-white/40" aria-hidden />{' '}
          {t('topology.kindExternal')}
        </span>
        <span className="ml-2 border-l border-black/10 pl-4 dark:border-white/10">{t('topology.edgeHint')}</span>
      </div>

      <div
        data-testid="topology-graph"
        className="relative h-[calc(100vh-17rem)] min-h-96 overflow-hidden rounded-card bg-surface text-ink dark:bg-white/5 dark:text-white"
      >
        {error ? (
          <div className="flex h-full items-center justify-center text-sm text-ink/40 dark:text-white/40">
            {t('common.error')}
          </div>
        ) : loading && !data ? (
          <div className="flex h-full items-center justify-center text-sm text-ink/40 dark:text-white/40">
            {t('common.loading')}
          </div>
        ) : fNodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-ink/40 dark:text-white/40">
            {t('common.collecting')} — {t('overview.collectingHint')}
          </div>
        ) : (
          <TopologyGraph
            nodes={fNodes}
            edges={fEdges}
            selectedEdgeId={selectedEdgeId}
            onEdgeSelect={setSelectedEdgeId}
          />
        )}
        {selectedEdge ? (
          <EdgePanel edge={selectedEdge} nodeById={nodeById} onClose={() => setSelectedEdgeId(null)} />
        ) : null}
      </div>
    </div>
  );
}
