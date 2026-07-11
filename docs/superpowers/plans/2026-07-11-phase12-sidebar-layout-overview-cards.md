# Phase 12 — Sidebar Layout + Overview Summary Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Lenses TDD.

**Goal:** Move navigation from the horizontal top-nav back to a grouped left **sidebar** (all 16 menus exposed, ordered into 6 groups), let content use the **full width** (remove the 1536px cap), and add **6 at-a-glance summary cards** to the Overview page.

**Architecture:** `nav.ts` gains a `NAV_GROUPS` source-of-truth (6 ordered groups) with `NAV_ITEMS` derived from it (keeps MobileTabs/`isActive` working). Rebuild a grouped `Sidebar` + a slim `Topbar` (toggles), rewrite `AppShell` to the sidebar layout at full width, retire `TopNav`. The Overview summary block is assembled server-side in the existing `/api/overview` route by composing already-shipped pure lenses (scorecard/efficiency/dns-insights/concentration) — no new collection, one new read (`getDns()`).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4 SnowUI tokens, vitest.

## Global Constraints

- App-only. NO collector/IaC change. Version bump **1.6.0** at the end (`app/src/lib/version.ts` `APP_VERSION` + `app/package.json` + `CHANGELOG.md` [1.6.0] EN+KR + ref links; `version.test.ts` asserts APP_VERSION===package.json).
- ALL visible strings via `t()` in BOTH `app/src/lib/i18n/translations/ko.json` and `en.json` (flat keys, `{param}` interpolation).
- Colors ONLY from `app/src/lib/chart-tokens.ts` (`STATUS`, `TOKENS`, palettes) — no hardcoded hex; STATUS dual-encoded (color + text).
- Lenses/pure helpers TDD (co-located `*.test.ts`). `npx -w app vitest run` green; `npx -w app tsc --noEmit` clean; `npm -w app run build` succeeds — before each commit.
- Do NOT change or drop existing e2e/testid contracts: `kpi-dataTransferred`, `nhi-badge`, `agents-table`, `chat-*`, `monitor-card`, `network-page`, `insights-tab-<key>`, `widget-overview-*`. `data-testid="app-version"` must exist EXACTLY once (moves from TopNav → Sidebar).
- Mobile-safe: keep the existing `MobileTabs` bottom bar for < lg; the sidebar is desktop-only (`hidden lg:flex`); no page h-scroll at 390px; wide content scrolls in-container. Light + dark both first-class.
- No new npm deps. Conventional commits + `Claude-Session: https://claude.ai/code/session_01Ds9LMG4DwVKhP1iEcK8dtx` trailer. Serial execution (shared nav/i18n/layout). dev branch `dev/phase12-sidebar-overview` → merge → deploy (user-authorized).

## Confirmed decisions (from the user)

- **Width:** full width — content fills the area right of the sidebar with padding only (remove `max-w-[1536px]`).
- **Sidebar:** grouped with section headers, all 16 menus exposed, in this order:
  - **개요 / Overview:** `/`
  - **네트워크 뷰 / Network:** `/topology`, `/network`, `/flows`, `/paths`
  - **분석 / Analysis:** `/insights`, `/workload`, `/monitors`
  - **운영 / Operations:** `/alerts`, `/anomalies`, `/diagnose`, `/agents`
  - **비즈니스 / Business:** `/cost`, `/reports`
  - **도구 / Tools:** `/search`, `/settings`
- **Overview cards:** the recommended 6 — reliability score (SLO 0..100), monthly cost run-rate, billed ratio, DNS health (fail rate + resolver p95), traffic concentration (top-pair share), monitor status (degraded/total).

## Relevant existing code (verified)

