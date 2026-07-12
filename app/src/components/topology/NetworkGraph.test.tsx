// Position-cache eviction tests (Phase 14 Task 5 robustness) — the cache
// backing layout pinning + localStorage persistence must stay bounded by the
// LIVE node-id working set. Before eviction it grew one-way with pod churn:
// once cumulative ever-seen ids crossed MAX_PERSISTED_NODES, persistPositions
// latched off permanently (its size guard never released), so manual drags
// silently stopped surviving reload on long-lived NOC screens.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_PERSISTED_NODES,
  evictStalePositions,
  loadStoredPositions,
  persistPositions,
} from './NetworkGraph';

const POSITIONS_STORAGE_KEY = 'nfm-topology-positions';

const p = (x: number, y: number) => ({ x, y });

beforeEach(() => {
  window.localStorage.clear();
});

describe('evictStalePositions', () => {
  it('drops ids absent from the live set and keeps live ones intact', () => {
    const cache = new Map([
      ['pod:shop/api-1', p(10, 20)],
      ['pod:shop/gone-0', p(30, 40)],
      ['az:ap-northeast-2a', p(50, 60)], // synthetic group node stays while live
    ]);
    evictStalePositions(cache, new Set(['pod:shop/api-1', 'az:ap-northeast-2a']));
    expect([...cache.keys()].sort()).toEqual(['az:ap-northeast-2a', 'pod:shop/api-1']);
    expect(cache.get('pod:shop/api-1')).toEqual(p(10, 20)); // a persisting id keeps its position
  });

  it('empty live set clears the cache (empty topology carries no positions forward)', () => {
    const cache = new Map([['pod:a', p(1, 2)]]);
    evictStalePositions(cache, new Set());
    expect(cache.size).toBe(0);
  });
});

describe('persistPositions + loadStoredPositions round-trip with eviction', () => {
  it('a stale id disappears from storage after evict + re-persist; a live id survives reload', () => {
    persistPositions(new Map([['pod:keep', p(1, 2)], ['pod:stale', p(3, 4)]]));
    const cache = loadStoredPositions(); // reload restore path
    expect(cache.size).toBe(2);
    evictStalePositions(cache, new Set(['pod:keep'])); // node set changed
    persistPositions(cache);
    const reloaded = loadStoredPositions();
    expect([...reloaded.keys()]).toEqual(['pod:keep']);
    expect(reloaded.get('pod:keep')).toEqual(p(1, 2));
  });

  it('persistence RESUMES once eviction brings the cache back under MAX_PERSISTED_NODES', () => {
    const cache = new Map<string, { x: number; y: number }>(
      Array.from({ length: MAX_PERSISTED_NODES + 1 }, (_, i): [string, { x: number; y: number }] => [
        `pod:churn-${i}`,
        p(i, i),
      ]),
    );
    persistPositions(cache); // over the cap — write is skipped
    expect(window.localStorage.getItem(POSITIONS_STORAGE_KEY)).toBeNull();

    // Working set shrinks back to 2 live nodes → eviction unlatches the cap.
    evictStalePositions(cache, new Set(['pod:churn-1', 'pod:churn-2']));
    persistPositions(cache);
    expect([...loadStoredPositions().keys()].sort()).toEqual(['pod:churn-1', 'pod:churn-2']);
  });
});
