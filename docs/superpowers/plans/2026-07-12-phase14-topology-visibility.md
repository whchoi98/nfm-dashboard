# Phase 14 — Topology Visibility (First Wave) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Pure builder logic is TDD; interactive graph changes are headless-verified. Read the target file BEFORE editing — the line anchors below are from an analysis pass and may drift.

**Goal:** Improve the `/topology` graph's visibility on dense pod-to-pod maps with 6 additions: node-grouping (namespace/AZ/cluster) with collapse/expand, click-to-isolate ego-network, canvas search+pan-to, a min-traffic threshold + interactive legend, kind icons + cross-AZ/high-retransmit badges, and deterministic node positions + a live MiniMap.

**Architecture:** All app-only, built on the existing force-directed `NetworkGraph.tsx` + `topology-graph.ts` model. Pure model changes (grouping, aggregate edges, threshold cut, layout seeding) live in `topology-graph.ts`/layout helpers (TDD); the graph component gains focus/search/legend/minimap interactions; the `/topology` page toolbar gains the new controls. Reuse existing assets: `ResourceIcon`/`KIND_META` (icons), the MiniMap already present in the unwired `TierFlowMap`, and the existing `focusId`/mute machinery.

**Tech Stack:** Next.js 16, React 19, reactflow ^11 + d3-force, Tailwind v4 SnowUI tokens, vitest.

## Global Constraints

- App-only. Version bump **0.8.0** at the end (version.ts + package.json + CHANGELOG [0.8.0] EN+KR + ref links; version.test passes).
- All visible strings via `t()` in BOTH ko.json + en.json. Colors ONLY from chart-tokens (`STATUS`, `TOKENS`, palettes) — no hardcoded hex; keep node COLOR reserved for health (add info via shape/icon/badge/label, not new color axes).
- Pure builder/layout helpers TDD (co-located `*.test.ts`). `npx -w app vitest run` green; `npx -w app tsc --noEmit` clean; `npm -w app run build` succeeds — before each commit.
- Do NOT change or remove existing behavior/testids: the force graph, edge health coloring, metric/level/cluster/category/tag filters, LIVE/pause, edge→HopPath panel, adjacency/health matrix + `topology-matrix-mode`/`adjacency-matrix-health`, zoom/pan, poll-time position preservation. New controls are additive.
- Mobile-safe (graph already scrolls/zooms in its container; new toolbar controls wrap; no page h-scroll at 390px). Light + dark first-class. No new npm deps (reactflow MiniMap + d3-force already present).
- Conventional commits + `Claude-Session:` trailer, NO Co-Authored-By line. Serial. dev branch `dev/phase14-topology-visibility` → merge → deploy (user-authorized).
- IaC/data unchanged. UI change → update `app/src/components/CLAUDE.md` if the topology component set changes materially + `docs/reference/ui.md` note.

## Current topology (verified via analysis; reuse, do not rebuild)

`app/src/app/topology/page.tsx` (toolbar + view toggle graph↔matrix + filters + edge→HopPath context Card ~`:346-417`, edge click `:369`); `app/src/components/topology/NetworkGraph.tsx` (force sim, `computeLayout` ~`:183-201`, node view `CircleNodeView` ~`:64-104` incl. label `:96-101`, edge view `CurvedEdgeView` ~`:123-171` incl. value pill `:157-168`, focus/mute `:275`, sim re-run on filter change `:232-238`, poll position-preserve `:293-312`); `GraphLegend.tsx` (static legend); `TagFilterPanel.tsx` (checkbox search `:46-49`); `app/src/lib/topology-graph.ts` (`buildGraphModel` ~`:77`, edge creation `:103-114`, thresholds `DEFAULT_RATE_THRESHOLD=128` + health 10/5 `:66-70`); `ResourceIcon.tsx` (`KIND_META` `:29-45`); the unwired `TierFlowMap.tsx` (has a reactflow `MiniMap` ~`:326-347` + tiered lanes + drill-down — REUSE its MiniMap). Topology data = `TopologySnapshot { nodes: TopoNode[], edges: TopoEdge[] }` (`types.ts`); `TopoNode` has `kind`, `namespace`, `cluster`, `az`, `vpcId`; `TopoEdge` has `metrics: Partial<Record<MetricName,number>>`, `category`, `targetPort`.

## Task sequence (serial)

