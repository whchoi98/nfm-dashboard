# Phase 4 — Insights Hub (5 tabs) + Datadog Composition + Per-Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps `- [ ]`. All subagents Fable 5.

**Goal:** Rebuild `/insights` into a 5-tab analytics hub (Cost/Reliability/Latency/Dependencies/DNS) with Datadog-style composition (global filter bar, dense widget grid, synced crosshair, toplists, status coloring), add a per-monitor section (`/monitors` list + `/monitors/[name]` Overview/Historical-explorer), and wire the remaining backend bits (reliability CW NHI, getFlowsWindow caching).

**Architecture:** A shared `useAnalyticsFilters` hook + `FilterBar` drive all hub widgets; a `Widget` wrapper + `HoverSync` context + `Toplist` are the Datadog primitives. The hub tabs consume the Phase-2 `/api/analytics/*` routes and the Phase-2 chart components. Per-monitor pages consume `/api/flows?monitor=` + `/api/monitors*` + CW metrics; flow-table rows open the Phase-3 HopPath.

**Tech Stack:** Next.js 16 (App Router, React 19), recharts, reactflow (already), lucide-react, TypeScript, vitest + @testing-library/react.

## Global Constraints

(inherits master index. Key for this phase:)
- All UI strings via `t()` (ko/en both). SnowUI tokens, theme-aware. No hardcoded hex — use `chart-tokens`. dataviz: dual-encode, empty states, mobile-safe (bottom sheet, no page h-scroll).
- Datadog composition (spec §16): global FilterBar applies to ALL widgets on a page; timeboard-dense widget grid; synced crosshair across timeseries; status coloring (STATUS ok/warn/danger) with icon dual-encode; toplists.
- Per-monitor (spec §15.2/§15.4): Traffic-summary aggregation = DataTransferred **avg**, Retransmissions/Timeouts **sum**, RTT **min** + p50/p95. NHI band. Flow tables per metric, row → HopPath. Category as first-class column/filter.
- App-only phase (redeploy happens in Phase 6, unless a mid-deploy is requested). conventional commits. TDD for pure/hook logic; render-smoke + headless for pages.

## Existing interfaces (consume — Phase 2/3)

```ts
// /api/analytics/{cost,reliability,latency,dependencies,dns} → shapes per spec §6:
//   cost: {totalUsd, byCategory:Record<DestCategory,{bytes,usd}>, top:CostRow[], series:Series[], regionArcs, stream}
//   reliability: {hotspots, breaches, nhi:Series, nhiSwimlanes, scatter}
//   latency: {overall:LatencyStats, intra, inter, slowest, trend:Series, distribution, hourHeatmap}
//   dependencies: {sankey, ports, namespaces, categories, hops, pathTree, pareto}
//   dns: DnsAggregate {enabled, topDomains, failures, latency, queryTypes, resolution, nameFlow}
// charts (app/src/components/charts/): StatDelta({label,value,unit?,deltaPct?,trend?,spark?,status?,testId?}),
//   Scatter, StreamGraph, Pareto, Treemap, Distribution, Gauge, Heatmap, RegionArcMap, Icicle, Swimlane, Sankey,
//   TimeSeries, CategoryBars, CategoryDonut, ChartTooltip
// app/src/lib/chart-tokens.ts: TOKENS, CATEGORY_COLORS(7), CATEGORY_ORDER, STATUS, SERIES_COLORS(8)
// app/src/lib/format.ts: formatBytes, formatCount, formatMicros, formatMetricValue(metric,value)
// app/src/lib/use-polling.ts: usePolling<T>(url, ms=30000)
// app/src/lib/ddb.ts: getFlowsWindow(n=12), queryFlowsByBucket(bucket, monitor?), getWorkloadInsights, getCollectionStatus, getCoverage
// app/src/lib/cw-metrics.ts: getNfmMetrics(minutes=60) → per-monitor NFM CW metric series (incl HealthIndicator, dimension MonitorId=ARN)
// app/src/components/HopPath.tsx ({edge:FlowEdge, metricLabel?}), TopEdgesPanel, ResourceIcon (Phase 3)
// app/src/components/ui/Controls: { Card, Select, TextInput }
// Nav: app/src/components/layout/{Sidebar,MobileTabs}.tsx (NAV_ITEMS)
```

## Shared interfaces (produce here)

