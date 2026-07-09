# Phase 2 — Aggregation Library + Chart Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. All subagents Fable 5.

**Goal:** Build the server-side analytics aggregation library (5 lenses: cost/reliability/latency/dependencies/dns), expose them as `/api/analytics/*` routes, and add the new chart component library (12 charts) — so Phase 3+ (topology, hub, pages) can render rich insights.

**Architecture:** Pure aggregation functions in `app/src/lib/analytics/*` computed at read time from DynamoDB flows (recent N buckets) + `DNS#latest` (Phase 1) + CloudWatch. API routes assemble + serve them. Chart components are recharts wrappers + a few custom SVG (heatmap/region-arc/icicle/swimlane/sankey), token-colored, dark-safe, with empty states.

**Tech Stack:** Next.js 16 (App Router, React 19), TypeScript, recharts ^3.9.2, lucide-react, vitest + @testing-library/react. No new deps except recharts already present.

## Global Constraints

(inherits master index `2026-07-08-analytics-enrichment-index.md`. Key for this phase:)
- Account <ACCOUNT_ID> / ap-northeast-2. arm64. Next 16 + Tailwind v4 (`@config`). React 19.
- 7 categories: INTRA_AZ, INTER_AZ, INTER_VPC, UNCLASSIFIED, AMAZON_S3, AMAZON_DYNAMODB, INTER_REGION.
- Cost rate `AZ_TRANSFER_USD_PER_GB=0.01` (INTER_AZ + INTER_VPC + INTER_REGION billed; INTRA_AZ/UNCLASSIFIED/S3/DDB = 0). Reliability thresholds `DEFAULT_RETRANS_RATE=10`, `DEFAULT_TIMEOUT_RATE=5` (events per GB).
- Aggregation semantics (AWS parity §15.4): DataTransferred=sum for talkers but AVG for the overview tile; Retransmissions/Timeouts=sum; RTT=min (best-case) + p50/p90/p95.
- All UI strings via `t()` (ko/en). SnowUI tokens, theme-aware. dataviz: color+shape dual-encoding, empty states, dark-safe. No hex hardcoded in components — use chart-tokens.
- API routes: `export const dynamic='force-dynamic'`, try/catch → 500 `{error:'internal error'}` + console.error; empty data → 200 + empty structure.
- conventional commits. TDD for all pure functions.

## Existing interfaces (Phase 1 + base — consume, don't redefine)

```ts
// app/src/lib/types.ts (already 7-category)
type MetricName = 'DATA_TRANSFERRED'|'RETRANSMISSIONS'|'TIMEOUTS'|'ROUND_TRIP_TIME';
type DestCategory = 'INTRA_AZ'|'INTER_AZ'|'INTER_VPC'|'UNCLASSIFIED'|'AMAZON_S3'|'AMAZON_DYNAMODB'|'INTER_REGION';
interface EndpointInfo { ip?; instanceId?; subnetId?; az?; vpcId?; region?; podName?; podNamespace?; serviceName?; }
interface FlowEdge { edgeHash; monitor; metric: MetricName; category: DestCategory; bucket; value; unit;
  a: EndpointInfo; b: EndpointInfo; snatIp?; dnatIp?; targetPort?; traversedConstructs: TraversedComponent[]; }
// ddb.ts: recentBuckets(n), getTopology(), getCollectionStatus(), getCoverage(), getWorkloadInsights(),
//   queryFlowsByBucket(bucket, monitor?), queryPodFlows(ns,pod,limit), queryEdgeSeries(edgeHash,limit)
// format.ts: formatBytes, formatCount, formatMetricValue, formatMicros
// use-polling.ts: usePolling<T>(url, ms=30000) → { data, error, loading, refresh }
// DynamoDB nfm-dashboard-meta DNS#latest/all → item.dns = DnsAggregate (Phase 1 collector/src/dns.ts):
//   { enabled, topDomains[], failures[], latency{p50,p90,p95,max,count}, queryTypes[], resolution{nodes,links}, nameFlow[] }
// Existing charts: TimeSeries, CategoryBars, CategoryDonut, ChartTooltip
```

