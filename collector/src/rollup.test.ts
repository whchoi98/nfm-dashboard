import { describe, it, expect } from 'vitest';
import { hourBucketOf, fiveMinBucketsOfHour, eligibleMissingHours } from './rollup.js';

describe('hourBucketOf', () => {
  it('floors to the hour in collector ISO format (no ms)', () => {
    expect(hourBucketOf(Date.parse('2026-07-15T03:47:33.123Z'))).toBe('2026-07-15T03:00:00Z');
    expect(hourBucketOf(Date.parse('2026-07-15T03:00:00.000Z'))).toBe('2026-07-15T03:00:00Z');
  });
});

describe('fiveMinBucketsOfHour', () => {
  it('returns the 12 five-minute grid keys of the hour, ascending', () => {
    const b = fiveMinBucketsOfHour('2026-07-15T03:00:00Z');
    expect(b).toHaveLength(12);
    expect(b[0]).toBe('2026-07-15T03:00:00Z');
    expect(b[1]).toBe('2026-07-15T03:05:00Z');
    expect(b[11]).toBe('2026-07-15T03:55:00Z');
  });
});

describe('eligibleMissingHours', () => {
  // At 04:03, hour 03 closed at 04:00 but 04:00+5min > now → NOT yet eligible;
  // hour 02 (closed 03:00, +5min = 03:05 <= now) IS.
  it('requires hourEnd + 5min <= now', () => {
    const now = Date.parse('2026-07-15T04:03:00Z');
    const hours = eligibleMissingHours(now, new Set());
    expect(hours[0]).toBe('2026-07-15T02:00:00Z');
    expect(hours).not.toContain('2026-07-15T03:00:00Z');
  });

  it('is newest-first, skips done hours, and caps at maxPerCycle', () => {
    const now = Date.parse('2026-07-15T04:10:00Z'); // hour 03 now eligible
    const done = new Set(['2026-07-15T02:00:00Z']);
    const hours = eligibleMissingHours(now, done, 168, 3);
    expect(hours).toEqual(['2026-07-15T03:00:00Z', '2026-07-15T01:00:00Z', '2026-07-15T00:00:00Z']);
  });

  it('looks back at most lookbackHours', () => {
    const now = Date.parse('2026-07-15T04:10:00Z');
    const hours = eligibleMissingHours(now, new Set(), 2, 10);
    expect(hours).toEqual(['2026-07-15T03:00:00Z', '2026-07-15T02:00:00Z']);
  });
});
