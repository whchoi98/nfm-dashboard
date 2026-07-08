'use client';

import { CircleCheck, CircleX } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { CollectionStatus, Coverage } from '@/lib/types';
import { formatCount } from '@/lib/format';
import KpiCard from '@/components/cards/KpiCard';
import CollectionStatusCard from '@/components/cards/CollectionStatusCard';
import { Card } from '@/components/ui/Controls';

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

export default function AgentsPage() {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<{ coverage: Coverage | null; status: CollectionStatus | null }>(
    '/api/agents',
  );
  const coverage = data?.coverage;
  const standalone = coverage?.standalone ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t('nav.agents')}</h1>

      {error ? (
        <Card>
          <p className="text-sm text-ink/60 dark:text-white/60">{t('common.error')}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label={t('overview.eksNodes')}
          value={loading && !data ? '…' : formatCount(coverage?.eksNodeCount ?? 0)}
          accent="blue"
        />
        <KpiCard
          label={t('overview.standaloneAgents')}
          value={loading && !data ? '…' : formatCount(standalone.length)}
          accent="lav"
        />
        <KpiCard
          label={t('agents.tagged')}
          value={loading && !data ? '…' : `${standalone.filter((s) => s.tagged).length}/${standalone.length}`}
          accent="blue"
        />
        <KpiCard
          label={t('agents.policyAttached')}
          value={loading && !data ? '…' : `${standalone.filter((s) => s.policyAttached).length}/${standalone.length}`}
          accent="lav"
        />
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
                    <th className="py-2 pr-3 text-xs font-medium text-ink/60 dark:text-white/60">
                      {t('agents.instanceId')}
                    </th>
                    <th className="py-2 pr-3 text-xs font-medium text-ink/60 dark:text-white/60">
                      {t('agents.role')}
                    </th>
                    <th className="py-2 pr-3 text-xs font-medium text-ink/60 dark:text-white/60">
                      {t('agents.tagged')}
                    </th>
                    <th className="py-2 text-xs font-medium text-ink/60 dark:text-white/60">
                      {t('agents.policyAttached')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {standalone.map((s) => (
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
