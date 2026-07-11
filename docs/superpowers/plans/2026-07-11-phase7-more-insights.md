# Phase 7 — More Insights & Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps `- [ ]`. All subagents Fable 5.

**Goal:** Add four new derived-insight areas to the `/insights` hub — **Efficiency & Cost optimization**, **Reliability Scorecard / SLO**, **Top Movers (what changed)**, and **DNS deep-dive** — all computed from data already collected (NFM flows, CloudWatch metrics incl. HealthIndicator, DNS aggregate). Efficiency / Scorecard / Movers are NEW hub tabs; DNS deep-dive enriches the existing DNS tab.

**Architecture:** Each new insight = a pure lens (`app/src/lib/analytics/*.ts`, TDD) + a force-dynamic API route (`/api/analytics/*`) + a tab component (`app/src/app/insights/tabs/*Tab.tsx`) registered in the hub `TABS` array, reusing the existing `lensQuery`/`LensState`/`usePolling` pattern. No duplication of existing lenses; these expose metrics not yet surfaced.

**Tech Stack:** Next 16 App Router, existing chart components (StatDelta/Toplist/Gauge/CategoryBars/CategoryDonut/Distribution/Heatmap/TimeSeries) + Datadog primitives, analytics lenses, vitest.

## Global Constraints

- All visible strings via `t()` with BOTH ko + en keys (flat JSON); i18n parity. SnowUI tokens only, theme-aware, mobile-safe.
- Reuse the hub pattern: `TabProps = {filters}`, `usePolling<T>(\`/api/analytics/<x>${lensQuery(filters)}\`)`, `LensState` for loading/error/empty. Pre-sort Toplist rows. Register each new tab in `TABS` (`app/src/app/insights/tabs` + `page.tsx`).
- Lenses are PURE + TDD. Routes force-dynamic + try/catch→500 + reuse `getFlowsWindow` (10s cache) / `getNfmMetrics` / `getDns`.
- Billed categories (cost model): INTER_AZ, INTER_VPC, INTER_REGION are billed (`AZ_TRANSFER_USD_PER_GB`); INTRA_AZ + AWS-service categories free. Keep the existing cost model in `cost.ts` (reuse `bytesToUsd`).
- App-only phase (collector unchanged). Version bump to **1.1.0** (new features) at the end. conventional commits + Claude-Session trailer. dev branch → merge → deploy (app only, user-authorized).

## Existing interfaces (consume)

```ts
// app/src/lib/analytics/filters.ts: lensQuery(filters) → "?buckets=&namespace=&category="; rangeToBuckets(range)
// tabs/shared.tsx: TabProps {filters}; LensState({loading,error,empty?,children}); formatUsd(v)
// hub: app/src/app/insights/page.tsx TABS: { key, labelKey, Comp }[]  (append new tabs)
// lib/analytics/cost.ts: bytesToUsd(bytes,category), CostRow{key,label,bytes,usd,category}, byCategory:Record<DestCategory,{bytes,usd}>
// lib/analytics/reliability.ts: reliabilityLens(flows,cw), ratePer, ReliabilityRow, NhiSwimlane; Series{label,points:[{t,v}]}
// lib/analytics/aggregate.ts: entityKey(endpoint,kind), Series, percentile, sumByMetric
// lib/ddb.ts: getFlowsWindow(n=12) [10s cache], recentBuckets(n), queryFlowsByBucket(bucket), getDns()
// lib/cw-metrics.ts: getNfmMetrics(minutes) → Record<"<Metric>:<monitor>",NfmSeries{timestamps,values,monitor}>. HealthIndicator: 0=healthy,>0=degraded (Maximum).
// charts: StatDelta, Toplist, Gauge, CategoryBars, CategoryDonut, Distribution, Heatmap, TimeSeries; format.ts: formatBytes/formatCount/formatMicros
// dns: DnsAggregate {enabled, topDomains:{name,count,internal}[], failures:{key,label,nxdomain,servfail,total,failRate}[], latency:{p50,p90,p95,max,count}, queryTypes:{type,count}[], resolution:{nodes,links}, nameFlow:{ip,name}[]}
```

## Task sequence (serial — all touch the hub TABS + i18n)

| # | Task | Deliverable |
|---|---|---|
| 1 | Efficiency & Cost | efficiency lens + route + EfficiencyTab + register |
| 2 | Reliability Scorecard / SLO | scorecard lens + route + ScorecardTab + register |
| 3 | Top Movers | movers lens + route (2-window) + MoversTab + register |
| 4 | DNS deep-dive | extend dns route/tab (NXDOMAIN clients, int/ext ratio, slow resolvers, rcode breakdown) |
| 5 | Finalize | full review + v1.1.0 bump + deploy (app) + prod smoke |

---

## Task 1: Efficiency & Cost optimization

**Files:** Create `app/src/lib/analytics/efficiency.ts` (+ `.test.ts`), `app/src/app/api/analytics/efficiency/route.ts`, `app/src/app/insights/tabs/EfficiencyTab.tsx`; Modify `app/src/app/insights/page.tsx` (register), i18n.

