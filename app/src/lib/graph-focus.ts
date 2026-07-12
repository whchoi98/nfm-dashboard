// app/src/lib/graph-focus.ts — pure ego-network computation for the
// NetworkGraph click-to-isolate focus mode (Phase 14 Task 2). No I/O, no
// rendering: given the graph's edges and a focused node id, returns the set
// of node/edge ids to keep visible for a 1- or 2-hop "ego network".
//
// Semantics (deliberate design choice): a BFS out to `hops` rings from the
// node determines the VISIBLE NODE SET, then the visible EDGE SET is the
// full induced subgraph over that node set — every edge whose both
// endpoints made the cut, not just the spokes discovered during the BFS.
// This matches how an "isolate" view should read: once b and c are both
// shown because they're within range of the focused node, an edge directly
// between b and c should render too, instead of vanishing because the BFS
// happened to reach them independently.
export interface EdgeLike {
  id: string;
  source: string;
  target: string;
}

export interface NeighborsResult {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

export function neighbors(edges: EdgeLike[], nodeId: string, hops: 1 | 2): NeighborsResult {
  const nodeIds = new Set<string>([nodeId]);
  let frontier = new Set<string>([nodeId]);

  for (let hop = 0; hop < hops && frontier.size > 0; hop++) {
    const next = new Set<string>();
    for (const e of edges) {
      // Directionless: either end touching the current frontier discovers
      // the other end. Self-loops (source === target) never introduce a new
      // node, so they don't drive traversal — they only show up later via
      // the induced-edge pass below.
      if (frontier.has(e.source) && !nodeIds.has(e.target)) next.add(e.target);
      if (frontier.has(e.target) && !nodeIds.has(e.source)) next.add(e.source);
    }
    for (const id of next) nodeIds.add(id);
    frontier = next;
  }

  const edgeIds = new Set<string>();
  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) edgeIds.add(e.id);
  }

  return { nodeIds, edgeIds };
}
