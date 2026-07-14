# Network-Observability Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four Datadog/Hubble-parity features feasible on NFM data — port/service traffic mix (G1), internet-egress cost by domain (G2), DNS resolver comparison (G3), and a composite-condition view (G5).

**Architecture:** Three app-only pure lenses + UI wiring (G1/G2/G5) plus one collector aggregation change with an app UI (G3). All USD via `cost.ts`; all lenses pure (no I/O). Follow existing lens/scope/Toplist/tab patterns.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4 (SnowUI tokens), vitest + @testing-library/react; collector = esbuild Lambda (vitest).

## Global Constraints

- All USD math via `cost.ts` — billed categories through `bytesToUsd`; internet egress through a NEW `egressBytesToUsd` (its own rate `INTERNET_EGRESS_USD_PER_GB`). No pricing recomputed elsewhere.
- All UI strings via `t()` in BOTH `app/src/lib/i18n/translations/ko.json` and `en.json`.
- Colors only from `app/src/lib/chart-tokens.ts` (`STATUS`/`TOKENS`); severity/health dual-encoded.
- Tests co-located; repo has NO jest-dom and NO vitest globals — import from `vitest`; component tests use `@testing-library/react` + `.toBeTruthy()`/`.getAttribute()`/`.textContent` + `afterEach(cleanup)` (reference `AnomalyDetailPanel.test.tsx`).
- Lenses are pure functions, no `Date.now()`/I/O; tests co-located `*.test.ts`.
- G3 changes the collector: mirror the `DnsAggregate` type in BOTH `collector/src/types.ts`-consumers and `app/src/lib/types.ts` region that declares it; keep all existing `DnsAggregate` fields byte-identical (additive `bySource` only); note the `NfmDash-Data` redeploy + backfill latency.
- `FlowEdge` fields available: `metric`, `category` (`DestCategory`), `value` (bytes for DATA_TRANSFERRED), `targetPort?`, `a`/`b` (`EndpointInfo` with `ip?`). `DATA_TRANSFERRED` is the only byte-bearing metric.

---

### Task 1: G1 — Port/service traffic-mix lens + Network Analytics `port` scope

**Files:**
- Create: `app/src/lib/analytics/port-mix.ts`, `app/src/lib/analytics/port-mix.test.ts`
- Modify: `app/src/lib/analytics/network-analytics.ts` (`Scope` type, `SCOPES`, `scopeKey`)
- Modify: `app/src/app/network/page.tsx` (scope option already data-driven from `SCOPES` — verify it picks up `port` automatically) + i18n `scope.port`

**Interfaces:**
- Produces: `PORT_LABELS: Record<number,string>`, `portLabel(port: number | undefined): string`, `portMix(flows: FlowEdge[]): PortMixRow[]` where `PortMixRow = { port: number | null; label: string; bytes: number; retransmissions: number }`.

- [ ] **Step 1: Write the failing test** — create `app/src/lib/analytics/port-mix.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { portMix, portLabel } from './port-mix';
import type { FlowEdge } from '../types';

const flow = (targetPort: number | undefined, metric: FlowEdge['metric'], value: number): FlowEdge => ({
  edgeHash: `${targetPort}-${metric}`, monitor: 'm', metric, category: 'INTRA_AZ',
  bucket: '2026-07-14T00:00:00Z', value, unit: 'Bytes', a: {}, b: {}, targetPort, traversedConstructs: [],
});

describe('portMix', () => {
  it('labels well-known ports and falls back to port N / unknown', () => {
    expect(portLabel(443)).toBe('HTTPS (443)');
    expect(portLabel(12345)).toBe('port 12345');
    expect(portLabel(undefined)).toBe('unknown');
  });
  it('groups DATA_TRANSFERRED bytes by port, carries retransmissions, sorts desc', () => {
    const rows = portMix([
      flow(443, 'DATA_TRANSFERRED', 1000), flow(443, 'DATA_TRANSFERRED', 500),
      flow(443, 'RETRANSMISSIONS', 7), flow(5432, 'DATA_TRANSFERRED', 2000),
      flow(undefined, 'DATA_TRANSFERRED', 100),
    ]);
    expect(rows[0]).toMatchObject({ port: 5432, label: 'PostgreSQL (5432)', bytes: 2000 });
    const https = rows.find((r) => r.port === 443)!;
    expect(https).toMatchObject({ bytes: 1500, retransmissions: 7 });
    expect(rows.find((r) => r.port === null)).toMatchObject({ label: 'unknown', bytes: 100 });
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx -w app vitest run src/lib/analytics/port-mix.test.ts` → FAIL (unresolved import).

