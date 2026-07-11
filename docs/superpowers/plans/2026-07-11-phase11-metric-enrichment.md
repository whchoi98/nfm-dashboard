# Phase 11 — Metric Enrichment (First Wave) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. All lenses TDD.

**Goal:** Add 8 diverse operator metrics to the NFM dashboard, all derivable from data the collector already stores (no collector change).

**Architecture:** Each metric = a pure lens change (TDD in the co-located `*.test.ts`) + a small UI surface on an existing page/tab. Reuse existing helpers (`ratePerGb`, `percentile`, `entityKey`, `STATUS` tokens, `StatDelta`/`Widget`/`Toplist`/`TimeSeries`/`Heatmap`). Grouped by area so each task is one cohesive, independently-reviewable deliverable.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, vitest, recharts + custom SVG charts, Tailwind v4 SnowUI tokens.

## Global Constraints

- App-only. NO collector change, NO IaC change. Version bump **1.5.0** at the end (`app/src/lib/version.ts` `APP_VERSION` + `app/package.json` + `CHANGELOG.md` [1.5.0] EN+KR + ref links; `version.test.ts` asserts APP_VERSION===package.json).
- ALL visible strings via `t()` (`app/src/lib/i18n`), added to BOTH `app/src/lib/i18n/translations/ko.json` and `en.json` (flat keys, `{param}` interpolation).
- Colors ONLY from `app/src/lib/chart-tokens.ts` (`STATUS = { ok, warn, danger }`, `TOKENS`, `SERIES_COLORS`) — never hardcode hex in components. STATUS is already dual-encoded (color + text/icon) — keep that.
- Lenses/pure helpers are TDD (co-located `*.test.ts`, `describe`/`it`, plain `expect`). Run `npx -w app vitest run`; typecheck `npx -w app tsc --noEmit`; build `npm -w app run build` — all green before each commit.
- Routes (if any added) `export const dynamic = 'force-dynamic'`, use `parseLensParams(req)` + `getFlowsWindow(buckets)`/`getFlowsWindowPair(n)`, try/catch → `Response.json({error:'internal error'},{status:500})`. Reuse existing routes where possible (no new route unless stated).
- Do NOT change existing testIds or existing page data contracts (e2e: `kpi-dataTransferred`, `nhi-badge`, `agents-table`, `chat-*`, `monitor-card`, `network-page`, `insights-tab-<key>`). New testIds follow conventions: `widget-<tab>-<name>`, `toplist-<tab>-<name>`, `insights-<key>-panel`, `stat-<name>`.
- Mobile-safe (no page h-scroll at 390px; wide tables/matrices scroll in-container). Light + dark both first-class. Pre-sort ranked lists. Empty/sparse safe (0 flows → empty-safe result, no NaN/Infinity).
- No new npm dependencies.
- Conventional commits + `Claude-Session: https://claude.ai/code/session_01Ds9LMG4DwVKhP1iEcK8dtx` trailer. Serial execution (i18n/tokens shared). dev branch `dev/phase11-metric-enrichment` → merge → deploy (user-authorized).

## Key data facts (from the codebase, verified)

- `FlowEdge` (`app/src/lib/types.ts:16-19`): `{ edgeHash, monitor, metric: MetricName, category: DestCategory, bucket: string, value: number, unit, a: EndpointInfo, b: EndpointInfo, targetPort?, ... }`. **Each metric is a SEPARATE row** per `edgeHash+metric+category+bucket`. `bucket` is the 5-min grid ISO string → per-bucket time series is grouping by `flow.bucket`.
- `MetricName = 'DATA_TRANSFERRED' | 'RETRANSMISSIONS' | 'TIMEOUTS' | 'ROUND_TRIP_TIME'`.
- `EndpointInfo`: `{ ip?, instanceId?, subnetId?, az?, vpcId?, region?, podName?, podNamespace?, serviceName? }`.
- Rate helper: reuse the existing "events per GB" helper used by `network-analytics.ts` / `reliability.ts` (`ratePerGb(events, bytes)` — confirm exact name/location by grep before use; do NOT fork it).
- `percentile(sortedAsc: number[], p: number): number` in `app/src/lib/analytics/aggregate.ts:32` (nearest-rank).
- `STATUS` in `chart-tokens.ts:75-79`: `{ ok: TOKENS.accentMint, warn: TOKENS.chartAmber, danger: '#FFB4B4' }`.
- `statusFor(v, warnAt, dangerAt): StatStatus` pattern in `app/src/lib/overview-metrics.ts:43-50` + thresholds `RETRANS_WARN/DANGER`, `TIMEOUT_WARN/DANGER` (lines 37-41).
- Test command: `npx -w app vitest run`. Representative lens test to mirror: `app/src/lib/analytics/network-analytics.test.ts` (has a `flow(over)` builder).

---

## Task sequence (serial)

| # | Task | Deliverable |
|---|---|---|
| 1 | Network fleet retransmissions | `network-analytics.ts` totalRetrans rate surfaced in `/network` header |
| 2 | Latency tail metrics | `latency.ts` p99 + per-path p95/jitter → LatencyTab |
| 3 | Monitor reliability chips | `monitors.ts` list item retrans/timeout → monitor cards |
| 4 | Overview golden-signal strip | `overview-metrics.ts` per-bucket retrans%/timeout% series → overview widget |
| 5 | RTT↔retrans correlation | `reliability.ts` Pearson r → ReliabilityTab badge |
| 6 | Traffic concentration | `dependencies.ts` entropy/Gini/topShare → DependenciesTab |
| 7 | Went-silent detection | `movers.ts` wentSilent flag → MoversTab list |
| 8 | Edge-health matrix | new `edge-health.ts` lens + health-colored matrix on `/topology` |
| 9 | Finalize | review + v1.5.0 + deploy + prod smoke |

