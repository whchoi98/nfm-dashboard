import { describe, it, expect } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('emits a header row + one line per row, columns derived from the first row', () => {
    const csv = toCsv([
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ]);
    expect(csv).toBe('a,b\r\n1,x\r\n2,y');
  });

  it('honors explicit column selection, ordering and headers', () => {
    const rows = [{ a: 1, b: 'x', c: 'skip' }];
    const csv = toCsv(rows, [
      { key: 'b', header: 'B col' },
      { key: 'a', header: 'A col' },
    ]);
    expect(csv).toBe('B col,A col\r\nx,1');
  });

  it('quotes values containing commas and doubles embedded quotes', () => {
    const csv = toCsv([{ a: 'x,y', b: 'say "hi"' }]);
    expect(csv).toBe('a,b\r\n"x,y","say ""hi"""');
  });

  it('quotes values containing newlines (LF and CRLF)', () => {
    const csv = toCsv([{ a: 'line1\nline2', b: 'p\r\nq' }]);
    expect(csv).toBe('a,b\r\n"line1\nline2","p\r\nq"');
  });

  it('quotes headers that need escaping', () => {
    const csv = toCsv([{ k: 1 }], [{ key: 'k', header: 'name, "quoted"' }]);
    expect(csv).toBe('"name, ""quoted"""\r\n1');
  });

  it('renders null/undefined/missing cells as empty and numbers as-is', () => {
    const csv = toCsv(
      [
        { a: null, b: undefined, c: 0 },
        { c: 1.5 },
      ],
      [
        { key: 'a', header: 'a' },
        { key: 'b', header: 'b' },
        { key: 'c', header: 'c' },
      ],
    );
    expect(csv).toBe('a,b,c\r\n,,0\r\n,,1.5');
  });

  it('empty rows with columns → header-only; without columns → empty string', () => {
    expect(toCsv([], [{ key: 'a', header: 'a' }])).toBe('a');
    expect(toCsv([])).toBe('');
  });
});
