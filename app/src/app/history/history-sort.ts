// Pure column-type sniffing + coercion sort for the History page's dynamic
// Athena results table ({ columns: string[]; rows: string[][] }). Unlike the
// 6 typed tables (app/src/lib/use-sortable.ts's SortColumn<T>), the DB column
// names AND types are unknown ahead of time — so instead of a declared
// `type`, we SNIFF it from the actual cell values the first time a column is
// sorted. No React/DOM here — kept import-free so it's cheap to unit test.
import type { SortState } from '@/lib/use-sortable';

export type ColumnType = 'number' | 'string';

/** Sniffs a column's type from its cells: 'number' iff every NON-EMPTY cell
 *  parses as a finite number (`Number(cell)`, so "Infinity"/"NaN" do NOT
 *  count as numeric); empty/blank cells are ignored. A column with no
 *  non-empty cells (all-empty, or no rows) has nothing numeric to confirm,
 *  so it defaults to 'string'. */
export function sniffColumnType(cells: string[]): ColumnType {
  let sawNumeric = false;
  for (const cell of cells) {
    if (cell.trim() === '') continue;
    if (!Number.isFinite(Number(cell))) return 'string';
    sawNumeric = true;
  }
  return sawNumeric ? 'number' : 'string';
}

/** Sorts `rows` (a NEW array — never mutates the input) by column `colIndex`,
 *  sniffing that column's type across ALL rows first. Empty/blank cells
 *  always sort LAST, in both directions (mirrors `compareBy`'s null-last
 *  convention in use-sortable.ts). */
export function sortRowsByColumn(rows: string[][], colIndex: number, dir: 'asc' | 'desc'): string[][] {
  const type = sniffColumnType(rows.map((r) => r[colIndex] ?? ''));
  const sign = dir === 'desc' ? -1 : 1;

  return [...rows].sort((a, b) => {
    const av = a[colIndex] ?? '';
    const bv = b[colIndex] ?? '';
    const aEmpty = av.trim() === '';
    const bEmpty = bv.trim() === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;

    const base = type === 'number' ? Number(av) - Number(bv) : av.localeCompare(bv, undefined, { sensitivity: 'base' });
    return base * sign;
  });
}

/** Same same-key-toggles / new-key-defaults-to-desc semantics as
 *  `useSortableRows`'s internal `onSort` (app/src/lib/use-sortable.ts) — kept
 *  as a small local helper here since History's columns are index-keyed
 *  (`String(i)`) rather than the typed-table `SortColumn.key`. */
export function toggleColumnSort(prev: SortState, key: string): SortState {
  return prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' };
}