---

## Task 1: Network fleet retransmissions (+ extract shared `ratePerGb`)

**Files:**
- Modify: `app/src/lib/analytics/aggregate.ts` (add exported `ratePerGb`)
- Modify: `app/src/lib/analytics/network-analytics.ts` (import shared `ratePerGb`; add `retransRateOverall` to result)
- Modify: `app/src/lib/analytics/reliability.ts` (import shared `ratePerGb`, drop local copy)
- Test: `app/src/lib/analytics/aggregate.test.ts`, `app/src/lib/analytics/network-analytics.test.ts`
- Modify (UI): `app/src/app/network/page.tsx` (header caption ~line 186-190)
- i18n: `ko.json` / `en.json`

**Interfaces:**
- Produces: `ratePerGb(events: number, bytes: number): number` (exported from `aggregate.ts`); `NetworkAnalyticsResult.retransRateOverall: number` (events/GB across all flows).

**Context:** `ratePerGb` is currently duplicated as a local (non-exported) fn in `network-analytics.ts:46` and `reliability.ts`. Formula: `bytes === 0 ? 0 : events / Math.max(bytes / 1e9, 1e-9)`. Extract once, reuse. `NetworkAnalyticsResult` already has `totalRetrans` + `totalBytes` (`network-analytics.ts:36-43`), computed but the `/network` header only shows `totalBytes`.

- [ ] **Step 1: Write failing test for shared `ratePerGb`**