| # | Task | Deliverable |
|---|---|---|
| 1 | Threshold controls + interactive legend | min-traffic slider + tunable thresholds (topology-graph props) + clickable legend (isolate danger) |
| 2 | Focus: ego-isolate + canvas search | node click → hide non-neighbors (1/2-hop) + search box → highlight + pan-to |
| 3 | Node grouping + collapse/expand | group by namespace/AZ/cluster with aggregate edges (topology-graph, TDD) + graph collapse/expand |
| 4 | Node encoding: kind icons + badges | ResourceIcon kind glyph + cross-AZ / high-retransmit badge on nodes |
| 5 | Layout stability + MiniMap | deterministic seeded positions (persist) + live MiniMap (port from TierFlowMap) |
| 6 | Finalize | review + v0.8.0 + deploy + prod smoke |

---

## Task 1: Threshold controls + interactive legend

**Files:** Modify `app/src/lib/topology-graph.ts` (+ test), `app/src/app/topology/page.tsx`, `app/src/components/topology/GraphLegend.tsx`; i18n.

**Interfaces:**
- `buildGraphModel(...)` gains an options field `minEdgeValue?: number` (default 0) — edges whose selected-metric value < `minEdgeValue` are dropped from the model; nodes left with no edges are dropped too. Also surface the existing hardcoded thresholds (`DEFAULT_RATE_THRESHOLD`, health warn/danger per GB) as options with the current values as defaults so the page can override them.
- The model result exposes `hiddenEdgeCount: number` (edges cut by `minEdgeValue`) so the UI can show "N hidden".

- [ ] Step 1: TDD `buildGraphModel` min-traffic cut — a fixture with edges of mixed selected-metric values; assert edges below `minEdgeValue` are removed, orphaned nodes removed, `hiddenEdgeCount` correct, and `minEdgeValue:0` = current behavior (no change). Also assert health thresholds are read from options (danger/warn boundary) not hardcoded.
- [ ] Step 2: FAIL → implement (thread `minEdgeValue` + threshold options through; compute `hiddenEdgeCount`) → PASS. Keep default output byte-identical to today when no options passed.
- [ ] Step 3: `page.tsx` toolbar: a **min-traffic slider** (0..max selected-metric value, log-ish or quantile steps; label shows the cut value + "{n} hidden") wired to `buildGraphModel({ minEdgeValue })`; optional numeric inputs for the health warn/danger thresholds (default 5/10 per GB). testids `topology-min-traffic`, `topology-threshold-*`.
- [ ] Step 4: `GraphLegend.tsx` → **interactive**: clicking the "danger"/"warn"/"ok" legend entry isolates (mutes/hides) edges+nodes NOT in that health class (toggle); a cleared state shows all. Keep it dual-encoded (text + STATUS color). testid `topology-legend-<status>`.
- [ ] Step 5: i18n (ko+en): `topology.minTraffic`, `topology.hiddenEdges`, `topology.threshold.retrans`, `topology.threshold.timeout`, `topology.legendFilterHint`. `vitest`/tsc/build. Commit `feat(app): topology min-traffic threshold + interactive health legend`.

---

## Task 2: Focus — ego-network isolate + canvas search

**Files:** Modify `app/src/components/topology/NetworkGraph.tsx`, `app/src/app/topology/page.tsx`; i18n. (Pure neighbor computation → a small tested helper.)