- [ ] **Step 3: Implement** `app/src/lib/analytics/port-mix.ts`:
```typescript
// Port/service traffic mix (Datadog/Hubble parity, feasible stand-in for a
// protocol view since NFM flows carry targetPort but no L4 protocol). Pure.
import type { FlowEdge } from '../types';

/** Well-known TCP/UDP dest ports → service label. Unknown ports render as `port N`. */
export const PORT_LABELS: Record<number, string> = {
  443: 'HTTPS (443)', 80: 'HTTP (80)', 53: 'DNS (53)', 5432: 'PostgreSQL (5432)',
  3306: 'MySQL (3306)', 6379: 'Redis (6379)', 27017: 'MongoDB (27017)',
  9092: 'Kafka (9092)', 22: 'SSH (22)', 8080: 'HTTP-alt (8080)',
};

export function portLabel(port: number | undefined): string {
  if (port == null) return 'unknown';
  return PORT_LABELS[port] ?? `port ${port}`;
}

export interface PortMixRow {
  port: number | null;
  label: string;
  bytes: number;
  retransmissions: number;
}

/** Group flows by targetPort: bytes from DATA_TRANSFERRED, retransmissions from
 *  RETRANSMISSIONS; sorted desc by bytes then port. undefined port → key null. */
export function portMix(flows: FlowEdge[]): PortMixRow[] {
  const acc = new Map<number | null, PortMixRow>();
  for (const f of flows) {
    const port = f.targetPort ?? null;
    const row = acc.get(port) ?? { port, label: portLabel(f.targetPort), bytes: 0, retransmissions: 0 };
    if (f.metric === 'DATA_TRANSFERRED') row.bytes += f.value;
    else if (f.metric === 'RETRANSMISSIONS') row.retransmissions += f.value;
    acc.set(port, row);
  }
  return [...acc.values()].sort(
    (x, y) => y.bytes - x.bytes || (y.port ?? -1) - (x.port ?? -1),
  );
}
```

- [ ] **Step 4: Run to verify pass** — `npx -w app vitest run src/lib/analytics/port-mix.test.ts` → PASS.

- [ ] **Step 5: Add `port` scope to Network Analytics.** In `app/src/lib/analytics/network-analytics.ts`:
  - Extend the type: `export type Scope = 'service' | 'namespace' | 'subnet' | 'az' | 'vpc' | 'category' | 'monitor' | 'port';`
  - Extend the array: add `'port'` to `export const SCOPES`.
  - In `scopeKey(flow, endpoint, scope)`, add a case BEFORE the default that ignores `endpoint` (port is a flow property, not per-endpoint): 
    ```typescript
    if (scope === 'port') return portLabel(flow.targetPort);
    ```
    Add `import { portLabel } from './port-mix';` at the top. (Verify the existing `scopeKey` switch/if structure and insert consistently.)

- [ ] **Step 6: i18n** — add `"scope.port": "Port"` to en.json and `"scope.port": "포트"` to ko.json (the network page renders scope options via `t('scope.'+s)`; verify and match the existing `scope.*` keys).

- [ ] **Step 7: Verify + commit** — `npx -w app vitest run && npx -w app tsc --noEmit` (all pass); then:
```bash
git add app/src/lib/analytics/port-mix.ts app/src/lib/analytics/port-mix.test.ts app/src/lib/analytics/network-analytics.ts app/src/lib/i18n/translations/ko.json app/src/lib/i18n/translations/en.json
git commit -m "feat(network): port/service traffic-mix lens + port scope"
```

---

### Task 2: G2 — Internet-egress cost by domain

