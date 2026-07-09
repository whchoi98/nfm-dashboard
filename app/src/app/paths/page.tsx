'use client';

// /paths — hop-path stepper (HopPath) for the edge chosen via the pod-pair
// picker or the ?edge= query. With nothing selected, the top topology edges
// (TopEdgesPanel) act as a "popular paths" starting point.
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Route } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { FlowEdge, TopologySnapshot } from '@/lib/types';
import HopPath from '@/components/HopPath';
import TopEdgesPanel from '@/components/topology/TopEdgesPanel';
import { Card, Select } from '@/components/ui/Controls';

// Mounted only when an edge is chosen, so the poll only runs with a real hash.
function PathResult({ edgeId }: { edgeId: string }) {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<{ series: FlowEdge[]; latest: FlowEdge | null }>(
    `/api/paths?edge=${encodeURIComponent(edgeId)}`,
  );
  if (error) {
    return (
      <Card>
        <p className="text-sm text-ink/60 dark:text-white/60">{t('common.error')}</p>
      </Card>
    );
  }
  if (loading && !data) {
    return (
      <Card>
        <p className="text-sm text-ink/40 dark:text-white/40">{t('common.loading')}</p>
      </Card>
    );
  }
  if (!data?.latest) {
    return (
      <Card>
        <p className="text-sm text-ink/40 dark:text-white/40">{t('paths.noData')}</p>
      </Card>
    );
  }
  return (
    <Card>
      <HopPath edge={data.latest} />
    </Card>
  );
}

function PathsContent() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const edgeFromQuery = searchParams.get('edge') ?? '';

  const { data: topo } = usePolling<TopologySnapshot>('/api/topology', 120000);
  const [podA, setPodA] = useState('');
  const [edgeId, setEdgeId] = useState(edgeFromQuery);

  // Keep local state in sync when the user lands with (or navigates to) ?edge=
  useEffect(() => {
    if (edgeFromQuery) setEdgeId(edgeFromQuery);
  }, [edgeFromQuery]);

  const pods = useMemo(
    () =>
      (topo?.nodes ?? [])
        .filter((n) => n.kind === 'pod')
        .sort((a, b) => a.label.localeCompare(b.label)),
    [topo],
  );
  const nodeById = useMemo(() => new Map((topo?.nodes ?? []).map((n) => [n.id, n])), [topo]);

  // Peers reachable from pod A: every edge touching it, labeled by the far end.
  const peerEdges = useMemo(() => {
    if (!podA) return [];
    return (topo?.edges ?? [])
      .filter((e) => e.source === podA || e.target === podA)
      .map((e) => {
        const otherId = e.source === podA ? e.target : e.source;
        const other = nodeById.get(otherId);
        return {
          edgeId: e.id,
          label: `${other?.label ?? otherId}${e.targetPort != null ? ` :${e.targetPort}` : ''}`,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [topo, podA, nodeById]);

  const selectEdge = (id: string) => {
    setEdgeId(id);
    router.replace(id ? `/paths?edge=${encodeURIComponent(id)}` : '/paths');
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t('nav.paths')}</h1>

      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <Select
            label={t('paths.podA')}
            value={podA}
            onChange={setPodA}
            allLabel={t('paths.selectPod')}
            options={pods.map((p) => ({
              value: p.id,
              label: p.namespace ? `${p.namespace}/${p.label}` : p.label,
            }))}
          />
          <Select
            label={t('paths.podB')}
            value={peerEdges.some((p) => p.edgeId === edgeId) ? edgeId : ''}
            onChange={selectEdge}
            allLabel={t('paths.selectPeer')}
            options={peerEdges.map((p) => ({ value: p.edgeId, label: p.label }))}
          />
          {edgeId ? (
            <span className="flex h-9 items-center gap-1.5 rounded-lg bg-accentLav px-3 text-[11px] font-medium text-ink">
              <Route size={13} strokeWidth={1.5} aria-hidden />
              {t('paths.edge')}: {edgeId.slice(0, 12)}…
            </span>
          ) : null}
        </div>
      </Card>

      {edgeId ? (
        <PathResult edgeId={edgeId} />
      ) : (
        <Card>
          <p className="mb-4 text-sm text-ink/50 dark:text-white/50">{t('paths.pickHint')}</p>
          {topo ? (
            <TopEdgesPanel topology={topo} metric="DATA_TRANSFERRED" onEdgeSelect={selectEdge} />
          ) : (
            <p className="text-sm text-ink/40 dark:text-white/40">{t('common.loading')}</p>
          )}
        </Card>
      )}
    </div>
  );
}

export default function PathsPage() {
  // useSearchParams requires a Suspense boundary during prerender.
  return (
    <Suspense fallback={null}>
      <PathsContent />
    </Suspense>
  );
}
