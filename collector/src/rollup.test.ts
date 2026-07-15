import { describe, it, expect } from 'vitest';
import { hourBucketOf, fiveMinBucketsOfHour, eligibleMissingHours, mergeHourEdges } from './rollup.js';
import type { FlowEdge } from './types.js';

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

const mk = (over: Partial<FlowEdge>): FlowEdge => ({
  edgeHash: 'e1', monitor: 'm1', metric: 'DATA_TRANSFERRED', category: 'INTER_AZ',
  bucket: '2026-07-15T03:00:00Z', value: 10, unit: 'Bytes',
  a: { podName: 'api-1', podNamespace: 'shop' }, b: { podName: 'db-0', podNamespace: 'shop' },
  traversedConstructs: [], ...over });

describe('mergeHourEdges', () => {
  const HOUR = '2026-07-15T03:00:00Z';

  it('sums counter values per (monitor, metric, category, edgeHash) and stamps the hour bucket', () => {
    const out = mergeHourEdges([
      mk({ bucket: '2026-07-15T03:00:00Z', value: 10 }),
      mk({ bucket: '2026-07-15T03:05:00Z', value: 32 }),
      mk({ bucket: '2026-07-15T03:05:00Z', value: 5, edgeHash: 'e2' }),
    ], HOUR);
    const e1 = out.find(e => e.edgeHash === 'e1')!;
    expect(e1.value).toBe(42);
    expect(e1.bucket).toBe(HOUR);
    expect(out.find(e => e.edgeHash === 'e2')!.value).toBe(5);
  });

  it('averages ROUND_TRIP_TIME over present buckets only', () => {
    const out = mergeHourEdges([
      mk({ metric: 'ROUND_TRIP_TIME', bucket: '2026-07-15T03:00:00Z', value: 10, unit: 'Milliseconds' }),
      mk({ metric: 'ROUND_TRIP_TIME', bucket: '2026-07-15T03:10:00Z', value: 30, unit: 'Milliseconds' }),
    ], HOUR);
    expect(out[0].value).toBe(20); // mean of 2 present buckets, NOT /12
  });

  it('carries endpoint info from the LATEST bucket of the edge', () => {
    const out = mergeHourEdges([
      mk({ bucket: '2026-07-15T03:00:00Z', a: { podName: 'api-1', podNamespace: 'shop', az: 'old' } }),
      mk({ bucket: '2026-07-15T03:55:00Z', a: { podName: 'api-1', podNamespace: 'shop', az: 'new' } }),
    ], HOUR);
    expect(out[0].a.az).toBe('new');
  });

  it('caps each (monitor, metric, category) group at capPerGroup by value', () => {
    const raw = Array.from({ length: 10 }, (_, i) => mk({ edgeHash: `e${i}`, value: i }));
    const out = mergeHourEdges(raw, HOUR, 3);
    expect(out).toHaveLength(3);
    expect(out.map(e => e.edgeHash).sort()).toEqual(['e7', 'e8', 'e9']);
  });
});
