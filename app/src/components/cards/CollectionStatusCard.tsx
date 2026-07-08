'use client';

import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { CollectionStatus } from '@/lib/types';
import { formatCount } from '@/lib/format';
import { Card } from '@/components/ui/Controls';

/** Last collection cycle stats (started/succeeded/failed/throttled + cycle time). */
export default function CollectionStatusCard({ status }: { status: CollectionStatus | null }) {
  const { t } = useLanguage();
  const stats = status?.stats;
  const cells: { key: string; value: number | undefined; alert?: boolean }[] = [
    { key: 'status.started', value: stats?.started },
    { key: 'status.succeeded', value: stats?.succeeded },
    { key: 'status.failed', value: stats?.failed, alert: (stats?.failed ?? 0) > 0 },
    { key: 'status.throttled', value: stats?.throttled, alert: (stats?.throttled ?? 0) > 0 },
  ];
  return (
    <Card title={t('overview.collection')}>
      {status ? (
        <>
          <dl className="grid grid-cols-2 gap-3">
            {cells.map((c) => (
              <div key={c.key} className="rounded-card bg-white p-3 dark:bg-white/5">
                <dt className="text-[11px] text-ink/50 dark:text-white/50">{t(c.key)}</dt>
                <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${c.alert ? 'underline decoration-2 underline-offset-4' : ''}`}>
                  {c.value != null ? formatCount(c.value) : '—'}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[11px] text-ink/50 dark:text-white/50">
            {t('overview.lastCycle')}: {new Date(status.cycleTs).toLocaleString()}
            {stats?.rows != null ? ` · ${t('status.rows')}: ${formatCount(stats.rows)}` : ''}
          </p>
        </>
      ) : (
        <p className="text-sm text-ink/40 dark:text-white/40">{t('common.collecting')}</p>
      )}
    </Card>
  );
}
