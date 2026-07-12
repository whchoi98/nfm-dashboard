import { describe, it, expect } from 'vitest';
import { sniffColumnType, sortRowsByColumn } from './history-sort';

describe('sniffColumnType', () => {
  it('returns "number" when every non-empty cell parses as a finite number', () => {
    expect(sniffColumnType(['1', '2', '3.5', '-4'])).toBe('number');
  });

  it('returns "string" when any non-empty cell is non-numeric', () => {
    expect(sniffColumnType(['1', '2', 'abc', '4'])).toBe('string');
  });

  it('ignores empty/blank cells when sniffing (numeric column with holes stays numeric)', () => {
    expect(sniffColumnType(['1', '', '3', '  ', '5'])).toBe('number');
  });

  it('treats an all-empty (or all-blank) column as "string"', () => {
    expect(sniffColumnType(['', '', ''])).toBe('string');
    expect(sniffColumnType([])).toBe('string');
  });

  it('rejects non-finite numeric strings like "Infinity" or "NaN" as non-numeric', () => {
    expect(sniffColumnType(['1', 'Infinity', '3'])).toBe('string');
    expect(sniffColumnType(['1', 'NaN', '3'])).toBe('string');
  });

  it('accepts whitespace-padded numbers', () => {
    expect(sniffColumnType([' 1 ', '2', ' 3'])).toBe('number');
  });
});

describe('sortRowsByColumn', () => {
  it('sorts a numeric column NUMERICALLY, not lexically (2 before 10)', () => {
    const rows = [['10'], ['2'], ['1']];
    const sorted = sortRowsByColumn(rows, 0, 'asc');
    expect(sorted.map((r) => r[0])).toEqual(['1', '2', '10']);
  });

  it('sorts a numeric column descending', () => {
    const rows = [['10'], ['2'], ['1']];
    const sorted = sortRowsByColumn(rows, 0, 'desc');
    expect(sorted.map((r) => r[0])).toEqual(['10', '2', '1']);
  });

  it('sorts a string column via localeCompare, case-insensitively, ascending', () => {
    const rows = [['banana'], ['Apple'], ['cherry']];
    const sorted = sortRowsByColumn(rows, 0, 'asc');
    expect(sorted.map((r) => r[0])).toEqual(['Apple', 'banana', 'cherry']);
  });

  it('sorts a string column descending', () => {
    const rows = [['banana'], ['apple'], ['cherry']];
    const sorted = sortRowsByColumn(rows, 0, 'desc');
    expect(sorted.map((r) => r[0])).toEqual(['cherry', 'banana', 'apple']);
  });

  it('sorts empty cells LAST regardless of direction (numeric column)', () => {
    const rows = [['3'], [''], ['1'], ['2']];
    const asc = sortRowsByColumn(rows, 0, 'asc');
    expect(asc.map((r) => r[0])).toEqual(['1', '2', '3', '']);
    const desc = sortRowsByColumn(rows, 0, 'desc');
    expect(desc.map((r) => r[0])).toEqual(['3', '2', '1', '']);
  });

  it('sorts empty cells LAST regardless of direction (string column)', () => {
    const rows = [['banana'], [''], ['apple']];
    const asc = sortRowsByColumn(rows, 0, 'asc');
    expect(asc.map((r) => r[0])).toEqual(['apple', 'banana', '']);
    const desc = sortRowsByColumn(rows, 0, 'desc');
    expect(desc.map((r) => r[0])).toEqual(['banana', 'apple', '']);
  });

  it('sorts by the given column index, independent of other columns', () => {
    const rows = [
      ['b', '2'],
      ['a', '10'],
      ['c', '1'],
    ];
    const sortedByCol1 = sortRowsByColumn(rows, 1, 'asc');
    expect(sortedByCol1.map((r) => r[1])).toEqual(['1', '2', '10']);
  });

  it('does NOT mutate the input rows array', () => {
    const rows = [['3'], ['1'], ['2']];
    const original = rows.map((r) => [...r]);
    sortRowsByColumn(rows, 0, 'asc');
    expect(rows).toEqual(original);
  });
});