## Shared interfaces (this phase — produced here, consumed by Phase 3/4)

```ts
// app/src/lib/analytics/aggregate.ts
export type EntityKind = 'pod'|'service'|'namespace'|'az'|'azpair'|'vpc';
export interface Series { label: string; points: { t: string; v: number }[]; }
export function entityKey(e: EndpointInfo, kind: EntityKind): string;   // stable label per entity
export function percentile(sortedAsc: number[], p: number): number;
export function sumByMetric(flows: FlowEdge[], metric: MetricName): number;
// cost.ts
export const AZ_TRANSFER_USD_PER_GB = 0.01;
export interface CostRow { key: string; label: string; bytes: number; usd: number; category: DestCategory; }
export function bytesToUsd(bytes: number, category: DestCategory): number;
// reliability.ts
export interface ReliabilityRow { key: string; label: string; bytes: number;
  retransmissions: number; timeouts: number; retransRate: number; timeoutRate: number; }
export const DEFAULT_RETRANS_RATE = 10; export const DEFAULT_TIMEOUT_RATE = 5;
// latency.ts
export interface LatencyStats { p50: number; p90: number; p95: number; min: number; max: number; count: number; }
// All API responses are the exact shapes in spec §6 (cost/reliability/latency/dependencies) + DnsAggregate (dns).
```

## File Structure

```
app/src/lib/chart-tokens.ts          # Modify — 7-category CATEGORY_COLORS, STATUS colors, 8 SERIES_COLORS
app/src/lib/analytics/aggregate.ts   # NEW — entityKey, percentile, sumByMetric, groupBy
app/src/lib/analytics/cost.ts        # NEW
app/src/lib/analytics/reliability.ts # NEW
app/src/lib/analytics/latency.ts     # NEW
app/src/lib/analytics/dependencies.ts# NEW
app/src/lib/analytics/*.test.ts      # NEW — TDD per module
app/src/lib/ddb.ts                   # Modify — add getDns(), getFlowsWindow(n)
app/src/app/api/analytics/{cost,reliability,latency,dependencies,dns}/route.ts  # NEW
app/src/components/charts/{StatDelta,Scatter,StreamGraph,Pareto,Treemap,Distribution,Gauge}.tsx  # NEW (recharts)
app/src/components/charts/{Heatmap,RegionArcMap,Icicle,Swimlane,Sankey}.tsx  # NEW (custom SVG / recharts Sankey)
app/src/lib/i18n/translations/{ko,en}.json  # Modify — chart/lens labels
```

## Task sequence

| # | Task | Deliverable |
|---|---|---|
| 1 | chart-tokens 7종 + status + series8 | tokens unified, tests |
| 2 | aggregate.ts shared helpers | entityKey/percentile/sumByMetric/groupBy (TDD) |
| 3 | cost.ts | 5 fns (TDD) |
| 4 | reliability.ts | 5 fns (TDD) |
| 5 | latency.ts | 5 fns (TDD) |
| 6 | dependencies.ts | 5 fns (TDD) |
| 7 | ddb getDns/getFlowsWindow + 5 analytics API routes | routes live-verified |
| 8 | recharts charts (StatDelta/Scatter/StreamGraph/Pareto/Treemap/Distribution/Gauge) | components + render smoke |
| 9 | custom charts (Heatmap/RegionArcMap/Icicle/Swimlane/Sankey) | components + render smoke |

---

## Task 1: chart-tokens — 7 categories + status colors + 8 series

**Files:** Modify `app/src/lib/chart-tokens.ts`; Test `app/src/lib/chart-tokens.test.ts`

**Interfaces:**
- Produces: `CATEGORY_COLORS: Record<DestCategory,string>` (all 7), `CATEGORY_ORDER: DestCategory[]` (7), `STATUS: {ok,warn,danger}`, `SERIES_COLORS` (8). Import `DestCategory` from `./types` (remove the local 3-union).

- [ ] **Step 1: Failing test**