Add to `app/src/lib/analytics/aggregate.test.ts` (create the file if absent, mirroring other analytics tests):
```ts
import { describe, it, expect } from 'vitest';
import { ratePerGb } from './aggregate';

describe('ratePerGb', () => {
  it('events per GB with 0-division guard', () => {
    expect(ratePerGb(0, 0)).toBe(0);
    expect(ratePerGb(10, 0)).toBe(0);
    expect(ratePerGb(5, 1e9)).toBeCloseTo(5, 6);   // 5 events over 1 GB
    expect(ratePerGb(2, 5e8)).toBeCloseTo(4, 6);   // 2 events over 0.5 GB
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`ratePerGb` not exported): `npx -w app vitest run src/lib/analytics/aggregate.test.ts`

- [ ] **Step 3: Add `ratePerGb` to `aggregate.ts`**
```ts
/** Events per GB with 0-division guard (shared by reliability/network-analytics lenses). */
export function ratePerGb(events: number, bytes: number): number {
  return bytes === 0 ? 0 : events / Math.max(bytes / 1e9, 1e-9);
}
```

- [ ] **Step 4: Replace the local copies** in `network-analytics.ts` and `reliability.ts`: delete the local `function ratePerGb(...)` and add `ratePerGb` to the existing `import { ... } from './aggregate';` (or add such an import). Run the full analytics suite: `npx -w app vitest run src/lib/analytics` → PASS (behavior unchanged).

- [ ] **Step 5: Write failing test for `retransRateOverall`**

Add to `app/src/lib/analytics/network-analytics.test.ts` (reuse its `flow(over)` builder):
```ts
it('retransRateOverall = fleet retransmissions per GB', () => {
  const flows = [
    flow({ metric: 'DATA_TRANSFERRED', value: 2e9 }),      // 2 GB
    flow({ metric: 'RETRANSMISSIONS', value: 20 }),
  ];
  const r = networkAnalyticsLens(flows, { sourceScope: 'service', destScope: 'service' });
  expect(r.totalRetrans).toBe(20);
  expect(r.retransRateOverall).toBeCloseTo(10, 6);         // 20 / 2GB
});
```

- [ ] **Step 6: Run — expect FAIL** (`retransRateOverall` undefined).

- [ ] **Step 7: Implement** — add `retransRateOverall: number;` to `NetworkAnalyticsResult` (after `totalRetrans`), and in the return object set `retransRateOverall: ratePerGb(totalRetrans, totalBytes)`.

- [ ] **Step 8: Run — expect PASS.** Then `npx -w app tsc --noEmit`.

- [ ] **Step 9: Surface in `/network` header.** In `app/src/app/network/page.tsx`, extend the header caption (currently `{t('network.pairs', {n})} · {formatBytes(data.totalBytes)}`) to append the fleet retrans total + rate, e.g.:
```tsx
{' · '}<span data-testid="network-total-retrans">{t('network.retransTotal', { n: data.totalRetrans.toLocaleString() })}</span>
{' · '}{t('network.retransRate', { r: data.retransRateOverall.toFixed(1) })}
```
Add i18n keys to BOTH `ko.json` and `en.json`:
```json
"network.retransTotal": "재전송 {n}건",         // en: "{n} retransmissions"
"network.retransRate": "{r}/GB"                  // en: "{r}/GB"
```

- [ ] **Step 10: Build + commit.** `npm -w app run build` → success. `git add app/src/lib/analytics/aggregate.ts app/src/lib/analytics/aggregate.test.ts app/src/lib/analytics/network-analytics.ts app/src/lib/analytics/network-analytics.test.ts app/src/lib/analytics/reliability.ts app/src/app/network/page.tsx app/src/lib/i18n/translations/ko.json app/src/lib/i18n/translations/en.json && git commit` — `feat(app): surface fleet retransmission total + rate on /network; extract shared ratePerGb`.

---

## Task 2: Latency tail metrics (p99 + per-path p95 & jitter)

**Files:**
- Modify: `app/src/lib/analytics/latency.ts`
- Test: `app/src/lib/analytics/latency.test.ts`
- Modify (UI): `app/src/app/insights/tabs/LatencyTab.tsx`
- i18n: `ko.json` / `en.json`

**Interfaces:**
- Consumes: `percentile` (`aggregate.ts`), existing `LatencyStats`, `percentilesOf`.
- Produces: `LatencyStats.p99: number` (added); `TailPath { key: string; label: string; edgeHash: string; p50: number; p95: number; jitter: number; count: number }`; `slowestByTail(flows: FlowEdge[], n?: number): TailPath[]`; `LatencyLensResult.slowestTail: TailPath[]`.

**Context:** `LatencyStats` (`latency.ts:9`) already has `p50/p90/p95/min/max/count` — **only `p99` is missing**. `slowestPaths` (`latency.ts:66`) ranks by MEAN rtt (`SlowPath { key,label,rtt,edgeHash }`). Add a percentile-based ranking instead of replacing it. Jitter = `p95 - p50`.

- [ ] **Step 1: Failing test — p99 in `percentilesOf`**
```ts
it('percentilesOf includes p99', () => {
  const s = percentilesOf([100, 200, 300, 400, 500]);
  expect(s.p99).toBe(500);            // nearest-rank top
  expect(percentilesOf([]).p99).toBe(0);
});
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — add `p99: number;` to `LatencyStats`; in `percentilesOf` add `p99: percentile(sorted, 99)` (empty array → the existing empty-guard returns 0 for all fields, extend it to include `p99: 0`).
- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Failing test — `slowestByTail`**
```ts
it('slowestByTail ranks by p95 and reports jitter', () => {
  const mk = (edge: string, label: string, vals: number[]): FlowEdge[] =>
    vals.map((v) => ({ edgeHash: edge, monitor: 'm', metric: 'ROUND_TRIP_TIME', category: 'INTRA_AZ',
      bucket: 'b', value: v, unit: 'ms', a: { serviceName: 'a' }, b: { serviceName: label },
      traversedConstructs: [] } as FlowEdge));
  const flows = [...mk('e1', 'slow', [10, 100]), ...mk('e2', 'steady', [50, 50])];
  const paths = slowestByTail(flows, 10);
  expect(paths[0].edgeHash).toBe('e1');            // higher p95 ranks first
  expect(paths[0].jitter).toBe(paths[0].p95 - paths[0].p50);
  expect(paths.find((p) => p.edgeHash === 'e2')!.jitter).toBe(0);
});
```
- [ ] **Step 6: Run — expect FAIL.**
- [ ] **Step 7: Implement `slowestByTail`** in `latency.ts`:
```ts
export interface TailPath { key: string; label: string; edgeHash: string;
  p50: number; p95: number; jitter: number; count: number; }

export function slowestByTail(flows: FlowEdge[], n = 20): TailPath[] {
  const byEdge = new Map<string, { label: string; vals: number[] }>();
  for (const f of flows) {
    if (f.metric !== 'ROUND_TRIP_TIME') continue;
    const e = byEdge.get(f.edgeHash) ?? { label: `${f.a.serviceName ?? f.a.ip ?? '?'} → ${f.b.serviceName ?? f.b.ip ?? '?'}`, vals: [] };
    e.vals.push(f.value);
    byEdge.set(f.edgeHash, e);
  }
  const paths: TailPath[] = [...byEdge.entries()].map(([edgeHash, e]) => {
    const s = percentilesOf(e.vals);
    return { key: edgeHash, label: e.label, edgeHash, p50: s.p50, p95: s.p95, jitter: s.p95 - s.p50, count: s.count };
  });
  paths.sort((x, y) => y.p95 - x.p95 || y.jitter - x.jitter || x.key.localeCompare(y.key));
  return paths.slice(0, n);
}
```
Add `slowestTail: slowestByTail(flows)` to the `latencyLens` return + `slowestTail: TailPath[]` to `LatencyLensResult`.
- [ ] **Step 8: Run — expect PASS.** `tsc --noEmit`.

- [ ] **Step 9: Surface in `LatencyTab.tsx`.** Add p95/p99/min/max to the overall stat row (extend the existing `StatDelta` tiles; add `stat-latency-p99`, `stat-latency-min`, `stat-latency-max`). Add a "Tail paths (p95 & jitter)" `Toplist`/table `testId="toplist-latency-tail"` fed by `data.slowestTail`, columns: path | p50 | p95 | jitter (ms). Add a root `data-testid="insights-latency-panel"` to the tab's root div (following the newer panel-testid convention). i18n keys (ko+en): `insights.latency.p99`, `insights.latency.min`, `insights.latency.max`, `insights.latency.tailPaths`, `insights.latency.jitter`.

