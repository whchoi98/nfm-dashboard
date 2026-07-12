// app/src/lib/graph-layout.ts — deterministic initial-position seeding for
// NetworkGraph's d3-force layout (Phase 14 Task 5). Pure, no d3/DOM: given a
// node id, derives a stable starting (x,y) from a hash of the id string, so
// the SAME node id always seeds the simulation from the SAME point —
// regardless of the node array's iteration order, poll refreshes,
// filter/groupBy changes, or a full page reload.
//
// Why this matters: d3-force's own forces are already deterministic (a
// fixed-seed LCG lives in d3-force/src/simulation.js — there is no
// Math.random anywhere in the library). But when a node's x/y aren't set
// before the simulation starts, d3-force seeds it off the node's ARRAY
// INDEX (`initialRadius * sqrt(0.5+i)`, `i * goldenAngle`), not its id. That
// means the exact same node could land at a different starting point across
// two builds/renders whose node array happened to be ordered differently —
// the one non-deterministic-in-practice input the library leaves on the
// table. Seeding explicitly from an id hash (this file) closes that gap: fix
// every node's seed + a fixed tick count (NetworkGraph.tsx ticks 300) and the
// resulting layout is deterministic by construction.
export interface Point {
  x: number;
  y: number;
}

/** FNV-1a 32-bit hash — fast, deterministic, ample dispersion for a UI seed (not cryptographic). */
function hashString(s: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return h >>> 0; // unsigned 32-bit
}

/**
 * Deterministic initial (x,y) for a node id, spread over [-spread, spread]
 * on each axis. The x/y hashes are salted differently so a node never seeds
 * on the x===y diagonal (which would visually bias every fresh id toward a
 * single line before the force sim pulls it apart).
 */
export function seedPosition(id: string, spread = 400): Point {
  const hx = hashString(`x:${id}`);
  const hy = hashString(`y:${id}`);
  return {
    x: (hx / 0xffffffff) * 2 * spread - spread,
    y: (hy / 0xffffffff) * 2 * spread - spread,
  };
}

/**
 * Order-independent identity for a node-id set — used to key the persisted
 * layout snapshot in localStorage (NetworkGraph.tsx position persistence).
 */
export function graphSignature(ids: Iterable<string>): string {
  const sorted = [...ids].sort();
  return `${sorted.length}:${hashString(sorted.join(''))}`;
}