```ts
// app/src/lib/chart-tokens.test.ts
import { it, expect } from 'vitest';
import { CATEGORY_COLORS, CATEGORY_ORDER, SERIES_COLORS, STATUS } from './chart-tokens';
import type { DestCategory } from './types';

it('every DestCategory has a color', () => {
  const cats: DestCategory[] = ['INTRA_AZ','INTER_AZ','INTER_VPC','UNCLASSIFIED','AMAZON_S3','AMAZON_DYNAMODB','INTER_REGION'];
  for (const c of cats) expect(CATEGORY_COLORS[c]).toMatch(/^#[0-9A-Fa-f]{6}$/);
  expect(CATEGORY_ORDER).toHaveLength(7);
});
it('status + 8 series colors', () => {
  expect(STATUS.ok).toMatch(/^#/); expect(STATUS.warn).toMatch(/^#/); expect(STATUS.danger).toMatch(/^#/);
  expect(SERIES_COLORS.length).toBeGreaterThanOrEqual(8);
});
```

- [ ] **Step 2: FAIL** — `npx -w app vitest run chart-tokens`
- [ ] **Step 3: Implement** — add to TOKENS two extra pastel hues (e.g. `chartAmber:'#FFE5B4'`, `chartRose:'#FFD6E0'`, `chartTeal:'#A1E3CB'`, `chartGrey:'#C9D0DA'`); import `DestCategory` from `./types`; `CATEGORY_COLORS` maps all 7 (INTRA_AZ chartViolet, INTER_AZ chartBlue, INTER_VPC accentMint, UNCLASSIFIED chartGrey, AMAZON_S3 chartAmber, AMAZON_DYNAMODB chartSky, INTER_REGION chartRose); `CATEGORY_ORDER` the 7 in that order; `STATUS = { ok: TOKENS.accentMint, warn: '#FFE5B4', danger: '#FFB4B4' }`; `SERIES_COLORS` = 8 distinct token hues. Keep existing exports (TOKENS). Remove local `DestCategory` type. Fix any importer that relied on the local 3-union (only chart-tokens itself + consumers using CATEGORY_COLORS — they now get 7, safe).
- [ ] **Step 4: PASS** — `npx -w app vitest run chart-tokens`; `npx -w app tsc --noEmit` clean (the earlier Phase-1 adaptation in TopologyGraph/insights may now type-check more cleanly — verify build).
- [ ] **Step 5: Commit** — `git add app/src/lib/chart-tokens.* && git commit -m "feat(app): 7-category colors + status + 8 series in chart-tokens"`

---

## Task 2: aggregate.ts shared helpers (TDD)

**Files:** Create `app/src/lib/analytics/aggregate.ts`, `app/src/lib/analytics/aggregate.test.ts`

**Interfaces (produce):**
- `entityKey(e: EndpointInfo, kind: EntityKind): string` — pod: `<ns>/<pod>`; service: `<ns>/<svc>` (fallback pod then ip); namespace: `<ns>` (fallback 'unknown'); az: `<az>`; azpair not here (edge-level); vpc: `<vpcId>`. Missing → 'unknown'.
- `percentile(sortedAsc: number[], p: number): number` — nearest-rank, clamp, empty→0.
- `sumByMetric(flows: FlowEdge[], metric: MetricName): number`.
- `groupBy<T>(items: T[], keyFn: (t:T)=>string): Map<string,T[]>`.

- [ ] **Step 1: Failing test**

```ts
// app/src/lib/analytics/aggregate.test.ts
import { it, expect } from 'vitest';
import { entityKey, percentile, sumByMetric, groupBy } from './aggregate';
import type { FlowEdge } from '../types';

it('entityKey by kind', () => {
  const e = { podNamespace:'shop', podName:'api-1', serviceName:'api', instanceId:'i-1', az:'az1', vpcId:'vpc-1' };
  expect(entityKey(e,'pod')).toBe('shop/api-1');
  expect(entityKey(e,'service')).toBe('shop/api');
  expect(entityKey(e,'namespace')).toBe('shop');
  expect(entityKey(e,'az')).toBe('az1');
  expect(entityKey(e,'vpc')).toBe('vpc-1');
  expect(entityKey({},'pod')).toBe('unknown');
});
it('percentile nearest-rank + empty', () => {
  expect(percentile([],50)).toBe(0);
  expect(percentile([1,2,3,4],50)).toBe(2);
  expect(percentile([1,2,3,4],100)).toBe(4);
});
it('sumByMetric filters by metric', () => {
  const f = [{metric:'TIMEOUTS',value:3},{metric:'DATA_TRANSFERRED',value:10},{metric:'TIMEOUTS',value:2}] as FlowEdge[];
  expect(sumByMetric(f,'TIMEOUTS')).toBe(5);
});
it('groupBy', () => {
  const g = groupBy([{k:'a'},{k:'b'},{k:'a'}], x => x.k);
  expect(g.get('a')).toHaveLength(2);
});
```

