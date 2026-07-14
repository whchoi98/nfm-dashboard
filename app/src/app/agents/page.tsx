'use client';

// /agents (Phase 6 Task 4): coverage StatDelta tiles, policy/tagged rate
// gauges, a collection-cycle history sparkline (STATUS#collect rows), the
// standalone agent table and the last-cycle status card.
import { CircleCheck, CircleX } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { CollectionStatus, Coverage } from '@/lib/types';
import { formatCount } from '@/lib/format';
import { SERIES_COLORS } from '@/lib/chart-tokens';
import { useSortableRows, type SortColumn } from '@/lib/use-sortable';
import Gauge, { type GaugeStatus } from '@/components/charts/Gauge';
import StatDelta from '@/components/charts/StatDelta';
import CollectionStatusCard from '@/components/cards/CollectionStatusCard';
import { SortableHeader } from '@/components/SortableHeader';
import { Card } from '@/components/ui/Controls';
import PageIntro from '@/components/PageIntro';

type StandaloneAgent = Coverage['standalone'][number];

// Sort on the RAW fields — `role` falls back to '' (never rendered as '—' for sorting).
// This is the boolean-comparator exercise: `tagged`/`policyAttached` sort false < true.
const AGENT_COLUMNS: SortColumn<StandaloneAgent>[] = [
  { key: 'instanceId', type: 'string', accessor: (s) => s.instanceId },
  { key: 'role', type: 'string', accessor: (s) => s.roleName ?? '' },
  { key: 'tagged', type: 'boolean', accessor: (s) => s.tagged },
  { key: 'policyAttached', type: 'boolean', accessor: (s) => s.policyAttached },
];

// Coverage-rate thresholds: onboarding aims at the full fleet, so <90% warns
// and <60% is danger — lab-scale heuristics, revisit with real fleet sizes.
const RATE_OK = 90;
const RATE_WARN = 60;
const rateStatus = (pct: number): GaugeStatus =>
  pct >= RATE_OK ? 'ok' : pct >= RATE_WARN ? 'warn' : 'danger';

// Boolean cell dual-encoded: icon + text, never color alone.
function BoolCell({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      {ok ? (
        <CircleCheck size={14} strokeWidth={2} className="text-ink/70 dark:text-white/70" aria-hidden />
      ) : (
        <CircleX size={14} strokeWidth={2} className="text-ink/40 dark:text-white/40" aria-hidden />
      )}
      {ok ? yes : no}
    </span>
  );
}

