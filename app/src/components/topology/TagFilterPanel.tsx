'use client';

// TagFilterPanel (Task 6) — WhaTap-style right-side node selector for the
// NetworkGraph. Holds a DRAFT selection (checkboxes edit the draft only);
// 적용/Apply commits it via onApply, 취소/Cancel resets the draft back to the
// currently applied selection. The search box filters visible rows without
// changing the draft; "전체 선택" toggles every node (not just visible ones).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { STATUS, TOKENS } from '@/lib/chart-tokens';
import { TextInput } from '@/components/ui/Controls';

export interface TagFilterNode {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'danger' | 'idle';
}

const statusColor = (s: TagFilterNode['status']) => (s === 'idle' ? TOKENS.chartGrey : STATUS[s]);

export default function TagFilterPanel({
  nodes,
  selected,
  onApply,
}: {
  nodes: TagFilterNode[];
  selected: Set<string>;
  onApply: (next: Set<string>) => void;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selected));
  const [query, setQuery] = useState('');

  // Re-sync the draft when the applied selection's MEMBERSHIP changes from
  // outside (apply, filter change, new nodes). Identity-only changes — the
  // parent rebuilds an equal Set on every poll — must not wipe an in-progress
  // draft, so compare contents against the previously seen prop.
  const lastSelected = useRef(selected);
  useEffect(() => {
    const prev = lastSelected.current;
    lastSelected.current = selected;
    const same = prev.size === selected.size && [...prev].every((id) => selected.has(id));
    if (!same) setDraft(new Set(selected));
  }, [selected]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? nodes.filter((n) => n.label.toLowerCase().includes(q)) : nodes;
  }, [nodes, query]);

  const allChecked = nodes.length > 0 && nodes.every((n) => draft.has(n.id));

  const toggle = (id: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setDraft(allChecked ? new Set() : new Set(nodes.map((n) => n.id)));
  };

  return (
    <div data-testid="tag-filter-panel" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('graph.selectedTags')}</h2>
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink/70 dark:bg-white/10 dark:text-white/70">
          {draft.size}
        </span>
      </div>
      <TextInput label={t('graph.searchTag')} value={query} onChange={setQuery} placeholder={t('graph.searchTag')} />
      <label className="flex cursor-pointer items-center gap-2 border-b border-black/5 pb-2 text-xs font-medium dark:border-white/10">
        <input type="checkbox" checked={allChecked} onChange={toggleAll} className="accent-chartViolet" />
        {t('graph.selectAll')}
      </label>
      <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
        {visible.map((n) => (
          <li key={n.id}>
            <label
              className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10"
              title={n.label}
            >
              <input
                type="checkbox"
                checked={draft.has(n.id)}
                onChange={() => toggle(n.id)}
                className="accent-chartViolet"
              />
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: statusColor(n.status) }}
              />
              <span className="truncate">{n.label}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2 border-t border-black/5 pt-3 dark:border-white/10">
        <span className="text-[11px] tabular-nums text-ink/60 dark:text-white/60">
          {t('graph.total', { n: nodes.length })} / {t('graph.selected', { n: draft.size })}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDraft(new Set(selected))}
            className="h-8 rounded-lg border border-black/10 px-3 text-xs font-medium text-ink/70 hover:bg-black/5 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/10"
          >
            {t('graph.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onApply(new Set(draft))}
            className="h-8 rounded-lg bg-ink px-3 text-xs font-semibold text-white hover:opacity-90 dark:bg-white dark:text-ink"
          >
            {t('graph.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
