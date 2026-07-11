# Phase 9 — Datadog-CNM Beautify & Deeper Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps `- [ ]`. All subagents Fable 5.

**Goal:** Beautify the dashboard toward Datadog Cloud Network Monitoring's dense, refined aesthetic and deepen visibility with (1) a **Network Analytics** view (source-scope → dest-scope aggregation with a metric toggle, inline sparklines, health coloring, drill-down — CNM's signature), (2) a **global visual polish** pass, (3) a reusable **faceted filter rail** + drill-down pivots, and (4) **topology graph** edge-health coloring + metric toggle.

**Architecture:** New `/network` menu (page + pure `network-analytics` lens + route) reusing `aggregate.entityKey`; a reusable `FacetRail` + `Sparkline` component; token/CSS-level polish (low-regression, applied via `chart-tokens.ts` + `globals.css` + shared `Widget`/`Card`/table chrome); NetworkGraph edge coloring by retransmit rate. No collector change.

**Tech Stack:** Next 16 App Router, existing charts + reactflow topology, Tailwind v4 tokens, vitest.

## Global Constraints

- All visible strings via `t()` ko+en (parity). SnowUI tokens only, theme-aware, mobile-safe (no page h-scroll at 390px; wide tables/maps scroll in-container). Pre-sort ranked lists.
- Lenses/pure helpers TDD. Routes force-dynamic + try/catch→500 + reuse the analytics param helper + `getFlowsWindow`/`getFlowsWindowPair`. Reuse `bytesToUsd`/`ratePerGb`/`entityKey`/`percentile` — no forks.
- **Visual polish = LOW-REGRESSION**: prefer token/`globals.css`/shared-component changes over per-page rewrites; do NOT change existing testIds, page data, or e2e contract (kpi-dataTransferred/nhi-badge/agents-table/chat-*). Headless before/after check that existing pages still render + no h-scroll.
- App-only. Version bump **1.3.0** at the end. conventional commits + Claude-Session trailer. Serial (nav.ts + i18n + tokens are shared). dev branch → merge → deploy (app, user-authorized).

## CNM reference (what we adopt)

Datadog CNM: a directed network map aggregated by tags; source↔dest aggregation of connection metrics (volume/throughput, TCP retransmits, RTT, connection health) with drill-down/pivot to logs/traces; dense dark faceted UI. We map: source scope → dest scope over our NFM flows; metrics = volume (DATA_TRANSFERRED bytes), throughput (bytes/s), retransmits (RETRANSMISSIONS count + per-GB rate = health), RTT (avg); pivot → our /flows, /paths, /topology, /insights?tab=dns.

## Task sequence (serial)

| # | Task | Deliverable |
|---|---|---|
| 1 | Network Analytics lens + route | network-analytics.ts + /api/network |
| 2 | Network Analytics page + FacetRail + Sparkline | /network + FacetRail + Sparkline + nav |
| 3 | Global visual polish | tokens/globals.css/Widget/Card/table density + Sparkline in tables |
| 4 | Topology graph beautify | NetworkGraph edge health coloring + metric toggle |
| 5 | Finalize | review + v1.3.0 + deploy + smoke |

---

## Task 1: Network Analytics lens + route

**Files:** Create `app/src/lib/analytics/network-analytics.ts` (+test), `app/src/app/api/network/route.ts`.