- [ ] **Step 2: FAIL** → **Step 3: Implement** (per interfaces) → **Step 4: PASS** (`npx -w app vitest run aggregate`) → **Step 5: Commit** `feat(app): analytics aggregate helpers`.

---

## Task 3: cost.ts (TDD)

**Files:** Create `app/src/lib/analytics/cost.ts`, `cost.test.ts`
**Interfaces (produce):**
- `bytesToUsd(bytes, category)`: billed categories = INTER_AZ, INTER_VPC, INTER_REGION → `(bytes/1e9)*AZ_TRANSFER_USD_PER_GB`; others (INTRA_AZ/UNCLASSIFIED/AMAZON_S3/AMAZON_DYNAMODB) → 0.
- `topCostContributors(flows, kind='service', n=20): CostRow[]` — group DATA_TRANSFERRED flows by edge (a,b entityKey pair), sum bytes→usd, desc, top n.
- `costByCategorySeries(flows): Series[]` — per-category usd per bucket.
- `regionArcs(flows): {from,to,bytes,usd}[]` — INTER_REGION flows grouped by a.region→b.region (exclude same/missing region).
- `categoryStream(flows): {t,values:Record<DestCategory,number>}[]` — per-bucket bytes by category.
- `costLens(flows)` → the spec §6.1 response `{ totalUsd, byCategory, top, series, regionArcs, stream }`.

- [ ] **Step 1: Failing test**

```ts
// app/src/lib/analytics/cost.test.ts
import { it, expect } from 'vitest';
import { bytesToUsd, costLens } from './cost';
import type { FlowEdge } from '../types';

it('bytesToUsd bills only inter-az/vpc/region', () => {
  expect(bytesToUsd(1e9,'INTER_AZ')).toBeCloseTo(0.01);
  expect(bytesToUsd(1e9,'INTER_VPC')).toBeCloseTo(0.01);
  expect(bytesToUsd(1e9,'INTER_REGION')).toBeCloseTo(0.01);
  expect(bytesToUsd(1e9,'INTRA_AZ')).toBe(0);
  expect(bytesToUsd(1e9,'AMAZON_S3')).toBe(0);
});
it('costLens totals + region arcs', () => {
  const flows = [
    { metric:'DATA_TRANSFERRED', category:'INTER_AZ', bucket:'b1', value:2e9, a:{az:'a'}, b:{az:'b'} },
    { metric:'DATA_TRANSFERRED', category:'INTER_REGION', bucket:'b1', value:1e9,
      a:{region:'ap-northeast-2'}, b:{region:'us-east-1'} },
    { metric:'DATA_TRANSFERRED', category:'INTRA_AZ', bucket:'b1', value:5e9, a:{az:'a'}, b:{az:'a'} },
  ] as any;
  const c = costLens(flows);
  expect(c.totalUsd).toBeCloseTo(0.03);  // 2e9*.01 + 1e9*.01 (intra=0)
  expect(c.regionArcs).toContainEqual(expect.objectContaining({ from:'ap-northeast-2', to:'us-east-1' }));
  expect(c.byCategory.INTER_AZ.usd).toBeCloseTo(0.02);
});
```

- [ ] **Step 2: FAIL** → **Step 3: Implement** (use aggregate.ts helpers; only DATA_TRANSFERRED flows contribute bytes/usd) → **Step 4: PASS** `npx -w app vitest run cost` → **Step 5: Commit** `feat(app): cost analytics lens`.

