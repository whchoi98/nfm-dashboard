'use client';

// Shared client-side sort primitive for click-to-sort data tables (Phase 15).
// Type-aware comparator (string/number/boolean) + a small hook that sorts a
// caller's rows into a NEW array without mutating the input. Always sort the
// RAW accessor value (e.g. `f.value`), never a formatted display string.
import { useMemo, useState } from 'react';

export type SortType = 'string' | 'number' | 'boolean';

export interface SortColumn<T> {
  key: string;
  type: SortType;
  accessor: (row: T) => string | number | boolean | null | undefined;
}

export interface SortState {
  key: string | null;
  dir: 'asc' | 'desc';
}

function isNullish(v: unknown): v is null | undefined {
  return v === null || v === undefined;
}

/** Pure comparator for a single column + direction. Null/undefined accessor
 *  values always sort LAST, regardless of `dir` — only the comparison of the
 *  two non-null values gets negated for `desc`. */
export function compareBy<T>(col: SortColumn<T>, dir: 'asc' | 'desc'): (a: T, b: T) => number {
  return (a: T, b: T) => {
    const av = col.accessor(a);
    const bv = col.accessor(b);
    const an = isNullish(av);
    const bn = isNullish(bv);
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;

    let base: number;
    switch (col.type) {
      case 'number':
        base = (av as number) - (bv as number);
        break;
      case 'boolean':
        base = Number(av as boolean) - Number(bv as boolean);
        break;
      case 'string':
      default:
        base = (av as string).localeCompare(bv as string, undefined, { sensitivity: 'base' });
        break;
    }
    return dir === 'desc' ? -base : base;
  };
}

const DEFAULT_INITIAL: SortState = { key: null, dir: 'desc' };

/** Sorts `rows` by the active column in `columns` (matched via `sort.key`).
 *  Returns a NEW array (stable sort; `rows` is never mutated); when
 *  `sort.key` is null (or matches no column), returns `rows` as-is. */
export function useSortableRows<T>(
  rows: T[],
  columns: SortColumn<T>[],
  initial: SortState = DEFAULT_INITIAL,
): { sorted: T[]; sort: SortState; onSort: (key: string) => void } {
  const [sort, setSort] = useState<SortState>(initial);

  const sorted = useMemo(() => {
    if (sort.key === null) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    return [...rows].sort(compareBy(col, sort.dir));
  }, [rows, columns, sort]);

  const onSort = (key: string) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  return { sorted, sort, onSort };
}