- `app/src/components/layout/`: currently `AppShell.tsx`, `TopNav.tsx` (horizontal, `data-testid="app-version"` + `top-nav` + `top-nav-more`), `MobileTabs.tsx`, `nav.ts`. `Sidebar.tsx`/`Topbar.tsx` were deleted in Phase 10 — recreate them.
- `nav.ts`: `NAV_ITEMS: {href,key,icon}[]` (16 items) + `isActive(pathname, href)`. `MobileTabs` uses `PRIMARY_HREFS=['/','/topology','/flows','/diagnose']` + `nav.more`.
- `/api/overview/route.ts` already loads `status, coverage, series (getNfmMetrics(60)), flows (getFlowsWindow(12))` and returns `{ kpis, rttP50, rttP95, nhi, topTalkers, breachCount, errorRates, series, status, coverage }`.
- `scorecardLens(flows, { byMonitor })` → `{ monitors: MonitorScore[] (each {status:'ok'|'warn'|'danger', score}), overall:{availabilityPct:number|null, score:number} }`. Score status band: ok≥90, warn≥70, danger<70. `byMonitor` built from CW `HealthIndicator:<monitor>` series (mapper `healthByMonitor` in `app/api/analytics/scorecard/route.ts`).
- `efficiencyLens(flows, { windowSeconds })` → `{ billedRatio:number(0..1), monthlyUsdRunRate:number, ... }`.
- `concentration(flows, kind?, metric?)` (in `analytics/dependencies.ts`) → `{ entropy, gini, topShare, n }`.
- `getDns()` (`lib/ddb.ts`) → `DnsAggregate | null`. `DnsAggregate = { enabled, failures: {nxdomain,servfail,total,failRate}[], latency:{p50,p90,p95,max,count}, ... }`.
- `Series` type from `@/lib/analytics/aggregate`. `FlowEdge` from `@/lib/types`.

## Task sequence (serial)

| # | Task | Deliverable |
|---|---|---|
| 1 | Grouped sidebar + full-width layout | `nav.ts` NAV_GROUPS, `Sidebar.tsx`, `Topbar.tsx`, `AppShell.tsx`; retire `TopNav.tsx` |
| 2 | Overview summary block (lens + route) | `overviewSummary()` in `overview-metrics.ts` + `/api/overview` extension |
| 3 | Overview 6 summary cards (UI) | summary card grid on `app/src/app/page.tsx` |
| 4 | Finalize | review + v1.6.0 + deploy + prod smoke |

---

## Task 1: Grouped sidebar + full-width layout

**Files:**
- Modify: `app/src/components/layout/nav.ts` (add `NAV_GROUPS`; derive `NAV_ITEMS`)
- Create: `app/src/components/layout/Sidebar.tsx`, `app/src/components/layout/Topbar.tsx`
- Modify: `app/src/components/layout/AppShell.tsx`
- Delete: `app/src/components/layout/TopNav.tsx`
- Modify: `app/src/lib/i18n/translations/{ko,en}.json` (group labels)
- Modify (docs): `app/src/components/CLAUDE.md` layout key-files line

**Interfaces:**
- Produces: `NAV_GROUPS: { key: string; labelKey: string; items: NavItem[] }[]`; `NAV_ITEMS: NavItem[]` (= `NAV_GROUPS.flatMap(g => g.items)`, same `NavItem` shape as today: `{ href, key, icon }`).