**Files:**
- Modify: `app/src/lib/analytics/cost.ts` (add `INTERNET_EGRESS_USD_PER_GB` + `egressBytesToUsd`)
- Create: `app/src/lib/analytics/egress-domains.ts`, `app/src/lib/analytics/egress-domains.test.ts`
- Modify: `app/src/app/api/cost-explorer/route.ts` (add egress-by-domain to the response) + `app/src/app/cost/page.tsx` (Toplist section) + i18n

**Interfaces:**
- Consumes: `getDns()` → `DnsAggregate` (`nameFlow: {ip,name}[]`), `getFlowsWindow`.
- Produces: `cost.ts` `export const INTERNET_EGRESS_USD_PER_GB = 0.09;` + `export function egressBytesToUsd(bytes: number): number`; `egress-domains.ts` `export function egressByDomain(flows: FlowEdge[], nameFlow: {ip:string;name:string}[]): EgressDomainRow[]` where `EgressDomainRow = { domain: string; bytes: number; usd: number }`.

- [ ] **Step 1: Add the egress rate to cost.ts.** In `app/src/lib/analytics/cost.ts`, after the `AZ_TRANSFER_USD_PER_GB` block add:
```typescript
// Internet data-transfer-out (egress) rate — AWS first-tier ~$0.09/GB in
// ap-northeast-2. INTERNET is NOT in BILLED_CATEGORIES (bytesToUsd returns 0
// for it) because inter-AZ pricing doesn't apply; egress is priced separately.
// An estimate, like AZ_TRANSFER_USD_PER_GB (UI shows an "estimate" badge).
export const INTERNET_EGRESS_USD_PER_GB = 0.09;

/** Estimated USD for internet-egress bytes. */
export function egressBytesToUsd(bytes: number): number {
  return (bytes / 1e9) * INTERNET_EGRESS_USD_PER_GB;
}
```

- [ ] **Step 2: Write the failing test** — create `app/src/lib/analytics/egress-domains.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { egressByDomain } from './egress-domains';
import type { FlowEdge } from '../types';

const inet = (ip: string, value: number): FlowEdge => ({
  edgeHash: ip, monitor: 'm', metric: 'DATA_TRANSFERRED', category: 'INTERNET',
  bucket: 'b', value, unit: 'Bytes', a: {}, b: { ip }, traversedConstructs: [],
});

describe('egressByDomain', () => {
  it('maps external IPs to domains, sums bytes+usd, buckets unmapped as unresolved, desc by usd', () => {
    const nameFlow = [{ ip: '52.1.2.3', name: 's3.ap-northeast-2.amazonaws.com' }];
    const rows = egressByDomain(
      [inet('52.1.2.3', 2e9), inet('52.1.2.3', 1e9), inet('9.9.9.9', 5e8)],
      nameFlow,
    );
    expect(rows[0]).toMatchObject({ domain: 's3.ap-northeast-2.amazonaws.com', bytes: 3e9 });
    expect(rows[0].usd).toBeCloseTo(3 * 0.09, 5);
    expect(rows.find((r) => r.domain === 'unresolved')).toMatchObject({ bytes: 5e8 });
  });
  it('ignores non-INTERNET and non-DATA_TRANSFERRED flows', () => {
    const f: FlowEdge = { ...inet('52.1.2.3', 1e9), category: 'INTRA_AZ' };
    expect(egressByDomain([f], [{ ip: '52.1.2.3', name: 'x.com' }])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify fail** — `npx -w app vitest run src/lib/analytics/egress-domains.test.ts` → FAIL.

- [ ] **Step 4: Implement** `app/src/lib/analytics/egress-domains.ts`:
```typescript
// Internet-egress cost broken down by destination domain (Datadog "group by
// domain", with our $ estimate). Pure. Joins INTERNET DATA_TRANSFERRED flows to
// DNS answer→domain mappings (DnsAggregate.nameFlow) by the external IP.
import type { FlowEdge } from '../types';
import { egressBytesToUsd } from './cost';

export interface EgressDomainRow {
  domain: string;
  bytes: number;
  usd: number;
}