## Task 4: reliability.ts (TDD)

**Files:** Create `app/src/lib/analytics/reliability.ts`, `reliability.test.ts`
**Interfaces (produce):**
- `ratePer(flows, kind='service'): ReliabilityRow[]` — per entity: sum bytes(DATA_TRANSFERRED), retransmissions(RETRANSMISSIONS), timeouts(TIMEOUTS); `retransRate = retransmissions / max(bytes/1e9, 1e-9)` (0 when bytes=0), `timeoutRate` likewise. Attribute a flow's counts to BOTH endpoints' entities.
- `thresholdBreaches(rows, {retransRate=DEFAULT_RETRANS_RATE, timeoutRate=DEFAULT_TIMEOUT_RATE}): ReliabilityRow[]` — rows exceeding either threshold, desc by max(rate/threshold).
- `nhiTimeline(cwHealthIndicator: Series): Series` — passthrough/normalize CW HealthIndicator (Maximum) to a 0/1 series.
- `nhiSwimlanes(cwByMonitor: Record<string,Series>): {monitor,points:{t,healthy:boolean}[]}[]`.
- `rttVsRetrans(flows, sampleCap=500): {key,label,rtt,retransmissions,bytes}[]` — per edge join RTT + RETRANSMISSIONS; exclude edges w/o RTT; cap sample (log dropped count).
- `reliabilityLens(flows, cw?)` → spec §6.2 response `{ hotspots, breaches, nhi, nhiSwimlanes, scatter }`.

- [ ] **Step 1: Failing test**

```ts
// app/src/lib/analytics/reliability.test.ts
import { it, expect } from 'vitest';
import { ratePer, thresholdBreaches, reliabilityLens } from './reliability';
import type { FlowEdge } from '../types';

const flows = [
  { edgeHash:'e1', metric:'DATA_TRANSFERRED', value:1e9, a:{podNamespace:'shop',serviceName:'api'}, b:{podNamespace:'shop',serviceName:'db'} },
  { edgeHash:'e1', metric:'RETRANSMISSIONS', value:30, a:{podNamespace:'shop',serviceName:'api'}, b:{podNamespace:'shop',serviceName:'db'} },
  { edgeHash:'e1', metric:'TIMEOUTS', value:2, a:{podNamespace:'shop',serviceName:'api'}, b:{podNamespace:'shop',serviceName:'db'} },
  { edgeHash:'e1', metric:'ROUND_TRIP_TIME', value:900, a:{podNamespace:'shop',serviceName:'api'}, b:{podNamespace:'shop',serviceName:'db'} },
] as any as FlowEdge[];

it('ratePer normalizes per GB', () => {
  const rows = ratePer(flows,'service');
  const api = rows.find(r => r.key==='shop/api')!;
  expect(api.retransRate).toBeCloseTo(30);   // 30 / (1e9/1e9)
  expect(api.timeoutRate).toBeCloseTo(2);
});
it('thresholdBreaches flags high retrans', () => {
  expect(thresholdBreaches(ratePer(flows,'service'),{retransRate:10,timeoutRate:5}).length).toBeGreaterThan(0);
});
it('reliabilityLens scatter joins rtt+retrans', () => {
  const rl = reliabilityLens(flows);
  expect(rl.scatter.find(s => s.rtt===900 && s.retransmissions===30)).toBeTruthy();
});
```

- [ ] **Step 2: FAIL** → **Step 3: Implement** → **Step 4: PASS** `npx -w app vitest run reliability` → **Step 5: Commit** `feat(app): reliability analytics lens`.

## Task 5: latency.ts (TDD)

**Files:** Create `app/src/lib/analytics/latency.ts`, `latency.test.ts`
**Interfaces (produce):**
- `percentilesOf(rttValues: number[]): LatencyStats` — {p50,p90,p95,min,max,count} via aggregate.percentile; empty→zeros.
- `intraVsInter(flows): {intra:LatencyStats, inter:LatencyStats}` — RTT flows split INTRA_AZ vs INTER_AZ.
- `slowestPaths(flows, n=20): {key,label,rtt,edgeHash}[]` — top RTT edges desc.
- `rttTrend(flows): Series` — per-bucket avg RTT.
- `rttByHourHeatmap(flows): {day,hour,value,count}[]` — bucket ts → (day-of-week, hour) avg RTT.
- `latencyLens(flows)` → spec §6.3 `{ overall, intra, inter, slowest, trend, distribution, hourHeatmap }` (distribution = histogram bins of RTT ms).