- [ ] **Step 10: Build + commit** `feat(app): latency p99 + per-path p95/jitter tail metrics`.

---

## Task 3: Monitor reliability chips (retrans / timeout on cards)

**Files:**
- Modify: `app/src/lib/monitors.ts` (`MonitorListItem` + `buildMonitorList`)
- Test: `app/src/lib/monitors.test.ts`
- Modify (UI): `app/src/app/monitors/page.tsx`
- i18n: `ko.json` / `en.json`

**Interfaces:**
- Consumes: `ratePerGb` (from Task 1, `aggregate.ts`).
- Produces: `MonitorListItem` gains `retransmissions: number; timeouts: number;` (raw sums, matching `MonitorTraffic.retransmissionsSum/timeoutsSum` semantics).

**Context:** `MonitorListItem` (`monitors.ts:9-15`) currently = `{ name, cluster?, nhi, dataTransferred, spark }`. `buildMonitorList` (`monitors.ts:64`) builds it from the same `metrics: Record<string, NfmSeries>` map `trafficSummary` uses (`Retransmissions:${name}` / `Timeouts:${name}` keys, summed via `sum(...)`). Monitor cards (`monitors/page.tsx`, `data-testid="monitor-card"`) show only NHI + bytes + spark today. `sum(...)` helper already exists in `monitors.ts`.

- [ ] **Step 1: Failing test** in `monitors.test.ts` (reuse its `series`/`METRICS` fixture builders):
```ts
it('buildMonitorList carries retransmissions and timeouts sums', () => {
  const metrics = {
    'DataTransferred:m1': series('DataTransferred', 'm1', [1e9, 1e9]),
    'Retransmissions:m1': series('Retransmissions', 'm1', [3, 7]),
    'Timeouts:m1': series('Timeouts', 'm1', [1, 1]),
  };
  const [item] = buildMonitorList({ m1: 'clusterA' }, metrics as any);
  expect(item.retransmissions).toBe(10);
  expect(item.timeouts).toBe(2);
});
```
(Match the exact `buildMonitorList` param shape you find in the file — the first arg is the monitor→cluster map.)
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — add `retransmissions: number; timeouts: number;` to `MonitorListItem`; in `buildMonitorList`, set them via the same `sum(metrics[\`Retransmissions:${name}\`]?.values ?? [])` / `Timeouts` pattern used by `trafficSummary`.
- [ ] **Step 4: Run — expect PASS.** `tsc --noEmit`.
- [ ] **Step 5: Surface chips on the card** in `monitors/page.tsx`. Below the NHI badge, render two small chips colored via `STATUS` + `statusFor`-style thresholds (retrans/GB and timeout/GB, using `ratePerGb(m.retransmissions, m.dataTransferred)` etc.), dual-encoded (label text + color). testIds `monitor-chip-retrans`, `monitor-chip-timeouts`. Reuse `RETRANS_WARN/DANGER`, `TIMEOUT_WARN/DANGER` thresholds from `overview-metrics.ts` (import or mirror the constants — prefer importing if exported; if not, add a shared threshold const rather than magic numbers). i18n keys (ko+en): `monitors.retransChip` ("재전송 {r}/GB"), `monitors.timeoutChip` ("타임아웃 {r}/GB").
- [ ] **Step 6: Build + commit** `feat(app): show retransmission/timeout health chips on monitor cards`.

---

## Task 4: Overview golden-signal strip (per-bucket retrans% / timeout% rate)

**Files:**
- Modify: `app/src/lib/overview-metrics.ts`
- Test: `app/src/lib/overview-metrics.test.ts`
- Modify (UI): `app/src/app/page.tsx`
- i18n: `ko.json` / `en.json`

**Interfaces:**
- Consumes: `ratePerGb` (`aggregate.ts`), `FlowEdge.bucket`.
- Produces: `errorRateSeries(flows: FlowEdge[]): ErrorRatePoint[]` where `ErrorRatePoint = { t: string; retransRate: number; timeoutRate: number }`; `OverviewMetrics` (the object `page.tsx` consumes) gains `errorRates: ErrorRatePoint[]`.

**Context:** Overview shows 4 KPI tiles + a per-monitor bytes `TimeSeries` (`trafficSeries()` filters `metric === 'DataTransferred'`). There is NO fleet error-rate trend. `FlowEdge.bucket` is the 5-min grid key — group by it. A "golden-signal" strip is the RED-dashboard summary operators check first.

- [ ] **Step 1: Failing test**
```ts
import { errorRateSeries } from './overview-metrics';
it('errorRateSeries computes per-bucket retrans%/timeout% per GB, sorted by bucket', () => {
  const f = (bucket: string, metric: any, value: number): FlowEdge => ({ edgeHash: 'e', monitor: 'm',
    metric, category: 'INTRA_AZ', bucket, value, unit: 'x', a: {}, b: {}, traversedConstructs: [] });
  const flows = [
    f('2026-07-11T00:05:00Z', 'DATA_TRANSFERRED', 2e9), f('2026-07-11T00:05:00Z', 'RETRANSMISSIONS', 20),
    f('2026-07-11T00:00:00Z', 'DATA_TRANSFERRED', 1e9), f('2026-07-11T00:00:00Z', 'TIMEOUTS', 5),
  ];
  const s = errorRateSeries(flows);
  expect(s.map((p) => p.t)).toEqual(['2026-07-11T00:00:00Z', '2026-07-11T00:05:00Z']); // ascending
  expect(s[1].retransRate).toBeCloseTo(10, 6);   // 20 / 2GB
  expect(s[0].timeoutRate).toBeCloseTo(5, 6);    // 5 / 1GB
});
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement**
```ts
export interface ErrorRatePoint { t: string; retransRate: number; timeoutRate: number; }