/** External endpoint IP of an INTERNET flow: prefer b.ip, fall back to a.ip. */
function externalIp(f: FlowEdge): string | undefined {
  return f.b?.ip ?? f.a?.ip;
}

export function egressByDomain(
  flows: FlowEdge[],
  nameFlow: { ip: string; name: string }[],
): EgressDomainRow[] {
  const ipToDomain = new Map(nameFlow.map((n) => [n.ip, n.name]));
  const acc = new Map<string, { bytes: number }>();
  for (const f of flows) {
    if (f.metric !== 'DATA_TRANSFERRED' || f.category !== 'INTERNET') continue;
    const ip = externalIp(f);
    const domain = (ip && ipToDomain.get(ip)) || 'unresolved';
    acc.set(domain, { bytes: (acc.get(domain)?.bytes ?? 0) + f.value });
  }
  return [...acc.entries()]
    .map(([domain, { bytes }]) => ({ domain, bytes, usd: egressBytesToUsd(bytes) }))
    .sort((x, y) => y.usd - x.usd || y.bytes - x.bytes || x.domain.localeCompare(y.domain));
}
```

- [ ] **Step 5: Run to verify pass** — `npx -w app vitest run src/lib/analytics/egress-domains.test.ts` → PASS.

- [ ] **Step 6: Wire into the cost-explorer route.** In `app/src/app/api/cost-explorer/route.ts`: also fetch DNS and compute egress-by-domain, adding it to the JSON. Add imports `import { getDns, getFlowsWindow } from '@/lib/ddb';` (merge with existing) and `import { egressByDomain } from '@/lib/analytics/egress-domains';`. After building `flows`, add:
```typescript
    const dns = await getDns().catch(() => null);
    const egressDomains = egressByDomain(flows, dns?.nameFlow ?? []);
```
Change the response to spread the lens result + the new field:
```typescript
    return Response.json({
      ...costExplorerLens(flows, { windowSeconds: buckets * 300, clusterOf }),
      egressDomains,
    });