- [ ] **Step 1: Failing test**

```ts
// app/src/lib/analytics/latency.test.ts
import { it, expect } from 'vitest';
import { percentilesOf, latencyLens } from './latency';
import type { FlowEdge } from '../types';

it('percentilesOf', () => {
  const s = percentilesOf([100,200,300,400]);
  expect(s.min).toBe(100); expect(s.max).toBe(400); expect(s.count).toBe(4); expect(s.p50).toBe(200);
  expect(percentilesOf([]).count).toBe(0);
});
it('latencyLens splits intra/inter + trend', () => {
  const flows = [
    { metric:'ROUND_TRIP_TIME', category:'INTRA_AZ', bucket:'2026-07-08T11:45:00Z', value:100, edgeHash:'e1', a:{}, b:{} },
    { metric:'ROUND_TRIP_TIME', category:'INTER_AZ', bucket:'2026-07-08T11:45:00Z', value:900, edgeHash:'e2', a:{}, b:{} },
  ] as any;
  const l = latencyLens(flows);
  expect(l.intra.max).toBe(100); expect(l.inter.max).toBe(900);
  expect(l.overall.count).toBe(2); expect(l.trend.points.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: FAIL** → **Step 3: Implement** → **Step 4: PASS** `npx -w app vitest run latency` → **Step 5: Commit** `feat(app): latency analytics lens`.

## Task 6: dependencies.ts (TDD)

**Files:** Create `app/src/lib/analytics/dependencies.ts`, `dependencies.test.ts`
**Interfaces (produce):**
- `serviceGraph(flows): {nodes:{name}[], links:{source,target,value}[]}` — service↔service (entityKey 'service') Sankey from DATA_TRANSFERRED, numeric-index links (name-collision-safe, like collector dns.ts resolution).
- `composition(flows): {ports:{port,count,bytes}[], namespaces:{key,bytes}[], categories:{category,bytes}[]}`.
- `hopUsage(flows): {type,count}[]` — traversedConstructs componentType counts (missing→'OTHER').
- `pathFrequencyTree(flows): {name,value,children}` — merge hop-type sequences into a prefix tree (root 'all').
- `paretoTalkers(flows, kind='service', metric='DATA_TRANSFERRED', n=20): {key,label,value,cumulativePct}[]`.
- `dependenciesLens(flows)` → spec §6.4 `{ sankey, ports, namespaces, categories, hops, pathTree, pareto }`.

- [ ] **Step 1: Failing test**

```ts
// app/src/lib/analytics/dependencies.test.ts
import { it, expect } from 'vitest';
import { paretoTalkers, hopUsage, dependenciesLens } from './dependencies';
import type { FlowEdge } from '../types';

