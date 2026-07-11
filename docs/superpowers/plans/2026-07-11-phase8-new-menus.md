# Phase 8 — New Menus & Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps `- [ ]`. All subagents Fable 5.

**Goal:** Add six new top-level menus/features, all from data already collected: **Alerts/Events**, **Search**, **Settings**, **Cost Explorer**, **Anomalies**, **Reports/Export**. Each is a new nav entry + page (+ route/lens where needed), reusing existing components, lenses, and the DDB/CloudWatch read path.

**Architecture:** New pages under `app/src/app/<name>/page.tsx`; new nav items in `app/src/components/layout/nav.ts` (Sidebar + MobileTabs auto-pick them; MobileTabs overflow "more" handles extras). Data via existing readers (`getFlowsWindow`, `getFlowsWindowPair`, `getNfmMetrics`, `getTopology`, `getDns`, `getCollectionHistory`) + lenses (`cost`, `efficiency`, `reliability`, `movers`) + a new `cloudwatch:DescribeAlarms` read for Alerts and a new anomaly lens. Settings persist client-side (localStorage) like the existing Language/theme.

**Tech Stack:** Next 16 App Router, existing charts + Datadog primitives + Toplist/StatDelta/Gauge, vitest, CloudWatch SDK.

## Global Constraints

- All visible strings via `t()` with BOTH ko + en (flat JSON); i18n parity. SnowUI tokens, theme-aware, mobile-safe (no page h-scroll at 390px; tables scroll in their own container). Pre-sort Toplist rows.
- Lenses/pure helpers TDD. Routes force-dynamic + try/catch→500 + reuse the analytics param helper. Don't touch `docs/superpowers/`, mcp-client/bedrock, or the collector.
- Preserve e2e testIds (kpi-dataTransferred/nhi-badge/agents-table/chat-*). New nav items via nav.ts (single source).
- App-only except Alerts (adds `cloudwatch:DescribeAlarms` to the ECS task role in `infra/lib/app-stack.ts` line ~190 — deploys with NfmDash-App).
- Version bump to **1.2.0** at the end. Conventional commits + Claude-Session trailer. Serial tasks (all touch nav.ts + i18n). dev branch → merge → deploy (app, user-authorized).

## Existing interfaces (consume)

```ts
// nav.ts: NAV_ITEMS: {href,key,icon:LucideIcon}[] (append). Sidebar + MobileTabs consume it.
// ddb.ts: getFlowsWindow(n), getFlowsWindowPair(n), getTopology(), getDns(), getCollectionHistory(n), queryFlowsByBucket, recentBuckets, queryPodFlows
// cw-metrics.ts: getNfmMetrics(minutes) + the CloudWatch client pattern (region). analytics lenses: cost.ts (bytesToUsd, CostRow), efficiency.ts, reliability.ts (ratePer, ReliabilityRow), movers.ts, aggregate.ts (entityKey, Series, percentile)
// filters.ts: lensQuery, rangeToBuckets, parseBuckets/parseLensParams (route param parsing)
// components: Widget, Toplist, StatDelta, Gauge, CategoryBars/Donut, TimeSeries, Distribution, FlowTable, HopPath, StatusBadge; ui/Controls {Card, Select, TextInput}; insights/tabs/shared LensState/formatUsd; format.ts
// i18n: useLanguage().t + LanguageContext (localStorage pattern to mirror for Settings)
// FlowEdge {a,b:EndpointInfo(podName,podNamespace,serviceName,ip,instanceId,subnetId,az,vpcId), monitor, metric, value, category, targetPort}; TopoNode/TopoEdge; DnsAggregate
```

## Task sequence (serial)

| # | Task | Deliverable |
|---|---|---|
| 1 | Alerts / Events | /api/alerts (DescribeAlarms + derived events) + /alerts + nav + IAM |
| 2 | Search | /api/search + /search + nav |
| 3 | Settings | /settings + settings store (localStorage) + nav |
| 4 | Cost Explorer | /api/cost-explorer + /cost + nav |
| 5 | Anomalies | anomaly lens + /api/anomalies + /anomalies + badges + nav |
| 6 | Reports / Export | /reports + CSV/Markdown export util + table export buttons + nav |
| 7 | Finalize | review + v1.2.0 + deploy (app + IAM) + prod smoke |

---

## Task 1: Alerts / Events

**Files:** Create `app/src/lib/cw-alarms.ts`, `app/src/app/api/alerts/route.ts`, `app/src/app/alerts/page.tsx`; Modify `infra/lib/app-stack.ts` (IAM), `app/src/components/layout/nav.ts`, i18n.