**Interface (produce):**
```ts
export interface EfficiencyResult {
  totalBytes: number; billedBytes: number; freeBytes: number; billedRatio: number; // 0..1
  byCategory: Record<DestCategory, { bytes: number; usd: number }>;
  windowUsd: number; monthlyUsdRunRate: number;      // windowUsd scaled to 30 days
  topCrossAz: CostRow[];                              // billed contributors, desc by usd
  trend: Series;                                      // billed USD per bucket over the window
}
export function efficiencyLens(flows: FlowEdge[], opts?: { windowSeconds?: number }): EfficiencyResult
```
Rules: billed = INTER_AZ+INTER_VPC+INTER_REGION bytes (reuse cost `bytesToUsd`); free = the rest. billedRatio = billedBytes/totalBytes (0 when total 0). windowUsd = Σ bytesToUsd; monthlyUsdRunRate = windowUsd × (2592000 / windowSeconds) (windowSeconds default = buckets×300; pass from route via rangeToBuckets). topCrossAz = billed CostRow[] top ~8. trend = per-bucket billed USD.

- [ ] Step 1: Failing test `efficiency.test.ts`: billed/free split by category, billedRatio, monthly run-rate scaling (windowUsd × 2592000/windowSeconds), topCrossAz billed-only desc, empty→zeros no NaN.
- [ ] Step 2: FAIL → implement efficiency.ts → PASS.
- [ ] Step 3: route (force-dynamic, buckets/namespace/category via existing helper, windowSeconds = buckets×300) → efficiencyLens.
- [ ] Step 4: `EfficiencyTab.tsx`: `Gauge` (billed ratio %), `StatDelta` (monthly USD run-rate + window USD), `Toplist` (top cross-AZ talkers, valueFormatter=USD, sub=formatBytes), `CategoryBars`/`CategoryDonut` (billed vs free / by-category), `TimeSeries` (billed-USD trend). LensState. testid `insights-tab-efficiency`.
- [ ] Step 5: register in TABS (`insights.tab.efficiency`), i18n ko+en. `npx -w app vitest run efficiency` + full suite + tsc + build.
- [ ] Step 6: Commit `feat(app): insights efficiency & cost-optimization tab`.

---

## Task 2: Reliability Scorecard / SLO

**Files:** Create `app/src/lib/analytics/scorecard.ts` (+ test), `app/src/app/api/analytics/scorecard/route.ts`, `app/src/app/insights/tabs/ScorecardTab.tsx`; register + i18n.

**Interface:**
```ts
export interface MonitorScore { monitor: string; nhiAvailabilityPct: number|null; // % of HealthIndicator points ==0
  retransRate: number; timeoutRate: number; bytes: number; score: number; // 0..100 composite
  status: 'ok'|'warn'|'danger'; }
export interface ScorecardResult { monitors: MonitorScore[]; overall: { availabilityPct: number|null; score: number };
  breachTimeline: { t: string; count: number }[]; worst: ReliabilityRow[]; }
export function scorecardLens(flows: FlowEdge[], cw: { byMonitor?: Record<string, Series> }): ScorecardResult
```
Rules: nhiAvailabilityPct per monitor = fraction of HealthIndicator points equal to 0 (healthy) × 100 (null if no points). retransRate/timeoutRate per monitor = events per GB (reuse ratePerGb pattern) from flows grouped by monitor. score = weighted composite (e.g. 0.6×availability + 0.2×(1−normalizedRetrans) + 0.2×(1−normalizedTimeout), clamp 0..100) — document the formula. status by score thresholds. worst = lowest-score services (reuse ratePer). breachTimeline from the aggregate NHI series (count degraded monitors per t) — derive from cw.byMonitor.

- [ ] Step 1: Failing test: availabilityPct (healthy fraction), composite score formula + clamp, status thresholds, empty/no-cw → nulls no NaN.
- [ ] Step 2-3: implement lens + route (getFlowsWindow + getNfmMetrics→byMonitor HealthIndicator series, like the reliability route).
- [ ] Step 4: `ScorecardTab.tsx`: per-monitor scorecard cards/table (score + availability% + rates + status badge), `Gauge`(overall availability), breach timeline (`TimeSeries`/bars), worst-services `Toplist`. testid `insights-tab-scorecard`.
- [ ] Step 5: register (`insights.tab.scorecard`), i18n; tests+tsc+build.
- [ ] Step 6: Commit `feat(app): insights reliability scorecard / SLO tab`.

---

## Task 3: Top Movers (what changed)

**Files:** Create `app/src/lib/analytics/movers.ts` (+ test), `app/src/app/api/analytics/movers/route.ts`, `app/src/app/insights/tabs/MoversTab.tsx`; register + i18n; add `getFlowsWindowOffset` helper to ddb if needed.