it('paretoTalkers cumulative %', () => {
  const flows = [
    { metric:'DATA_TRANSFERRED', value:90, a:{podNamespace:'n',serviceName:'a'}, b:{podNamespace:'n',serviceName:'z'} },
    { metric:'DATA_TRANSFERRED', value:10, a:{podNamespace:'n',serviceName:'b'}, b:{podNamespace:'n',serviceName:'z'} },
  ] as any;
  const p = paretoTalkers(flows,'service');
  expect(p[0].cumulativePct).toBeCloseTo(90, 0);
  expect(p[p.length-1].cumulativePct).toBeCloseTo(100, 0);
});
it('hopUsage counts componentType, OTHER for missing', () => {
  const flows = [
    { metric:'DATA_TRANSFERRED', value:1, a:{}, b:{}, traversedConstructs:[{componentType:'TransitGateway'},{}] },
  ] as any;
  const h = hopUsage(flows);
  expect(h.find(x=>x.type==='TransitGateway')!.count).toBe(1);
  expect(h.find(x=>x.type==='OTHER')!.count).toBe(1);
});
it('dependenciesLens shape', () => {
  const l = dependenciesLens([{metric:'DATA_TRANSFERRED',value:1,a:{podNamespace:'n',serviceName:'a'},b:{podNamespace:'n',serviceName:'b'},traversedConstructs:[]}] as any);
  expect(l.sankey.nodes.length).toBeGreaterThan(0);
  expect(Array.isArray(l.pareto)).toBe(true);
  expect(l.pathTree.name).toBe('all');
});
```

- [ ] **Step 2: FAIL** → **Step 3: Implement** → **Step 4: PASS** `npx -w app vitest run dependencies` → **Step 5: Commit** `feat(app): dependencies analytics lens`.

## Task 7: ddb getDns/getFlowsWindow + 5 analytics API routes

**Files:** Modify `app/src/lib/ddb.ts`; Create `app/src/app/api/analytics/{cost,reliability,latency,dependencies,dns}/route.ts`; Test `app/src/lib/ddb.test.ts` (extend).

**Interfaces:**
- Consumes: Tasks 3-6 lens fns; existing `queryFlowsByBucket`, `recentBuckets`, `getWorkloadInsights`, cw-metrics.
- Produces: `getDns(): Promise<DnsAggregate|null>` (read `DNS#latest`/`all` → item.dns), `getFlowsWindow(n=12): Promise<FlowEdge[]>` (recentBuckets(n) → queryFlowsByBucket each, concat). Routes call getFlowsWindow → lens fn → JSON. `/api/analytics/dns` returns `getDns() ?? {enabled:false,...empty}`.

- [ ] **Step 1: Failing test** — `getFlowsWindow(3)` issues 3 bucket queries and concats (mock queryFlowsByBucket via the DDB mock); `getDns` returns the `dns` attr or null.

```ts
// add to app/src/lib/ddb.test.ts
import { getFlowsWindow, getDns } from './ddb';
// (use aws-sdk-client-mock DynamoDBDocumentClient; mock Query per bucket returns 1 flow; GetItem DNS#latest returns {dns:{enabled:true}})
it('getFlowsWindow concats recent buckets', async () => { /* mock → expect length === buckets*perBucket */ });
it('getDns returns dns attr or null', async () => { /* mock GetItem → expect {enabled:true}; missing → null */ });
```

- [ ] **Step 2: FAIL** → **Step 3: Implement** ddb additions + 5 routes (each `dynamic='force-dynamic'`, try/catch→500). 
- [ ] **Step 4: PASS + live verify** — `npx -w app vitest run ddb`; `npm -w app run build`; `AUTH_DISABLED=1 npm -w app run dev` PORT 3030, then:
  `for p in cost reliability latency dependencies dns; do echo "/$p"; curl -s "localhost:3030/api/analytics/$p" | head -c 200; echo; done`
  Expect real JSON (flows have 7 categories now; dns enabled=true). Kill dev. Record.
- [ ] **Step 5: Commit** `feat(app): analytics api routes + ddb getDns/getFlowsWindow`.

## Task 8: recharts chart components (StatDelta/Scatter/StreamGraph/Pareto/Treemap/Distribution/Gauge)

**Files:** Create the 7 components in `app/src/components/charts/`; Test `app/src/components/charts/charts-recharts.test.tsx` (render smoke — mount each with sample data + empty data, assert no throw + a testid present).

**Interfaces (produce — props each component accepts):**
- `StatDelta({ label, value, unit?, deltaPct?, trend?: 'up'|'down'|'flat', spark?: number[], status?: 'ok'|'warn'|'danger' })` — big value + delta badge (▲/▼ + %) + mini sparkline (recharts Line, no axes) + status color (dual-encode: icon + color). testid `stat-<label>` slug.
- `Scatter({ points: {x,y,label?}[], xLabel, yLabel })` — recharts ScatterChart, 4-quadrant reference lines at medians, token color, tooltip, empty state.
- `StreamGraph({ data: {t,values:Record<string,number>}[], keys: string[], colors?: Record<string,string> })` — recharts stacked AreaChart (stackOffset 'wiggle' for stream, or 'expand' for 100%); CATEGORY_COLORS for category keys.
- `Pareto({ rows: {label,value,cumulativePct}[] })` — recharts ComposedChart: bars(value) + line(cumulativePct on right axis 0-100).
- `Treemap({ data: {name,value}[] })` — recharts Treemap, SERIES_COLORS, value labels.
- `Distribution({ bins: {bucketMs,count}[], unit?='ms' })` — recharts BarChart histogram.
- `Gauge({ value, max, label, status? })` — semicircular gauge (recharts RadialBarChart or custom arc), status color.

