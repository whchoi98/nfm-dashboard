// TDD for seedPosition/graphSignature (Phase 14 Task 5) — the deterministic
// initial-position seed feeding NetworkGraph's d3-force layout. The full
// force simulation itself is NOT unit-tested here: it lives in the
// 'use client' NetworkGraph.tsx alongside reactflow/d3-force and is exercised
// via headless QA instead, per the task brief's explicit allowance ("if the
// full force sim is impractical to unit-test, test the extracted seed
// function only"). d3-force's forces are already deterministic on their own
// (a fixed-seed LCG, no Math.random anywhere in the library — verified by
// reading d3-force/src/simulation.js), so once every node's seed is a pure
// function of its id (this file) and the tick count is fixed, the resulting
// layout is deterministic by construction.
import { describe, expect, it } from 'vitest';
import { graphSignature, seedPosition } from './graph-layout';

describe('seedPosition', () => {
  it('is a pure function of the id: calling it twice yields identical positions', () => {
    expect(seedPosition('pod/api-abc123')).toEqual(seedPosition('pod/api-abc123'));
  });

  it('a node id maps to the same initial position regardless of call order/context', () => {
    seedPosition('unrelated-warmup-call');
    const first = seedPosition('node/gw-1');
    seedPosition('another-unrelated-call');
    const second = seedPosition('node/gw-1');
    expect(second).toEqual(first);
  });

  it('different ids map to different positions', () => {
    const ids = ['a', 'b', 'c', 'pod/api-1', 'pod/api-2', 'node/gw-1', 'vpc/main', 'external'];
    const seen = new Set(ids.map((id) => JSON.stringify(seedPosition(id))));
    expect(seen.size).toBe(ids.length);
  });

  it('returns finite coordinates within the requested spread', () => {
    const p = seedPosition('some-id', 250);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(250);
    expect(Math.abs(p.y)).toBeLessThanOrEqual(250);
  });

  it('does not seed every id on the x===y diagonal', () => {
    const p = seedPosition('diagonal-check');
    expect(p.x).not.toBe(p.y);
  });

  it('honors a custom spread', () => {
    const p = seedPosition('wide-spread', 1000);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(1000);
    expect(Math.abs(p.y)).toBeLessThanOrEqual(1000);
  });
});

describe('graphSignature', () => {
  it('is order-independent: the same set in a different array order yields the same signature', () => {
    expect(graphSignature(['a', 'b', 'c'])).toBe(graphSignature(['c', 'a', 'b']));
  });

  it('differs when the node set differs', () => {
    expect(graphSignature(['a', 'b'])).not.toBe(graphSignature(['a', 'b', 'c']));
  });

  it('is stable across repeated calls on the same set', () => {
    const ids = ['x', 'y', 'z'];
    expect(graphSignature(ids)).toBe(graphSignature(ids));
  });

  it('empty set has a well-defined signature (no throw)', () => {
    expect(() => graphSignature([])).not.toThrow();
  });
});