```ts
// app/src/lib/analytics/filters.ts
export type TimeRange = '15m'|'1h'|'3h'|'24h';
export interface AnalyticsFilters { range: TimeRange; cluster: string; namespace: string;
  category: string; metric: MetricName; }   // 'all' sentinel for cluster/namespace/category
export const DEFAULT_FILTERS: AnalyticsFilters;
export function rangeToBuckets(range: TimeRange): number;   // 15m→3, 1h→12, 3h→36, 24h→288
// app/src/lib/hooks/useAnalyticsFilters.ts  (client hook)
export function useAnalyticsFilters(): { filters: AnalyticsFilters; setFilter: (k, v)=>void };
// app/src/components/analytics/HoverSync.tsx
export function HoverSyncProvider({children}); export function useHoverSync(): {activeT: string|null; setActiveT};
```

## Task sequence

| # | Task | Deliverable |
|---|---|---|
| 1 | filters.ts + useAnalyticsFilters + FilterBar | global filter (URL+sessionStorage), TDD pure + smoke |
| 2 | Datadog primitives: Widget + HoverSync + Toplist | components + smoke |
| 3 | backend wiring: reliability CW NHI + getFlowsWindow cache + window param | routes updated, TDD/live |
| 4 | /insights 5-tab hub (bento per tab, filters, synced) | UI + headless |
| 5 | per-monitor: /api/monitors(+[name]) + /monitors(+[name]) + nav | UI + headless |

---

## Task 1: filters.ts + useAnalyticsFilters + FilterBar

**Files:** Create `app/src/lib/analytics/filters.ts`, `app/src/lib/analytics/filters.test.ts`, `app/src/lib/hooks/useAnalyticsFilters.ts`, `app/src/components/analytics/FilterBar.tsx`, `app/src/components/analytics/FilterBar.test.tsx`.

**Interfaces:** per Shared interfaces. `FilterBar({ filters, setFilter, clusters?, namespaces? })` — Select controls for range/cluster/namespace/category/metric (labels via t(); category options from CATEGORY_ORDER + 'all'; metric from the 4 MetricName). Sticky top bar, wraps on mobile. testid `filter-bar`.

Rules: `rangeToBuckets` pure (TDD). `useAnalyticsFilters` reads/writes URL query (?range=&cluster=&…) + mirrors to sessionStorage `nfm-analytics-filters`; SSR-safe (guard window). DEFAULT_FILTERS = {range:'1h', cluster:'all', namespace:'all', category:'all', metric:'DATA_TRANSFERRED'}.

- [ ] **Step 1: Failing test** — filters.test.ts: `rangeToBuckets('15m')===3`, `'1h'===12`, `'3h'===36`, `'24h'===288`; DEFAULT_FILTERS shape. FilterBar smoke: renders `filter-bar` + the 5 selects, changing a select calls setFilter.
- [ ] **Step 2: FAIL** → **Step 3: implement** (filters.ts pure; useAnalyticsFilters with useSearchParams + sessionStorage; FilterBar) → **Step 4: PASS** (`npx -w app vitest run filters FilterBar` + build) → **Step 5: Commit** `feat(app): analytics global filter bar + useAnalyticsFilters`.

---

## Task 2: Datadog primitives — Widget + HoverSync + Toplist

**Files:** Create `app/src/components/analytics/Widget.tsx`, `app/src/components/analytics/HoverSync.tsx`, `app/src/components/analytics/Toplist.tsx`, and `app/src/components/analytics/analytics-primitives.test.tsx`.

**Interfaces:**
- `Widget({ title, actions?, children, className? })` — Datadog-style widget chrome: title bar + optional actions slot (e.g. a CloudWatch deep link, metric menu) + body. testid `widget-<title-slug>` (accept optional `testId`). Reuses Card look.
- `HoverSyncProvider`/`useHoverSync` — context sharing an `activeT` (the hovered timestamp) so multiple TimeSeries can align a crosshair. (TimeSeries stays as-is; the hub wires onMouseMove→setActiveT and passes activeT as a highlight — keep the integration minimal: expose the context; a small `SyncedTimeSeries` wrapper optional.)
- `Toplist({ rows: {label, value, sub?, status?:'ok'|'warn'|'danger'}[], valueFormatter?, onSelect? })` — ranked horizontal bars (value ∝ width) + label + formatted value; status color (dual-encode with a leading dot/icon). testid `toplist`. Empty-state.

Rules: 'use client', tokens-only, t() for any text (empty state), dark-safe.

- [ ] **Step 1: smoke** (Widget renders title+children+testid; Toplist renders rows + empty-state; HoverSync provider+hook works via a test consumer) → FAIL → **Step 2: implement** → **Step 3: PASS** + build → **Step 4: Commit** `feat(app): Datadog primitives (Widget, HoverSync, Toplist)`.

---

## Task 3: backend wiring — reliability CW NHI + getFlowsWindow cache + window param