**Interface:**
```ts
export type Scope = 'service'|'namespace'|'subnet'|'az'|'vpc'|'category'|'monitor';
export interface NetPair { source: string; dest: string; bytes: number; throughput: number; // bytes/s
  retransmissions: number; retransRate: number; // per GB
  rtt: number|null; health: 'ok'|'warn'|'danger'; spark: number[]; }  // spark = selected-metric per-bucket
export interface NetworkAnalyticsResult { pairs: NetPair[]; totalBytes: number; totalRetrans: number;
  sourceScope: Scope; destScope: Scope; metric: 'volume'|'throughput'|'retransmits'|'rtt'; }
export function networkAnalyticsLens(flows: FlowEdge[], opts: { sourceScope: Scope; destScope: Scope;
  metric?: 'volume'|'throughput'|'retransmits'|'rtt'; windowSeconds?: number; buckets?: string[]; topN?: number;
  retransThreshold?: number }): NetworkAnalyticsResult
```
Rules: scopeKey(endpoint, scope) — reuse `entityKey` for service/namespace/az/vpc; subnet=subnetId; category=flow category; monitor=flow.monitor. For each (source scope of `a`, dest scope of `b`) pair, aggregate: bytes (DATA_TRANSFERRED), retransmissions (RETRANSMISSIONS), rtt (avg of ROUND_TRIP_TIME, null if none). throughput = bytes/windowSeconds. retransRate = ratePerGb(retransmissions, bytes). health = danger/warn/ok by retransRate vs retransThreshold (default 10 events/GB; warn at half). spark = per-bucket value of the SELECTED metric (needs `buckets` to bucketize — if omitted, spark = []). Rank pairs by the selected metric desc, cap topN (default 50). Skip self-pairs where source===dest ONLY if scopes equal AND you want to (keep them; they're intra-scope). TDD: scope keying per scope, pair aggregation, retransRate/health thresholds, throughput scaling, rtt null, spark per-bucket, ranking+cap, empty→{pairs:[]}.

- [ ] Steps: TDD lens RED→GREEN → route (force-dynamic; parse buckets/namespace/category + `?src=&dst=&metric=`; windowSeconds=buckets×300; pass recentBuckets for spark) → `vitest`/tsc/build → Commit `feat(app): network analytics lens + route (source→dest aggregation)`.

---

## Task 2: Network Analytics page + FacetRail + Sparkline

**Files:** Create `app/src/app/network/page.tsx`, `app/src/components/analytics/FacetRail.tsx`, `app/src/components/charts/Sparkline.tsx`; Modify `app/src/components/layout/nav.ts`; i18n.

- `Sparkline({ values, className?, color? })` — a tiny inline SVG sparkline (no axes), token-colored, empty-safe. testid `sparkline`. (Reused in Task 3 tables too.)
- `FacetRail({ facets, selected, onChange })` — a left rail of facet groups (each: label + options with counts + checkbox/radio); collapses to a top sheet on mobile. `facets: { key, label, options: {value,label,count}[] }[]`. testid `facet-rail`. Reusable.
- `/network` page ('use client'): source-scope + dest-scope `Select`s (Scope options), a metric toggle (volume/throughput/retransmits/rtt), a `FacetRail` (namespace/cluster/category/monitor built from the data) filtering the fetch (namespace/category → query params), and a **source→dest table**: columns source | dest | value (selected metric, formatted) | retrans% (health-colored chip) | RTT | `Sparkline`. Rows sorted by metric; row click → drill-down (pivot to `/flows?ns=` or `/topology` or `/paths` per the scope). LensState empty/loading. testid `network-page`. Dense, CNM-style, mobile-safe.
- nav: `{ href:'/network', key:'nav.network', icon: Waypoints }` (lucide Waypoints or Share2). i18n `nav.network` (ko '네트워크 분석' / en 'Network') + scope/metric/column labels + facet labels ko+en.
- [ ] Steps: Sparkline + FacetRail (+smoke) → /network page (usePolling `/api/network?src=&dst=&metric=` + lensQuery) → nav + i18n → `vitest`/tsc/build → Commit `feat(app): network analytics page (source→dest) + facet rail + sparkline`.

---

## Task 3: Global visual polish (Datadog-dense aesthetic) — LOW REGRESSION

**Files:** Modify `app/src/lib/chart-tokens.ts` + `app/src/app/globals.css` + `app/src/components/analytics/Widget.tsx` + `app/src/components/ui/Controls.tsx` (Card) + `app/src/components/FlowTable.tsx` (density + Sparkline column, additive). i18n only if new strings.

- Refine the visual system toward Datadog's dense-refined dark look WITHOUT changing data/testIds: tighter card padding scale, subtle 1px token borders on cards/tables, refined table row height + zebra/hover, consistent section header typography, refined muted/secondary text tokens, refined focus states. Do it via `globals.css` utility classes + token tweaks + `Widget`/`Card` chrome so it applies broadly.
- Add an optional inline `Sparkline` (Task 2) into `FlowTable` (a small trend column) and the monitors/workload tables where a per-row series is cheaply available — ADDITIVE (guard behind data availability; don't break existing columns/sort/testIds).
- Polish empty/loading states (LensState) to a consistent refined skeleton style.
- Keep light + dark both first-class; verify contrast. Do NOT restyle into force-dark.
- [ ] Steps: apply token/CSS/chrome polish → (smoke) → `vitest`/tsc/build. Headless before/after: existing pages (overview/insights/topology/monitors/flows) still render, no h-scroll at 390px, light+dark, 0 console errors, testIds intact. → Commit `style(app): datadog-dense visual polish (tokens, card/table chrome, sparklines, refined empty states)`.

---

## Task 4: Topology graph beautify

**Files:** Modify `app/src/components/topology/NetworkGraph.tsx` (+ topology page toggle if needed); i18n.

- Add **edge health coloring** by retransmit rate (the topology edges already carry metrics; compute retrans-per-GB per edge → color ok/warn/danger via STATUS, layered with the existing dashed-by-throughput). A legend entry for health.
- Add a **metric toggle** affecting edge width/label (volume/retransmits/rtt) if the topology page doesn't already have the metric selector wired to the graph (it has a metric Select — ensure the graph reflects it for width + health).
- Refine visuals toward CNM: cleaner node/edge styling, refined labels, consistent with the Task-3 polish. Keep the existing TagFilterPanel + hop-path + matrix toggle intact.
- [ ] Steps: implement edge-health coloring + metric reflection + refinement → (smoke) → `vitest`/tsc/build → Commit `feat(app): topology graph edge-health coloring + metric-aware styling`.

---

## Task 5: Finalize — review + v1.3.0 + deploy

- [ ] Step 1: Full suite green; tsc clean; build. Confirm /network nav + pages route; existing pages unregressed.
- [ ] Step 2: Final whole-branch adversarial review (network-analytics lens correctness, empty/sparse safety, FacetRail/Sparkline, VISUAL-POLISH REGRESSION [existing pages/testIds/mobile/contrast], topology coloring, i18n parity, tokens) → fix Critical/Important.
- [ ] Step 3: Version bump **1.3.0** (version.ts + package.json + CHANGELOG [1.3.0] EN+KR + ref links). version.test passes.
- [ ] Step 4: Merge to main; build+push `<sha>`; `cdk deploy NfmDash-App -c imageTag=<sha>` (USER-AUTHORIZED). Verify health/302/ECS/tag; headless prod smoke: /network (source→dest + facets + sparklines + drill-down), topology edge-health, the visual polish on existing pages, mobile/dark.

---

## Phase 9 self-review checklist
- [ ] Network Analytics (source→dest aggregation, metric toggle, sparklines, health, drill-down) — T1/T2.
- [ ] FacetRail + Sparkline reusable components — T2 (+T3 table sparklines).
- [ ] Global visual polish — no regression to existing pages/testIds/mobile/contrast — T3.
- [ ] Topology edge-health coloring + metric-aware styling — T4.
- [ ] /network nav; pure lenses TDD; empty/sparse safe; i18n ko+en; tokens; mobile; light+dark.
- [ ] v1.3.0 synced; full suite + build green; review clean; deployed + prod smoke — T5.
