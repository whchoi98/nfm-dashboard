# Phase 6 — Page Enrichment + Footer Removal + Final Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps `- [ ]`. All subagents Fable 5.

**Goal:** Enrich the four remaining primary pages (overview `/`, flows `/flows`, paths `/paths`, agents `/agents`) using the analytics lenses, chart components, and Datadog primitives built in Phases 2-5; remove the bottom SnowUI attribution footer (attribution stays in README); then final rebuild/redeploy + E2E.

**Architecture:** Reuse existing building blocks — do NOT rebuild the /insights hub or /monitors. Overview/paths consume only a FEW lens fields and deep-link to the hub (`/insights?tab=`) for detail. Overview KPIs move to §15.4 traffic-summary semantics (DataTransferred **avg**, Retrans/Timeouts **sum**, RTT **min** + p50/p95) with delta% + sparkline via `StatDelta`. Preserve every e2e testId contract.

**Tech Stack:** Next 16 App Router, React 19, existing chart components + analytics APIs, Tailwind v4 tokens, vitest + Playwright e2e.

## Global Constraints

- All visible strings via `t()` with BOTH ko + en keys (flat JSON). **i18n parity test (`i18n.test.tsx`) checks ko/en key match** — add AND remove keys in both files together; mind trailing commas on the last key.
- SnowUI tokens only, no hardcoded hex, theme-aware light/dark (fixing dark KPI pastel contrast is part of the StatDelta transition).
- **PRESERVE e2e testId contracts**: `kpi-dataTransferred`, `kpi-retransmissions`, `kpi-timeouts`, `kpi-rtt`, `nhi-badge`, `agents-table`, `chat-input`/`chat-send`/`chat-assistant-msg`. `StatDelta`'s default testId is `stat-<slug>` and a Korean label slugs to empty — so ALWAYS pass an explicit `testId` when replacing a KpiCard.
- Do NOT modify README (it retains the CC BY attribution). Do NOT touch mcp-client/bedrock/infra stacks.
- KPI semantic change (sum→avg for transferred, min for RTT) is intentional per §15.4; only a genuine null renders "—"; RTT is frequently sparse → empty states required.
- App-only phase. Conventional commits + Claude-Session trailer. dev branch `dev/phase6-enrichment` → merge → redeploy (final, from main; deploy subject to user authorization).

## Existing building blocks (reuse — do NOT rebuild)

```ts
// Charts: StatDelta({label,value,unit?,deltaPct?,trend?,spark?,status?,testId?}), TimeSeries, Toplist,
//   CategoryDonut, CategoryBars, StreamGraph, Distribution, Gauge, Treemap, Sankey, Heatmap, Scatter, Pareto, Icicle.
// Datadog primitives: Widget, HoverSyncProvider/useHoverSync, Toplist, FilterBar (analytics/).
// Analytics APIs: /api/analytics/{cost,reliability,latency,dependencies,dns} (?buckets=&namespace=&category=).
//   cost→{totalUsd,byCategory,top:CostRow[],series,regionArcs,stream}; reliability→{hotspots,breaches,nhi,nhiSwimlanes,scatter};
//   latency→{overall,intra,inter,slowest,trend,distribution:RttBin[],hourHeatmap}; dependencies→{sankey,ports,namespaces,categories,hops:{type,count}[],pathTree,pareto}; dns→DnsAggregate.
// lib/monitors.ts: trafficSummary() pattern (avg/sum/sum/min + rttP50/P95). lib/ddb.ts: getFlowsWindow(12) (10s in-flight cache), recentBuckets, queryFlowsByBucket, getCoverage, getCollectionStatus.
// lib/cw-metrics.ts: getNfmMetrics(minutes). Analytics lenses in lib/analytics/{cost,reliability,latency,dependencies}.ts (pure).
// Components: KpiCard, StatusBadge({value,testId}), CollectionStatusCard, FlowTable(+CategoryChip,FlowDrawer), TopEdgesPanel, HopPath, monitors/[name] cloudWatchUrl().
// insights/tabs/shared.tsx: LensState fetch pattern, formatUsd, lensQuery.
// i18n: useLanguage().t; translations/{ko,en}.json.
```