**Interface:**
```ts
export interface Mover { key: string; label: string; metric: MetricName; current: number; prior: number; deltaPct: number|null; direction: 'up'|'down'|'flat'; }
export interface MoversResult { dataTransferred: Mover[]; retransmissions: Mover[]; timeouts: Mover[]; }
export function moversLens(current: FlowEdge[], prior: FlowEdge[], opts?: { topN?: number }): MoversResult
```
Rules: per entity (service kind via entityKey) sum each metric for current vs prior window; deltaPct = (current−prior)/prior×100 (null when prior 0 & current>0 → treat as new/▲∞ shown as "new"; both 0 → flat). Rank by absolute change (bytes/count), keep top N (default 8) per metric, split visually into increases/decreases. Prior 0 handling explicit.
Route: window n = rangeToBuckets(range); current = recentBuckets(n), prior = the n buckets BEFORE that (recentBuckets(2n) sliced). Add `ddb.getFlowsWindowRange(startIdx, count)` or compute in-route by querying recentBuckets(2n) per bucket and splitting by index. Respect namespace/category filters.

- [ ] Step 1: Failing test: per-entity current/prior deltas, prior-0 → "new", both-0 → flat, ranked by abs change, topN cap, direction.
- [ ] Step 2-3: implement lens + route (two windows).
- [ ] Step 4: `MoversTab.tsx`: three sections (traffic/retrans/timeouts), each a Toplist or two Toplists (top increases ▲ + top decreases ▼) with deltaPct + direction color (up=danger for retrans/timeout, neutral for traffic). testid `insights-tab-movers`.
- [ ] Step 5: register (`insights.tab.movers`), i18n; tests+tsc+build.
- [ ] Step 6: Commit `feat(app): insights top-movers tab (window-over-window deltas)`.

---

## Task 4: DNS deep-dive (enrich existing DNS tab)

**Files:** Modify `app/src/app/insights/tabs/DnsTab.tsx` (add widgets); optionally a small pure helper `app/src/lib/analytics/dns-insights.ts` (+ test); i18n. (DNS is a snapshot — NO time-trend without collector history; scope to snapshot-derivable deep insights and note trends as a follow-up.)

Add to the enabled DNS tab (reuse the existing `/api/analytics/dns` DnsAggregate; do NOT change the route contract):
- **Internal vs external ratio** — from `topDomains[].internal`: a Gauge/CategoryBars (internal% vs external%), + counts.
- **Top NXDOMAIN sources** — from `failures` (sort by nxdomain desc) → Toplist (label + nxdomain count, status warn).
- **Slow resolvers / latency band** — from `latency` (p50/p90/p95/max) StatDelta tiles (ms) + a note; if `resolution` gives per-resolver edges, a Toplist of heaviest resolvers.
- **Failure breakdown by rcode** — NXDOMAIN vs SERVFAIL totals across `failures` → CategoryBars/Toplist.
Keep the existing DnsTab widgets (topDomains, queryTypes, failures, resolution sankey) + the loading skeleton. Pure derivations (ratios/sorts) → a helper with a small test.

- [ ] Step 1: (if helper extracted) failing test for the pure derivations (internal ratio, nxdomain-sorted, rcode totals).
- [ ] Step 2: implement + enrich DnsTab (new widgets in the enabled branch, empty-safe). i18n ko+en.
- [ ] Step 3: tests + tsc + build.
- [ ] Step 4: Commit `feat(app): dns tab deep-dive (internal/external ratio, NXDOMAIN sources, resolver latency, rcode breakdown)`.

---

## Task 5: Finalize — review + v1.1.0 + deploy

- [ ] Step 1: Full suite `npx -w app vitest run` green; `tsc --noEmit`; `npm -w app run build`. Confirm the 3 new tabs registered + DNS enriched.
- [ ] Step 2: Final whole-branch adversarial review (lens correctness, empty/sparse safety [RTT/DNS often sparse], i18n parity, tokens, mobile, no e2e-testid regressions) → fix Critical/Important.
- [ ] Step 3: Version bump **1.1.0**: `app/src/lib/version.ts` APP_VERSION='1.1.0', `app/package.json` 1.1.0, CHANGELOG `## [1.1.0]` (Added: efficiency/scorecard/top-movers tabs + DNS deep-dive) EN+KR + ref links. version.test passes.
- [ ] Step 4: Merge to main; build+push image `<sha>`; `cdk deploy NfmDash-App -c imageTag=<sha>` (USER-AUTHORIZED). Verify health/302/ECS/tag; headless prod smoke of the 3 new tabs + enriched DNS.

---

## Phase 7 self-review checklist
- [ ] Efficiency (billed ratio, monthly run-rate, cross-AZ talkers, trend) — T1.
- [ ] Reliability scorecard (NHI availability %, composite score, breach timeline, worst services) — T2.
- [ ] Top Movers (window-over-window deltas, prior-0 handling) — T3.
- [ ] DNS deep-dive (int/ext ratio, NXDOMAIN sources, resolver latency, rcode breakdown) — T4.
- [ ] 3 new tabs registered + DNS enriched; lenses TDD; empty/sparse safe; i18n ko+en; tokens; mobile.
- [ ] v1.1.0 (version.ts + package.json + CHANGELOG) synced; full suite + build green; final review clean; deployed + prod smoke — T5.