- [ ] **Step 1: Restructure `nav.ts` into groups.** Read the current `NAV_ITEMS` to get each item's exact `icon` import and `key`. Define:
```ts
export interface NavGroup { key: string; labelKey: string; items: NavItem[]; }
export const NAV_GROUPS: NavGroup[] = [
  { key: 'overview', labelKey: 'nav.group.overview', items: [
    { href: '/', key: 'nav.overview', icon: /* existing */ } ] },
  { key: 'network', labelKey: 'nav.group.network', items: [
    { href: '/topology', key: 'nav.topology', icon: /* existing */ },
    { href: '/network', key: 'nav.network', icon: /* existing */ },
    { href: '/flows', key: 'nav.flows', icon: /* existing */ },
    { href: '/paths', key: 'nav.paths', icon: /* existing */ } ] },
  { key: 'analysis', labelKey: 'nav.group.analysis', items: [
    { href: '/insights', key: 'nav.insights', icon: /* existing */ },
    { href: '/workload', key: 'nav.workload', icon: /* existing */ },
    { href: '/monitors', key: 'nav.monitors', icon: /* existing */ } ] },
  { key: 'ops', labelKey: 'nav.group.ops', items: [
    { href: '/alerts', key: 'nav.alerts', icon: /* existing */ },
    { href: '/anomalies', key: 'nav.anomalies', icon: /* existing */ },
    { href: '/diagnose', key: 'nav.diagnose', icon: /* existing */ },
    { href: '/agents', key: 'nav.agents', icon: /* existing */ } ] },
  { key: 'business', labelKey: 'nav.group.business', items: [
    { href: '/cost', key: 'nav.cost', icon: /* existing */ },
    { href: '/reports', key: 'nav.reports', icon: /* existing */ } ] },
  { key: 'tools', labelKey: 'nav.group.tools', items: [
    { href: '/search', key: 'nav.search', icon: /* existing */ },
    { href: '/settings', key: 'nav.settings', icon: /* existing */ } ] },
];
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
```
Keep `isActive` unchanged. Use the EXACT `icon`/`key` values already present in the file — do not invent new ones. Every current NAV_ITEMS href must appear exactly once across the groups (16 total).

- [ ] **Step 2: If `nav.ts` has a test, update it; else add a small guard test** `app/src/components/layout/nav.test.ts`:
```ts
import { NAV_GROUPS, NAV_ITEMS } from './nav';
it('NAV_ITEMS is the flattened groups with no dup hrefs and 16 items', () => {
  expect(NAV_ITEMS).toEqual(NAV_GROUPS.flatMap((g) => g.items));
  const hrefs = NAV_ITEMS.map((i) => i.href);
  expect(new Set(hrefs).size).toBe(hrefs.length);
  expect(hrefs).toContain('/'); expect(hrefs).toContain('/settings');
  expect(hrefs.length).toBe(16);
});
```
Run: `npx -w app vitest run src/components/layout/nav.test.ts` → PASS.

- [ ] **Step 3: Create `Sidebar.tsx`** ('use client') — a desktop-only left rail (`hidden lg:flex lg:flex-col`), fixed width (`w-60`), full height, its own vertical scroll (`overflow-y-auto`):
  - Top: brand — the `N` avatar (`bg-accentLav`) + `NFM Dashboard` linking to `/`.
  - Body: `NAV_GROUPS.map` → for each group a small uppercase header `{t(group.labelKey)}` (muted, `text-[11px]`), then its items as links (icon + `t(item.key)`), active styling via `isActive(pathname, href)` (same active classes TopNav used). Each link keeps `aria-current` on active.
  - Footer (`mt-auto`): `data-testid="app-version"` showing `NFM Dashboard v{APP_VERSION}` (import `APP_VERSION` from `@/lib/version`) — MOVED here from TopNav; must be the ONLY app-version in the DOM.
  - testId `sidebar`.

- [ ] **Step 4: Create `Topbar.tsx`** ('use client') — a slim sticky header (`h-14`, border-bottom) holding the controls that TopNav owned: Refresh (`router.refresh()`), language toggle (`setLang(lang==='ko'?'en':'ko')` via `useLanguage`), theme toggle (`document.documentElement.classList.toggle('dark', next)` + `localStorage['nfm-theme']`). Reuse TopNav's exact button implementations (accessible names via `t('common.refresh'|'switchLang'|'toggleTheme')`, `STATUS`/token classes, no hardcoded hex). testId `topbar`. (Page `<h1>` titles already live in each page, so no breadcrumb needed.)

- [ ] **Step 5: Rewrite `AppShell.tsx`** to the sidebar layout at full width. Keep the `/chat-popup` (chrome-less early return) and `/login` (no FloatingChat) branches and the `<LanguageProvider>` wrapper exactly as they are; replace the body with:
```tsx
return (
  <div className="flex min-h-screen">
    <Sidebar />
    <div className="flex min-w-0 flex-1 flex-col">
      <Topbar />
      <main className="w-full flex-1 p-4 pb-20 lg:pb-4">{children}</main>
    </div>
    <MobileTabs />
    {pathname !== '/login' && <FloatingChat />}
  </div>
);
```
No `max-w-[1536px]` / `mx-auto` — content is full width. Import `Sidebar`/`Topbar`; remove the `TopNav` import.

