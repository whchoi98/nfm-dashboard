# Phase 3 — Topology & Path Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. All subagents Fable 5.

**Goal:** Replace the unreadable 116-node force graph with an AWS-console-style **icon tiered flow map** (drill-down) + **adjacency-matrix toggle** + **top-edges panel**, and render pod-to-pod paths as an AWS **NetworkPathStepper** (nfm06 aesthetic) with EKS Pod/Namespace/Service/Cluster node types — shared across the topology and paths pages.

**Architecture:** Pure builders (buildHops/buildTiers/buildMatrix/rankEdges) transform the existing `/api/topology` (TopologySnapshot) and `/api/paths` (FlowEdge) payloads; components render them. TierFlowMap uses React Flow with custom icon nodes; HopPath/AdjacencyMatrix/TopEdgesPanel are the new shared pieces. The old TopologyGraph + PathView are replaced.

**Tech Stack:** Next.js 16 (App Router, React 19), reactflow ^11, recharts (Heatmap reused), lucide-react, TypeScript, vitest + @testing-library/react.

## Global Constraints

(inherits master index. Key for this phase:)
- No hardcoded hex in components — use `app/src/lib/chart-tokens.ts` (TOKENS, CATEGORY_COLORS(7), STATUS, SERIES_COLORS(8)).
- All UI strings via `t()` (ko/en both). SnowUI tokens, theme-aware (light+dark). dataviz: color+shape dual-encode, empty states, responsive/mobile (bottom sheet for panels).
- Consume existing shapes (do not change collector/API): TopologySnapshot/TopoNode/TopoEdge, FlowEdge (`app/src/lib/types.ts`); `/api/topology`, `/api/paths?edge=<hash>` (returns {series:FlowEdge[], latest:FlowEdge|null}).
- Path/edge selection contract preserved: an edge → `/paths?edge=<edgeHash>` link still works.
- conventional commits. TDD for pure builders; render-smoke for components (jsdom 0×0 — assert testid + empty text, no throw). App-only (no redeploy until Phase 6).

## Existing interfaces (consume)

```ts
// app/src/lib/types.ts
interface TopoNode { id: string; kind: 'pod'|'node'|'vpc'|'external'; label: string;
  namespace?: string; cluster?: string; az?: string; vpcId?: string; }
interface TopoEdge { id: string; source: string; target: string;
  metrics: Partial<Record<MetricName,number>>; category: DestCategory; targetPort?: number; }
interface TopologySnapshot { generatedAt: string; nodes: TopoNode[]; edges: TopoEdge[]; }
interface EndpointInfo { ip?; instanceId?; subnetId?; az?; vpcId?; region?; podName?; podNamespace?; serviceName?; }
interface TraversedComponent { componentId?; componentType?; componentArn?; serviceName?; }
interface FlowEdge { edgeHash; ...; a: EndpointInfo; b: EndpointInfo; snatIp?; dnatIp?; targetPort?; traversedConstructs: TraversedComponent[]; }
// Phase 2: app/src/components/charts/Heatmap.tsx  Heatmap({rows,cols,cells:{row,col,value}[],unit?,colorForValue?})  testid chart-heatmap
// app/src/lib/chart-tokens.ts: TOKENS, CATEGORY_COLORS, CATEGORY_ORDER, STATUS, SERIES_COLORS
// app/src/components/ui/Controls: { Card, Select }
// format.ts: formatMetricValue(value, metric), formatBytes
```

## Shared interfaces (produce here)