- Add `cloudwatch:DescribeAlarms` to the existing `cloudwatch:GetMetricData,ListMetrics` statement in app-stack.ts (~line 190).
- `cw-alarms.ts`: `getAlarms(): Promise<{name,stateValue,stateReason,metricName,updatedAt}[]>` via CloudWatch `DescribeAlarmsCommand` (reuse the region client pattern from cw-metrics; filter to `nfm-dashboard-*` alarms). On error → [].
- `/api/alerts` (force-dynamic): returns `{ alarms, events }`. events = derived feed built from DDB (no new writes): NHI-degraded (getNfmMetrics HealthIndicator>0 latest per monitor), reliability breaches (reliabilityLens(getFlowsWindow).breaches), collection gaps (getCollectionHistory — cycles with failed>0 or missing), top spikes (moversLens up-direction retrans/timeout with big delta). Each event `{id, severity:'critical'|'warn'|'info', kind, title, detail, ts, link?}`. Sort by severity+ts desc.
- `/alerts` page: an alarms panel (name + state badge ok/alarm) + an events feed (severity dot dual-encoded + title + detail + relative time + link to the relevant page). Empty-states. nav `{href:'/alerts', key:'nav.alerts', icon: Bell}`. testid `alerts-page`.
- TDD the pure event-derivation helper (given metrics/breaches/history → events with correct severity/sort).
- [ ] Steps: helper test RED→GREEN → cw-alarms + route + page + IAM + nav + i18n → `vitest`/tsc/build → Commit `feat(app): alerts & events menu (CloudWatch alarms + derived event feed)`.

---

## Task 2: Search

**Files:** Create `app/src/lib/search.ts` (+test), `app/src/app/api/search/route.ts`, `app/src/app/search/page.tsx`; nav + i18n. Optionally a topbar search box (Topbar.tsx) — OPTIONAL, keep to the page if it complicates.

- `search.ts`: `searchEntities(q, { topology, flows, dns }): SearchResult[]` PURE — match q (case-insensitive substring) across: topology nodes (label/id/namespace/cluster), flow endpoints (podName/serviceName/ip/instanceId/subnetId), DNS names (topDomains/nameFlow). Return typed results `{type:'pod'|'service'|'subnet'|'ip'|'node'|'domain', label, sublabel, href}` with a deep link (e.g. pod → `/flows?ns=&pod=`, node/edge → `/topology`, domain → `/insights?tab=dns`). Dedupe + cap. TDD.
- `/api/search?q=` (force-dynamic): loads topology + getFlowsWindow + getDns, calls searchEntities, returns `{results}`. (Bounded; min query length 2.)
- `/search` page: a search `TextInput` (debounced) + grouped results list (by type) with links; empty/hint states. nav `{href:'/search', key:'nav.search', icon: Search}`. testid `search-page`.
- [ ] Steps: search.ts test RED→GREEN → route + page + nav + i18n → gate → Commit `feat(app): unified entity search menu`.

---

## Task 3: Settings

**Files:** Create `app/src/lib/settings.ts` (localStorage-backed store + hook), `app/src/app/settings/page.tsx`; nav + i18n. (Client-only; no backend.)

- `settings.ts`: `useSettings()` hook + `AppSettings { defaultRange: TimeRange; retransThreshold; timeoutThreshold; costPerGb; anomalySigma; monitorFilter: string }` persisted in localStorage `nfm-settings` (SSR-safe, defaults). Mirror the LanguageContext localStorage pattern.
- `/settings` page: form controls (Select/TextInput) for default time range, thresholds (retrans/timeout events-per-GB, cost per GB, anomaly σ), default monitor filter; a "Subscribe to alarms" helper showing the `aws sns subscribe --topic-arn arn:aws:sns:ap-northeast-2:<ACCOUNT_ID>:nfm-dashboard-alarms ...` command (copy button) — informational. Save→localStorage. nav `{href:'/settings', key:'nav.settings', icon: Settings}`. testid `settings-page`.
- Wire the ANOMALIES page (Task 5) + Efficiency gauge to read these thresholds from `useSettings()` (client-side). Server lenses keep their defaults but accept optional override params where already supported; document what's wired vs display-only.
- [ ] Steps: settings.ts (+ a small parse/default test) → page + nav + i18n → gate → Commit `feat(app): settings menu (thresholds, default range, alarm subscribe helper)`.

---

## Task 4: Cost Explorer

**Files:** Create `app/src/lib/analytics/cost-explorer.ts` (+test), `app/src/app/api/cost-explorer/route.ts`, `app/src/app/cost/page.tsx`; nav + i18n.

- `cost-explorer.ts`: `costExplorerLens(flows, {windowSeconds}): { byCluster, byNamespace, byCategory, byMonitor: {label,bytes,usd}[]; totalUsd; monthlyRunRate; savings: {label,usd,hint}[]; trend: Series }` — group billed cost (reuse bytesToUsd) by cluster (from monitor mapping / endpoint), namespace (podNamespace), category, monitor; savings = top inter-AZ/inter-Region contributors with a hint (e.g. "co-locate in one AZ"). TDD grouping + run-rate + savings ranking.
- `/api/cost-explorer` (force-dynamic, buckets/namespace/category params, windowSeconds).
- `/cost` page: `StatDelta`(total + monthly run-rate), grouped `Toplist`s/`Treemap`/`CategoryBars` (by cluster/ns/category/monitor), savings `Toplist` (with hints), `TimeSeries` trend. Reuse Widget/LensState. nav `{href:'/cost', key:'nav.cost', icon: Wallet}` (lucide Wallet or DollarSign). testid `cost-explorer-page`.
- [ ] Steps: lens test RED→GREEN → route + page + nav + i18n → gate → Commit `feat(app): cost explorer menu`.