export function errorRateSeries(flows: FlowEdge[]): ErrorRatePoint[] {
  const byBucket = new Map<string, { bytes: number; retrans: number; timeouts: number }>();
  for (const f of flows) {
    const b = byBucket.get(f.bucket) ?? { bytes: 0, retrans: 0, timeouts: 0 };
    if (f.metric === 'DATA_TRANSFERRED') b.bytes += f.value;
    else if (f.metric === 'RETRANSMISSIONS') b.retrans += f.value;
    else if (f.metric === 'TIMEOUTS') b.timeouts += f.value;
    byBucket.set(f.bucket, b);
  }
  return [...byBucket.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([t, v]) => ({ t, retransRate: ratePerGb(v.retrans, v.bytes), timeoutRate: ratePerGb(v.timeouts, v.bytes) }));
}
```
Wire `errorRates: errorRateSeries(flows)` into the overview metrics object returned to `page.tsx` (find the existing builder that assembles `OverviewKpis`/overview data and add the field; keep existing fields intact).
- [ ] **Step 4: Run — expect PASS.** `tsc --noEmit`.
- [ ] **Step 5: Surface strip** in `page.tsx`: a new `Widget testId="widget-overview-golden"` titled via `t('overview.goldenSignals')`, containing a `TimeSeries` with two series (retransRate, timeoutRate) from `data.errorRates` (x=`t`, colored from `SERIES_COLORS`/`STATUS`). Place it after the traffic widget. Mobile-safe (chart already responsive). i18n keys (ko+en): `overview.goldenSignals` ("에러 신호 (재전송·타임아웃 /GB)"), `overview.retransRate`, `overview.timeoutRate`.
- [ ] **Step 6: Build + commit** `feat(app): overview golden-signal strip (fleet retransmission/timeout rate trend)`.

---

## Task 5: RTT↔retransmission correlation (Pearson r) — substitute for WI-RTT

> **Note:** WI (WorkloadInsightsTopContributors) does NOT support ROUND_TRIP_TIME (live API enum = DATA_TRANSFERRED/TIMEOUTS/RETRANSMISSIONS only), so the originally-listed "WI RTT" metric is infeasible. This app-only correlation metric replaces it.

**Files:**
- Modify: `app/src/lib/analytics/reliability.ts`
- Test: `app/src/lib/analytics/reliability.test.ts`
- Modify (UI): `app/src/app/insights/tabs/ReliabilityTab.tsx`
- i18n: `ko.json` / `en.json`

**Interfaces:**
- Consumes: existing `rttVsRetrans(flows, cap?)` → `ScatterPoint[]` (`{ key,label,rtt,retransmissions,bytes }`).
- Produces: `correlation(points: ScatterPoint[]): { r: number | null; n: number }`; `ReliabilityLensResult.correlation: { r: number | null; n: number }`.

**Context:** The Reliability tab already renders a scatter of retransmissions × rtt, but no single number says whether they move together. Pearson r over (rtt, retransmissions) answers "is latency associated with loss?".

- [ ] **Step 1: Failing test**
```ts
import { correlation } from './reliability';
const pt = (rtt: number, retransmissions: number) => ({ key: `${rtt}`, label: 'x', rtt, retransmissions, bytes: 1 });
it('correlation: perfect positive → ~1, perfect negative → ~-1, <2 points → null', () => {
  expect(correlation([pt(1,1), pt(2,2), pt(3,3)]).r).toBeCloseTo(1, 6);
  expect(correlation([pt(1,3), pt(2,2), pt(3,1)]).r).toBeCloseTo(-1, 6);
  expect(correlation([pt(1,1)]).r).toBeNull();
  expect(correlation([]).n).toBe(0);
});
it('correlation: zero variance → null (no NaN)', () => {
  expect(correlation([pt(5,1), pt(5,2)]).r).toBeNull(); // rtt constant
});
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement**
```ts
export function correlation(points: ScatterPoint[]): { r: number | null; n: number } {
  const n = points.length;
  if (n < 2) return { r: null, n };
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.rtt; sy += p.retransmissions; }
  const mx = sx / n, my = sy / n;
  let cov = 0, vx = 0, vy = 0;
  for (const p of points) {
    const dx = p.rtt - mx, dy = p.retransmissions - my;
    cov += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return { r: null, n };
  return { r: cov / Math.sqrt(vx * vy), n };
}
```
Add `correlation: correlation(<the scatter points>)` to `reliabilityLens`'s return + `correlation: { r: number | null; n: number }` to `ReliabilityLensResult` (compute from the same points it already builds via `rttVsRetrans`).
- [ ] **Step 4: Run — expect PASS.** `tsc --noEmit`.
- [ ] **Step 5: Surface badge** next to the scatter in `ReliabilityTab.tsx`: `data-testid="reliability-correlation"` showing `r` to 2 dp with a dual-encoded label (`t('insights.reliability.correlation', { r })`) and a qualitative word (strong/weak/none) — when `r === null` show `t('insights.reliability.correlationNA')`. Add the root `data-testid="insights-reliability-panel"` to the tab root div (newer convention). i18n keys (ko+en): `insights.reliability.correlation` ("RTT↔재전송 상관 r={r}"), `insights.reliability.correlationNA` ("상관 데이터 부족").
- [ ] **Step 6: Build + commit** `feat(app): RTT vs retransmission correlation coefficient on reliability tab`.