- [ ] **Step 6: Delete `TopNav.tsx`.** Grep to confirm nothing imports it (`grep -rn "layout/TopNav\|from './TopNav'\|<TopNav" app/src` → empty). Confirm `data-testid="app-version"` count is exactly 1 (`grep -rn 'data-testid="app-version"' app/src | wc -l` → 1). Update `app/src/components/CLAUDE.md` layout line to `AppShell.tsx`, `Sidebar.tsx`, `Topbar.tsx`, `MobileTabs.tsx`, `nav.ts`.

- [ ] **Step 7: i18n.** Add group-label keys to BOTH `ko.json` and `en.json`: `nav.group.overview` (ko "개요" / en "Overview"), `nav.group.network` ("네트워크 뷰"/"Network"), `nav.group.analysis` ("분석"/"Analysis"), `nav.group.ops` ("운영"/"Operations"), `nav.group.business` ("비즈니스"/"Business"), `nav.group.tools` ("도구"/"Tools"). All `nav.*` item keys + `common.refresh/switchLang/toggleTheme` already exist — reuse.

- [ ] **Step 8: Verify.** `npx -w app vitest run` (all green), `npx -w app tsc --noEmit` (clean), `npm -w app run build` (success). Headless (reuse `~/.cache/ms-playwright/chromium_headless_shell-1229`; `AUTH_DISABLED=1 npm -w app run dev -- -p 3071`): desktop 1920px — `sidebar` visible with all 6 group headers + 16 links, active highlight, content is FULL width (main left edge right after the sidebar, no centered gap), `app-version` shows once; navigate 4-5 pages; mobile 390×844 — sidebar hidden, `MobileTabs` works, no h-scroll; light+dark; 0 console errors. Kill dev.

- [ ] **Step 9: Commit** `feat(app): grouped left sidebar (6 groups, all menus) + full-width content; retire top-nav`. Stage `app/src/components/layout/*`, `app/src/lib/i18n/translations/*.json`, `app/src/components/CLAUDE.md`, and any test changed.

---

## Task 2: Overview summary block (lens + route)

**Files:**
- Modify: `app/src/lib/overview-metrics.ts` (+ `overview-metrics.test.ts`)
- Modify: `app/src/app/api/overview/route.ts`

**Interfaces:**
- Consumes: `scorecardLens`, `efficiencyLens` (`@/lib/analytics/efficiency`), `concentration` (`@/lib/analytics/dependencies`), `Series` (`@/lib/analytics/aggregate`), `DnsAggregate`/`FlowEdge` (`@/lib/types`).
- Produces:
```ts
export interface OverviewSummary {
  reliabilityScore: number;                 // 0..100 (scorecard overall.score)
  reliabilityStatus: 'ok' | 'warn' | 'danger';
  availabilityPct: number | null;
  monthlyUsdRunRate: number;
  billedRatio: number;                      // 0..1
  dnsEnabled: boolean;
  dnsFailRate: number | null;               // 0..1 fleet fraction (null if no queries)
  dnsResolverP95: number | null;            // ms (null if no samples)
  concentrationTopShare: number;            // 0..1 largest-pair share
  monitorsTotal: number;
  monitorsDegraded: number;                 // scorecard monitors with status !== 'ok'
}
export function overviewSummary(
  flows: FlowEdge[],
  opts: { byMonitor: Record<string, Series>; dns: DnsAggregate | null; windowSeconds: number },
): OverviewSummary
```