```
(Add the `egressDomains?: EgressDomainRow[]` field to the `CostExplorerResult` consumer type where the page reads it — or type the page's fetch result locally. Keep `costExplorerLens` itself unchanged.)

- [ ] **Step 7: Add the UI section.** In `app/src/app/cost/page.tsx`, add an "Egress cost by domain" section using the shared `Toplist` (sortable), rows from `data.egressDomains` (label = domain, value = usd, secondary = bytes), with the existing estimate disclaimer/badge pattern used elsewhere on the cost page. Follow how other Toplist sections on that page are built. i18n: `cost.egressByDomain` title + reuse existing `unresolved`/estimate keys (add `cost.egressByDomain` to ko/en).

- [ ] **Step 8: Verify + commit** — `npx -w app vitest run && npx -w app tsc --noEmit` (all pass); then:
```bash
git add app/src/lib/analytics/cost.ts app/src/lib/analytics/egress-domains.ts app/src/lib/analytics/egress-domains.test.ts app/src/app/api/cost-explorer/route.ts app/src/app/cost/page.tsx app/src/lib/i18n/translations/ko.json app/src/lib/i18n/translations/en.json
git commit -m "feat(cost): internet-egress cost by domain (DNS-join, egress rate)"
```

---

### Task 3: G3 (collector) — per-source DNS aggregation

**Files:**
- Modify: `collector/src/dns.ts` (`DnsAggregate` + `aggregateDns`), `collector/src/dns.test.ts`
- Modify: `app/src/lib/types.ts` (mirror the `DnsAggregate` shape if it is declared/duplicated there — verify; the collector `DnsAggregate` is the source of truth)

**Interfaces:**
- Produces: `DnsSourceStat = { latencyP50: number; latencyP95: number; failRate: number; count: number }`; `DnsAggregate` gains `bySource: { coredns: DnsSourceStat; resolver: DnsSourceStat }`.

- [ ] **Step 1: Write the failing test** — add to `collector/src/dns.test.ts` (follow the file's existing style/imports):
```typescript
it('splits latency + failRate by DNS source (coredns vs resolver)', () => {
  const recs = [
    { source: 'resolver', name: 'a.com', qtype: 'A', rcode: 'NOERROR', durationMs: 10, answerIps: [] },
    { source: 'resolver', name: 'b.com', qtype: 'A', rcode: 'NXDOMAIN', durationMs: 30, answerIps: [] },
    { source: 'coredns', name: 'svc.local', qtype: 'A', rcode: 'NOERROR', durationMs: 2, answerIps: [] },
  ] as import('./dns-parse.js').DnsRecord[];
  const agg = aggregateDns(recs);
  expect(agg.bySource.resolver.count).toBe(2);
  expect(agg.bySource.resolver.failRate).toBeCloseTo(0.5, 5); // 1 NXDOMAIN of 2
  expect(agg.bySource.coredns.count).toBe(1);
  expect(agg.bySource.coredns.failRate).toBe(0);
  expect(agg.bySource.resolver.latencyP95).toBeGreaterThanOrEqual(agg.bySource.resolver.latencyP50);
});
```

- [ ] **Step 2: Run to verify fail** — `npm -w collector run test` (or the file-scoped vitest) → FAIL (`bySource` undefined).

- [ ] **Step 3: Implement in `collector/src/dns.ts`.** Add the type + field:
```typescript
export interface DnsSourceStat { latencyP50: number; latencyP95: number; failRate: number; count: number }
```
Add `bySource: { coredns: DnsSourceStat; resolver: DnsSourceStat }` to the `DnsAggregate` interface (after the existing fields). In `aggregateDns`, accumulate per-source in the existing single pass: keep per-source arrays of durations + counts of total/failed (rcode NXDOMAIN or SERVFAIL). Add a helper and build the field:
```typescript
  const bySrc: Record<'coredns' | 'resolver', { durs: number[]; total: number; failed: number }> = {
    coredns: { durs: [], total: 0, failed: 0 }, resolver: { durs: [], total: 0, failed: 0 },
  };
  // inside the existing `for (const r of records)` loop, add:
  //   const s = bySrc[r.source]; s.total++;
  //   if (r.rcode === 'NXDOMAIN' || r.rcode === 'SERVFAIL') s.failed++;
  //   if (typeof r.durationMs === 'number') s.durs.push(r.durationMs);
  const stat = (b: { durs: number[]; total: number; failed: number }): DnsSourceStat => {
    const d = [...b.durs].sort((x, y) => x - y);
    return { latencyP50: pct(d, 50), latencyP95: pct(d, 95), failRate: b.total ? b.failed / b.total : 0, count: b.total };
  };
```
Add `bySource: { coredns: stat(bySrc.coredns), resolver: stat(bySrc.resolver) }` to the returned object in BOTH the non-empty return and the early `enabled:false` return (empty stats: `{ latencyP50:0, latencyP95:0, failRate:0, count:0 }` for both). Reuse the existing `pct()` helper. Keep every other field byte-identical.

- [ ] **Step 4: Run to verify pass** — `npm -w collector run test` → PASS.

- [ ] **Step 5: Mirror the type for the app.** In `app/src/lib/types.ts`, if `DnsAggregate` is declared there, add the identical `DnsSourceStat` + `bySource` (make `bySource` OPTIONAL — `bySource?: {...}` — in the app copy so older `DNS#latest` items without it still typecheck and the UI can show an awaiting-data state). If the app imports the collector type instead, no change needed — verify which. Run `npx -w app tsc --noEmit`.

- [ ] **Step 6: Commit**
```bash
git add collector/src/dns.ts collector/src/dns.test.ts app/src/lib/types.ts
git commit -m "feat(collector): per-source DNS stats (coredns vs resolver) in DnsAggregate"
```

---

### Task 4: G3 (app) — DNS resolver-comparison panel

**Files:**
- Modify: `app/src/lib/analytics/dns-insights.ts` (a small pass-through/typing helper if needed) + `app/src/app/insights/tabs/DnsTab.tsx` (comparison panel) + i18n

**Interfaces:**
- Consumes: `DnsAggregate.bySource?` (Task 3, optional). Uses existing `DnsSourceStat` fields.

