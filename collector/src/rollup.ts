// Hourly rollup pure helpers. Hour keys share the collector ISO format
// (no ms) so HFLOW keys line up with the 5-min FLOW grid.
export const HOUR_MS = 3_600_000;
const FIVE_MIN_MS = 300_000;
// One full cycle past hour close, so the hour's last 5-min bucket has landed.
const CLOSE_GRACE_MS = 5 * 60_000;

const iso = (t: number) => new Date(t).toISOString().replace(/\.\d+Z/, 'Z');

export function hourBucketOf(t: number): string {
  return iso(Math.floor(t / HOUR_MS) * HOUR_MS);
}

export function fiveMinBucketsOfHour(hourBucket: string): string[] {
  const start = Date.parse(hourBucket);
  return Array.from({ length: 12 }, (_, i) => iso(start + i * FIVE_MIN_MS));
}

export function eligibleMissingHours(
  nowMs: number, done: Set<string>, lookbackHours = 168, maxPerCycle = 6,
): string[] {
  const newestEligibleStart = Math.floor((nowMs - CLOSE_GRACE_MS) / HOUR_MS) * HOUR_MS - HOUR_MS;
  const out: string[] = [];
  for (let i = 0; i < lookbackHours && out.length < maxPerCycle; i++) {
    const key = iso(newestEligibleStart - i * HOUR_MS);
    if (!done.has(key)) out.push(key);
  }
  return out;
}