**Files:** Modify `app/src/app/api/analytics/reliability/route.ts`, `app/src/lib/ddb.ts` (getFlowsWindow caching), `app/src/app/api/analytics/{cost,reliability,latency,dependencies}/route.ts` (accept `?buckets=` from range); Test: extend `app/src/lib/ddb.test.ts`.

**Interfaces:**
- reliability route: fetch `getNfmMetrics()` (cw-metrics), transform its HealthIndicator series → `nhi` (single Series) and per-monitor → `nhiSwimlanes` (Record<monitor,Series>), pass to `reliabilityLens(flows, { healthIndicator, byMonitor })`. So the reliability response's `nhi`/`nhiSwimlanes` are populated (currently empty).
- `getFlowsWindow(n=12)`: add in-flight de-dup so 4 concurrent analytics routes fetching the same window don't each re-query — a module-level in-flight Promise map keyed by `n`, cached ~10s (short TTL), returns the shared promise. Keep correctness (fresh data within TTL). 
- All 4 flow-based routes: read optional `?buckets=<n>` query (from `rangeToBuckets`), default 12, clamp [1,288], pass to getFlowsWindow.

- [ ] **Step 1: Failing test** — ddb.test.ts: two concurrent `getFlowsWindow(12)` calls issue the underlying bucket queries ONCE (in-flight de-dup) within the TTL; a call after TTL re-queries. (Mock timers or the query fn.)
- [ ] **Step 2: FAIL** → **Step 3: implement** → **Step 4: PASS + live** — `npx -w app vitest run ddb`; `npm -w app run build`; `AUTH_DISABLED=1 npm -w app run dev` PORT 3033 → `curl -s localhost:3033/api/analytics/reliability | python3 -c "import sys,json;d=json.load(sys.stdin);print('nhi points',len(d['nhi']['points']),'swimlanes',len(d['nhiSwimlanes']))"` (nhi should now be populated from CW; if CW HealthIndicator has data). `curl -s "localhost:3033/api/analytics/cost?buckets=36" | head -c 120`. Kill dev. Record.
- [ ] **Step 5: Commit** `feat(app): wire reliability NHI from CloudWatch + getFlowsWindow cache + buckets param`.

---

## Task 4: /insights 5-tab hub

**Files:** Rewrite `app/src/app/insights/page.tsx`; Create `app/src/app/insights/tabs/{CostTab,ReliabilityTab,LatencyTab,DependenciesTab,DnsTab}.tsx` (or inline sections); i18n keys.

**Interfaces:** Consumes Tasks 1-3 (FilterBar/useAnalyticsFilters/Widget/HoverSync/Toplist) + Phase-2 charts + `/api/analytics/*` (with `?buckets=` from filters).

Layout per spec §7/§16: FilterBar (sticky) + tab strip (`t()` labels: 비용/신뢰성/지연/의존성/DNS) + active tab's bento grid of Widgets:
- **Cost**: StatDelta(totalUsd, status by threshold) + Treemap(byCategory usd) + Toplist(top cost contributors) + StreamGraph(categoryStream) + RegionArcMap(regionArcs).
- **Reliability**: StatDelta tiles + Toplist(hotspots retransRate) + breaches table (Widget) + TimeSeries(nhi) + Swimlane(nhiSwimlanes) + Scatter(rttVsRetrans) + Heatmap(AZ×AZ retrans — reuse buildMatrix? or from hotspots) .
- **Latency**: StatDelta p50/p90/p95 + min + Distribution(distribution) + CategoryBars/bars(intra vs inter) + Toplist(slowest) + TimeSeries(trend) + Heatmap(hourHeatmap).
- **Dependencies**: Sankey(serviceGraph) + Toplist(ports) + Treemap(namespaces) + CategoryDonut(categories) + Icicle(pathTree) + Pareto(pareto).
- **DNS**: enabled? Toplist(topDomains, internal/external) + CategoryDonut(queryTypes) + Heatmap(failures ns×rcode) + Distribution(dns latency) + Sankey(resolution) ; not-enabled → guidance card. 
Tab selection in URL (?tab=cost). Each widget: empty-state + loading. Synced crosshair across a tab's TimeSeries via HoverSync.