---

## Task 6: Traffic concentration (entropy / Gini / top-share)

**Files:**
- Modify: `app/src/lib/analytics/dependencies.ts`
- Test: `app/src/lib/analytics/dependencies.test.ts`
- Modify (UI): `app/src/app/insights/tabs/DependenciesTab.tsx`
- i18n: `ko.json` / `en.json`

**Interfaces:**
- Consumes: existing per-entity aggregation in `dependencies.ts` (reuse the same grouping `paretoTalkers` uses — `entityKey`/pair keying + summed `value` for `DATA_TRANSFERRED`).
- Produces: `concentration(flows: FlowEdge[], kind?: EntityKind, metric?: MetricName): { entropy: number; gini: number; topShare: number; n: number }` (entropy normalized 0..1; gini 0..1; topShare = largest single share 0..1).

**Context:** `paretoTalkers` returns only cumulative %; there is no scalar telling operators "traffic is dangerously concentrated in one pair". Shannon entropy (normalized by `log(n)`), Gini, and top-1 share are the standard scalars.

- [ ] **Step 1: Failing test**
```ts
import { concentration } from './dependencies';
const dt = (a: string, b: string, bytes: number): FlowEdge => ({ edgeHash: `${a}-${b}`, monitor: 'm',
  metric: 'DATA_TRANSFERRED', category: 'INTRA_AZ', bucket: 'x', value: bytes, unit: 'B',
  a: { serviceName: a }, b: { serviceName: b }, traversedConstructs: [] });
it('concentration: uniform → entropy≈1, gini≈0; dominated → entropy→0, topShare→1', () => {
  const uni = concentration([dt('a','b',100), dt('c','d',100), dt('e','f',100), dt('g','h',100)]);
  expect(uni.entropy).toBeCloseTo(1, 2);
  expect(uni.gini).toBeCloseTo(0, 2);
  expect(uni.topShare).toBeCloseTo(0.25, 2);
  const dom = concentration([dt('a','b',997), dt('c','d',1), dt('e','f',1), dt('g','h',1)]);
  expect(dom.entropy).toBeLessThan(0.2);
  expect(dom.topShare).toBeGreaterThan(0.99);
});
it('concentration: empty → zeros, no NaN', () => {
  const z = concentration([]);
  expect(z).toEqual({ entropy: 0, gini: 0, topShare: 0, n: 0 });
});
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** (reuse the file's existing entity/pair keying; here is the scalar math over the summed values array `vals` desc):
```ts
export function concentration(flows: FlowEdge[], kind: EntityKind = 'service', metric: MetricName = 'DATA_TRANSFERRED'): { entropy: number; gini: number; topShare: number; n: number } {
  // Build per-pair totals using the SAME keying paretoTalkers uses (do not fork it).
  const totals = /* Map<key, number> of summed `metric` value per pair */ pairTotals(flows, kind, metric);
  const vals = [...totals.values()].filter((v) => v > 0).sort((x, y) => y - x);
  const n = vals.length;
  if (n === 0) return { entropy: 0, gini: 0, topShare: 0, n: 0 };
  const total = vals.reduce((s, v) => s + v, 0);
  const shares = vals.map((v) => v / total);
  const entropy = n === 1 ? 0 : -shares.reduce((s, p) => s + (p > 0 ? p * Math.log(p) : 0), 0) / Math.log(n);
  // Gini over sorted-desc shares: G = (2*Σ i*x_i)/(n*Σ x_i) - (n+1)/n, with i ascending.
  const asc = [...vals].sort((x, y) => x - y);
  let cum = 0; for (let i = 0; i < n; i++) cum += (i + 1) * asc[i];
  const gini = n === 1 ? 0 : (2 * cum) / (n * total) - (n + 1) / n;
  return { entropy, gini, topShare: shares[0], n };
}
```
If a reusable `pairTotals` grouping does not already exist, extract the grouping used inside `paretoTalkers` into a small shared helper and have both call it (DRY) rather than duplicating the pair-keying logic.
- [ ] **Step 4: Run — expect PASS.** `tsc --noEmit`.
- [ ] **Step 5: Surface** in `DependenciesTab.tsx`: a `Widget testId="widget-dependencies-concentration"` with three dual-encoded stat readouts — entropy (0=집중, 1=분산), Gini, top-pair share % — from a small fetch or the existing dependencies payload (add `concentration` to the dependencies route/lens result if the tab reads a single payload; otherwise compute alongside). i18n keys (ko+en): `insights.dependencies.concentration`, `insights.dependencies.entropy`, `insights.dependencies.gini`, `insights.dependencies.topShare`.
- [ ] **Step 6: Build + commit** `feat(app): traffic-concentration scalars (entropy/Gini/top-share) on dependencies tab`.

---

## Task 7: Went-silent detection (movers)

**Files:**
- Modify: `app/src/lib/analytics/movers.ts`
- Test: `app/src/lib/analytics/movers.test.ts`
- Modify (UI): `app/src/app/insights/tabs/MoversTab.tsx`
- i18n: `ko.json` / `en.json`

**Interfaces:**
- Consumes: existing `moversFor(current, prior, metric, opts?)` grouping + `Mover` type.
- Produces: `Mover.wentSilent: boolean` (true iff `prior > 0 && current === 0`); `MoversResult.silent: Mover[]` (entities that went silent this window, any metric, deduped by key, prior>0→0).

**Context:** `movers.ts` (`Mover` at line 13-22) currently flags `prior===0 && current>0` as a "new" mover but treats `prior>0 && current===0` as an ordinary `-100%` `down` — indistinguishable from a big decline. A crashed / scaled-to-zero service is a strong incident signal that deserves its own list.

- [ ] **Step 1: Failing test**
```ts
it('wentSilent flags prior>0 & current=0 and NOT new appearances', () => {
  const cur: FlowEdge[] = []; // service "x" absent now
  const prior: FlowEdge[] = [{ edgeHash: 'e', monitor: 'm', metric: 'DATA_TRANSFERRED', category: 'INTRA_AZ',
    bucket: 'b', value: 500, unit: 'B', a: { serviceName: 'x' }, b: { serviceName: 'y' }, traversedConstructs: [] }];
  const res = moversLens(cur, prior);
  expect(res.silent.some((m) => m.label.includes('x') && m.wentSilent)).toBe(true);
  // a brand-new entity (prior 0, current >0) must NOT be in silent
  const res2 = moversLens(prior, cur);
  expect(res2.silent.length).toBe(0);
});
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — add `wentSilent: boolean;` to `Mover`; in `moversFor` set `wentSilent: prior > 0 && current === 0` on each mover. Add `silent: Mover[]` to `MoversResult` = union across the three metric mover lists filtered to `wentSilent`, deduped by `key` (keep the largest prior). Keep existing fields/behavior unchanged.
- [ ] **Step 4: Run — expect PASS.** `tsc --noEmit`.
- [ ] **Step 5: Surface** in `MoversTab.tsx`: a "Went silent" `Widget`/`Toplist` `testId="toplist-movers-silent"` listing `data.silent` (label + prior value, danger-styled), shown above/below the existing sections. Empty-safe (hide or show "none" when empty). i18n keys (ko+en): `insights.movers.silent` ("무음 전환"), `insights.movers.silentEmpty`, `insights.movers.priorValue`.
- [ ] **Step 6: Build + commit** `feat(app): went-silent entity detection on movers tab`.

