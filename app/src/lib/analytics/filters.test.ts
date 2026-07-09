// Pure analytics filter primitives (Phase 4 Task 1): rangeToBuckets,
// DEFAULT_FILTERS shape, and parseFilters coercion of unknown records.
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, parseFilters, rangeToBuckets } from './filters';

describe('rangeToBuckets', () => {
  it('maps 15m to 3 buckets', () => {
    expect(rangeToBuckets('15m')).toBe(3);
  });
  it('maps 1h to 12 buckets', () => {
    expect(rangeToBuckets('1h')).toBe(12);
  });
  it('maps 3h to 36 buckets', () => {
    expect(rangeToBuckets('3h')).toBe(36);
  });
  it('maps 24h to 288 buckets', () => {
    expect(rangeToBuckets('24h')).toBe(288);
  });
});

describe('DEFAULT_FILTERS', () => {
  it('has the documented default shape', () => {
    expect(DEFAULT_FILTERS).toEqual({
      range: '1h',
      cluster: 'all',
      namespace: 'all',
      category: 'all',
      metric: 'DATA_TRANSFERRED',
    });
  });
});

describe('parseFilters', () => {
  it('returns defaults for empty or non-object input', () => {
    expect(parseFilters({})).toEqual(DEFAULT_FILTERS);
    expect(parseFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(parseFilters(undefined)).toEqual(DEFAULT_FILTERS);
    expect(parseFilters('nope')).toEqual(DEFAULT_FILTERS);
  });

  it('keeps valid values', () => {
    expect(
      parseFilters({
        range: '24h',
        cluster: 'eks-a',
        namespace: 'default',
        category: 'INTER_AZ',
        metric: 'TIMEOUTS',
      }),
    ).toEqual({
      range: '24h',
      cluster: 'eks-a',
      namespace: 'default',
      category: 'INTER_AZ',
      metric: 'TIMEOUTS',
    });
  });

  it('falls back per-field on invalid or missing values', () => {
    expect(
      parseFilters({ range: '2d', cluster: 5, namespace: '', metric: 'BOGUS' }),
    ).toEqual(DEFAULT_FILTERS);
    expect(parseFilters({ range: '3h' })).toEqual({ ...DEFAULT_FILTERS, range: '3h' });
  });
});
