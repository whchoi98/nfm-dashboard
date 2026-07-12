'use client';

// /topology — WhaTap-style force-directed graph (NetworkGraph) ↔ adjacency
// matrix (AdjacencyMatrix) over /api/topology. Graph mode pairs with a
// TagFilterPanel (draft→apply node selection) and a LIVE/pause legend header;
// matrix mode keeps the Top-edges panel. The toolbar's cluster/category
// Selects pre-filter the snapshot before it reaches any view (filterTopology).
// Selecting an edge (graph edge, matrix cell, or top-edges row) opens a
// dialog that fetches /api/paths for that edge and renders its HopPath.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Search, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { DestCategory, FlowEdge, MetricName, TopoEdge, TopologySnapshot } from '@/lib/types';
import { filterTopology, resolveEdge, type TierLevel } from '@/lib/topology';
import { buildGraphModel, DEFAULT_HEALTH_THRESHOLD, DEFAULT_HEALTH_WARN_THRESHOLD } from '@/lib/topology-graph';
import type { HealthLevel } from '@/lib/analytics/edge-health';
import { RETRANS_RATE_DANGER, RETRANS_RATE_WARN } from '@/lib/analytics/aggregate';
import { CATEGORY_ORDER, STATUS } from '@/lib/chart-tokens';
import { formatMetricValue } from '@/lib/format';
import NetworkGraph from '@/components/topology/NetworkGraph';
import GraphLegend, { type HealthStatus } from '@/components/topology/GraphLegend';
import TagFilterPanel from '@/components/topology/TagFilterPanel';
import AdjacencyMatrix from '@/components/topology/AdjacencyMatrix';
import TopEdgesPanel from '@/components/topology/TopEdgesPanel';
import HopPath from '@/components/HopPath';
import { CategoryChip } from '@/components/FlowTable';
import { Card, NumberInput, Select } from '@/components/ui/Controls';

const METRICS: MetricName[] = ['DATA_TRANSFERRED', 'RETRANSMISSIONS', 'TIMEOUTS', 'ROUND_TRIP_TIME'];
const LEVELS: { value: TierLevel; labelKey: string }[] = [
  { value: 'cluster', labelKey: 'topology.levelCluster' },
  { value: 'namespace', labelKey: 'topology.levelNamespace' },
  { value: 'service', labelKey: 'topology.levelService' },
  { value: 'pod', labelKey: 'topology.levelPod' },
];
const MATRIX_MODES = ['metric', 'health'] as const;
const HEALTH_LEVELS: { value: HealthLevel; labelKey: string }[] = [
  { value: 'service', labelKey: 'topology.levelService' },
  { value: 'namespace', labelKey: 'topology.levelNamespace' },
  { value: 'az', labelKey: 'topology.levelAz' },
  { value: 'vpc', labelKey: 'topology.levelVpc' },
];
const HEALTH_STATUSES = ['ok', 'warn', 'danger'] as const;

// Min-traffic slider (Phase 14 Task 1): a quadratic mapping between the
// slider position and the cut value gives finer control near zero, where
// most meaningful cuts on a long-tailed traffic distribution live.
const MIN_TRAFFIC_SLIDER_STEPS = 1000;
function sliderPosFromValue(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round(Math.sqrt(Math.min(Math.max(value, 0), max) / max) * MIN_TRAFFIC_SLIDER_STEPS);
}
function valueFromSliderPos(pos: number, max: number): number {
  const frac = pos / MIN_TRAFFIC_SLIDER_STEPS;
  return Math.round(max * frac * frac);
}

/** n most-recent 5-minute grid buckets, newest first (mirrors collector formula).
 *  Duplicated from flows/page.tsx: ddb.ts is server-only (AWS SDK) and can't be
 *  imported into a client component. */
