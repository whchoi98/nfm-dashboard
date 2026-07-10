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

---

## ADDENDUM (2026-07-10, user directives): Workload Insights page, monitor-detail enrichment, version label

Two user requests after screenshot analysis (screenshots/NFM_*.png, nfm_monitor_*.png, *workload_insight*.png = AWS NFM Workload-Insights + Monitor-detail console views). Decisions: version **v1.0.0**; Workload Insights = **new /workload menu page**.

### Task 5 (EXTENDED) — footer removal + version label + CHANGELOG + DNS skeleton
- In addition to removing `FooterAttribution` (AppShell): create `CHANGELOG.md` (Keep-a-Changelog format) with top entry `## [1.0.0] - 2026-07-10` summarizing the shipped dashboard (Phases 1-5). Create `app/src/lib/version.ts` `export const APP_VERSION = '1.0.0'` (single source; keep in sync with CHANGELOG top + app/package.json version→1.0.0). Add a version label at the **Sidebar bottom** (mt-auto) under the "NFM Dashboard" brand: `NFM Dashboard v{APP_VERSION}` (small, muted, token). Mobile: also surface in the MobileTabs "more"/settings area or the Topbar if sensible (optional). Keep README attribution (do not touch). Remove `footer.attribution` from ko+en (parity).

### Task 7 — Workload Insights page (/workload)
**Files:** Create `app/src/app/workload/page.tsx`, `app/src/app/api/workload/route.ts` (or reuse an existing WI reader), `app/src/components/workload/*` as needed; add nav item; i18n.
**Data:** `WI#latest/all` (WiResult { metric; category; rows: WiRow[] }; WiRow { accountId?, localSubnetId?, localAz?, localVpcId?, remoteIdentifier?, value? }) via a ddb reader (getWorkloadInsights — check lib/ddb.ts; add if missing). Per-AZ/overall timeseries from getNfmMetrics.
**UI (AWS Workload-Insights parity):** a **flow-type/category selector** (our 7 DestCategory + 'all'); per-metric sections (DATA_TRANSFERRED, RETRANSMISSIONS, TIMEOUTS, ROUND_TRIP_TIME) each = a `TimeSeries` (per-AZ or overall) + a **Top Contributors table** (columns: subnet / AZ / VPC / local region / account / remote resource / category / value; filter box + pagination via existing table patterns). Reuse FlowTable-style table or a compact table; empty-states (RTT sparse). testids `workload-page`, `workload-metric-<name>`, `workload-contributors`. nav `nav.workload` (icon e.g. Layers/Boxes). t() ko+en. Deep-link "상위 기여자" rows are informational (no drilldown required v1).

### Task 8 — /monitors/[name] detail enrichment
**Files:** Modify `app/src/app/monitors/[name]/page.tsx` (+ a small NhiBand component if needed).
- **NHI striped band**: render the monitor's NHI timeline as a horizontal **hatched band** (정상=accentMint hatch / 저하됨=chartViolet-or-danger hatch) across the window (AWS style), replacing/augmenting the current NHI viz. Legend 정상/저하됨.
- **Per-chart CloudWatch links**: on each metric chart (data transferred, retransmissions/timeouts, RTT) add "지표에서 보기 / View in metrics" + "Create an alarm" links (reuse `lib/cloudwatch-url.ts` from Task 1; alarm link = CloudWatch create-alarm console URL for that NFM metric/monitor — best-effort). t() ko+en.
- Keep existing tiles + historical explorer + HopPath (already matches AWS "Network path" stepper).

### Revised order: T1→T2→T3→T4→T5(extended)→T7→T8→T6(final verify+review+deploy LAST).

---

## Task 9 (user directive: include all NFM flow categories) — WI collector category expansion + DestCategory widening + collector redeploy

**Verified via live API:** StartQueryWorkloadInsightsTopContributors `destinationCategory` accepts 11 values [INTRA_AZ, INTER_AZ, INTER_VPC, INTER_REGION, AMAZON_S3, AMAZON_DYNAMODB, UNCLASSIFIED, INTERNET, AWS_SERVICE, TRANSIT_GATEWAY, LOCAL_ZONE]. Bundled SDK enum is stale (7) — the wire accepts the strings. Collector currently queries only CORE 3.

**Files:** collector/src/{wi-query,categories,types}.ts (+tests), app/src/lib/types.ts (DestCategory), app/src/lib/chart-tokens.ts (CATEGORY_COLORS + CATEGORY_ORDER), app/src/lib/i18n/translations/{ko,en}.json (category.*), any exhaustive Record<DestCategory,...>. Deploy: rebuild collector + `cdk deploy NfmDash-Data` (SUBJECT TO USER AUTHORIZATION).
- Widen `DestCategory` 7→11 (both collector + app copies stay identical) adding INTERNET, AWS_SERVICE, TRANSIT_GATEWAY, LOCAL_ZONE.
- wi-query.ts: widen `WiCategory`/`CATEGORIES` to all 11; cast the SDK command's `destinationCategory` (SDK type stale). 3 metrics × 11 = 33 async query lifecycles/cycle — assess the existing concurrency limiter + Lambda timeout: if it fits, query all 11 every cycle (freshest); ELSE rotate (CORE every cycle + rest every Nth) AND merge-preserve into WI#latest (store per metric×category so a rotation cycle does not drop previously-collected categories — change handler storage from overwrite to merge if rotating).
- chart-tokens: add 4 colors (distinct, CVD-aware) + append to CATEGORY_ORDER. i18n: category.INTERNET='인터넷'/'Internet', category.AWS_SERVICE='AWS Service', category.TRANSIT_GATEWAY='Transit Gateway', category.LOCAL_ZONE='Local Zone' (ko+en). Fix any exhaustive DestCategory switch/Record (insights route, analytics category maps).
- Tests: wi-query collects 11 categories (or rotates correctly + merges); app tsc/build compiles with widened union. Collector `npm -w collector run build` compiles (SDK-cast ok).
- This lands BEFORE the final app deploy so WI#latest accumulates the 11 categories over cycles; T7 /workload then shows them.
