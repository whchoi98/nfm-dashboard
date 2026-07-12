// Pure analytics filter primitives (Phase 4 Task 1): rangeToBuckets,
// DEFAULT_FILTERS shape, and parseFilters coercion of unknown records.
// Task 4a adds applyFlowFilters (route-side flows filtering) and lensQuery.
import { describe, expect, it } from 'vitest';
import type { FlowEdge } from '../types';
import {
  applyFlowFilters,
  DEFAULT_FILTERS,
  lensQuery,
  parseBuckets,
  parseFilters,
  parseLensParams,
  rangeToBuckets,
  TIME_RANGES,
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
  it('maps 7d to 2016 buckets', () => {
    expect(rangeToBuckets('7d')).toBe(2016);
  });
});

describe('TIME_RANGES', () => {
  it('includes 7d and has length 5', () => {
    expect(TIME_RANGES).toContain('7d');
    expect(TIME_RANGES).toHaveLength(5);
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

describe('parseBuckets', () => {
  const req = (qs: string) => new Request(`http://localhost/api/analytics/cost${qs}`);

  it('defaults to 12 for missing, non-numeric or sub-1 values', () => {
    expect(parseBuckets(req(''))).toBe(12); // no param
    expect(parseBuckets(req('?buckets=abc'))).toBe(12);
    expect(parseBuckets(req('?buckets=0'))).toBe(12);
    // 0 < raw < 1 must NOT pass the guard and floor to 0 (empty window).
    expect(parseBuckets(req('?buckets=0.5'))).toBe(12);
    expect(parseBuckets(req('?buckets=-3'))).toBe(12);
  });

  it('floors and clamps valid values into [1, 2016]', () => {
    expect(parseBuckets(req('?buckets=5'))).toBe(5);
    expect(parseBuckets(req('?buckets=5.9'))).toBe(5);
    expect(parseBuckets(req('?buckets=1'))).toBe(1);
    expect(parseBuckets(req('?buckets=9999'))).toBe(2016);
  });
});

describe('parseLensParams', () => {
  it('parses buckets + namespace/category in one pass', () => {
    const req = new Request(
      'http://localhost/api/analytics/cost?buckets=36&namespace=shop&category=INTER_AZ',
    );
    expect(parseLensParams(req)).toEqual({ buckets: 36, namespace: 'shop', category: 'INTER_AZ' });
  });

  it('yields defaults/nulls when params are absent', () => {
    const req = new Request('http://localhost/api/analytics/cost');
    expect(parseLensParams(req)).toEqual({ buckets: 12, namespace: null, category: null });
  });

  it('clamps an over-range buckets value (7d+) down to 2016', () => {
    const req = new Request('http://localhost/api/analytics/cost?buckets=5000');
    expect(parseLensParams(req).buckets).toBe(2016);
  });

  it('accepts exactly 2016 (the 7d ceiling) unchanged', () => {
    const req = new Request('http://localhost/api/analytics/cost?buckets=2016');
    expect(parseLensParams(req).buckets).toBe(2016);
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
