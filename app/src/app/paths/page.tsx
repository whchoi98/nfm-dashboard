'use client';

// /paths — hop-path stepper (HopPath) for the edge chosen via the pod-pair
// picker or the ?edge= query. With nothing selected, a default grid offers
// starting points: top topology edges ("popular paths"), this session's
// recent lookups, the overall RTT distribution and the hop-type composition.
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { History, Route } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { FlowEdge, TopologySnapshot } from '@/lib/types';
import type { RttBin } from '@/lib/analytics/latency';
import type { HopCount } from '@/lib/analytics/dependencies';
import { formatCount } from '@/lib/format';
import {
  pushRecent,
  readRecentPaths,
  saveRecentPaths,
  type RecentPath,
} from '@/lib/recent-paths';
import HopPath from '@/components/HopPath';
import TopEdgesPanel from '@/components/topology/TopEdgesPanel';
import Distribution from '@/components/charts/Distribution';
import Toplist, { type ToplistRow } from '@/components/analytics/Toplist';
import { Card, Select } from '@/components/ui/Controls';
import PageIntro from '@/components/PageIntro';

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

// Ambient lenses below are mounted ONLY in the unselected state (same
// conditional-mount pattern as PathResult), so their polls stop as soon as an
// edge is chosen.

// Overall RTT histogram. NFM reports ROUND_TRIP_TIME for few flows, so an
// empty distribution is the normal case — show a friendly note, not a chart.
function RttDistributionPanel() {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<{ distribution: RttBin[] }>(
    '/api/analytics/latency',
    60000,
  );
  const bins = data?.distribution ?? [];
  return (
    <Card title={t('paths.rttTitle')} testId="paths-rtt-dist">
      {error ? (
        <p className="text-sm text-ink/60 dark:text-white/60">{t('common.error')}</p>
      ) : loading && !data ? (
        <p className="text-sm text-ink/40 dark:text-white/40">{t('common.loading')}</p>
      ) : bins.length === 0 ? (
        <p className="flex h-32 items-center justify-center px-4 text-center text-sm text-ink/40 dark:text-white/40">
          {t('paths.rttEmpty')}
        </p>
      ) : (
        <Distribution bins={bins} unit="µs" height={200} />
      )}
    </Card>
  );
}

// Hop-type composition: how often each hop type appears across observed paths.
function HopCompositionPanel() {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<{ hops: HopCount[] }>(
    '/api/analytics/dependencies',
    60000,
  );
  // Toplist contract: rows pre-sorted desc by value (flow count per hop type).
  const rows: ToplistRow[] = useMemo(
    () =>
      [...(data?.hops ?? [])]
        .sort((a, b) => b.count - a.count)
        .map((h) => ({ label: h.type, value: h.count })),
    [data],
  );
  return (
    <Card title={t('paths.hopsTitle')} testId="paths-hops">
      {error ? (
        <p className="text-sm text-ink/60 dark:text-white/60">{t('common.error')}</p>
      ) : loading && !data ? (
        <p className="text-sm text-ink/40 dark:text-white/40">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="flex h-32 items-center justify-center px-4 text-center text-sm text-ink/40 dark:text-white/40">
          {t('paths.hopsEmpty')}
        </p>
      ) : (
        <Toplist
          rows={rows}
          valueFormatter={formatCount}
          testId="paths-hops-list"
          sortable
          valueHeader={t('common.count')}
        />
      )}
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
  // Recent lookups live in sessionStorage; hydrate after mount (SSR-safe).
  const [recent, setRecent] = useState<RecentPath[]>([]);
  useEffect(() => {
    setRecent(readRecentPaths());
  }, []);

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

  // Human label for an edge id, from the topology nodes (fallback: id prefix).
  const edgeLabel = (id: string): string => {
    const e = (topo?.edges ?? []).find((x) => x.id === id);
    if (!e) return `${id.slice(0, 12)}…`;
    const src = nodeById.get(e.source)?.label ?? e.source;
    const dst = nodeById.get(e.target)?.label ?? e.target;
    return `${src} → ${dst}${e.targetPort != null ? ` :${e.targetPort}` : ''}`;
  };

  const selectEdge = (id: string) => {
    setEdgeId(id);
    if (id) {
      // Record the lookup: dedupe by edgeId, newest-first, capped (see lib).
      setRecent((prev) => {
        const next = pushRecent(prev, { edgeId: id, label: edgeLabel(id), ts: Date.now() });
        saveRecentPaths(next);
        return next;
      });
    }
    router.replace(id ? `/paths?edge=${encodeURIComponent(id)}` : '/paths');
  };

  // Relative timestamp for the recent-lookups list (session-scoped, so short).
  const relTime = (ts: number): string => {
    const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (mins < 1) return t('paths.timeJustNow');
    if (mins < 60) return t('paths.timeMinAgo', { min: mins });
    return t('paths.timeHourAgo', { h: Math.floor(mins / 60) });
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t('nav.paths')}</h1>
      <PageIntro page="paths" />

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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <p className="mb-4 text-sm text-ink/50 dark:text-white/50">{t('paths.pickHint')}</p>
            {topo ? (
              <TopEdgesPanel topology={topo} metric="DATA_TRANSFERRED" onEdgeSelect={selectEdge} />
            ) : (
              <p className="text-sm text-ink/40 dark:text-white/40">{t('common.loading')}</p>
            )}
          </Card>

          <Card title={t('paths.recentTitle')} testId="paths-recent">
            {recent.length === 0 ? (
              <p className="text-sm text-ink/40 dark:text-white/40">{t('paths.recentEmpty')}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {recent.map((r) => (
                  <li key={r.edgeId}>
                    <button
                      type="button"
                      onClick={() => selectEdge(r.edgeId)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    >
                      <History
                        size={13}
                        className="shrink-0 text-ink/40 dark:text-white/40"
                        aria-hidden
                      />
                      <span
                        className="min-w-0 flex-1 truncate font-medium text-ink dark:text-white"
                        title={r.label}
                      >
                        {r.label}
                      </span>
                      <span className="shrink-0 tabular-nums text-[11px] text-ink/40 dark:text-white/40">
                        {relTime(r.ts)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <RttDistributionPanel />
          <HopCompositionPanel />
        </div>
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