## Current pages (modify)

```
app/src/app/page.tsx (overview): KpiCard×4 (kpi-* testIds) + StatusBadge(nhi-badge) + TimeSeries + CollectionStatusCard + coverage dl. API /api/overview = topology-edge SUM KPIs (RTT avg) + getNfmMetrics(60) + status + coverage. NO delta/spark/lenses.
app/src/app/flows/page.tsx: filter form + FlowTable ×2 cards. /api/flows?bucket= (single bucket) or pod mode. NO viz.
app/src/app/paths/page.tsx: pod-pair picker + ?edge=→HopPath; unselected → TopEdgesPanel only. /api/topology + /api/paths.
app/src/app/agents/page.tsx: KpiCard×4 + standalone table (agents-table) + CollectionStatusCard. /api/agents = getCoverage + getCollectionStatus (latest only). Static.
app/src/components/layout/AppShell.tsx: FooterAttribution() at L10-24, used at L42. i18n key footer.attribution (ko.json+en.json ~L254, last key).
```

## Task sequence

| # | Task | Deliverable |
|---|---|---|
| 1 | Overview enrichment (API + page) | /api/overview, page.tsx, StatDelta+delta/spark, top talkers, breaches, CW link |
| 2 | Flows aggregate strip | flows/page.tsx (Toplist+CategoryDonut+time bars) |
| 3 | Paths default content | paths/page.tsx (recent + RTT Distribution + hop usage) |
| 4 | Agents gauges + cycle sparkline | ddb getCollectionHistory, /api/agents, agents/page.tsx |
| 5 | Footer removal + DNS tab loading skeleton | AppShell.tsx, i18n, DnsTab.tsx |
| 6 | Final verify + rebuild/redeploy + E2E | full suite, build, deploy, prod smoke |

---

## Task 1: Overview enrichment (API + page)

**Files:** Modify `app/src/app/api/overview/route.ts`, `app/src/app/page.tsx`; Create `app/src/lib/cloudwatch-url.ts` (extract from monitors/[name]); i18n keys.

**Interfaces (produce):**
```ts
// /api/overview response:
interface OverviewData {
  kpis: Record<'dataTransferred'|'retransmissions'|'timeouts'|'rtt', { value: number|null; deltaPct: number|null; spark: number[] }>;
  rttP50: number|null; rttP95: number|null; nhi: number|null;
  topTalkers: { label: string; usd: number; bytes: number }[];   // costLens().top (top ~6)
  breachCount: number;                                            // reliabilityLens().breaches.length
  series: Record<string, NfmSeries>;                              // existing per-monitor DataTransferred
  status: CollectionStatus|null; coverage: Coverage|null;
}
// lib/cloudwatch-url.ts: export function cloudWatchMetricsUrl(opts:{region?:string; monitor?:string}): string;
```
**Rules:** KPI values via §15.4 semantics from `getNfmMetrics()` (DataTransferred=avg of series values, Retrans/Timeouts=sum, RTT=min; rttP50/P95 via percentile). deltaPct = compare latest-half vs prior-half window. spark = the per-bucket values array. topTalkers from `costLens(getFlowsWindow(12)).top`. breachCount from `reliabilityLens(...).breaches.length`. Reuse the 10s-cached `getFlowsWindow(12)`.