- [ ] **Step 1: Write the failing test** — create `app/src/app/insights/tabs/DnsResolverCompare.test.tsx` (or extend the DnsTab test if one exists). Test a small presentational sub-component `ResolverCompare` you will add to `DnsTab.tsx` (export it for the test):
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { ResolverCompare } from './DnsTab';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

afterEach(cleanup);
const wrap = (ui: React.ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>);

describe('ResolverCompare', () => {
  it('renders coredns + resolver rows with latency and fail-rate', () => {
    wrap(<ResolverCompare bySource={{
      coredns: { latencyP50: 2, latencyP95: 5, failRate: 0, count: 100 },
      resolver: { latencyP50: 10, latencyP95: 40, failRate: 0.2, count: 50 },
    }} />);
    expect(screen.getByTestId('dns-resolver-compare')).toBeTruthy();
    expect(screen.getByText(/coredns/i)).toBeTruthy();
    expect(screen.getByText(/resolver/i)).toBeTruthy();
  });
  it('shows an awaiting-data state when bySource is undefined', () => {
    wrap(<ResolverCompare bySource={undefined} />);
    expect(screen.getByTestId('dns-resolver-compare-empty')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx -w app vitest run src/app/insights/tabs/DnsResolverCompare.test.tsx` → FAIL.

- [ ] **Step 3: Implement `ResolverCompare` in `DnsTab.tsx`** (export it) — a compact two-row panel comparing coredns/resolver on p50/p95 latency + fail-rate, using `useLanguage`, chart-token colors, dual-encoded. Props: `{ bySource: DnsAggregate['bySource'] }`. When `bySource` is undefined, render `<div data-testid="dns-resolver-compare-empty">{t('dns.resolverCompare.awaiting')}</div>`; else a small table/grid `data-testid="dns-resolver-compare"` with a row per source (label via `t('dns.source.coredns')`/`t('dns.source.resolver')`), columns p50/p95 (via `formatMicros` if µs, or ms as the DNS latency unit is ms — match `DnsTab`'s existing latency formatting) + fail-rate as a percent. Wire `<ResolverCompare bySource={dns?.bySource} />` into the DnsTab body near the existing latency/resolver widgets.

- [ ] **Step 4: Run to verify pass** — `npx -w app vitest run src/app/insights/tabs/DnsResolverCompare.test.tsx` → PASS.

- [ ] **Step 5: i18n** — add to ko/en: `dns.resolverCompare.title`, `dns.resolverCompare.awaiting`, `dns.source.coredns` ("CoreDNS"/"CoreDNS"), `dns.source.resolver` ("Route53 Resolver"/"Route53 Resolver"), `dns.resolverCompare.failRate`, `dns.resolverCompare.p50`, `dns.resolverCompare.p95`.

- [ ] **Step 6: Verify + commit** — `npx -w app vitest run && npx -w app tsc --noEmit`:
```bash
git add app/src/app/insights/tabs/DnsTab.tsx app/src/app/insights/tabs/DnsResolverCompare.test.tsx app/src/lib/i18n/translations/ko.json app/src/lib/i18n/translations/en.json
git commit -m "feat(dns): resolver-comparison panel (coredns vs resolver) on Insights DNS"
```

---

### Task 5: G5 — Composite-condition view

**Files:**
- Create: `app/src/lib/analytics/composite-conditions.ts`, `app/src/lib/analytics/composite-conditions.test.ts`
- Modify: `app/src/app/alerts/page.tsx` (composite section) + i18n

**Interfaces:**
- Consumes: `ratePer` (`reliability.ts`) → rows with `retransRate`/`timeoutRate`; `RETRANS_RATE_DANGER` (`aggregate.ts`, = 10); `moversLens` (`movers.ts`) → `Mover[]` with `deltaPct`.
- Produces: `compositeConditions(current: FlowEdge[], prior: FlowEdge[]): CompositeRow[]` where `CompositeRow = { label: string; conditions: string[]; severity: 'critical'|'warn' }`.

- [ ] **Step 1: Write the failing test** — create `app/src/lib/analytics/composite-conditions.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { compositeConditions } from './composite-conditions';
import type { FlowEdge } from '../types';

// helper builds a service-entity flow with retrans + a volume drop
const edge = (a: string, metric: FlowEdge['metric'], value: number, bucket = 'b1'): FlowEdge => ({
  edgeHash: `${a}-${metric}-${bucket}`, monitor: 'm', metric, category: 'INTER_AZ', bucket, value,
  unit: 'Bytes', a: { serviceName: a, podNamespace: 'ns' }, b: { serviceName: 'peer', podNamespace: 'ns' },
  traversedConstructs: [],
});

describe('compositeConditions', () => {
  it('flags an entity breaching >=2 conditions (high retrans rate + volume drop)', () => {
    // current: heavy retrans, low volume; prior: high volume → volume dropped
    const current = [edge('svc', 'DATA_TRANSFERRED', 1e6), edge('svc', 'RETRANSMISSIONS', 1000)];
    const prior = [edge('svc', 'DATA_TRANSFERRED', 1e9, 'b0')];
    const rows = compositeConditions(current, prior);
    const svc = rows.find((r) => r.label.includes('svc'));
    expect(svc).toBeTruthy();
    expect(svc!.conditions.length).toBeGreaterThanOrEqual(2);
  });
  it('does not flag an entity breaching only one condition', () => {
    const current = [edge('quiet', 'DATA_TRANSFERRED', 1e9)];
    const prior = [edge('quiet', 'DATA_TRANSFERRED', 1e9, 'b0')];
    expect(compositeConditions(current, prior).find((r) => r.label.includes('quiet'))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx -w app vitest run src/lib/analytics/composite-conditions.test.ts` → FAIL.

- [ ] **Step 3: Implement** `app/src/lib/analytics/composite-conditions.ts`. Compose the existing lenses (do NOT introduce new thresholds beyond reusing `RETRANS_RATE_DANGER`; pick a documented volume-drop threshold constant in-file, e.g. `VOLUME_DROP_PCT = -50`):
```typescript
// Composite-condition view (Datadog composite-alarm pattern as a dashboard
// signal, NOT a CloudWatch alarm). Pure. Flags service entities breaching >=2 of:
// high retransmission rate, and a large window-over-window volume drop.
import type { FlowEdge } from '../types';
import { ratePer } from './reliability';
import { RETRANS_RATE_DANGER } from './aggregate';
import { moversLens } from './movers';

export interface CompositeRow {
  label: string;
  conditions: string[];
  severity: 'critical' | 'warn';
}

/** A window-over-window drop of this many percent (negative) counts as a condition. */
export const VOLUME_DROP_PCT = -50;

export function compositeConditions(current: FlowEdge[], prior: FlowEdge[]): CompositeRow[] {
  // Condition 1: high retransmission rate per service entity.
  const retrans = new Map<string, number>();
  for (const r of ratePer(current, 'service')) retrans.set(r.label, r.retransRate);

  // Condition 2: large volume drop (deltaPct <= VOLUME_DROP_PCT) from movers.
  const drop = new Map<string, number>();
  const movers = moversLens(current, prior); // reuse the movers lens over the pair
  for (const m of movers.movers ?? []) {
    if (m.deltaPct != null && m.deltaPct <= VOLUME_DROP_PCT) drop.set(m.label, m.deltaPct);
  }

  const labels = new Set<string>([...retrans.keys(), ...drop.keys()]);
  const rows: CompositeRow[] = [];
  for (const label of labels) {
    const conditions: string[] = [];
    const rr = retrans.get(label) ?? 0;
    if (rr > RETRANS_RATE_DANGER) conditions.push(`retrans ${rr.toFixed(1)}/GB`);
    if (drop.has(label)) conditions.push(`volume ${drop.get(label)!.toFixed(0)}%`);
    if (conditions.length >= 2) {
      rows.push({ label, conditions, severity: rr > 2 * RETRANS_RATE_DANGER ? 'critical' : 'warn' });
    }
  }
  return rows.sort((x, y) => y.conditions.length - x.conditions.length || x.label.localeCompare(y.label));
}
```
NOTE: verify `moversLens`'s actual signature/return shape (`movers.ts`) and `ratePer`'s `ReliabilityRow` fields (`label`, `retransRate`) before finalizing — adjust field access to match. If `moversLens` needs specific args (metric/window), pass the DATA_TRANSFERRED-appropriate ones; the test exercises a volume drop so the default metric must be data volume.

- [ ] **Step 4: Run to verify pass** — `npx -w app vitest run src/lib/analytics/composite-conditions.test.ts` → PASS.

- [ ] **Step 5: Add the Alerts section.** In `app/src/app/alerts/page.tsx`, add a "Composite conditions" section: fetch the current+prior windows the same way the anomalies path does (`getFlowsWindowPair` via an API route, OR add the compute to the existing alerts route if it already has a flows window — verify how alerts gets its data). Render flagged rows with condition chips + severity (dual-encoded, `STATUS`). Empty-state when none. i18n `alerts.composite.title` + `alerts.composite.empty`.

- [ ] **Step 6: Verify + commit** — `npx -w app vitest run && npx -w app tsc --noEmit`:
```bash
git add app/src/lib/analytics/composite-conditions.ts app/src/lib/analytics/composite-conditions.test.ts app/src/app/alerts/page.tsx app/src/lib/i18n/translations/ko.json app/src/lib/i18n/translations/en.json
git commit -m "feat(alerts): composite-condition view (multi-signal breaches)"
```

---

### Task 6: Finalize — full verification + docs

**Files:**
- Modify: `docs/reference/{api,ui,frontend}.md`, `docs/architecture.md` (Query/Presentation notes)

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npx -w app vitest run && npx -w app tsc --noEmit && npm -w app run build` — all pass; `npm -w collector run test` — passes.

- [ ] **Step 2: Docs (bilingual where the file is bilingual)** — add one line each: api.md (cost-explorer now returns `egressDomains`; network `port` scope), ui.md (DNS resolver-compare panel, Alerts composite section), frontend.md (port scope), architecture.md Presentation/Query note (4 parity features). Follow the writing-style guide (EN+KO mirror for architecture.md).

- [ ] **Step 3: Commit**
```bash
git add docs/
git commit -m "docs: note network-parity features (port scope, egress domains, DNS resolver compare, composite view)"
```

---

## Self-Review

**1. Spec coverage:** G1 port mix → Task 1. G2 egress domain cost (+ egressBytesToUsd) → Task 2. G3 collector per-source → Task 3, G3 app panel → Task 4. G5 composite view → Task 5. Docs/verify → Task 6. All four spec features + the `egressBytesToUsd` cost-source note covered.

**2. Placeholder scan:** Lenses have complete code + tests. UI steps (Task 1 Step 5/6, Task 2 Step 7, Task 4 Step 3, Task 5 Step 5) give exact files, testids, i18n keys, and the pattern to follow, but defer to reading the existing page/tab for the surrounding JSX — flagged explicitly (network page scope options, cost Toplist sections, DnsTab body, alerts data path) rather than inventing markup that may not match. Each names a concrete verify-first anchor, not "TBD".

**3. Type consistency:** `PortMixRow`/`portLabel` (T1), `EgressDomainRow`/`egressBytesToUsd`/`INTERNET_EGRESS_USD_PER_GB` (T2), `DnsSourceStat`/`bySource` (T3→T4), `CompositeRow`/`VOLUME_DROP_PCT` (T5) are defined once and consumed with matching names. `Scope` gains `'port'` in both the type and `SCOPES` array (T1). The `DnsAggregate.bySource` is optional in the app mirror (T3 Step 5) so T4's awaiting-data state is reachable.

**Flagged for implementers (verify-before-final, not defects):** `moversLens` signature + `ReliabilityRow` fields (T5 Step 3), whether `app/src/lib/types.ts` declares or imports `DnsAggregate` (T3 Step 5), how the alerts page currently sources its data (T5 Step 5), and the network page's scope-option rendering (T1 Step 5). Each has a concrete instruction to confirm against the real code before finalizing that step.
