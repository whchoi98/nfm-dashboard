'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { EndpointInfo, FlowEdge } from '@/lib/types';
import { CATEGORY_COLORS, type DestCategory } from '@/lib/chart-tokens';
import { formatMetricValue } from '@/lib/format';

export function endpointLabel(e: EndpointInfo): string {
  if (e.podName) return e.podNamespace ? `${e.podNamespace}/${e.podName}` : e.podName;
  return e.serviceName ?? e.instanceId ?? e.ip ?? '—';
}

export function CategoryChip({ category }: { category: string }) {
  const { t } = useLanguage();
  const color = CATEGORY_COLORS[category as DestCategory];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink/70 dark:bg-white/10 dark:text-white/70">
      {color ? (
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      ) : null}
      {t(`category.${category}`)}
    </span>
  );
}

function Field({ label, value }: { label: string; value?: string | number }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="shrink-0 text-ink/50 dark:text-white/50">{label}</span>
      <span className="break-all text-right font-medium text-ink dark:text-white">{value}</span>
    </div>
  );
}

function EndpointDetail({ title, e }: { title: string; e: EndpointInfo }) {
  const { t } = useLanguage();
  return (
    <div className="rounded-card bg-surface p-4 dark:bg-white/5">
      <p className="mb-2 text-xs font-semibold text-ink/60 dark:text-white/60">{title}</p>
      <div className="flex flex-col gap-1.5">
        <Field label={t('field.pod')} value={e.podName} />
        <Field label={t('field.namespace')} value={e.podNamespace} />
        <Field label={t('field.service')} value={e.serviceName} />
        <Field label={t('field.ip')} value={e.ip} />
        <Field label={t('field.instanceId')} value={e.instanceId} />
        <Field label={t('field.subnetId')} value={e.subnetId} />
        <Field label={t('field.az')} value={e.az} />
        <Field label={t('field.vpcId')} value={e.vpcId} />
        <Field label={t('field.region')} value={e.region} />
      </div>
    </div>
  );
}