- [ ] **Step 1:** Extract `cloudWatchMetricsUrl` into `lib/cloudwatch-url.ts` (from monitors/[name] `cloudWatchUrl()`); re-point that page to import it (no behavior change).
- [ ] **Step 2:** Extend `/api/overview` per OverviewData (keep it a single JSON response; force-dynamic; try/catch→500). Add a tiny unit test for the delta/spark reducer if extracted as a pure fn (TDD it).
- [ ] **Step 3:** Rewrite `page.tsx`: replace `KpiCard`×4 with `StatDelta`×4 — **pass explicit `testId="kpi-dataTransferred|kpi-retransmissions|kpi-timeouts|kpi-rtt"`**, value formatted (formatBytes/formatCount/formatMicros), `deltaPct`, `spark`; RTT tile shows p50/p95 sub + "—" only when null. Keep `StatusBadge testId="nhi-badge"`. Add a `Toplist` of topTalkers (Widget, link to `/insights?tab=cost`), a breaches `StatDelta` (status warn/danger by count, link `/insights?tab=reliability`), and a CloudWatch deep link. Wrap the traffic `TimeSeries` in `HoverSyncProvider`. Bento grid (grid-cols-1 md:grid-cols-2 xl:grid-cols-3), mobile-safe. Keep CollectionStatusCard + coverage.
- [ ] **Step 4:** `npx -w app vitest run` green; `tsc --noEmit`; `npm -w app run build`. (Update the overview test if one exists.)
- [ ] **Step 5:** Commit `feat(app): overview enrichment (StatDelta deltas + sparklines, top talkers, breaches, CloudWatch link)`.

---

## Task 2: Flows aggregate strip

**Files:** Modify `app/src/app/flows/page.tsx`; i18n keys.

**Rules:** Add a widget row ABOVE the FlowTable (md:grid-cols-3), keep the filter form + FlowTable unchanged: (a) client-side useMemo Top-N talkers over the CURRENT result set → `Toplist` (sorted desc); (b) category byte distribution over the result set → `CategoryDonut` (Record<DestCategory,number>); (c) time-of-day activity → `CategoryBars` or a small `StreamGraph` fed by `/api/analytics/cost` `stream` (server-cached). Empty-states when no rows. Mobile: strip stacks above the table, no fixed widths, no page h-scroll.

- [ ] **Step 1:** Implement the strip (reuse Toplist/CategoryDonut/CategoryBars; derive aggregates client-side from the loaded flows for (a)(b); fetch cost stream for (c)). i18n ko+en.
- [ ] **Step 2:** Component/smoke test if practical (aggregation useMemo pure part testable). `vitest run` green; `tsc`; build.
- [ ] **Step 3:** Commit `feat(app): flows aggregate strip (top talkers, category mix, activity)`.

---

## Task 3: Paths default content (unselected state)

**Files:** Modify `app/src/app/paths/page.tsx`; i18n keys.

**Rules:** When no edge selected, render a grid: keep `TopEdgesPanel` (popular paths); add **Recent lookups** — on `selectEdge()` push `{edgeId,label,ts}` to sessionStorage `nfm-recent-paths` (max 5), render clickable list → selectEdge; **overall RTT distribution** from `/api/analytics/latency` `distribution: RttBin[]` → `Distribution` (empty-state when RTT sparse — REQUIRED); **hop composition** from `/api/analytics/dependencies` `hops: {type,count}[]` → `Toplist`. Lens fetches mount only in the unselected state (mirror the existing conditional-mount pattern). Selected state (HopPath) unchanged.

- [ ] **Step 1:** Implement recent-lookups (sessionStorage) + Distribution + hop Toplist in the unselected branch. i18n ko+en. Empty-states.
- [ ] **Step 2:** `vitest run` green; `tsc`; build.
- [ ] **Step 3:** Commit `feat(app): paths default content (recent lookups, RTT distribution, hop composition)`.

---

## Task 4: Agents gauges + cycle sparkline

**Files:** Modify `app/src/lib/ddb.ts` (add `getCollectionHistory`), `app/src/app/api/agents/route.ts`, `app/src/app/agents/page.tsx`; i18n keys; test in `ddb.test.ts`.

**Interfaces:** `getCollectionHistory(n=24): Promise<CollectionStatus[]>` — Query `pk='STATUS#collect'`, exclude `sk='latest'`, newest-first, limit n (collector writes `STATUS#collect/<cycleTs>` history rows). `/api/agents` response adds `history: CollectionStatus[]`.

