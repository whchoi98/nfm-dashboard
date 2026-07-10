// Pure analytics filter primitives (Phase 4 Task 1): rangeToBuckets,
// DEFAULT_FILTERS shape, and parseFilters coercion of unknown records.
// Task 4a adds applyFlowFilters (route-side flows filtering) and lensQuery.
import { describe, expect, it } from 'vitest';
import type { FlowEdge } from '../types';
import {
  applyFlowFilters,
  DEFAULT_FILTERS,
  lensQuery,
  parseFilters,
  rangeToBuckets,
} from './filters';

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

function flow(over: Partial<FlowEdge>): FlowEdge {
  return {
    edgeHash: 'h',
    monitor: 'm',
    metric: 'DATA_TRANSFERRED',
    category: 'INTRA_AZ',
    bucket: '2026-07-10T00:00:00Z',
    value: 1,
    unit: 'Bytes',
    a: {},
    b: {},
    traversedConstructs: [],
    ...over,
  };
}

describe('applyFlowFilters', () => {
  const flows = [
    flow({ edgeHash: '1', category: 'INTER_AZ', a: { podNamespace: 'default' }, b: { podNamespace: 'kube-system' } }),
    flow({ edgeHash: '2', category: 'INTRA_AZ', a: { podNamespace: 'shop' }, b: {} }),
    flow({ edgeHash: '3', category: 'INTER_AZ', a: {}, b: { podNamespace: 'shop' } }),
  ];

  it('is a no-op for missing or "all" values', () => {
    expect(applyFlowFilters(flows, {})).toEqual(flows);
    expect(applyFlowFilters(flows, { namespace: 'all', category: 'all' })).toEqual(flows);
    expect(applyFlowFilters(flows, { namespace: null, category: null })).toEqual(flows);
  });

  it('filters by category', () => {
    expect(applyFlowFilters(flows, { category: 'INTER_AZ' }).map((f) => f.edgeHash)).toEqual(['1', '3']);
  });

  it('filters by namespace matching either endpoint', () => {
    expect(applyFlowFilters(flows, { namespace: 'shop' }).map((f) => f.edgeHash)).toEqual(['2', '3']);
    expect(applyFlowFilters(flows, { namespace: 'kube-system' }).map((f) => f.edgeHash)).toEqual(['1']);
  });

  it('combines category and namespace', () => {
    expect(
      applyFlowFilters(flows, { category: 'INTER_AZ', namespace: 'shop' }).map((f) => f.edgeHash),
    ).toEqual(['3']);
  });
});

describe('lensQuery', () => {
  it('emits buckets only when namespace/category are "all"', () => {
    expect(lensQuery(DEFAULT_FILTERS)).toBe('?buckets=12');
  });

  it('appends encoded namespace and category when set', () => {
    expect(
      lensQuery({ ...DEFAULT_FILTERS, range: '24h', namespace: 'kube system', category: 'INTER_AZ' }),
    ).toBe('?buckets=288&namespace=kube%20system&category=INTER_AZ');
  });
});