/** Card-width collection-cycle sparkline (monitors-page Spark pattern). */
function CycleSpark({ values }: { values: number[] }) {
  const rows = values.map((v, i) => ({ i, v }));
  return (
    <div className="h-16 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={SERIES_COLORS[0]}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function AgentsPage() {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<{
    coverage: Coverage | null;
    status: CollectionStatus | null;
    history: CollectionStatus[];
  }>('/api/agents');
  const firstLoad = loading && !data;

  const coverage = data?.coverage;
  const standalone = coverage?.standalone ?? [];
  // Default sort = instanceId asc (exercises the boolean comparator via tagged/policyAttached).
  const { sorted: sortedStandalone, sort: agentSort, onSort: onAgentSort } = useSortableRows(
    standalone,
    AGENT_COLUMNS,
    { key: 'instanceId', dir: 'asc' },
  );
  const total = standalone.length;
  const taggedCount = standalone.filter((s) => s.tagged).length;
  const policyCount = standalone.filter((s) => s.policyAttached).length;
  const taggedPct = total ? Math.round((taggedCount / total) * 100) : 0;
  const policyPct = total ? Math.round((policyCount / total) * 100) : 0;

  // getCollectionHistory returns oldest→newest — feed the spark left-to-right.
  const history = data?.history ?? [];
  const cycleRows = history.map((h) => h.stats.rows);
  const lastCycle = history[history.length - 1];

  const bodyNotice = (text: string) => (
    <p className="flex h-40 items-center justify-center text-sm text-ink/40 dark:text-white/40">
      {text}
    </p>
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t('nav.agents')}</h1>
      <PageIntro page="agents" />

      {error ? (
        <Card>
          <p className="text-sm text-ink/60 dark:text-white/60">{t('common.error')}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatDelta
          testId="stat-agents-eks-nodes"
          label={t('overview.eksNodes')}
          value={firstLoad ? '…' : formatCount(coverage?.eksNodeCount ?? 0)}
        />
        <StatDelta
          testId="stat-agents-standalone"
          label={t('overview.standaloneAgents')}
          value={firstLoad ? '…' : formatCount(total)}
        />
        <StatDelta
          testId="stat-agents-tagged"
          label={t('agents.tagged')}
          value={firstLoad ? '…' : `${taggedCount}/${total}`}
        />
        <StatDelta
          testId="stat-agents-policy"
          label={t('agents.policyAttached')}
          value={firstLoad ? '…' : `${policyCount}/${total}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card title={t('agents.policyRate')} testId="agents-gauge-policy">
          {firstLoad ? (
            bodyNotice(t('common.loading'))
          ) : (
            <Gauge
              value={policyPct}
              max={total ? 100 : 0}
              label={`${policyCount}/${total}`}
              status={total ? rateStatus(policyPct) : undefined}
              valueFormatter={(n) => `${n}%`}
            />
          )}
        </Card>
        <Card title={t('agents.taggedRate')} testId="agents-gauge-tagged">
          {firstLoad ? (
            bodyNotice(t('common.loading'))
          ) : (
            <Gauge
              value={taggedPct}
              max={total ? 100 : 0}
              label={`${taggedCount}/${total}`}
              status={total ? rateStatus(taggedPct) : undefined}
              valueFormatter={(n) => `${n}%`}
            />
          )}
        </Card>
        <Card
          title={t('agents.collectionCycles')}
          testId="agents-cycles"
          className="sm:col-span-2 xl:col-span-1"
        >
          {history.length < 2 ? (
            bodyNotice(firstLoad ? t('common.loading') : t('chart.empty'))
          ) : (
            <>
              <CycleSpark values={cycleRows} />
              <p className="mt-3 text-[11px] text-ink/50 dark:text-white/50">
                {t('agents.cyclesWindow', { count: history.length })}
                {` · ${t('status.rows')}: ${formatCount(lastCycle.stats.rows)}`}
              </p>
            </>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={t('agents.coverageTitle')} className="xl:col-span-2" testId="agents-table">
          {standalone.length === 0 ? (
            <p className="text-sm text-ink/40 dark:text-white/40">
              {loading && !data ? t('common.loading') : t('agents.noStandalone')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-black/5 text-left dark:border-white/10">
                    <SortableHeader label={t('agents.instanceId')} columnKey="instanceId" sort={agentSort} onSort={onAgentSort} className="pr-3" />
                    <SortableHeader label={t('agents.role')} columnKey="role" sort={agentSort} onSort={onAgentSort} className="pr-3" />
                    <SortableHeader label={t('agents.tagged')} columnKey="tagged" sort={agentSort} onSort={onAgentSort} className="pr-3" />
                    <SortableHeader label={t('agents.policyAttached')} columnKey="policyAttached" sort={agentSort} onSort={onAgentSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedStandalone.map((s) => (
                    <tr key={s.instanceId} className="border-b border-black/5 dark:border-white/5">
                      <td className="py-2.5 pr-3 font-medium">{s.instanceId}</td>
                      <td className="py-2.5 pr-3 text-xs text-ink/70 dark:text-white/70">{s.roleName ?? '—'}</td>
                      <td className="py-2.5 pr-3">
                        <BoolCell ok={s.tagged} yes={t('agents.yes')} no={t('agents.no')} />
                      </td>
                      <td className="py-2.5">
                        <BoolCell ok={s.policyAttached} yes={t('agents.yes')} no={t('agents.no')} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <CollectionStatusCard status={data?.status ?? null} />
      </div>
    </div>
  );
}
