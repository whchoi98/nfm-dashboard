'use client';

import { useMemo } from 'react';
import { ArrowRight, Box, Globe, Layers, Network, Server, Waypoints } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { EndpointInfo, FlowEdge, MetricName } from '@/lib/types';
import { formatBytes, formatCount, formatMicros } from '@/lib/format';
import TimeSeries, { type TimeSeriesInput } from './charts/TimeSeries';
import { CategoryChip } from './FlowTable';

type StepKind = 'pod' | 'node' | 'subnet' | 'construct' | 'endpoint';

interface Step {
  kind: StepKind;
  title: string;
  subtitle?: string;
}

// Node style per step kind — icon + fill (dual-encoded identity).
const STEP_STYLE: Record<StepKind, { icon: typeof Box; cls: string }> = {
  pod: { icon: Box, cls: 'bg-accentBlue text-ink' },
  node: { icon: Server, cls: 'bg-accentLav text-ink' },
  subnet: { icon: Network, cls: 'bg-surface text-ink dark:bg-white/10 dark:text-white' },
  construct: { icon: Waypoints, cls: 'bg-accentMint text-ink' },
  endpoint: { icon: Globe, cls: 'bg-surface text-ink dark:bg-white/10 dark:text-white' },
};

function endpointSteps(e: EndpointInfo, fallback: string): Step[] {
  const steps: Step[] = [];
  if (e.podName || e.serviceName) {
    steps.push({ kind: 'pod', title: e.podName ?? e.serviceName!, subtitle: e.podNamespace });
  }
  if (e.instanceId) steps.push({ kind: 'node', title: e.instanceId, subtitle: e.ip });
  // Neither a pod nor an instance: a bare IP / external endpoint.
  if (steps.length === 0) steps.push({ kind: 'endpoint', title: e.ip ?? fallback });
  if (e.subnetId || e.az) {
    steps.push({ kind: 'subnet', title: e.subnetId ?? '—', subtitle: e.az ?? e.vpcId });
  }
  return steps;
}

const METRIC_ORDER: MetricName[] = [
  'DATA_TRANSFERRED',
  'RETRANSMISSIONS',
  'TIMEOUTS',
  'ROUND_TRIP_TIME',
];
const METRIC_FMT: Record<MetricName, (n: number) => string> = {
  DATA_TRANSFERRED: formatBytes,
  RETRANSMISSIONS: formatCount,
  TIMEOUTS: formatCount,
  ROUND_TRIP_TIME: formatMicros,
};

/**
 * Path detail for one edge: [pod A] → [node] → [subnet/AZ] → traversed
 * constructs → [subnet/AZ] → [node] → [pod B] stepper (vertical on mobile),
 * SNAT/DNAT/port badges and per-metric time series.
 */
export default function PathView({ latest, series }: { latest: FlowEdge; series: FlowEdge[] }) {
  const { t } = useLanguage();

  const steps = useMemo<Step[]>(() => {
    const construct: Step[] = (latest.traversedConstructs ?? []).map((c) => ({
      kind: 'construct',
      title: c.serviceName ?? c.componentType ?? '—',
      subtitle: c.componentId,
    }));
    return [
      ...endpointSteps(latest.a, t('path.endpointA')),
      ...construct,
      ...endpointSteps(latest.b, t('path.endpointB')).reverse(),
    ];
  }, [latest, t]);

  const charts = useMemo(() => {
    const byMetric = new Map<MetricName, TimeSeriesInput>();
    for (const f of series) {
      const s = byMetric.get(f.metric) ?? { name: t(`metric.${f.metric}`), points: [] };
      s.points.push({ t: f.bucket, v: f.value });
      byMetric.set(f.metric, s);
    }
    return METRIC_ORDER.filter((m) => byMetric.has(m)).map((m) => ({
      metric: m,
      input: byMetric.get(m)!,
    }));
  }, [series, t]);

  return (
    <div data-testid="path-view" className="flex flex-col gap-4">
      {/* Badges */}
      <div className="flex flex-wrap items-center gap-2">
        <CategoryChip category={latest.category} />
        {latest.targetPort != null ? (
          <span className="rounded-full bg-accentLav px-2 py-0.5 text-[11px] font-medium text-ink">
            {t('path.port')} {latest.targetPort}
          </span>
        ) : null}
        {latest.snatIp ? (
          <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink/70 dark:bg-white/10 dark:text-white/70">
            SNAT {latest.snatIp}
          </span>
        ) : null}
        {latest.dnatIp ? (
          <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink/70 dark:bg-white/10 dark:text-white/70">
            DNAT {latest.dnatIp}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-ink/50 dark:text-white/50">
          {t('path.lastBucket')}: {new Date(latest.bucket).toLocaleString()}
        </span>
      </div>

      {/* Stepper: horizontal on desktop, vertical on mobile */}
      <div className="overflow-x-auto">
        <ol className="flex flex-col items-stretch gap-1 md:flex-row md:items-center">
          {steps.map((s, i) => {
            const { icon: Icon, cls } = STEP_STYLE[s.kind];
            return (
              <li key={`${s.kind}-${s.title}-${i}`} className="flex flex-col items-stretch md:flex-row md:items-center">
                {i > 0 ? (
                  <span className="flex justify-center px-1 py-0.5 text-ink/30 md:py-0 dark:text-white/30">
                    <ArrowRight size={14} strokeWidth={1.5} className="rotate-90 md:rotate-0" aria-hidden />
                  </span>
                ) : null}
                <div className={`flex min-w-36 items-center gap-2.5 rounded-card px-3 py-2.5 ${cls}`}>
                  <Icon size={16} strokeWidth={1.5} className="shrink-0" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold" title={s.title}>{s.title}</p>
                    <p className="truncate text-[10px] opacity-60">
                      {s.subtitle ?? t(`path.kind.${s.kind}`)}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Per-metric time series (small multiples — one axis each) */}
      {charts.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {charts.map(({ metric, input }) => (
            <div key={metric} className="rounded-card bg-surface p-4 dark:bg-white/5">
              <div className="mb-2 flex items-center gap-2">
                <Layers size={14} strokeWidth={1.5} className="text-ink/40 dark:text-white/40" aria-hidden />
                <h3 className="text-xs font-semibold text-ink/70 dark:text-white/70">
                  {t(`metric.${metric}`)}
                </h3>
              </div>
              <TimeSeries series={[input]} valueFormatter={METRIC_FMT[metric]} height={180} />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink/40 dark:text-white/40">{t('chart.empty')}</p>
      )}
    </div>
  );
}