function recentBuckets(n: number): string[] {
  const t = Date.now();
  return Array.from({ length: n }, (_, i) =>
    new Date(Math.floor(t / 300000) * 300000 - i * 300000).toISOString().replace(/\.\d+Z/, 'Z'),
  );
}

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
  // LIVE/pause toggle: paused stops the poll while keeping the last snapshot.
  const [paused, setPaused] = useState(false);
  const { data, loading, error } = usePolling<TopologySnapshot>('/api/topology', 30000, !paused);
  const [view, setView] = useState<'graph' | 'matrix'>('graph');
  const [level, setLevel] = useState<TierLevel>('namespace');
  const [metric, setMetric] = useState<MetricName>('DATA_TRANSFERRED');
  // '' = all (the Select's allLabel option) — no filtering on that axis.
  const [cluster, setCluster] = useState('');
  const [category, setCategory] = useState<DestCategory | ''>('');
  // Tag filter applied by TagFilterPanel; null = all nodes.
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  // Node last clicked in the graph → blue focus ring + edge highlighting.
  const [focusId, setFocusId] = useState<string | null>(null);
  // Kept as the edge object (not id) so a poll refresh can't blank the panel.
  const [selectedEdge, setSelectedEdge] = useState<TopoEdge | null>(null);

  // Phase 14 Task 1 — min-traffic threshold (cuts low-value edges + orphaned
  // nodes from the graph model) and tunable edge-health warn/danger
  // thresholds (retransmissions per GB; defaults match today's values).
  const [minEdgeValue, setMinEdgeValue] = useState(0);
  const [healthWarn, setHealthWarn] = useState(DEFAULT_HEALTH_WARN_THRESHOLD);
  const [healthDanger, setHealthDanger] = useState(DEFAULT_HEALTH_THRESHOLD);
  // Interactive legend: clicking a health class isolates it (dims the rest);
  // clicking the active one again clears back to "show all".
  const [healthFilter, setHealthFilter] = useState<HealthStatus | null>(null);
  const toggleHealthFilter = (h: HealthStatus) => setHealthFilter((cur) => (cur === h ? null : h));
  // A metric switch changes the value scale entirely (bytes vs RTT vs
  // counts) — a stale cut in the old unit would silently hide everything.
  useEffect(() => setMinEdgeValue(0), [metric]);

  // Task 8 — matrix render mode: 'metric' (default, unchanged) or 'health'
  // (RED/AMBER/GREEN by connection health). healthLevel is independent of
  // `level` above: buildHealthMatrix keys directly off raw FlowEdge endpoint
  // fields (service/namespace/az/vpc) and has no 'cluster'/'pod' notion, while
  // the tier `level` has no 'az'/'vpc' notion — the two aggregations don't share a type.
  const [matrixMode, setMatrixMode] = useState<'metric' | 'health'>('metric');
  const [healthLevel, setHealthLevel] = useState<HealthLevel>('service');

  // Health mode needs raw FlowEdge[] (buildHealthMatrix consumes them
  // directly); the page otherwise only ever loads a TopologySnapshot. Fetch
  // guarded to health mode + matrix view: the bucket timer and the poll
  // itself only run while both are true, so metric mode never fetches flows.
  const flowsActive = view === 'matrix' && matrixMode === 'health';
  const [flowBucket, setFlowBucket] = useState('');
  useEffect(() => {
    if (!flowsActive) return;
    // Latest COMPLETE bucket (skip the one still being written), same rule as flows/page.tsx.
    const compute = () => recentBuckets(2)[1];
    setFlowBucket(compute());
    const id = setInterval(() => setFlowBucket(compute()), 30000);
    return () => clearInterval(id);
  }, [flowsActive]);
  const { data: flowsData } = usePolling<{ flows: FlowEdge[] }>(
    `/api/flows?bucket=${encodeURIComponent(flowBucket)}&limit=1000`,
    30000,
    flowsActive && !!flowBucket,
  );
  const healthFlows = flowsData?.flows ?? [];

  // Cluster/category re-scoping rebuilds the topology with a disjoint node-id
  // set — a stale tag selection would empty the graph (buildGraphModel keeps
  // only selected ids) and a stale focus would mute every edge. Reset both.
  useEffect(() => {
    setSelectedIds(null);
    setFocusId(null);
  }, [cluster, category]);

  // TagFilterPanel apply: commit the selection and drop the focus if the new
  // selection removed the focused node (empty set = "all nodes" keeps it).
  const applyTagSelection = (next: Set<string>) => {
    setSelectedIds(next);
    setFocusId((f) => (f != null && next.size > 0 && !next.has(f) ? null : f));
  };

  const clusters = useMemo(
    () => [...new Set((data?.nodes ?? []).map((n) => n.cluster).filter((c): c is string => !!c))].sort(),
    [data],
  );
  // Cluster/category scoping applied BEFORE the tier/matrix/top-edges builders.
  const topology = useMemo(
    () => (data ? filterTopology(data, cluster, category) : null),
    [data, cluster, category],
  );

  // Min-traffic slider range: 0..max selected-metric value over the
  // currently-scoped (cluster/category) cross-node edges. Self-loops don't
  // participate in the cut, so they're excluded from the max too.
  const maxEdgeValue = useMemo(() => {
    let max = 0;
    for (const e of topology?.edges ?? []) {
      if (e.source === e.target) continue;
      const v = e.metrics[metric] ?? 0;
      if (v > max) max = v;
    }
    return max;
  }, [topology, metric]);
  // hiddenEdgeCount for the "{n} hidden" label — mirrors exactly what
  // NetworkGraph builds internally from the same inputs (pure function, so
  // recomputing here is cheap and always stays in sync).
  const hiddenEdgeCount = useMemo(
    () =>
      topology
        ? buildGraphModel(topology, {
            metric,
            selectedIds,
            minEdgeValue,
            healthThreshold: healthDanger,
            healthWarnThreshold: healthWarn,
          }).hiddenEdgeCount
        : 0,
    [topology, metric, selectedIds, minEdgeValue, healthDanger, healthWarn],
  );

  // Clamp the min-traffic cut if a narrower cluster/category scope (or a
  // metric switch) drops the max below the currently-set cut value.
  useEffect(() => {
    setMinEdgeValue((v) => Math.min(v, maxEdgeValue));
  }, [maxEdgeValue]);

  const labelOf = useMemo(() => {
    const labels = new Map((data?.nodes ?? []).map((n) => [n.id, n.label]));
    return (id: string) => labels.get(id) ?? id;
  }, [data]);

  // TagFilterPanel row list: full node set of the filtered snapshot (before
  // tag selection) with graph statuses, so hidden nodes stay re-checkable.
  // NOTE: reliability breach/warn wiring into node status is out of scope for
  // Task 6 — no breaches/warns sets are passed, so statuses are ok/idle only.
  const tagNodes = useMemo(
    () =>
      topology
        ? buildGraphModel(topology, { metric }).nodes.map(({ id, label, status }) => ({ id, label, status }))
        : [],
    [topology, metric],
  );
  const appliedTagIds = useMemo(
    () => selectedIds ?? new Set(tagNodes.map((n) => n.id)),
    [selectedIds, tagNodes],
  );

  // Canvas search (Phase 14 Task 2): resolves typed text to a node id
  // (label or id, case-insensitive; exact match preferred over substring)
  // and focuses it — separate from TagFilterPanel's checkbox filter, which
  // narrows the rendered node SET rather than jumping to one node.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchNoMatch, setSearchNoMatch] = useState(false);
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim().toLowerCase();
    if (!q) return;
    const exact = tagNodes.find((n) => n.id.toLowerCase() === q || n.label.toLowerCase() === q);
    const match = exact ?? tagNodes.find((n) => n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q));
    if (match) {
      setFocusId(match.id);
      setSearchNoMatch(false);
    } else {
      setSearchNoMatch(true);
    }
  };

  // Top-edges rows carry a real TopoEdge id.
  const selectEdgeId = (id: string) => {
    const e = topology?.edges.find((x) => x.id === id);
    if (e) setSelectedEdge(e);
  };
  // Matrix cells carry aggregated entity ids → resolve to the heaviest
  // underlying edge for the current metric (within the filtered set).
  const selectPair = (source: string, target: string) => {
    if (!topology) return;
    const e = resolveEdge(topology, level, source, target, metric);
    if (e) setSelectedEdge(e);
  };
  // Graph edges carry raw node ids — 'pod' level keeps every id as-is, so this
  // resolves the heaviest TopoEdge between the exact pair.
  const selectGraphLink = (source: string, target: string) => {
    if (!topology) return;
    const e = resolveEdge(topology, 'pod', source, target, metric);
    if (e) setSelectedEdge(e);
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
          {view === 'matrix' ? (
            <div
              role="group"
              aria-label={t('topology.matrixMode')}
              data-testid="topology-matrix-mode"
              className="flex h-9 items-center gap-0.5 rounded-lg border border-black/10 bg-white p-0.5 dark:border-white/15 dark:bg-ink"
            >
              {MATRIX_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={matrixMode === m}
                  onClick={() => setMatrixMode(m)}
                  data-testid={`topology-matrix-mode-${m}`}
                  className={`h-full rounded-md px-3 text-xs font-medium ${
                    matrixMode === m
                      ? 'bg-ink text-white dark:bg-white dark:text-ink'
                      : 'text-ink/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10'
                  }`}
                >
                  {m === 'metric' ? t('topology.matrixModeMetric') : t('topology.matrixModeHealth')}
                </button>
              ))}
            </div>
          ) : null}
          {view === 'matrix' && matrixMode === 'health' ? (
            <Select
              label={t('topology.healthLevel')}
              value={healthLevel}
              onChange={(v) => setHealthLevel(v as HealthLevel)}
              options={HEALTH_LEVELS.map((l) => ({ value: l.value, label: t(l.labelKey) }))}
            />
          ) : null}
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
          <Select
            label={t('topology.cluster')}
            value={cluster}
            onChange={setCluster}
            allLabel={t('filter.all')}
            options={clusters.map((c) => ({ value: c, label: c }))}
          />
          <Select
            label={t('topology.category')}
            value={category}
            onChange={(v) => setCategory(v as DestCategory | '')}
            allLabel={t('filter.all')}
            options={CATEGORY_ORDER.map((c) => ({ value: c, label: t(`category.${c}`) }))}
          />
          {view === 'graph' ? (
            <>
              <form onSubmit={handleSearchSubmit} className="flex flex-col gap-1 text-[11px] font-medium text-ink/60 dark:text-white/60">
                <label htmlFor="topology-search-input">{t('topology.search')}</label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="topology-search-input"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setSearchNoMatch(false);
                    }}
                    placeholder={t('topology.search')}
                    data-testid="topology-search"
                    className="h-9 min-w-32 max-w-full rounded-lg border border-black/10 bg-white px-2.5 text-xs text-ink outline-none focus:border-chartViolet dark:border-white/15 dark:bg-ink dark:text-white"
                  />
                  <button
                    type="submit"
                    aria-label={t('topology.search')}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-black/10 text-ink/70 hover:bg-black/5 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/10"
                  >
                    <Search size={14} strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
                {searchNoMatch ? (
                  <span
                    data-testid="topology-search-no-match"
                    className="text-[11px] font-medium"
                    style={{ color: STATUS.danger }}
                  >
                    {t('topology.noMatch')}
                  </span>
                ) : null}
              </form>
              <div className="flex flex-col gap-1 text-[11px] font-medium text-ink/60 dark:text-white/60">
                <label htmlFor="topology-min-traffic-input">
                  {t('topology.minTraffic')}: {formatMetricValue(metric, minEdgeValue)}
                  {hiddenEdgeCount > 0 ? ` · ${t('topology.hiddenEdges', { n: hiddenEdgeCount })}` : ''}
                </label>
                <input
                  id="topology-min-traffic-input"
                  type="range"
                  min={0}
                  max={MIN_TRAFFIC_SLIDER_STEPS}
                  step={1}
                  value={sliderPosFromValue(minEdgeValue, maxEdgeValue)}
                  onChange={(e) => setMinEdgeValue(valueFromSliderPos(Number(e.target.value), maxEdgeValue))}
                  disabled={maxEdgeValue <= 0}
                  data-testid="topology-min-traffic"
                  className="h-9 w-36 accent-chartViolet disabled:opacity-40"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-ink/60 dark:text-white/60">
                  {t('topology.threshold.retrans')}
                </span>
                <div className="flex items-center gap-1.5">
                  <NumberInput
                    label={t('graph.status.warn')}
                    value={healthWarn}
                    onChange={setHealthWarn}
                    min={0}
                    testId="topology-threshold-warn"
                  />
                  <NumberInput
                    label={t('graph.status.danger')}
                    value={healthDanger}
                    onChange={setHealthDanger}
                    min={0}
                    testId="topology-threshold-danger"
                  />
                </div>
              </div>
            </>
          ) : null}
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
          ) : topology ? (
            view === 'graph' ? (
              <div className="flex flex-col gap-3">
                <GraphLegend
                  generatedAt={data?.generatedAt}
                  paused={paused}
                  onTogglePause={() => setPaused((p) => !p)}
                  healthWarnThreshold={healthWarn}
                  healthDangerThreshold={healthDanger}
                  healthFilter={healthFilter}
                  onHealthFilterToggle={toggleHealthFilter}
                />
                <NetworkGraph
                  topology={topology}
                  metric={metric}
                  selectedIds={selectedIds}
                  focusId={focusId}
                  onNodeSelect={setFocusId}
                  onLinkSelect={selectGraphLink}
                  minEdgeValue={minEdgeValue}
                  healthThreshold={healthDanger}
                  healthWarnThreshold={healthWarn}
                  healthFilter={healthFilter}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {matrixMode === 'health' ? (
                  <div
                    data-testid="matrix-health-legend"
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink/60 dark:text-white/60"
                    title={t('topology.healthLegendTitle', { warn: RETRANS_RATE_WARN, danger: RETRANS_RATE_DANGER })}
                  >
                    <span className="font-medium">{t('graph.legendHealth')}</span>
                    {HEALTH_STATUSES.map((s) => (
                      <span key={s} className="flex items-center gap-1.5">
                        <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS[s] }} />
                        {t(`graph.status.${s}`)}
                      </span>
                    ))}
                  </div>
                ) : null}
                <AdjacencyMatrix
                  topology={topology}
                  metric={metric}
                  level={level}
                  onCellSelect={matrixMode === 'metric' ? selectPair : undefined}
                  mode={matrixMode}
                  flows={matrixMode === 'health' ? healthFlows : undefined}
                  healthLevel={healthLevel}
                />
              </div>
            )
          ) : (
            <div className="flex h-96 items-center justify-center text-sm text-ink/40 dark:text-white/40">
              {t('topology.empty')}
            </div>
          )}
        </Card>
        <Card className="min-w-0">
          {topology ? (
            view === 'graph' ? (
              <TagFilterPanel nodes={tagNodes} selected={appliedTagIds} onApply={applyTagSelection} />
            ) : (
              <TopEdgesPanel topology={topology} metric={metric} onEdgeSelect={selectEdgeId} />
            )
          ) : (
            <p className="text-sm text-ink/40 dark:text-white/40">{t('common.loading')}</p>
          )}
        </Card>
      </div>

      {selectedEdge ? (
        // key: remount per edge so the hop-path poll restarts — otherwise
        // usePolling keeps the previous edge's data visible under the new header.
        <EdgeHopPanel
          key={selectedEdge.id}
          edge={selectedEdge}
          labelOf={labelOf}
          onClose={() => setSelectedEdge(null)}
        />
      ) : null}
    </div>
  );
}
