'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import type { SortState } from '@/lib/use-sortable';

// Dense header typography (Phase 9 polish) — mirrors FlowTable's headCls.
const headCls = 'text-[11px] font-semibold uppercase tracking-wide text-ink/50 dark:text-white/50';

/** A sortable `<th>` for click-to-sort tables (Phase 15 shared primitive).
 *  Renders the `<th>` itself (with `aria-sort`) so callers just drop it into
 *  a `<tr>`; the header label doubles as the click target and shows an
 *  ArrowUp/ArrowDown only while it is the active sort column. */
export function SortableHeader({
  label,
  columnKey,
  sort,
  onSort,
  align = 'left',
  className = '',
}: {
  label: string;
  columnKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  const active = sort.key === columnKey;
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <th className={`py-1.5 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`} aria-sort={ariaSort}>
      <button
        type="button"
        data-testid={`sort-header-${columnKey}`}
        onClick={() => onSort(columnKey)}
        className={`flex items-center gap-1 ${align === 'right' ? 'ml-auto' : ''} ${headCls} hover:text-ink dark:hover:text-white`}
      >
        {label}
        {active ? (
          sort.dir === 'desc' ? (
            <ArrowDown size={12} strokeWidth={1.5} aria-hidden />
          ) : (
            <ArrowUp size={12} strokeWidth={1.5} aria-hidden />
          )
        ) : null}
      </button>
    </th>
  );
}
