import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { compareBy, useSortableRows, type SortColumn } from './use-sortable';

describe('compareBy', () => {
  describe('number', () => {
    const col: SortColumn<{ v: number | null | undefined }> = {
      key: 'v',
      type: 'number',
      accessor: (r) => r.v,
    };

    it('sorts ascending numerically, with null/undefined last', () => {
      const rows = [{ v: 3 }, { v: null }, { v: 1 }, { v: undefined }, { v: 2 }];
      const sorted = [...rows].sort(compareBy(col, 'asc'));
      expect(sorted.map((r) => r.v)).toEqual([1, 2, 3, null, undefined]);
    });

    it('sorts descending numerically, with null/undefined STILL last (not first)', () => {
      const rows = [{ v: 3 }, { v: null }, { v: 1 }, { v: undefined }, { v: 2 }];
      const sorted = [...rows].sort(compareBy(col, 'desc'));
      expect(sorted.map((r) => r.v)).toEqual([3, 2, 1, null, undefined]);
    });

    it('treats all-null columns as a no-op ordering (all equal, none crash)', () => {
      const rows = [{ v: null }, { v: undefined }, { v: null }];
      const sorted = [...rows].sort(compareBy(col, 'asc'));
      expect(sorted).toHaveLength(3);
    });
  });

  describe('string', () => {
    const col: SortColumn<{ v: string }> = { key: 'v', type: 'string', accessor: (r) => r.v };

    it('sorts ascending via localeCompare', () => {
      const rows = [{ v: 'banana' }, { v: 'apple' }, { v: 'cherry' }];
      const sorted = [...rows].sort(compareBy(col, 'asc'));
      expect(sorted.map((r) => r.v)).toEqual(['apple', 'banana', 'cherry']);
    });

    it('sorts descending via localeCompare', () => {
      const rows = [{ v: 'banana' }, { v: 'apple' }, { v: 'cherry' }];
      const sorted = [...rows].sort(compareBy(col, 'desc'));
      expect(sorted.map((r) => r.v)).toEqual(['cherry', 'banana', 'apple']);
    });

    it('is case-insensitive (sensitivity: base)', () => {
      const rows = [{ v: 'Banana' }, { v: 'apple' }, { v: 'Cherry' }];
      const sorted = [...rows].sort(compareBy(col, 'asc'));
      expect(sorted.map((r) => r.v)).toEqual(['apple', 'Banana', 'Cherry']);
    });
  });

  describe('boolean', () => {
    const col: SortColumn<{ v: boolean }> = { key: 'v', type: 'boolean', accessor: (r) => r.v };

    it('sorts ascending with false before true', () => {
      const rows = [{ v: true }, { v: false }];
      const sorted = [...rows].sort(compareBy(col, 'asc'));
      expect(sorted.map((r) => r.v)).toEqual([false, true]);
    });

    it('sorts descending with true before false', () => {
      const rows = [{ v: true }, { v: false }];
      const sorted = [...rows].sort(compareBy(col, 'desc'));
      expect(sorted.map((r) => r.v)).toEqual([true, false]);
    });
  });
});

describe('useSortableRows', () => {
  type Row = { id: string; n: number };
  const columns: SortColumn<Row>[] = [
    { key: 'id', type: 'string', accessor: (r) => r.id },
    { key: 'n', type: 'number', accessor: (r) => r.n },
  ];
  const rows: Row[] = [
    { id: 'b', n: 2 },
    { id: 'a', n: 3 },
    { id: 'c', n: 1 },
  ];

  it('with sort.key === null, returns rows as-is (passthrough)', () => {
    const { result } = renderHook(() => useSortableRows(rows, columns));
    expect(result.current.sort.key).toBeNull();
    expect(result.current.sorted).toBe(rows);
  });

  it('onSort with a new key sets that key and defaults dir to desc', () => {
    const { result } = renderHook(() => useSortableRows(rows, columns));
    act(() => result.current.onSort('n'));
    expect(result.current.sort).toEqual({ key: 'n', dir: 'desc' });
    expect(result.current.sorted.map((r) => r.n)).toEqual([3, 2, 1]);
  });

  it('onSort with the same key toggles direction', () => {
    const { result } = renderHook(() => useSortableRows(rows, columns));
    act(() => result.current.onSort('n')); // -> desc
    act(() => result.current.onSort('n')); // -> asc
    expect(result.current.sort).toEqual({ key: 'n', dir: 'asc' });
    expect(result.current.sorted.map((r) => r.n)).toEqual([1, 2, 3]);
  });

  it('switching to a different key resets dir to desc', () => {
    const { result } = renderHook(() => useSortableRows(rows, columns));
    act(() => result.current.onSort('n')); // n desc
    act(() => result.current.onSort('id')); // id desc (new key)
    expect(result.current.sort).toEqual({ key: 'id', dir: 'desc' });
    expect(result.current.sorted.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('respects an explicit initial sort state', () => {
    const { result } = renderHook(() => useSortableRows(rows, columns, { key: 'n', dir: 'asc' }));
    expect(result.current.sort).toEqual({ key: 'n', dir: 'asc' });
    expect(result.current.sorted.map((r) => r.n)).toEqual([1, 2, 3]);
  });

  it('does not mutate the input rows array', () => {
    const original = [...rows];
    const { result } = renderHook(() => useSortableRows(rows, columns));
    act(() => result.current.onSort('n'));
    expect(rows).toEqual(original);
  });

  it('produces a new array reference when sorted (never the same array as rows)', () => {
    const { result } = renderHook(() => useSortableRows(rows, columns));
    act(() => result.current.onSort('n'));
    expect(result.current.sorted).not.toBe(rows);
  });

  it('is a stable sort — equal-key rows retain relative order', () => {
    type R2 = { id: string; group: string };
    const r2: R2[] = [
      { id: '1', group: 'x' },
      { id: '2', group: 'x' },
      { id: '3', group: 'y' },
      { id: '4', group: 'x' },
    ];
    const cols2: SortColumn<R2>[] = [{ key: 'group', type: 'string', accessor: (r) => r.group }];
    const { result } = renderHook(() => useSortableRows(r2, cols2, { key: 'group', dir: 'asc' }));
    expect(result.current.sorted.map((r) => r.id)).toEqual(['1', '2', '4', '3']);
  });

  it('ignores onSort for an unknown key (no matching column) without crashing', () => {
    const { result } = renderHook(() => useSortableRows(rows, columns));
    act(() => result.current.onSort('nope'));
    expect(result.current.sort).toEqual({ key: 'nope', dir: 'desc' });
    // No matching column -> falls back to passthrough rows rather than throwing.
    expect(result.current.sorted).toEqual(rows);
  });
});
