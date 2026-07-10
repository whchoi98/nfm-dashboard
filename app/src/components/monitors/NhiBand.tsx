'use client';

// AWS NFM console-style Network Health Indicator band: the NHI timeline as a
// horizontal striped band across the window — one hatched segment per point,
// mint = healthy (v === 0), violet = degraded (v > 0). Dual-encoded: a text
// legend row plus a per-segment tooltip (time + status), never color alone.
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { STATUS, TOKENS } from '@/lib/chart-tokens';

/** Hatched fill matching the AWS console's striped band look. Colors are
 *  chart tokens (STATUS.ok / TOKENS.chartViolet), referenced — not hardcoded. */
function hatch(color: string): string {
  return `repeating-linear-gradient(135deg, ${color} 0px, ${color} 4px, transparent 4px, transparent 8px)`;
}

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-ink/60 dark:text-white/60">
      <span
        aria-hidden
        className="h-3 w-4 rounded-[3px] border border-black/10 dark:border-white/15"
        style={{ backgroundImage: hatch(color) }}
      />
      {label}
    </span>
  );
}

export default function NhiBand({ points }: { points: { t: string; v: number }[] }) {
  const { t } = useLanguage();
  if (points.length === 0) {
    return (
      <div data-testid="nhi-band" className="py-6 text-center text-xs text-ink/40 dark:text-white/40">
        {t('chart.empty')}
      </div>
    );
  }
  const healthy = t('monitors.nhiHealthy');
  const degraded = t('monitors.nhiDegraded');
  return (
    <div data-testid="nhi-band" className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={t('monitors.nhi')}
        className="flex h-10 w-full overflow-hidden rounded-lg border border-black/10 dark:border-white/15"
      >
        {points.map((p, i) => {
          const isDegraded = p.v > 0;
          return (
            <span
              key={`${p.t}-${i}`}
              title={`${timeLabel(p.t)} · ${isDegraded ? degraded : healthy}`}
              className="h-full min-w-0 flex-1"
              style={{ backgroundImage: hatch(isDegraded ? TOKENS.chartViolet : STATUS.ok) }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <LegendSwatch color={STATUS.ok} label={healthy} />
          <LegendSwatch color={TOKENS.chartViolet} label={degraded} />
        </div>
        <span className="text-[10px] tabular-nums text-ink/40 dark:text-white/40">
          {timeLabel(points[0].t)} – {timeLabel(points[points.length - 1].t)}
        </span>
      </div>
    </div>
  );
}