---

## Task 8: Edge-health matrix (RED/AMBER/GREEN adjacency)

**Files:**
- Create: `app/src/lib/analytics/edge-health.ts` (+ `edge-health.test.ts`)
- Modify (UI): `app/src/components/topology/AdjacencyMatrix.tsx` (+ `app/src/app/topology/page.tsx` toggle) and `app/src/components/charts/Heatmap.tsx` if a health-coloring path is needed
- i18n: `ko.json` / `en.json`

**Interfaces:**
- Consumes: `ratePerGb` (`aggregate.ts`), `STATUS` (`chart-tokens.ts`), `FlowEdge`.
- Produces: `type HealthStatus = 'ok' | 'warn' | 'danger'`; `HealthCell { row: string; col: string; status: HealthStatus; retransRate: number; timeoutRate: number; bytes: number }`; `HealthMatrix { rows: string[]; cols: string[]; cells: HealthCell[] }`; `buildHealthMatrix(flows: FlowEdge[], level: 'service' | 'namespace' | 'az' | 'vpc', opts?: { retransWarn?: number; retransDanger?: number; timeoutWarn?: number; timeoutDanger?: number }): HealthMatrix`.

**Context:** `AdjacencyMatrix` (`components/topology/AdjacencyMatrix.tsx`) currently colors cells by raw metric magnitude via `Heatmap` — NOT by health. Datadog CNM's signature is a source→dest grid colored GREEN/AMBER/RED by connection health. Compute per source→dest (by `level`) group: sum RETRANSMISSIONS/TIMEOUTS/DATA_TRANSFERRED, derive rates via `ratePerGb`, map to status by threshold (worst of retrans/timeout).