```ts
// app/src/lib/topology.ts (NEW — pure builders, TDD)
export type ResourceKind = 'pod'|'namespace'|'service'|'cluster'|'instance'|'eni'|'subnet'|'az'
  |'vpc'|'vpce'|'tgw'|'awsservice'|'region'|'internet'|'other';
export interface Hop { kind: ResourceKind; label: string; id?: string; context?: string; }
export function resourceKindOf(componentType?: string): ResourceKind;   // map traversedConstructs type
export function endpointKind(e: EndpointInfo): ResourceKind;            // pod/instance/... from endpoint
export function buildHops(edge: FlowEdge): Hop[];                       // [srcEndpoint, ...traversed, dstEndpoint]
export type TierLevel = 'cluster'|'namespace'|'service'|'pod';
export interface TierNode { id: string; kind: ResourceKind; label: string; tier: number; }
export interface TierLink { id: string; source: string; target: string; bytes: number; category: DestCategory; }
export function buildTiers(topo: TopologySnapshot, level: TierLevel): { nodes: TierNode[]; links: TierLink[] };
export interface MatrixData { rows: string[]; cols: string[]; cells: { row: string; col: string; value: number }[]; }
export function buildMatrix(topo: TopologySnapshot, metric: MetricName, level: TierLevel): MatrixData;
export function rankEdges(topo: TopologySnapshot, metric: MetricName, n: number): TopoEdge[];
```

## Task sequence

| # | Task | Deliverable |
|---|---|---|
| 1 | topology.ts pure builders | resourceKindOf/endpointKind/buildHops/buildTiers/buildMatrix/rankEdges (TDD) |
| 2 | ResourceIcon component | icon per ResourceKind (incl EKS pod/ns/service/cluster), render smoke |
| 3 | HopPath (NetworkPathStepper) | AWS nfm06 stepper from FlowEdge, replaces PathView usage |
| 4 | TierFlowMap | React Flow icon tiered map + drilldown, replaces TopologyGraph |
| 5 | AdjacencyMatrix + TopEdgesPanel | matrix (Heatmap reuse) + ranking panel |
| 6 | Wire /topology + /paths pages | integration + headless render verify; remove TopologyGraph/PathView |

---

## Task 1: topology.ts pure builders (TDD)

**Files:** Create `app/src/lib/topology.ts`, `app/src/lib/topology.test.ts`

**Interfaces:** exactly the "Shared interfaces" block above.

Rules:
- `resourceKindOf(componentType)`: case-insensitive contains match → `'TransitGateway'→'tgw'`, `'NetworkInterface'/'ENI'→'eni'`, `'VpcEndpoint'/'Endpoint'→'vpce'`, `'Subnet'→'subnet'`, `'Vpc'→'vpc'`, `'Instance'→'instance'`, service names (S3/DynamoDB/CloudWatch/Logs)→'awsservice', `'Internet'/'IGW'→'internet'`, `'Region'→'region'`; undefined/unknown→'other'.
- `endpointKind(e)`: podName→'pod', else instanceId→'instance', else subnetId→'subnet', else ip→'other'.
- `buildHops(edge)`: `[hop(edge.a)]` + `edge.traversedConstructs.map(tc → hop by resourceKindOf(tc.componentType), label=tc.serviceName||componentType||componentId, id=componentId)` + `[hop(edge.b)]`. Endpoint hop label: pod→`<ns>/<pod>`, instance→instanceId, else ip; context = az/region/vpcId when present; id = instanceId/podName.
- `buildTiers(topo, level)`: aggregate topo.nodes to the chosen level entity (pod→as-is; service→`<ns>/<svc>` fallback pod; namespace→ns; cluster→cluster||'—'), tier index by node.kind mapping to a lane (pod/service = tier 0 "workload", node/instance = tier 1, external/vpc = tier 2). Links: aggregate topo.edges between the level-entities, sum DATA_TRANSFERRED metric as bytes, keep a representative category; drop self-links.
- `buildMatrix(topo, metric, level)`: rows/cols = unique level-entities that appear as edge source/target; cells[row][col] = summed metric across edges between them.
- `rankEdges(topo, metric, n)`: topo.edges sorted desc by `metrics[metric] ?? 0`, top n.

- [ ] **Step 1: Failing test**