- [ ] **Step 1: Implement** hub + tabs + i18n (all strings t(), ko+en). Use `usePolling(\`/api/analytics/<lens>?buckets=${rangeToBuckets(filters.range)}\`)`.
- [ ] **Step 2: Verify** — `npx -w app vitest run` green (existing insights test updated/removed); `npx -w app tsc --noEmit` clean; `npm -w app run build` succeeds.
- [ ] **Step 3: Headless** (chromium): `AUTH_DISABLED=1 npm -w app run dev` PORT 3034 → `/insights`: assert `filter-bar` + tab strip; each of the 5 tabs renders its widgets without console error on LIVE data (cost/reliability/dependencies/dns have data; latency may be empty→empty-states); switching a filter (e.g. range) refetches; light+dark; iPhone 390×844 no h-scroll. Record per-tab pass/fail + console errors. Kill dev.
- [ ] **Step 4: Commit** `feat(app): insights 5-tab analytics hub (Datadog composition)`.

---

## Task 5: per-monitor pages + nav

**Files:** Create `app/src/app/api/monitors/route.ts`, `app/src/app/api/monitors/[name]/route.ts`, `app/src/app/monitors/page.tsx`, `app/src/app/monitors/[name]/page.tsx`; Modify `app/src/components/layout/{Sidebar,MobileTabs}.tsx` (+`nav.monitors`), `app/src/lib/ddb.ts` (helpers if needed), i18n.