**Interfaces:**
- New helper (in `topology-graph.ts` or a `graph-focus.ts`) `neighbors(edges, nodeId, hops: 1|2): { nodeIds: Set<string>; edgeIds: Set<string> }` — TDD.
- `NetworkGraph` focus mode: when a node is focused (existing `focusId`), in "isolate" mode HIDE nodes/edges not in its `hops`-neighborhood (vs today's mute-only at `:275`); a 1-hop/2-hop toggle; clicking empty canvas clears.

- [ ] Step 1: TDD `neighbors` — a small graph; 1-hop returns the node + direct neighbors + connecting edges; 2-hop extends one more ring; unknown node → just itself; directionless (both in/out neighbors).
- [ ] Step 2: FAIL → implement → PASS.
- [ ] Step 3: `NetworkGraph.tsx`: extend the focus path (`:275`) — add an `isolate` boolean (default on) so focusing a node renders only its `neighbors(hops)` subgraph (others removed from the reactflow node/edge arrays, not just muted); keep the existing focus ring; a 1↔2 hop toggle (testid `topology-hop-toggle`); ESC / empty-canvas click clears focus (restore full graph). Preserve poll position-preservation for the visible subset.
- [ ] Step 4: `page.tsx`: a **canvas search** input (reuse/extend the entity search; on submit, resolve the node id, set `focusId`, and call reactflow `setCenter`/`fitView` to pan-to + highlight). testid `topology-search`. Distinct from the TagFilterPanel checkbox filter (which stays).
- [ ] Step 5: i18n (`topology.search`, `topology.hops`, `topology.isolate`, `topology.clearFocus`). `vitest`/tsc/build. Headless: focusing a node hides non-neighbors; search pans to a node; ESC restores. Commit `feat(app): topology click-to-isolate ego-network + canvas search/pan-to`.

---

## Task 3: Node grouping + collapse/expand

**Files:** Modify `app/src/lib/topology-graph.ts` (+ test), `app/src/components/topology/NetworkGraph.tsx`, `app/src/app/topology/page.tsx`; i18n. (Biggest task — the density fix.)

**Interfaces:**
- `buildGraphModel` gains `groupBy?: 'none' | 'namespace' | 'az' | 'cluster'` (default `'none'` = today). When set, nodes are collapsed into GROUP nodes keyed by that field; edges between groups are AGGREGATED into one edge per (groupA,groupB) summing metrics (bytes/retrans/timeouts, rtt avg-weighted) and re-deriving health; a group's expanded state re-shows its member nodes (with intra-group edges) while other groups stay collapsed.
- Group node shape: `GraphNode` gains `group?: { key: string; kind: 'group'; memberCount: number; expanded: boolean }`. Result exposes group nodes + a stable ordering.

- [ ] Step 1: TDD grouping+aggregation — fixture of pods across 2 namespaces; `groupBy:'namespace'` → 2 group nodes + 1 aggregate edge summing the cross-namespace metrics + correct memberCount + health re-derived from summed retrans/GB; `groupBy:'none'` = current output; expanding one group re-adds its members + intra-edges while the other stays a group; self-traffic within a group folds to a group self-loop.
- [ ] Step 2: FAIL → implement (reuse the endpoint→key logic pattern from `edge-health.ts`/aggregate; do NOT fork keying) → PASS.
- [ ] Step 3: `page.tsx`: a **Group-by control** (none/namespace/AZ/cluster; testid `topology-groupby`). Note AZ grouping surfaces cross-zone cost — call it out in the label/hint.
- [ ] Step 4: `NetworkGraph.tsx`: render group nodes distinctly (rounded rect / larger, `memberCount` badge) with a click → expand/collapse (toggle `expanded`, rebuild model). Aggregate edges use the same throughput/health encoding. Keep focus/search/threshold (Tasks 1-2) working with grouping on.
- [ ] Step 5: i18n (`topology.groupBy`, `.group.namespace/.az/.cluster/.none`, `topology.members`, `topology.azCostHint`). `vitest`/tsc/build. Headless: groupBy=namespace collapses to group nodes + aggregate edges; expanding one group shows members; no h-scroll. Commit `feat(app): topology node grouping (namespace/AZ/cluster) + collapse/expand`.

---

## Task 4: Node encoding — kind icons + cross-AZ / high-retransmit badges

**Files:** Modify `app/src/components/topology/NetworkGraph.tsx` (`CircleNodeView`); reuse `ResourceIcon.tsx`; i18n.

- [ ] Step 1: `CircleNodeView` (`:64-104`): render the node's `kind` via `ResourceIcon`/`KIND_META` (pod/node/vpc/external) inside/beside the circle — COLOR stays health (retrans/GB); kind is the icon/shape channel. Keep the metric-sized circle.
- [ ] Step 2: Add corner **badges** (small glyphs, dual-encoded with a tooltip): (a) cross-AZ badge when the node participates in cross-AZ edges (compare endpoint `az` across its edges — compute in the model or the component from the node's edges); (b) high-retransmit badge when the node's health is `danger`. testids `topology-node-badge-crossaz`, `topology-node-badge-retrans`.
- [ ] Step 3: Legend entries for the icons/badges (extend GraphLegend). i18n (`topology.kind.*`, `topology.badge.crossAz`, `topology.badge.highRetrans`). Tokens only.
- [ ] Step 4: `vitest`/tsc/build. Headless: nodes show kind icons + badges render for cross-AZ/danger nodes, light+dark. Commit `feat(app): topology node kind icons + cross-AZ / high-retransmit badges`.

---

## Task 5: Layout stability + live MiniMap

**Files:** Modify `app/src/components/topology/NetworkGraph.tsx` (+ `computeLayout` test if extracted); reuse the MiniMap pattern from `TierFlowMap.tsx`.

**Interfaces:** `computeLayout(nodes, edges, opts)` becomes DETERMINISTIC — seed the force sim / initial positions from a stable hash of node id (so the same graph lays out the same way across reloads/filter changes), and persist manual drags + computed positions to `localStorage` keyed by graph signature.

- [ ] Step 1: TDD determinism — calling the layout twice on the same nodes/edges yields the same positions (seeded); a node id → same initial position (hash-based). (If layout is hard to unit-test due to d3 randomness, extract the seed/initial-position function and test THAT.)
- [ ] Step 2: FAIL → implement seeded initial positions (replace any `Math.random` seeding with an id-hash) + persist/restore positions from `localStorage` (key by sorted node-id set or a signature); on filter/level/groupBy change, preserve positions of nodes that persist (don't full-reshuffle — addresses `:232-238`).
- [ ] Step 3: Port the reactflow **`<MiniMap>`** from `TierFlowMap.tsx:326-347` into the live `NetworkGraph` (node color = health, so the minimap reflects health at a glance); mobile-safe (hide < sm if cramped). testid `topology-minimap`.
- [ ] Step 4: `vitest`/tsc/build. Headless: reload keeps node positions stable; changing a filter doesn't reshuffle persistent nodes; minimap renders + reflects the graph. Commit `feat(app): deterministic topology layout + live minimap`.

---

## Task 6: Finalize — review + v0.8.0 + deploy

- [ ] Step 1: Full `vitest` + `tsc` + `build` green. Confirm all existing topology behavior (matrix modes, filters, HopPath, health coloring, LIVE) unregressed; new testids present.
- [ ] Step 2: Final whole-branch adversarial review (strongest model) over `git merge-base main HEAD`..HEAD. Focus: grouping/aggregation correctness (metric sums, health re-derivation, expand/collapse state, self-loops) + `groupBy:'none'` == current output (no regression); ego-isolate neighbor math; min-traffic cut + orphan removal + `hiddenEdgeCount`; deterministic layout actually stable + position persistence not corrupting; COLOR still reserved for health (kind/badges use shape/icon, no new color axis); no regressed topology testids/behavior; i18n ko+en parity; tokens only; mobile. Fix Critical/Important.
- [ ] Step 3: Version bump **0.8.0** (version.ts + package.json + CHANGELOG [0.8.0] EN+KR: Added = the 6 topology-visibility features; + ref links). version.test passes.
- [ ] Step 4: Commit `chore(release): v0.8.0 — topology visibility (grouping, ego-isolate, search, thresholds, kind icons, minimap)`. Merge `--no-ff` to main.
- [ ] Step 5: Deploy (USER-AUTHORIZED). `bash scripts/build-push.sh <sha>` → `cd infra && npx cdk deploy NfmDash-App --require-approval never -c imageTag=<sha>`. Verify stack UPDATE_COMPLETE, ECS rollout COMPLETED + image tag, ALB healthy, CloudFront /login 200 + /→302.
- [ ] Step 6: Prod smoke: `bash scripts/smoke.sh` (3/3) + authenticated headless on `/topology`: group-by collapses/expands, node click isolates ego-network, search pans-to, min-traffic slider hides edges + legend isolates a health class, kind icons + badges render, minimap + stable layout, matrix modes still work; light+dark, mobile no-h-scroll.

---

## Phase 14 self-review checklist
- [ ] 6 features: min-traffic+legend, ego-isolate+search, grouping+collapse, kind icons+badges, deterministic layout+minimap — each app-only, additive.
- [ ] Pure logic (min-traffic cut, neighbors, grouping/aggregation, layout seed) is TDD; `groupBy:'none'`/`minEdgeValue:0` == current output (no regression).
- [ ] COLOR stays health-only; new info via shape/icon/badge/label. Tokens only. i18n ko+en.
- [ ] Existing topology behavior/testids (matrix modes, filters, HopPath, health coloring, LIVE, zoom) unregressed; reused dead-code MiniMap + ResourceIcon rather than rebuilding.
- [ ] v0.8.0 synced; full suite + build green; final review clean; deployed + prod smoke — Task 6.