- [ ] **Step 1: Failing test** (`edge-health.test.ts`)
```ts
import { buildHealthMatrix } from './edge-health';
const f = (src: string, dst: string, metric: any, value: number): FlowEdge => ({ edgeHash: `${src}-${dst}`,
  monitor: 'm', metric, category: 'INTER_AZ', bucket: 'b', value, unit: 'x',
  a: { serviceName: src }, b: { serviceName: dst }, traversedConstructs: [] });
it('buildHealthMatrix: worst-of retrans/timeout status per source→dest', () => {
  const flows = [
    f('a', 'b', 'DATA_TRANSFERRED', 1e9), f('a', 'b', 'RETRANSMISSIONS', 100), // 100/GB → danger
    f('c', 'd', 'DATA_TRANSFERRED', 1e9), f('c', 'd', 'RETRANSMISSIONS', 0),   // 0 → ok
  ];
  const m = buildHealthMatrix(flows, 'service', { retransWarn: 10, retransDanger: 50, timeoutWarn: 10, timeoutDanger: 50 });
  expect(m.cells.find((c) => c.row === 'a' && c.col === 'b')!.status).toBe('danger');
  expect(m.cells.find((c) => c.row === 'c' && c.col === 'd')!.status).toBe('ok');
  expect(m.rows).toContain('a'); expect(m.cols).toContain('b');
});
it('buildHealthMatrix empty → empty matrix', () => {
  expect(buildHealthMatrix([], 'service')).toEqual({ rows: [], cols: [], cells: [] });
});
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `edge-health.ts`.** Key each source→dest by the endpoint field for `level` (service→`serviceName`, namespace→`podNamespace`, az→`az`, vpc→`vpcId`; skip flows missing either side's key). Sum bytes/retrans/timeouts per (row,col). `retransRate = ratePerGb(retrans, bytes)`, `timeoutRate = ratePerGb(timeouts, bytes)`. `status` = danger if either rate ≥ its danger threshold, else warn if either ≥ its warn threshold, else ok. Defaults: retransWarn 10, retransDanger 50, timeoutWarn 10, timeoutDanger 50 (align with `overview-metrics.ts` constants — import if exported, else define shared consts, no magic numbers). Sort `rows`/`cols` (unique, ascending). Return `{ rows, cols, cells }`.
- [ ] **Step 4: Run — expect PASS.** `tsc --noEmit`.
- [ ] **Step 5: Render.** Give `AdjacencyMatrix` a `mode: 'metric' | 'health'` prop (default `'metric'` — existing behavior untouched). In `'health'` mode, build cells via `buildHealthMatrix(flows, level)` and color each cell with `STATUS[cell.status]` (dual-encode: also show the rate in the cell/tooltip). Add a health/metric toggle on `app/src/app/topology/page.tsx` (a `Select` or segmented button, testId `topology-matrix-mode`) plus a STATUS legend (ok/warn/danger). Keep the existing metric matrix + tier-map + hop-path panel intact. The `/topology` page must pass `flows` to the matrix in health mode (fetch via the existing topology/flows data source — reuse what the page already loads; if it only has a `TopologySnapshot`, add a flows fetch guarded to health mode). Mobile: matrix scrolls in its own `overflow-x-auto` container (already the pattern). testId `adjacency-matrix-health`.
- [ ] **Step 6: Build + commit** `feat(app): edge-health adjacency matrix (RED/AMBER/GREEN) on topology`.

---

## Task 9: Finalize — review + v1.5.0 + deploy

- [ ] **Step 1: Green gate.** `npx -w app vitest run` (all pass), `npx -w app tsc --noEmit` (clean), `npm -w app run build` (success). Confirm every new testId renders and no existing testId/page data changed.
- [ ] **Step 2: Final whole-branch adversarial review** (dispatch code-reviewer on the strongest model) over `git merge-base main HEAD`..HEAD. Focus: lens correctness (percentile/entropy/Gini/Pearson math + empty/zero-variance/single-element safety), no NaN/Infinity, DRY (`ratePerGb` extraction + `pairTotals` reuse — no re-forked formulas), i18n ko+en parity for ALL new keys, tokens-only (no hardcoded hex; STATUS dual-encoded), no regressed testIds/e2e contract, mobile no-h-scroll (esp. Task 8 matrix), light+dark. Fix Critical/Important; log Minor.
- [ ] **Step 3: Version bump v1.5.0.** `app/src/lib/version.ts` `APP_VERSION = '1.5.0'`; `app/package.json` `"version": "1.5.0"`; `CHANGELOG.md` add `## [1.5.0] - <today>` under BOTH `# English` and `# 한국어` (### Added: the 8 metrics; note WI-RTT infeasibility → correlation substitute) + reference links `[1.5.0]`/update `[Unreleased]` in both blocks. `npx -w app vitest run src/lib/version.test.ts` passes.
- [ ] **Step 4: Commit** `chore(release): v1.5.0 — metric enrichment first wave (8 operator metrics)`. Merge `--no-ff` to `main`.
- [ ] **Step 5: Deploy (USER-AUTHORIZED).** `bash scripts/build-push.sh <sha>` → `cd infra && npx cdk deploy NfmDash-App --require-approval never -c imageTag=<sha>`. Verify: stack UPDATE_COMPLETE, ECS rollout COMPLETED + running image tag = `<sha>`, ALB target healthy, CloudFront `/login` 200 + `/`→302.
- [ ] **Step 6: Prod smoke.** `bash scripts/smoke.sh` (3/3) + headless authenticated check that the new surfaces render (network retrans header, latency p99/tail, monitor chips, overview golden strip, reliability r badge, dependencies concentration, movers silent, topology health matrix) light+dark, mobile no-h-scroll.

---

## Phase 11 self-review checklist
- [ ] 8 metrics each: pure lens (TDD, empty/zero-variance safe) + UI surface + ko/en i18n + tokens.
- [ ] `ratePerGb` extracted once to `aggregate.ts`; no re-forked rate/percentile/keying formulas (DRY).
- [ ] WI-RTT correctly dropped (API-infeasible) and replaced by RTT↔retrans correlation.
- [ ] No existing testId/page-data/e2e contract changed; new testIds follow conventions.
- [ ] Mobile no-h-scroll (Task 8 matrix scrolls in-container); light+dark first-class.
- [ ] v1.5.0 synced (version.ts + package.json + CHANGELOG EN+KR); full suite + build green; final review clean; deployed + prod smoke — Task 9.