/** Right-side drawer (desktop) / bottom sheet (mobile) with full flow detail. */
export function FlowDrawer({ flow, onClose }: { flow: FlowEdge; onClose: () => void }) {
  const { t } = useLanguage();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={t('flow.drawerTitle')}>
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-card bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:inset-y-0 md:left-auto md:right-0 md:h-full md:max-h-full md:w-[26rem] md:rounded-none md:pb-5 dark:bg-ink">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('flow.drawerTitle')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-8 w-8 items-center justify-center rounded-card text-ink/60 hover:bg-surface dark:text-white/60 dark:hover:bg-white/10"
          >
            <X size={16} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <CategoryChip category={flow.category} />
          <span className="rounded-full bg-accentLav px-2 py-0.5 text-[11px] font-medium text-ink">
            {t(`metric.${flow.metric}`)}
          </span>
          {flow.targetPort != null ? (
            <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink/70 dark:bg-white/10 dark:text-white/70">
              :{flow.targetPort}
            </span>
          ) : null}
        </div>
        <p className="mb-4 text-2xl font-semibold tracking-tight">
          {formatMetricValue(flow.metric, flow.value)}
        </p>
        <div className="mb-4 flex flex-col gap-1.5">
          <Field label={t('flow.bucket')} value={new Date(flow.bucket).toLocaleString()} />
          <Field label={t('flow.monitor')} value={flow.monitor} />
          <Field label={t('flow.snat')} value={flow.snatIp} />
          <Field label={t('flow.dnat')} value={flow.dnatIp} />
        </div>
        <div className="flex flex-col gap-3">
          <EndpointDetail title={t('flow.endpointA')} e={flow.a} />
          <div className="flex justify-center text-ink/40 dark:text-white/40">
            <ArrowDown size={16} strokeWidth={1.5} aria-hidden />
          </div>
          <EndpointDetail title={t('flow.endpointB')} e={flow.b} />
        </div>
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold text-ink/60 dark:text-white/60">{t('flow.traversed')}</p>
          {flow.traversedConstructs?.length ? (
            <ol className="flex flex-col gap-1.5">
              {flow.traversedConstructs.map((c, i) => (
                <li
                  key={`${c.componentId ?? c.componentArn ?? i}`}
                  className="flex items-center gap-2 rounded-card bg-surface px-3 py-2 text-xs dark:bg-white/5"
                >
                  <span className="rounded bg-accentBlue px-1.5 py-0.5 text-[10px] font-semibold text-ink">
                    {c.componentType ?? '?'}
                  </span>
                  <span className="break-all font-medium">
                    {c.serviceName ?? c.componentId ?? c.componentArn ?? '—'}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-ink/40 dark:text-white/40">{t('flow.noTraversed')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

type SortKey = 'value' | 'category' | 'metric' | 'port';

/** Sortable flow table (desktop) with a card-list fallback on mobile. */
export default function FlowTable({ flows }: { flows: FlowEdge[] }) {
  const { t } = useLanguage();
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [desc, setDesc] = useState(true);
  const [selected, setSelected] = useState<FlowEdge | null>(null);

  const sorted = useMemo(() => {
    const cmp: Record<SortKey, (a: FlowEdge, b: FlowEdge) => number> = {
      value: (a, b) => a.value - b.value,
      category: (a, b) => a.category.localeCompare(b.category),
      metric: (a, b) => a.metric.localeCompare(b.metric),
      port: (a, b) => (a.targetPort ?? -1) - (b.targetPort ?? -1),
    };
    return [...flows].sort((a, b) => (desc ? -cmp[sortKey](a, b) : cmp[sortKey](a, b)));
  }, [flows, sortKey, desc]);

  const onSort = (k: SortKey) => {
    if (k === sortKey) setDesc((d) => !d);
    else {
      setSortKey(k);
      setDesc(true);
    }
  };

  const SortHeader = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      type="button"
      onClick={() => onSort(k)}
      className="flex items-center gap-1 text-xs font-medium text-ink/60 hover:text-ink dark:text-white/60 dark:hover:text-white"
    >
      {label}
      {sortKey === k ? (
        desc ? (
          <ArrowDown size={12} strokeWidth={1.5} aria-hidden />
        ) : (
          <ArrowUp size={12} strokeWidth={1.5} aria-hidden />
        )
      ) : null}
    </button>
  );

  if (flows.length === 0) {
    return (
      <div data-testid="flow-table" className="flex h-40 items-center justify-center text-sm text-ink/40 dark:text-white/40">
        {t('table.empty')}
      </div>
    );
  }

  const rowKey = (f: FlowEdge, i: number) => `${f.edgeHash}-${f.metric}-${f.bucket}-${i}`;

  return (
    <div data-testid="flow-table">
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/5 text-left dark:border-white/10">
              <th className="py-2 pr-3 text-xs font-medium text-ink/60 dark:text-white/60">{t('flow.colA')}</th>
              <th className="py-2 pr-3 text-xs font-medium text-ink/60 dark:text-white/60">{t('flow.colB')}</th>
              <th className="py-2 pr-3"><SortHeader k="category" label={t('flow.colCategory')} /></th>
              <th className="py-2 pr-3"><SortHeader k="metric" label={t('flow.colMetric')} /></th>
              <th className="py-2 pr-3"><SortHeader k="port" label={t('flow.colPort')} /></th>
              <th className="py-2"><SortHeader k="value" label={t('flow.colValue')} /></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((f, i) => (
              <tr
                key={rowKey(f, i)}
                onClick={() => setSelected(f)}
                className="cursor-pointer border-b border-black/5 hover:bg-surface dark:border-white/5 dark:hover:bg-white/5"
              >
                <td className="max-w-56 truncate py-2.5 pr-3 font-medium">{endpointLabel(f.a)}</td>
                <td className="max-w-56 truncate py-2.5 pr-3 font-medium">{endpointLabel(f.b)}</td>
                <td className="py-2.5 pr-3"><CategoryChip category={f.category} /></td>
                <td className="py-2.5 pr-3 text-xs text-ink/70 dark:text-white/70">{t(`metric.${f.metric}`)}</td>
                <td className="py-2.5 pr-3 tabular-nums text-ink/70 dark:text-white/70">
                  {f.targetPort ?? '—'}
                </td>
                <td className="py-2.5 font-semibold tabular-nums">{formatMetricValue(f.metric, f.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile card list */}
      <ul className="flex flex-col gap-2 md:hidden">
        {sorted.map((f, i) => (
          <li key={rowKey(f, i)}>
            <button
              type="button"
              onClick={() => setSelected(f)}
              className="w-full rounded-card bg-surface p-3 text-left dark:bg-white/5"
            >
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <span className="truncate">{endpointLabel(f.a)}</span>
                <ArrowRight size={12} strokeWidth={1.5} className="shrink-0 text-ink/40 dark:text-white/40" aria-hidden />
                <span className="truncate">{endpointLabel(f.b)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <CategoryChip category={f.category} />
                <span className="text-ink/60 dark:text-white/60">{t(`metric.${f.metric}`)}</span>
                {f.targetPort != null ? <span className="text-ink/60 dark:text-white/60">:{f.targetPort}</span> : null}
                <span className="ml-auto font-semibold tabular-nums">{formatMetricValue(f.metric, f.value)}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {selected ? <FlowDrawer flow={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
