'use client';

// GraphLegend (Task 6; interactive health filter — Phase 14 Task 1) — LIVE
// indicator (snapshot timestamp + pause/resume toggle that stops the
// topology poll) plus the solid/dashed edge legend for the NetworkGraph rate
// threshold and the edge-health (retrans/GB) color legend (STATUS colors,
// dual-encoded with text labels). Each health entry is also a toggle button:
// clicking "ok"/"warn"/"danger" isolates that class in the graph (edges/nodes
// outside it are dimmed); clicking the active entry again clears the filter.
import { Pause, Play } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { STATUS, TOKENS } from '@/lib/chart-tokens';
import { DEFAULT_HEALTH_THRESHOLD, DEFAULT_RATE_THRESHOLD } from '@/lib/topology-graph';

export type HealthStatus = 'ok' | 'warn' | 'danger';
const HEALTH_LEVELS: HealthStatus[] = ['ok', 'warn', 'danger'];

/** generatedAt ISO string → local HH:MM:SS. */
function hhmmss(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function GraphLegend({
  generatedAt,
  paused,
  onTogglePause,
  threshold = DEFAULT_RATE_THRESHOLD,
  healthWarnThreshold = DEFAULT_HEALTH_THRESHOLD / 2,
  healthDangerThreshold = DEFAULT_HEALTH_THRESHOLD,
  healthFilter = null,
  onHealthFilterToggle,
}: {
  generatedAt?: string;
  paused: boolean;
  onTogglePause: () => void;
  threshold?: number;
  healthWarnThreshold?: number;
  healthDangerThreshold?: number;
  /** Active isolate filter (null = show all classes). */
  healthFilter?: HealthStatus | null;
  onHealthFilterToggle?: (h: HealthStatus) => void;
}) {
  const { t } = useLanguage();
  return (
    <div data-testid="graph-legend" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]">
      <span className="flex items-center gap-1.5 font-semibold">
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${paused ? '' : 'animate-pulse'}`}
          style={{ backgroundColor: paused ? TOKENS.chartGrey : STATUS.ok }}
        />
        {paused ? t('graph.paused') : t('graph.live')}
        {generatedAt ? (
          <span className="font-normal tabular-nums text-ink/60 dark:text-white/60">{hhmmss(generatedAt)}</span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={onTogglePause}
        data-testid="graph-pause-toggle"
        className="flex h-7 items-center gap-1 rounded-lg border border-black/10 px-2 font-medium text-ink/70 hover:bg-black/5 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/10"
      >
        {paused ? <Play size={12} strokeWidth={1.5} aria-hidden /> : <Pause size={12} strokeWidth={1.5} aria-hidden />}
        {paused ? t('graph.resume') : t('graph.pause')}
      </button>
      <span className="flex items-center gap-1.5 text-ink/60 dark:text-white/60">
        <svg width="24" height="6" aria-hidden>
          <line x1="0" y1="3" x2="24" y2="3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        {t('graph.legendSolid', { threshold })}
      </span>
      <span className="flex items-center gap-1.5 text-ink/60 dark:text-white/60">
        <svg width="24" height="6" aria-hidden>
          <line x1="0" y1="3" x2="24" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
        </svg>
        {t('graph.legendDashed', { threshold })}
      </span>
      {/* edge-health color legend — STATUS colors dual-encoded with text labels;
          each entry doubles as an isolate-filter toggle (Phase 14 Task 1). */}
      <span
        data-testid="graph-health-legend"
        className="flex items-center gap-x-2.5 text-ink/60 dark:text-white/60"
        title={`${t('graph.legendHealthTitle', {
          warn: healthWarnThreshold,
          danger: healthDangerThreshold,
        })} — ${t('topology.legendFilterHint')}`}
      >
        <span className="font-medium">{t('graph.legendHealth')}</span>
        {HEALTH_LEVELS.map((h) => {
          const active = healthFilter === h;
          return (
            <button
              key={h}
              type="button"
              onClick={() => onHealthFilterToggle?.(h)}
              aria-pressed={active}
              data-testid={`topology-legend-${h}`}
              className={`flex items-center gap-1.5 rounded-full px-1.5 py-0.5 ${
                active
                  ? 'font-semibold text-ink dark:text-white'
                  : 'hover:bg-black/5 dark:hover:bg-white/10'
              }`}
              style={active ? { backgroundColor: `${STATUS[h]}40` } : undefined}
            >
              <svg width="16" height="6" aria-hidden>
                <line x1="0" y1="3" x2="16" y2="3" stroke={STATUS[h]} strokeWidth="2.5" />
              </svg>
              {t(`graph.status.${h}`)}
            </button>
          );
        })}
      </span>
    </div>
  );
}