```ts
// app/src/lib/topology.test.ts
import { it, expect } from 'vitest';
import { resourceKindOf, endpointKind, buildHops, buildTiers, buildMatrix, rankEdges } from './topology';
import type { FlowEdge, TopologySnapshot } from './types';

it('resourceKindOf maps component types', () => {
  expect(resourceKindOf('TransitGateway')).toBe('tgw');
  expect(resourceKindOf('NetworkInterface')).toBe('eni');
  expect(resourceKindOf('VpcEndpoint')).toBe('vpce');
  expect(resourceKindOf('Amazon CloudWatch Logs')).toBe('awsservice');
  expect(resourceKindOf(undefined)).toBe('other');
});
it('endpointKind prefers pod > instance > subnet > ip', () => {
  expect(endpointKind({ podName:'p', instanceId:'i' })).toBe('pod');
  expect(endpointKind({ instanceId:'i' })).toBe('instance');
  expect(endpointKind({ ip:'1.1.1.1' })).toBe('other');
});
it('buildHops chains endpoint→traversed→endpoint', () => {
  const edge = { edgeHash:'e', a:{ podName:'api-1', podNamespace:'shop', az:'az1' },
    b:{ instanceId:'i-2', az:'az2' }, traversedConstructs:[{ componentType:'TransitGateway', componentId:'tgw-1' }] } as any as FlowEdge;
  const hops = buildHops(edge);
  expect(hops.map(h=>h.kind)).toEqual(['pod','tgw','instance']);
  expect(hops[0].label).toBe('shop/api-1'); expect(hops[1].id).toBe('tgw-1'); expect(hops[2].label).toBe('i-2');
});
it('buildTiers aggregates to namespace + drops self-links', () => {
  const topo: TopologySnapshot = { generatedAt:'', nodes:[
    { id:'pod:shop/api', kind:'pod', label:'api', namespace:'shop' },
    { id:'pod:shop/db', kind:'pod', label:'db', namespace:'shop' },
    { id:'pod:mon/g', kind:'pod', label:'g', namespace:'mon' } ], edges:[
    { id:'e1', source:'pod:shop/api', target:'pod:mon/g', metrics:{ DATA_TRANSFERRED:100 }, category:'INTER_AZ' },
    { id:'e2', source:'pod:shop/api', target:'pod:shop/db', metrics:{ DATA_TRANSFERRED:50 }, category:'INTRA_AZ' } ] };
  const { nodes, links } = buildTiers(topo, 'namespace');
  expect(nodes.map(n=>n.id).sort()).toEqual(['mon','shop']);
  expect(links).toHaveLength(1);            // shop↔mon; shop↔shop self-link dropped
  expect(links[0].bytes).toBe(100);
});
it('rankEdges desc by metric', () => {
  const topo = { generatedAt:'', nodes:[], edges:[
    { id:'a', source:'x', target:'y', metrics:{ DATA_TRANSFERRED:10 }, category:'INTRA_AZ' },
    { id:'b', source:'x', target:'z', metrics:{ DATA_TRANSFERRED:99 }, category:'INTRA_AZ' } ] } as any;
  expect(rankEdges(topo,'DATA_TRANSFERRED',1)[0].id).toBe('b');
});
```

