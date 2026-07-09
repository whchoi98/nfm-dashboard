'use client';

// HopPath (Task 3) — horizontal network-path stepper in the AWS Network Flow
// Monitor style (screenshots/nfm06.png): a row of circular resource icons
// joined by thin connector lines, each with kind label, monospace resource id
// and region/AZ context stacked below; SNAT/DNAT/port shown as summary badges.
// Identity is dual-encoded (per-kind icon glyph + text label, never color-only).
import { useMemo } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { FlowEdge } from '@/lib/types';
import { buildHops } from '@/lib/topology';
import ResourceIcon from './topology/ResourceIcon';

/**
 * Stepper of buildHops(edge): src endpoint → traversed constructs → dst
 * endpoint. Scrolls horizontally inside its own box on narrow screens
 * (no page-level h-scroll). Safe for 0 traversed constructs (2 endpoint hops).
 */
export default function HopPath({ edge, metricLabel }: { edge: FlowEdge; metricLabel?: string }) {
  const { t } = useLanguage();
  const hops = useMemo(() => buildHops(edge), [edge]);

  const badges = [
    edge.snatIp ? `${t('paths.snat')} ${edge.snatIp}` : null,
    edge.dnatIp ? `${t('paths.dnat')} ${edge.dnatIp}` : null,
    edge.targetPort != null ? `${t('paths.port')} ${edge.targetPort}` : null,
  ].filter((b): b is string => b != null);

  return (
    <section data-testid="hop-path" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-ink dark:text-white">
          {t('paths.networkPath')}
          {metricLabel ? ` (${metricLabel})` : ''}
        </h3>
        {badges.map((b) => (
          <span
            key={b}
            className="rounded-full bg-surface px-2 py-0.5 font-mono text-[11px] font-medium text-ink/70 dark:bg-white/10 dark:text-white/70"
          >
            {b}
          </span>
        ))}
      </div>

      {/* Stepper scrolls inside its own box on narrow screens. */}
      <div className="overflow-x-auto pb-1">
        <ol className="flex min-w-max items-start">
          {hops.map((hop, i) => (
            <li
              key={`${hop.kind}-${hop.id ?? hop.label}-${i}`}
              data-testid="hop-step"
              className="flex w-44 shrink-0 flex-col gap-1"
            >
              <div className="flex items-center">
                <ResourceIcon kind={hop.kind} size={36} />
                {i < hops.length - 1 ? (
                  <span className="h-px flex-1 bg-ink/20 dark:bg-white/20" aria-hidden />
                ) : null}
              </div>
              <div className="min-w-0 pr-4">
                <p className="truncate text-xs font-semibold text-ink dark:text-white" title={hop.label}>
                  {hop.label}
                </p>
                {hop.id && hop.id !== hop.label ? (
                  <p className="truncate font-mono text-[11px] text-ink/60 dark:text-white/60" title={hop.id}>
                    {hop.id}
                  </p>
                ) : null}
                {hop.context ? (
                  <p className="truncate text-[11px] text-ink/50 dark:text-white/50" title={hop.context}>
                    {hop.context}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