Rules: all use chart-tokens (no hex), ResponsiveContainer, dark-safe (via CSS vars / token hues), empty-state (`t('chart.empty')`) when data empty, `'use client'`. Reuse existing ChartTooltip where a tooltip is needed.

- [ ] **Step 1: Render smoke test** (mount each with data + empty; assert renders, empty shows chart.empty). RED (components missing).
- [ ] **Step 2: FAIL** → **Step 3: Implement 7 components** → **Step 4: PASS** `npx -w app vitest run charts-recharts` + `npm -w app run build` (recharts SSR/client boundary — mark `'use client'`).
- [ ] **Step 5: Commit** `feat(app): recharts chart components (statdelta/scatter/stream/pareto/treemap/distribution/gauge)`.

## Task 9: custom chart components (Heatmap/RegionArcMap/Icicle/Swimlane/Sankey)

**Files:** Create the 5 components in `app/src/components/charts/`; Test `charts-custom.test.tsx` (render smoke + empty).

**Interfaces (produce):**
- `Heatmap({ rows: string[], cols: string[], cells: {row,col,value}[], colorScale?, unit? })` — CSS grid, cell bg = value→token-based scale (light→dark within a hue), value on hover/label; dual-encode with a legend. Used for AZ×AZ, adjacency matrix (Phase 3), DNS failure (ns×rcode), hour×day.
- `RegionArcMap({ arcs: {from,to,bytes,usd}[] })` — schematic (NOT geo): region nodes laid on a circle/columns, arcs (SVG paths) width∝bytes; labels + usd. Empty state.
- `Icicle({ tree: {name,value,children} })` — flame/icicle SVG: horizontal levels, width∝value, SERIES_COLORS by depth, hover label. Used for path-frequency tree.
- `Swimlane({ lanes: {monitor,points:{t,healthy:boolean}[]}[] })` — parallel horizontal bands per monitor, green(ok)/rose(degraded) segments over time, legend.
- `Sankey({ data: {nodes:{name}[], links:{source,target,value}[]} })` — recharts Sankey (v3 has it) wrapper, token colors, node labels, empty state; handle self-link/empty gracefully.

Rules: same as Task 8 (chart-tokens, dark-safe, empty-state, 'use client', responsive). SVG components use viewBox + preserveAspectRatio for responsiveness.

- [ ] **Step 1: Render smoke test** (each with data + empty). RED.
- [ ] **Step 2: FAIL** → **Step 3: Implement 5 components** → **Step 4: PASS** `npx -w app vitest run charts-custom` + `npm -w app run build`.
- [ ] **Step 5: Commit** `feat(app): custom chart components (heatmap/regionarc/icicle/swimlane/sankey)`.

---

## Phase 2 self-review checklist (before finishing branch)
- [ ] chart-tokens: all 7 categories + status + 8 series — Task 1.
- [ ] 5 lens libs (cost/reliability/latency/dependencies + aggregate) TDD, shapes match spec §6 — Tasks 2-6.
- [ ] DNS lens served by reading DNS#latest (no recompute) — Task 7.
- [ ] 5 analytics API routes live-verified against real 7-category + DNS data — Task 7.
- [ ] 12 new chart components render + empty states + tokens (no hex) — Tasks 8-9.
- [ ] Full app suite green + build clean. No secrets. Aggregation semantics per §15.4 (RTT min + percentiles; retrans/timeout sum; cost only billed categories).
- [ ] Note for Phase 3/4: charts + lens response shapes are the contract the hub/topology consume.
