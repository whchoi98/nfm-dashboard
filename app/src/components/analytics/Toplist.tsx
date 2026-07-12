'use client';
// Datadog-style toplist: ranked horizontal bars (width ∝ value / max value)
// with label, optional sub text and a right-aligned formatted value. Status is
// dual-encoded per the chart-tokens mandate: STATUS color + leading dot + an
// sr-only text label — never color alone.
import { ArrowDown, ArrowUp } from 'lucide-react';
import { SERIES_COLORS, STATUS } from '@/lib/chart-tokens';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSortableRows, type SortColumn } from '@/lib/use-sortable';

export type ToplistRow = {
  label: string;
  value: number;
  sub?: string;
  status?: keyof typeof STATUS; // 'ok' | 'warn' | 'danger'
  /** Pre-formatted value text for this row; overrides valueFormatter (for
   *  lists that mix units, e.g. bytes and counts). Bars still use `value`. */
  display?: string;
};

// Sort on the RAW `label`/`value` fields — never the formatted `display` text.
const TOPLIST_SORT_COLUMNS: SortColumn<ToplistRow>[] = [
  { key: 'label', type: 'string', accessor: (r) => r.label },
  { key: 'value', type: 'number', accessor: (r) => r.value },
];

/** A compact, `<ul>`-friendly sort toggle for the Toplist header row (Phase 16)
 *  — `SortableHeader` is `<th>`-bound so doesn't fit here. `aria-pressed` +
 *  `aria-label` stand in for `aria-sort` outside a table. */
function ToplistSortButton({
  label,
  active,
  dir,
  onClick,
  testId,
  align = 'left',
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  testId: string;
  align?: 'left' | 'right';
}) {
  const { t } = useLanguage();
  const ariaLabel = active
    ? `${label} — ${t(dir === 'asc' ? 'common.sortAscending' : 'common.sortDescending')}`
    : label;
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink/50 hover:text-ink dark:text-white/50 dark:hover:text-white ${align === 'right' ? 'ml-auto' : ''}`}
    >
      {label}
      {active ? (
        dir === 'desc' ? (
          <ArrowDown size={12} strokeWidth={1.5} aria-hidden />
        ) : (
          <ArrowUp size={12} strokeWidth={1.5} aria-hidden />
        )
      ) : null}
    </button>
  );
}

export default function Toplist({
  rows,
  valueFormatter = String,
  onSelect,
  testId = 'toplist',
  sortable = false,
  labelHeader,
  valueHeader,
}: {
  rows: ToplistRow[];
  valueFormatter?: (v: number) => string;
  onSelect?: (label: string) => void;
  testId?: string;
  /** Opt-in click-to-sort header (Phase 16). Off by default: output is
   *  byte-identical to the pre-Phase-16 component. */
  sortable?: boolean;
  labelHeader?: string;
  valueHeader?: string;
}) {
  const { t } = useLanguage();

  // Always called (rules of hooks) but only rendered/used when `sortable` —
  // `key: null` preserves the caller's incoming (value-desc) order until the
  // user clicks a header, so behavior is unchanged before first interaction.
  const { sorted, sort, onSort } = useSortableRows(rows, TOPLIST_SORT_COLUMNS, {
    key: null,
    dir: 'desc',
  });

  if (rows.length === 0) {
    return (
      <p data-testid={testId} className="py-6 text-center text-xs text-ink/40 dark:text-white/40">
        {t('toplist.empty')}
      </p>
    );
  }

  // Bar-width max computed over ALL rows regardless of sort order — sorting
  // reorders rows but must never rescale bars.
  const max = Math.max(...rows.map((r) => r.value));
  const displayRows = sortable ? sorted : rows;

  const list = (
    <ul data-testid={sortable ? undefined : testId} className="flex flex-col gap-1.5">
      {displayRows.map((r, i) => {
        const pct = max > 0 ? Math.max(0, (r.value / max) * 100) : 0;
        const barColor = r.status ? STATUS[r.status] : SERIES_COLORS[0];
        const rowCls =
          'relative flex w-full items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 text-left text-xs text-ink dark:text-white';
        const content = (
          <>
            <span
              aria-hidden
              data-testid="toplist-bar"
              className="absolute inset-y-0 left-0 rounded-lg opacity-70 dark:opacity-40"
              style={{ width: `${pct}%`, backgroundColor: barColor }}
            />
            <span className="relative flex min-w-0 flex-1 items-baseline gap-1.5">
              {r.status ? (
                <>
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 self-center rounded-full"
                    style={{ backgroundColor: STATUS[r.status] }}
                  />
                  <span className="sr-only">{t(`toplist.status.${r.status}`)}</span>
                </>
              ) : null}
              <span className="truncate font-medium">{r.label}</span>
              {r.sub ? (
                <span className="truncate text-[11px] text-ink/40 dark:text-white/40">{r.sub}</span>
              ) : null}
            </span>
            <span className="relative shrink-0 font-semibold tabular-nums">{r.display ?? valueFormatter(r.value)}</span>
          </>
        );
        return (
          <li key={`${r.label}-${i}`}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(r.label)}
                className={`${rowCls} cursor-pointer hover:bg-black/5 dark:hover:bg-white/10`}
              >
                {content}
              </button>
            ) : (
              <div className={rowCls}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );

  if (!sortable) return list;

  return (
    <div data-testid={testId}>
      <div className="mb-1 flex items-center justify-between gap-2 px-2">
        <ToplistSortButton
          label={labelHeader ?? t('common.name')}
          active={sort.key === 'label'}
          dir={sort.dir}
          onClick={() => onSort('label')}
          testId="toplist-sort-label"
        />
        <ToplistSortButton
          label={valueHeader ?? t('common.value')}
          active={sort.key === 'value'}
          dir={sort.dir}
          onClick={() => onSort('value')}
          testId="toplist-sort-value"
          align="right"
        />
      </div>
      {list}
    </div>
  );
}