**Rules:** Add two `Gauge`s (policyAttached rate, tagged rate — value/max + status thresholds) + a cycle sparkline (`StatDelta` spark or a small spark over `history` `stats.rows` or `succeeded`). Convert the KpiCard×4 to `StatDelta` (static values → omit deltaPct; **explicit testIds if any are referenced by tests** — check; agents KpiCards are not in the e2e contract but verify). KEEP `agents-table` testId + the table + CollectionStatusCard.

- [ ] **Step 1:** Failing test for `getCollectionHistory` (mock ddb Query → returns n newest non-latest rows). FAIL → implement → PASS.
- [ ] **Step 2:** Extend `/api/agents` + rewrite `agents/page.tsx` (Gauges + sparkline + StatDelta tiles). i18n ko+en. Preserve agents-table.
- [ ] **Step 3:** `vitest run` green; `tsc`; build.
- [ ] **Step 4:** Commit `feat(app): agents coverage gauges + collection-cycle history sparkline`.

---

## Task 5: Footer removal + DNS tab loading skeleton

**Files:** Modify `app/src/components/layout/AppShell.tsx`, `app/src/lib/i18n/translations/{ko,en}.json`, `app/src/app/insights/tabs/DnsTab.tsx`.

- [ ] **Step 1:** Delete `FooterAttribution` (AppShell.tsx L10-24) + its usage (L42). Confirm layout intact (`<main>` already has `pb-20 lg:pb-4`). Remove `footer.attribution` from BOTH ko.json + en.json (last key — fix trailing comma). Do NOT touch README.
- [ ] **Step 2:** DnsTab: before the `if (!data?.enabled)` check, add a first-load guard — while `data === undefined` (loading) render a skeleton grid (`animate-pulse` token cards approximating the real layout), so `widget-dns-disabled` renders ONLY when loaded AND `enabled===false`.
- [ ] **Step 3:** If `KpiCard` is now unused anywhere (grep), leave it (harmless) or note; don't delete unless clearly orphaned. `vitest run` green (i18n parity test passes with the key removed from both); `tsc`; build.
- [ ] **Step 4:** Commit `feat(app): remove SnowUI footer attribution + DNS tab loading skeleton`.

---

## Task 6: Final verify + rebuild/redeploy + E2E

**Files:** none (verification + deploy).

- [ ] **Step 1:** Full suite `npx -w app vitest run` green; `tsc --noEmit`; `npm -w app run build`. Run the final whole-branch adversarial review → fix Critical/Important.
- [ ] **Step 2:** Merge `dev/phase6-enrichment` → main.
- [ ] **Step 3:** Build new SHA image (`scripts/build-push.sh <sha>`) + `cdk deploy NfmDash-App -c imageTag=<sha>` (SUBJECT TO USER AUTHORIZATION). Verify health 200 / 302 / ECS rev / image tag. (Ignore the spurious CFN "UPDATE_IN_PROGRESS" race; confirm via describe-stacks.)
- [ ] **Step 4:** E2E `scripts/smoke.sh` (Playwright 3 spec: login→`kpi-dataTransferred` visible, chat SSE, iPhone 390px no h-scroll) + headless prod smoke: overview shows deltas/sparklines/top-talkers, flows strip, paths default content, agents gauges, footer GONE, 5 insights tabs + topology still fine, 0 console errors, light/dark/mobile. 2× consecutive green.

---

## Phase 6 self-review checklist
- [ ] Overview: StatDelta delta+spark (kpi-* testIds preserved), §15.4 semantics, top talkers, breaches, CW link, nhi-badge — T1.
- [ ] Flows strip / Paths default content / Agents gauges+sparkline — T2/T3/T4.
- [ ] Footer removed (README untouched, i18n parity kept) + DNS skeleton — T5.
- [ ] e2e testId contract intact; i18n ko+en parity; tokens-only theme-aware; mobile-safe; RTT empty states.
- [ ] Full suite + build green; final review clean; deployed from main + prod smoke 2× — T6.