- [ ] **Step 1: Failing test** in `overview-metrics.test.ts`:
```ts
import { overviewSummary } from './overview-metrics';
const f = (monitor: string, metric: any, value: number): FlowEdge => ({ edgeHash: `${monitor}-${metric}`,
  monitor, metric, category: 'INTER_AZ', bucket: 'b', value, unit: 'x',
  a: { serviceName: 'a' }, b: { serviceName: 'b' }, traversedConstructs: [] });
it('overviewSummary composes scorecard/efficiency/concentration/dns headline scalars', () => {
  const flows = [f('m1', 'DATA_TRANSFERRED', 2e9), f('m1', 'RETRANSMISSIONS', 4)];
  const dns = { enabled: true, topDomains: [], queryTypes: [], resolution: { nodes: [], links: [] }, nameFlow: [],
    latency: { p50: 1, p90: 2, p95: 5, max: 9, count: 10 },
    failures: [{ key: 'k', label: 'k', nxdomain: 3, servfail: 1, total: 100, failRate: 0.04 }] } as any;
  const s = overviewSummary(flows, { byMonitor: {}, dns, windowSeconds: 3600 });
  expect(s.reliabilityScore).toBeGreaterThanOrEqual(0);
  expect(s.reliabilityScore).toBeLessThanOrEqual(100);
  expect(['ok', 'warn', 'danger']).toContain(s.reliabilityStatus);
  expect(s.billedRatio).toBeCloseTo(1, 6);           // INTER_AZ is billed
  expect(s.monthlyUsdRunRate).toBeGreaterThan(0);
  expect(s.dnsEnabled).toBe(true);
  expect(s.dnsFailRate).toBeCloseTo(0.04, 6);        // (3+1)/100
  expect(s.dnsResolverP95).toBe(5);
  expect(s.concentrationTopShare).toBeCloseTo(1, 6); // single pair
  expect(s.monitorsTotal).toBe(1);
});
it('overviewSummary empty/dns-off safe (no NaN)', () => {
  const s = overviewSummary([], { byMonitor: {}, dns: null, windowSeconds: 3600 });
  expect(s.dnsEnabled).toBe(false);
  expect(s.dnsFailRate).toBeNull();
  expect(s.dnsResolverP95).toBeNull();
  expect(s.concentrationTopShare).toBe(0);
  expect(s.monitorsTotal).toBe(0);
  expect(Number.isNaN(s.monthlyUsdRunRate)).toBe(false);
});
```

- [ ] **Step 2: Run — expect FAIL** (`overviewSummary` undefined).

- [ ] **Step 3: Implement** in `overview-metrics.ts`:
```ts
import { scorecardLens } from './analytics/scorecard';
import { efficiencyLens } from './analytics/efficiency';
import { concentration } from './analytics/dependencies';
import type { Series } from './analytics/aggregate';
import type { DnsAggregate } from './types';

function scoreStatus(score: number): 'ok' | 'warn' | 'danger' {
  return score >= 90 ? 'ok' : score >= 70 ? 'warn' : 'danger';
}
function dnsFleetFailRate(dns: DnsAggregate | null): number | null {
  if (!dns || !dns.enabled) return null;
  const total = dns.failures.reduce((s, x) => s + x.total, 0);
  if (total === 0) return null;
  const fails = dns.failures.reduce((s, x) => s + x.nxdomain + x.servfail, 0);
  return fails / total;
}

export function overviewSummary(
  flows: FlowEdge[],
  opts: { byMonitor: Record<string, Series>; dns: DnsAggregate | null; windowSeconds: number },
): OverviewSummary {
  const sc = scorecardLens(flows, { byMonitor: opts.byMonitor });
  const eff = efficiencyLens(flows, { windowSeconds: opts.windowSeconds });
  const conc = concentration(flows);
  const dns = opts.dns;
  return {
    reliabilityScore: sc.overall.score,
    reliabilityStatus: scoreStatus(sc.overall.score),
    availabilityPct: sc.overall.availabilityPct,
    monthlyUsdRunRate: eff.monthlyUsdRunRate,
    billedRatio: eff.billedRatio,
    dnsEnabled: !!dns?.enabled,
    dnsFailRate: dnsFleetFailRate(dns),
    dnsResolverP95: dns?.enabled && dns.latency.count > 0 ? dns.latency.p95 : null,
    concentrationTopShare: conc.topShare,
    monitorsTotal: sc.monitors.length,
    monitorsDegraded: sc.monitors.filter((m) => m.status !== 'ok').length,
  };
}
```
(Place `OverviewSummary` interface above the function.)

