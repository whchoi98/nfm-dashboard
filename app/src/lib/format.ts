// Number formatting helpers shared by all dashboard pages.
// formatBytes uses decimal (SI) units: 1 KB = 1000 B (network transfer convention).

/** 1 significant decimal, trailing ".0" dropped: 1.53 → "1.5", 2.04 → "2". */
function trim1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const neg = n < 0 ? '-' : '';
  let v = Math.abs(n);
  let i = 0;
  while (v >= 1000 && i < BYTE_UNITS.length - 1) {
    v /= 1000;
    i++;
  }
  return `${neg}${i === 0 ? Math.round(v) : trim1(v)} ${BYTE_UNITS[i]}`;
}

/** Compact counts: 999 → "999", 12345 → "12.3K", 1234567 → "1.2M". */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const neg = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v < 1000) return `${neg}${Math.round(v).toLocaleString('en-US')}`;
  if (v < 1_000_000) return `${neg}${trim1(v / 1000)}K`;
  if (v < 1_000_000_000) return `${neg}${trim1(v / 1_000_000)}M`;
  return `${neg}${trim1(v / 1_000_000_000)}B`;
}

/** Format a value using the unit implied by its NFM metric name. */
export function formatMetricValue(
  metric: 'DATA_TRANSFERRED' | 'RETRANSMISSIONS' | 'TIMEOUTS' | 'ROUND_TRIP_TIME',
  v: number,
): string {
  if (metric === 'DATA_TRANSFERRED') return formatBytes(v);
  if (metric === 'ROUND_TRIP_TIME') return formatMicros(v);
  return formatCount(v);
}

/** Microseconds → human latency: 900 → "900 µs", 1500 → "1.5 ms", 1500000 → "1.5 s". */
export function formatMicros(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const neg = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v < 1000) return `${neg}${Math.round(v)} µs`;
  if (v < 1_000_000) return `${neg}${trim1(v / 1000)} ms`;
  return `${neg}${trim1(v / 1_000_000)} s`;
}
