// app/src/lib/recent-paths.test.ts
import { describe, it, expect } from 'vitest';
import { MAX_RECENT_PATHS, parseRecent, pushRecent, type RecentPath } from './recent-paths';

const entry = (edgeId: string, ts = 0): RecentPath => ({ edgeId, label: `L-${edgeId}`, ts });

describe('pushRecent', () => {
  it('prepends new entries (newest-first)', () => {
    const out = pushRecent([entry('a', 1)], entry('b', 2));
    expect(out.map((r) => r.edgeId)).toEqual(['b', 'a']);
  });

  it('dedupes by edgeId, keeping the newest entry', () => {
    const out = pushRecent([entry('a', 1), entry('b', 2)], entry('b', 3));
    expect(out.map((r) => r.edgeId)).toEqual(['b', 'a']);
    expect(out[0].ts).toBe(3);
  });

  it(`caps the list at ${MAX_RECENT_PATHS}`, () => {
    let list: RecentPath[] = [];
    for (let i = 0; i < MAX_RECENT_PATHS + 3; i++) list = pushRecent(list, entry(`e${i}`, i));
    expect(list).toHaveLength(MAX_RECENT_PATHS);
    expect(list[0].edgeId).toBe(`e${MAX_RECENT_PATHS + 2}`); // newest kept
  });
});

describe('parseRecent', () => {
  it('round-trips a valid payload', () => {
    const list = [entry('a', 1), entry('b', 2)];
    expect(parseRecent(JSON.stringify(list))).toEqual(list);
  });

  it('returns [] for null, bad JSON and non-arrays', () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('{not json')).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
  });

  it('drops malformed entries and caps the result', () => {
    const mixed = [entry('a', 1), { edgeId: 42 }, 'x', null, ...Array.from({ length: 9 }, (_, i) => entry(`f${i}`, i))];
    const out = parseRecent(JSON.stringify(mixed));
    expect(out[0]).toEqual(entry('a', 1));
    expect(out).toHaveLength(MAX_RECENT_PATHS);
    expect(out.every((r) => typeof r.edgeId === 'string')).toBe(true);
  });
});