- [ ] **Step 4: Run — expect PASS.** `tsc --noEmit`.

- [ ] **Step 5: Wire into `/api/overview/route.ts`.** Add `getDns` to the `@/lib/ddb` import; add `getDns()` to the `Promise.all`; build `byMonitor` from `series` using the SAME `HealthIndicator:` mapping the scorecard route uses (extract that mapper into a shared exported helper `healthByMonitor(cwSeries)` — put it in `lib/cw-metrics.ts` or `lib/overview-metrics.ts` and have BOTH the scorecard route and the overview route import it, rather than duplicating). Compute `summary: overviewSummary(flows, { byMonitor, dns, windowSeconds: 12 * 300 })` and add `summary` to the JSON response (additive — keep all existing fields). Keep the try/catch → 500.

- [ ] **Step 6: Verify.** `npx -w app vitest run` green; `tsc --noEmit`; `npm -w app run build`.

- [ ] **Step 7: Commit** `feat(app): overview summary block (reliability/cost/dns/concentration/monitors) in /api/overview`.

---

## Task 3: Overview 6 summary cards (UI)

**Files:**
- Modify: `app/src/app/page.tsx`
- Modify: `app/src/lib/i18n/translations/{ko,en}.json`

**Interfaces:**
- Consumes: `OverviewSummary` (Task 2) on `data.summary`.

**Context:** Add the 6 cards as a grid ABOVE (or right below) the existing KPI tiles, so the overview reads as a summary landing. Each card = label + big value + status color (dual-encoded) + a deep link to the relevant page/tab. Reuse the existing `StatDelta` component (or a small local `SummaryCard` wrapping `Card`) + `insightsLink(tab)` pattern already in the file. Do NOT change existing KPI tiles/widgets/testIds.

- [ ] **Step 1: Extend `OverviewData`** in `page.tsx` with `summary?: OverviewSummary` (import the type from `@/lib/overview-metrics`).

- [ ] **Step 2: Render a summary card grid** `data-testid="overview-summary"` (`grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6`), each card guarded by `data?.summary` (show `…` while `firstLoad`). The 6 cards (testids + content):
  1. `summary-card-reliability` — `t('overview.summary.reliability')`, value `{score}/100`, status color from `summary.reliabilityStatus`, sub = availability `{availabilityPct}%` (or `—`), link `/insights?tab=scorecard`.
  2. `summary-card-cost` — `t('overview.summary.monthlyCost')`, value `formatUsd(summary.monthlyUsdRunRate)`, link `/cost`.
  3. `summary-card-billed` — `t('overview.summary.billedRatio')`, value `{(billedRatio*100).toFixed(0)}%`, link `/insights?tab=efficiency`.
  4. `summary-card-dns` — `t('overview.summary.dns')`, value = `dnsEnabled` ? `{(dnsFailRate*100).toFixed(1)}%` (fail rate; `—` if null) : `t('overview.summary.dnsOff')`; sub = resolver p95 `{dnsResolverP95}ms` when present; status warn/danger by fail-rate thresholds (warn ≥ 0.01, danger ≥ 0.05); link `/insights?tab=dns`.
  5. `summary-card-concentration` — `t('overview.summary.concentration')`, value `{(concentrationTopShare*100).toFixed(0)}%` (top pair share), link `/insights?tab=dependencies`.
  6. `summary-card-monitors` — `t('overview.summary.monitors')`, value `{monitorsTotal - monitorsDegraded}/{monitorsTotal}` healthy, status = `monitorsDegraded>0 ? 'warn' : 'ok'` (danger if all degraded), link `/monitors`.
  Use `STATUS`-colored accents only where a status exists; keep it dual-encoded (a small status word/dot + the number, never color-only). Cards are links (whole card clickable) or carry a small "→" link like the existing widgets.