- [ ] **Step 2: FAIL** — `npx -w app vitest run topology`
- [ ] **Step 3: Implement** per rules.
- [ ] **Step 4: PASS** — `npx -w app vitest run` full green; `npx -w app tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `feat(app): topology pure builders (hops/tiers/matrix/rankEdges)`

---

## Task 2: ResourceIcon component

**Files:** Create `app/src/components/topology/ResourceIcon.tsx`, `app/src/components/topology/ResourceIcon.test.tsx`

**Interfaces:** `ResourceIcon({ kind: ResourceKind, size?: number })` — a circular badge (bordered) with a per-kind lucide icon + per-kind token color. `KIND_META: Record<ResourceKind,{icon, color}>`. `data-testid` `resicon-<kind>`.

Rules:
- lucide icons per kind (e.g. pod=Box, namespace=Boxes, service=Network, cluster=Hexagon/Layers, instance=Server, eni=PlugZap, subnet=Grid2x2, az=MapPin, vpc=Cloud, vpce=Link2, tgw=GitFork, awsservice=Database, region=Globe, internet=Globe2, other=Circle). Color from TOKENS/SERIES_COLORS (no hex). 'use client'.
- Render smoke test: mount for every ResourceKind → assert `resicon-<kind>` present, no throw.

- [ ] **Step 1: smoke test (all kinds)** → FAIL → **Step 2: implement** → **Step 3: PASS** (`npx -w app vitest run ResourceIcon` + build) → **Step 4: Commit** `feat(app): ResourceIcon (per-kind AWS-style icons incl EKS)`.

---

## Task 3: HopPath (NetworkPathStepper)

**Files:** Create `app/src/components/HopPath.tsx`, `app/src/components/HopPath.test.tsx`; will replace `app/src/components/PathView.tsx` usage in Task 6.

**Interfaces:** `HopPath({ edge: FlowEdge, metricLabel?: string })` — horizontal stepper of `buildHops(edge)`: each hop = `<ResourceIcon kind>` + label + id (as a monospace link-styled span; if id looks like an AWS resource id show it, no external link needed) + context (region/az) below, joined by horizontal connectors. SNAT/DNAT/targetPort shown as a badge on the connector or a summary line. Title = `t('paths.networkPath')` + optional metricLabel. Mobile: horizontal scroll or vertical stack. testid `hop-path`. Empty/one-hop safe.

Rules: 'use client', tokens, dual-encode (icon+label not color-only), `t()` for all labels; add i18n keys `paths.networkPath`, `paths.snat`, `paths.dnat`, `paths.port` to ko/en if missing.

- [ ] **Step 1: render smoke** (edge with traversedConstructs → hop-path renders N steps incl pod + tgw; edge with empty traversed → still renders 2 endpoints) → FAIL → **Step 2: implement** → **Step 3: PASS** + build → **Step 4: Commit** `feat(app): HopPath network-path stepper (AWS nfm06 style, EKS nodes)`.

---

## Task 4: TierFlowMap (React Flow icon tiered map + drilldown)

**Files:** Create `app/src/components/topology/TierFlowMap.tsx`, `app/src/components/topology/TierFlowMap.test.tsx`; replaces `TopologyGraph.tsx` (delete in Task 6).

**Interfaces:** `TierFlowMap({ topology: TopologySnapshot, level: TierLevel, onLevelChange, onEdgeSelect })` — builds `buildTiers(topology, level)`, lays out nodes in left→right lanes by `tier`, custom node = `<ResourceIcon>` + label, edges = flow ribbons (stroke width ∝ log(bytes), color = CATEGORY_COLORS[category]). Node click → drill down (cluster→namespace→service→pod via onLevelChange) OR select. Edge click → onEdgeSelect(edgeId). React Flow: `nodesDraggable={false}`, `fitView`, MiniMap, Controls at bottom-left (not overlapping a FAB). testid `tier-flow-map`. Empty topology → empty-state.

Rules: 'use client', dagre or manual lane layout (x by tier, y stacked within tier), tokens only, memoized layout (recompute only on topology/level change). Handle ~100 aggregated nodes fine (namespace level = ~dozens).

- [ ] **Step 1: render smoke** (sample topology → tier-flow-map renders, nodes present; empty → empty-state) → FAIL → **Step 2: implement** → **Step 3: PASS** + build (reactflow is client-only) → **Step 4: Commit** `feat(app): TierFlowMap icon tiered topology with drilldown`.

---

## Task 5: AdjacencyMatrix + TopEdgesPanel

**Files:** Create `app/src/components/topology/AdjacencyMatrix.tsx`, `app/src/components/topology/TopEdgesPanel.tsx`, and one smoke test `app/src/components/topology/topology-panels.test.tsx`.

**Interfaces:**
- `AdjacencyMatrix({ topology, metric, level, onCellSelect })` — `buildMatrix(topology, metric, level)` → `<Heatmap rows cols cells>` (reuse Phase-2 Heatmap). Cell click → onCellSelect(row,col). testid `adjacency-matrix`. Empty → empty-state.
- `TopEdgesPanel({ topology, metric, onEdgeSelect })` — `rankEdges(topology, metric, 15)` list: each row = source→target + formatMetricValue(value, metric) + category chip; click → onEdgeSelect(edgeId) (links to `/paths?edge=`). testid `top-edges-panel`. Empty → empty-state. Mobile: works as bottom sheet content.

Rules: 'use client', tokens, `t()`, reuse Heatmap + format.

- [ ] **Step 1: smoke** (both render with sample topology + empty) → FAIL → **Step 2: implement** → **Step 3: PASS** + build → **Step 4: Commit** `feat(app): AdjacencyMatrix + TopEdgesPanel`.

---

## Task 6: Wire /topology + /paths pages (integration + headless verify)

**Files:** Modify `app/src/app/topology/page.tsx`, `app/src/app/paths/page.tsx`; Delete `app/src/components/topology/TopologyGraph.tsx`, `app/src/components/PathView.tsx` (after replacing usage).

**Interfaces:** Consumes Tasks 1-5 components. `/api/topology`, `/api/paths` unchanged.

Rules:
- `/topology`: top toolbar = view toggle (`t('topology.viewGraph')` TierFlowMap ↔ `t('topology.viewMatrix')` AdjacencyMatrix) + level select (cluster/namespace/service/pod) + metric select + existing cluster/namespace/category filters. Body = TierFlowMap (default) or AdjacencyMatrix. Right side (desktop) / bottom sheet (mobile) = TopEdgesPanel. Edge/cell select → open a panel showing the edge's HopPath (fetch `/api/paths?edge=<id>`) with a link to the full `/paths?edge=` page. Remove the old TopologyGraph + EdgePanel force-graph.
- `/paths`: replace PathView with HopPath (fed by `/api/paths` latest FlowEdge). Keep the edge-from-query (`?edge=`) + the pod-pair/edge picker; default content when none selected (reuse TopEdgesPanel "popular paths" from topology data via /api/topology).
- All new strings via `t()` (add topology.viewGraph/viewMatrix/level/metric, paths.* keys to ko+en).

- [ ] **Step 1: Implement wiring** (both pages), delete old components, add i18n keys.
- [ ] **Step 2: Verify** — `npx -w app vitest run` full green (existing topology/paths page tests, if any, updated); `npx -w app tsc --noEmit` clean; `npm -w app run build` succeeds.
- [ ] **Step 3: Headless render verify** (chromium via playwright-core as in prior phases): `AUTH_DISABLED=1 npm -w app run dev` PORT 3031, drive:
  - `/topology`: assert `tier-flow-map` visible on real live topology; toggle to matrix → `adjacency-matrix` visible; `top-edges-panel` visible; click a top edge → HopPath panel shows `hop-path`. Light + dark, iPhone 390×844 no h-scroll. Console error 0.
  - `/paths?edge=<a real edgeHash from /api/topology edges>`: `hop-path` renders steps.
  Record results. Kill dev.
- [ ] **Step 4: Commit** — `feat(app): topology tier-map/matrix + hop-path paths page (replace force graph)`.

---

## Phase 3 self-review checklist (before finishing branch)
- [ ] topology.ts builders TDD; ResourceIcon covers all kinds incl EKS pod/ns/service/cluster — Tasks 1-2.
- [ ] HopPath = AWS nfm06 stepper, shared by topology edge-select + paths page — Tasks 3,6.
- [ ] TierFlowMap replaces force graph, drill-down, lanes fill canvas; matrix toggle; top-edges panel — Tasks 4-6.
- [ ] TopologyGraph + PathView deleted; no dead imports.
- [ ] Headless: topology graph+matrix+hop-path render on live data, light/dark/iPhone, 0 console errors — Task 6.
- [ ] tokens-only, t() everywhere (ko+en), empty states. Full suite green + build. App-only (no redeploy).