**Interfaces:**
- `/api/monitors` → `{ monitors: { name, cluster?, nhi: 0|1|null, dataTransferred: number, spark: number[] }[] }` — list of NFM monitors (from MONITORS env or discovered via getNfmMetrics dimensions), each with latest NHI (CW HealthIndicator) + recent traffic + a sparkline. `/api/monitors/[name]` → `{ name, nhi, traffic:{dataTransferredAvg, retransmissionsSum, timeoutsSum, rttMin}, nhiTimeline:Series, series:{...} }` (AWS traffic-summary semantics §15.4).
- `/monitors` page: list (Card per monitor: name + NHI StatusBadge + traffic sparkline) → link to `/monitors/[name]`.
- `/monitors/[name]` page: two tabs — **Overview** (NHI status card + 4 traffic-summary tiles via StatDelta[avg/sum/sum/min] + NHI band(TimeSeries or Swimlane) + data-transferred TimeSeries + "View in CloudWatch" deep link) + **Historical explorer** (per-metric flow tables from `/api/flows?monitor=<name>`; columns Category/Local·Remote endpoints/value; row click → HopPath panel for that flow's edge). 
- Nav: add "모니터/Monitors" to Sidebar + MobileTabs.

- [ ] **Step 1: Implement** routes + pages + nav + i18n (t(), ko+en). Reuse StatDelta/StatusBadge/TimeSeries/Swimlane/HopPath/FlowTable patterns.
- [ ] **Step 2: Verify** — full suite green; tsc clean; build succeeds.
- [ ] **Step 3: Headless** PORT 3035 → `/monitors`: list renders live monitors (nfm-eks-* + nfm-vpc-all) with NHI badges; click one → `/monitors/[name]` Overview tab (traffic tiles + NHI) + switch to Historical explorer (flow table, row → hop-path). light/dark/iPhone, 0 console errors. Record. Kill dev.
- [ ] **Step 4: Commit** `feat(app): per-monitor pages (overview + historical explorer) + nav`.

---

## Phase 4 self-review checklist
- [ ] FilterBar drives all hub widgets (range→buckets, cluster/ns/category/metric) — Tasks 1,4.
- [ ] Datadog primitives (Widget/HoverSync/Toplist) used across hub — Tasks 2,4.
- [ ] reliability NHI now populated from CW; getFlowsWindow de-dups concurrent fetches; buckets param honored — Task 3.
- [ ] 5 tabs each render Phase-2 charts on live data with empty/loading states — Task 4 headless.
- [ ] per-monitor Overview (avg/sum/sum/min traffic + NHI) + Historical explorer (flow tables + row→HopPath) + nav — Task 5 headless.
- [ ] tokens-only, t() ko+en, mobile-safe, full suite green + build. App-only (redeploy Phase 6 or on request).

---

## Task 6 (added 2026-07-09, user directive): WhaTap-style NetworkGraph topology

**Why:** User supplied a concrete reference (WhaTap network-topology screenshot) and said "토폴로지는 [이미지]처럼 구현" — a force-directed node-link graph. This REPLACES TierFlowMap in the `/topology` "graph" view. Matrix view stays. TierFlowMap component may remain in tree (unused) or be removed if trivial; do NOT break matrix.

**Reference features to reproduce:** force-directed graph; nodes = circles **sized by traffic** (bigger = more bytes), colored by status (green/mint=ok, amber=warn, red=danger, gray=idle), **blue ring** on focused node; **self-loop** arc + byte label for source==target; **curved directional edges** with a byte label and arrowhead; edge style **solid when rate ≤ threshold, dashed when > threshold** (legend); LIVE header (timestamp from `generatedAt` + pause toggle that pauses polling); a **right-side tag filter panel** = search + "전체 선택" + per-node checkboxes with status dot + `Total N / Selected M` counts + 취소/적용 (draft→apply); zoom controls (reactflow `<Controls/>`).

**New dep:** `d3-force` + `@types/d3-force` (`npm i -w app d3-force @types/d3-force`) — layout only. (recharts already vendors most d3; d3-force is small.)

**Files:**
- Create `app/src/lib/topology-graph.ts` (+ `.test.ts`): pure model builder.
- Create `app/src/components/topology/NetworkGraph.tsx`: reactflow custom circle nodes + curved labeled edges + d3-force layout hook + `<Controls/>`. testid `network-graph`.
- Create `app/src/components/topology/TagFilterPanel.tsx` (+ smoke): draft/apply node selector. testid `tag-filter-panel`.
- Create `app/src/components/topology/GraphLegend.tsx` (or inline): LIVE + pause + solid/dashed legend. testid `graph-legend`.
- Modify `app/src/app/topology/page.tsx`: graph view → NetworkGraph; right panel in graph mode → TagFilterPanel (matrix mode keeps TopEdgesPanel); add `selectedIds` + `paused` state + legend/LIVE header. Edge click → existing EdgeHopPanel; node click → focus ring.
- Modify `app/src/lib/use-polling.ts`: add optional `enabled = true` 3rd param (when false: skip fetch + interval, keep last data) for pause. Backward-compatible.
- i18n: `topology.viewGraph` exists; add `graph.*` keys (live, paused, pause, resume, selectedTags, selectAll, apply, cancel, total, selected, searchTag, legendSolid, legendDashed, selfLoop) ko+en.

**Model interface (produce):**
```ts
export interface GraphNode { id:string; label:string; kind:TopoNode['kind']; radius:number; traffic:number; selfBytes:number; status:'ok'|'warn'|'danger'|'idle'; }
export interface GraphLink { id:string; source:string; target:string; value:number; rate:number; dashed:boolean; category:DestCategory; }
export interface GraphModel { nodes:GraphNode[]; links:GraphLink[]; total:number; selected:number; }
export interface BuildGraphOpts { metric?:MetricName; windowSeconds?:number; rateThreshold?:number; selectedIds?:Set<string>|null; breaches?:Set<string>; warns?:Set<string>; radiusRange?:[number,number]; }
export function buildGraphModel(topo:TopologySnapshot, opts?:BuildGraphOpts): GraphModel
```
Rules: metric default DATA_TRANSFERRED; value(edge)=edge.metrics[metric]??0; source==target → node.selfBytes (not a link); node.traffic = Σ incident link values + selfBytes; radius = sqrt-scale(traffic)→radiusRange (default [18,56], all-zero→min); status precedence danger>warn>(traffic==0?idle):ok; rate=value/(windowSeconds??300); dashed = rate>threshold(default 128); selectedIds non-empty → keep only those nodes + links with both ends kept; `total`=all topo nodes, `selected`=rendered node count.

**Steps:**
- [x] 1. `npm i -w app d3-force @types/d3-force`.
- [x] 2. Failing test `topology-graph.test.ts`: sizing monotonic+clamped; self-loop→selfBytes; dashed boundary (rate 128 solid / 129 dashed); selectedIds filter drops nodes+dangling links; status precedence; empty topo. RED.
- [x] 3. Implement `topology-graph.ts` → GREEN.
- [x] 4. Implement NetworkGraph (force layout via d3-force ~300 ticks memoized on node/link id set; reactflow nodes draggable; curved bezier edges + labels + arrow + dashed; self-loop; focus ring; empty-state) + TagFilterPanel (draft/apply) + GraphLegend + use-polling `enabled`. Component smoke tests for TagFilterPanel (toggle, select-all, search, apply calls onChange with draft; cancel resets).
- [x] 5. Wire /topology page. `npx -w app vitest run` green; `npx -w app tsc --noEmit` clean; `npm -w app run build` OK.
- [x] 6. Headless (chromium, `~/.cache/ms-playwright/chromium_headless_shell-1228`): `AUTH_DISABLED=1 npm -w app run dev` PORT 3036 → `/topology`: assert `network-graph` renders circles sized differently on live data; `graph-legend` + LIVE + pause toggles polling; `tag-filter-panel` — uncheck a node + 적용 → that node disappears from graph; edge click → `edge-hop-panel`; toggle to matrix → `adjacency-matrix` still works. light/dark/iPhone 390×844 no h-scroll, 0 console errors. Kill dev.
- [x] 7. Commit `feat(app): WhaTap-style force-directed network topology graph`.