- [ ] **Step 3: i18n.** Add to BOTH ko.json + en.json: `overview.summary.reliability` (ko "신뢰성 점수"/en "Reliability"), `.monthlyCost` ("월 예상 비용"/"Est. monthly cost"), `.billedRatio` ("청구 트래픽 비율"/"Billed ratio"), `.dns` ("DNS 실패율"/"DNS failures"), `.dnsOff` ("DNS 미수집"/"DNS off"), `.concentration` ("트래픽 집중도"/"Concentration"), `.monitors` ("모니터 정상"/"Monitors healthy"), `.availability` ("가용성 {p}%"/"{p}% avail"), `.resolverP95` ("리졸버 p95 {ms}ms"/"resolver p95 {ms}ms").

- [ ] **Step 4: Verify.** `npx -w app vitest run` green; `tsc --noEmit`; `npm -w app run build`. Headless (authless dev, port 3071): `/` shows `overview-summary` with all 6 `summary-card-*`, values render (or graceful `—`/`DNS off`), status colors in light+dark, cards link correctly, no h-scroll at 390px (grid collapses to 2 cols). 

- [ ] **Step 5: Commit** `feat(app): 6 at-a-glance summary cards on overview (reliability/cost/billed/dns/concentration/monitors)`.

---

## Task 4: Finalize — review + v1.6.0 + deploy

- [ ] **Step 1: Green gate.** Full `vitest`, `tsc`, `build` all green. Confirm sidebar/topbar render, all 16 menus reachable, `app-version` ×1, overview summary cards render, no existing testid/e2e contract changed.
- [ ] **Step 2: Final whole-branch adversarial review** (strongest model) over `git merge-base main HEAD`..HEAD. Focus: layout regression (all nav hrefs present + grouped order correct + active highlight + mobile MobileTabs intact + app-version once + full-width applied), `NAV_ITEMS` still drives MobileTabs, summary math (empty/dns-off/no-NaN, billedRatio, dnsFailRate, score status bands), shared `healthByMonitor` extraction (scorecard route + overview route both use it, no fork), i18n ko+en parity for ALL new keys, tokens-only, no regressed e2e testids, light+dark, mobile no-h-scroll. Fix Critical/Important; log Minor.
- [ ] **Step 3: Version bump v1.6.0** (`version.ts` + `package.json` + `CHANGELOG.md` [1.6.0] EN+KR: Changed = sidebar layout + full width; Added = 6 overview summary cards; + ref links). `version.test.ts` passes.
- [ ] **Step 4: Commit** `chore(release): v1.6.0 — grouped sidebar + full-width layout + overview summary cards`. Merge `--no-ff` to `main`.
- [ ] **Step 5: Deploy (USER-AUTHORIZED).** `bash scripts/build-push.sh <sha>` → `cd infra && npx cdk deploy NfmDash-App --require-approval never -c imageTag=<sha>`. Verify stack UPDATE_COMPLETE, ECS rollout COMPLETED + image tag, ALB healthy, CloudFront `/login` 200 + `/`→302.
- [ ] **Step 6: Prod smoke.** `bash scripts/smoke.sh` (3/3) + headless authenticated check: sidebar with 6 groups + full-width content + overview summary cards render, light+dark, mobile bottom tabs + no h-scroll.

---

## Phase 12 self-review checklist
- [ ] Sidebar: 6 groups, all 16 menus exposed, confirmed order; `NAV_GROUPS` source-of-truth with `NAV_ITEMS` derived (MobileTabs/isActive intact).
- [ ] Full width (no 1536 cap); `app-version` testid moves to Sidebar (exactly once); `TopNav` retired.
- [ ] Overview summary block composes existing lenses (no new collection; one new `getDns()` read); `healthByMonitor` shared (not forked).
- [ ] 6 summary cards, dual-encoded, deep-linked, empty/dns-off safe; i18n ko+en; tokens only.
- [ ] No regressed e2e testids; mobile no-h-scroll; light+dark.
- [ ] v1.6.0 synced; full suite + build green; final review clean; deployed + prod smoke — Task 4.
