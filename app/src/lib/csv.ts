// CSV assembly + browser download helper (Phase 8 Task 6).
// toCsv is PURE (no I/O, no Date) — RFC-4180-ish: CRLF line breaks, values
// quoted only when they contain a comma/quote/CR/LF, quotes doubled.

export interface CsvColumn {
  key: string;
  header: string;
}

/** Quote `s` per RFC 4180 when it contains a comma, quote or newline. */
function escapeCell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** null/undefined → empty cell; everything else via String() (numbers as-is). */
function cellOf(v: unknown): string {
  return v == null ? '' : escapeCell(String(v));
}

/**
 * Rows → CSV text (no trailing newline). When `columns` is omitted they are
 * derived from the first row's keys (header = key); with no rows AND no
 * columns there is nothing to describe → ''.
 */
export function toCsv(rows: Record<string, unknown>[], columns?: CsvColumn[]): string {
  const cols = columns ?? (rows.length ? Object.keys(rows[0]).map((k) => ({ key: k, header: k })) : []);
  if (cols.length === 0) return '';
  const lines = [cols.map((c) => escapeCell(c.header)).join(',')];
  for (const row of rows) lines.push(cols.map((c) => cellOf(row[c.key])).join(','));
  return lines.join('\r\n');
}

/**
 * Browser-only Blob download via a temporary `<a download>`. No-op outside
 * the DOM (SSR/jsdom-safety); kept here so every export button shares it.
 */
export function downloadText(filename: string, text: string, mime = 'text/csv'): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