---

## Task 5: Anomalies

**Files:** Create `app/src/lib/analytics/anomalies.ts` (+test), `app/src/app/api/anomalies/route.ts`, `app/src/app/anomalies/page.tsx`; a small `AnomalyBadge` component + wire into overview/monitors; nav + i18n.

- `anomalies.ts`: `detectAnomalies(current: FlowEdge[], prior: FlowEdge[], opts:{retransRate,timeoutRate,sigma}): Anomaly[]` PURE — per entity flag when: retransRate or timeoutRate exceeds threshold (events/GB), OR a metric's current deviates from prior by > sigma×stddev (window-over-window). `Anomaly {key,label,kind:'retrans'|'timeout'|'spike', metric, value, baseline, severity, detail}`. Rank by severity. TDD threshold + deviation + empty.
- `/api/anomalies` (force-dynamic; getFlowsWindowPair for baseline; thresholds from query params defaulting to lens defaults).
- `/anomalies` page: ranked anomaly list/table (entity + kind + value vs baseline + severity badge) + counts by kind; empty-state ("no anomalies"). nav `{href:'/anomalies', key:'nav.anomalies', icon: TriangleAlert}`. testid `anomalies-page`.
- `AnomalyBadge`: a small badge component; add an anomaly count badge on the overview breaches area + monitors list (client reads /api/anomalies count or reuses overview data) — keep light/additive.
- [ ] Steps: lens test RED→GREEN → route + page + badge + nav + i18n → gate → Commit `feat(app): anomalies menu (baseline-deviation detection) + badges`.

---

## Task 6: Reports / Export

**Files:** Create `app/src/lib/report.ts` (+test) + `app/src/lib/csv.ts` (+test), `app/src/app/reports/page.tsx`; add CSV export buttons to `FlowTable` + the workload/monitors tables; nav + i18n.

- `csv.ts`: `toCsv(rows: Record<string,unknown>[], columns?): string` PURE (proper quoting/escaping). TDD (commas/quotes/newlines/empty).
- `report.ts`: `buildReportMarkdown(data): string` PURE — assemble a summary from overview KPIs + cost + reliability + top talkers + anomalies into Markdown. TDD structure.
- `/reports` page: fetches the summary data, renders a preview (reuse `Markdown`), a "Download .md" + "Download .csv" (flows/cost) + "Print" (window.print) buttons. nav `{href:'/reports', key:'nav.reports', icon: FileText}`. testid `reports-page`.
- Add a small "Export CSV" button to FlowTable (and optionally workload/monitors tables) using `toCsv` + a Blob download. Additive (default hidden if a prop not passed, or always shown small).
- [ ] Steps: csv.ts + report.ts tests RED→GREEN → page + FlowTable export button + nav + i18n → gate → Commit `feat(app): reports & export menu (Markdown/CSV/print) + table CSV export`.

---

## Task 7: Finalize — review + v1.2.0 + deploy

- [ ] Step 1: Full suite green; tsc clean; build. Confirm all 6 nav entries present + pages route.
- [ ] Step 2: Final whole-branch adversarial review (lens/helper correctness, empty/sparse safety, i18n parity, tokens, mobile, no regression to existing menus/e2e, IAM change correct) → fix Critical/Important.
- [ ] Step 3: Version bump **1.2.0** (version.ts + package.json + CHANGELOG [1.2.0] EN+KR + ref links). version.test passes.
- [ ] Step 4: Merge to main; build+push image `<sha>`; `cdk deploy NfmDash-App -c imageTag=<sha>` (USER-AUTHORIZED; this deploy also applies the DescribeAlarms IAM add). Verify health/302/ECS/tag; headless prod smoke of the 6 new menus.

---

## Phase 8 self-review checklist
- [ ] Alerts (CloudWatch alarms + derived events) + IAM DescribeAlarms — T1.
- [ ] Search (unified entity search + deep links) — T2.
- [ ] Settings (thresholds/range/monitor + alarm-subscribe helper, localStorage) — T3.
- [ ] Cost Explorer (by cluster/ns/category/monitor + run-rate + savings) — T4.
- [ ] Anomalies (baseline-deviation lens + page + badges) — T5.
- [ ] Reports/Export (Markdown/CSV/print + table CSV) — T6.
- [ ] 6 nav entries; pure helpers TDD; empty/sparse safe; i18n ko+en; tokens; mobile; no e2e/menu regression.
- [ ] v1.2.0 synced; full suite + build green; review clean; deployed (app+IAM) + prod smoke — T7.
