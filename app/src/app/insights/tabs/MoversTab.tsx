'use client';
// Top-movers tab (Phase 7 Task 3): window-over-window deltas per service
// entity — which entities' traffic / retransmissions / timeouts changed most
// vs the prior window (incident triage). One Toplist per metric, rows arrive
// from the lens pre-ranked by absolute change; the delta chip lives in `sub`
// (▲/▼ + signed % or "new" when there is no prior baseline).
import { useMemo } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import { lensQuery } from '@/lib/analytics/filters';
import type { Mover, MoversResult } from '@/lib/analytics/movers';
import { formatBytes, formatCount } from '@/lib/format';
import Widget from '@/components/analytics/Widget';
import Toplist, { type ToplistRow } from '@/components/analytics/Toplist';
import { LensState, type TabProps } from './shared';

interface SectionDef {
  metric: 'DATA_TRANSFERRED' | 'RETRANSMISSIONS' | 'TIMEOUTS';
  field: keyof MoversResult;
  testId: string;
  format: (v: number) => string;
  /** Retrans/timeout increases are BAD (danger); traffic direction is neutral. */
  badWhenUp: boolean;
}

const SECTIONS: SectionDef[] = [
  { metric: 'DATA_TRANSFERRED', field: 'dataTransferred', testId: 'traffic',
    format: formatBytes, badWhenUp: false },
  { metric: 'RETRANSMISSIONS', field: 'retransmissions', testId: 'retrans',
    format: formatCount, badWhenUp: true },
  { metric: 'TIMEOUTS', field: 'timeouts', testId: 'timeouts',
    format: formatCount, badWhenUp: true },
];

export default function MoversTab({ filters }: TabProps) {
  const { t } = useLanguage();
  const { data, error, loading } = usePolling<MoversResult>(
    `/api/analytics/movers${lensQuery(filters)}`,
  );
  const firstLoad = loading && !data;

  const rowsBySection: ToplistRow[][] = useMemo(() => {
    // Delta chip text: "new" when there is no prior baseline (deltaPct null),
    // otherwise arrow + unsigned % + a translated direction word (dual-encoded).
    const deltaText = (m: Mover): string => {
      if (m.deltaPct == null) return t('insights.movers.new');
      if (m.direction === 'flat') return t('insights.movers.flat');
      const pct = Math.abs(m.deltaPct).toFixed(1);
      return t(m.direction === 'up' ? 'insights.movers.up' : 'insights.movers.down', { pct });
    };
    return SECTIONS.map(({ field, badWhenUp }) =>
      // Lens order preserved: ranked by |current − prior| desc.
      (data?.[field] ?? []).map((m) => ({
        label: m.label,
        value: m.current,
        sub: deltaText(m),
        status: badWhenUp && m.direction !== 'flat'
          ? (m.direction === 'up' ? ('danger' as const) : ('ok' as const))
          : undefined,
      })),
    );
  }, [data, t]);

  return (
    <div
      data-testid="insights-movers-panel"
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
    >
      {SECTIONS.map(({ metric, format, testId }, i) => (
        <Widget key={metric} title={t(`metric.${metric}`)} testId={`widget-movers-${testId}`}>
          <LensState
            loading={firstLoad}
            error={error}
            empty={rowsBySection[i].length === 0}
            emptyLabel={t('insights.movers.empty')}
          >
            <p className="mb-2 text-[11px] text-ink/40 dark:text-white/40">
              {t('insights.movers.vsPrior')}
            </p>
            <Toplist
              rows={rowsBySection[i]}
              valueFormatter={format}
              testId={`toplist-movers-${testId}`}
            />
          </LensState>
        </Widget>
      ))}
    </div>
  );
}
