# Network-Observability Parity (Datadog CNM / Cilium Hubble) — Design

**Date:** 2026-07-14
**Status:** Approved (ready for implementation plan)
**Scope:** 4 features. 3 app-only (G1, G2, G5) + 1 collector+app (G3). No new runtime deps.

## Background

Feature-gap research vs Datadog Cloud Network Monitoring and Cilium Hubble (`.superpowers/sdd/datadog-hubble-gap-research.txt`). L7 HTTP/gRPC breakdown and network-policy verdicts are OUT — they require a Cilium/eBPF agent, absent from the CloudWatch NFM data source. The four features below are what NFM/CloudWatch/DNS data can actually support. Pricing math stays single-sourced in `cost.ts` (`bytesToUsd`).

Data facts verified during brainstorming:
- `FlowEdge` has **no protocol field** — only `targetPort` (dest port). So "protocol mix (TCP/UDP/ICMP)" is infeasible; G1 becomes **port/service traffic mix** off `targetPort`.
- `DNS#latest` (`DnsAggregate`) already carries `nameFlow: {ip,name}[]` — DNS-answer IPs that appear in flows, mapped to their domain. This makes G2 (egress cost by domain) app-only.
- `DnsAggregate` does NOT split by DNS source (coredns vs resolver); the raw `DnsRecord.source` does. G3 (resolver compare) needs a collector change to aggregate per-source.

---

## G1 — Port / service traffic mix (app-only)

**What:** which destination ports/services carry the traffic (a feasible stand-in for Hubble's protocol view, off `targetPort`).

- **Lens** (new, pure) `app/src/lib/analytics/port-mix.ts`: group `DATA_TRANSFERRED` flows by `targetPort`; sum bytes; carry retransmissions/timeouts where present. A `PORT_LABELS` map names well-known ports (443 HTTPS, 80 HTTP, 53 DNS, 5432 PostgreSQL, 3306 MySQL, 6379 Redis, 27017 MongoDB, 9092 Kafka, 22 SSH, 8080 HTTP-alt); unknown ports render as `port N`; `targetPort` undefined → `unknown`. Output: `{ port: number|null; label: string; bytes: number; retransmissions: number }[]`, desc by bytes.
- **UI:** add a `port` option to the Network Analytics dest-scope selector (`app/src/app/network/page.tsx` + `network-analytics.ts` aggregation), so the existing source→dest table can aggregate the dest side by port. Metric toggle (volume/retransmits) reuses the existing controls. Follows the established Scope pattern (service/namespace/subnet/az/vpc/category/monitor → add `port`).
- **Test:** lens groups by port, labels well-known ports, sorts desc, handles undefined port; network page scope option renders.

## G2 — Internet-egress cost by domain (app-only) — ❌ DROPPED (infeasible on NFM data)

> **Status: DROPPED during implementation (2026-07-14).** A spec-stage feasibility miss:
> the brainstorming claim that `nameFlow` makes this app-only does not hold. Two independent
> data breaks confirmed against the collector code:
> 1. `INTERNET`-category volume is produced **only** by the Workload Insights collector
>    (`wi-query.ts` → `WI#latest`, `WiRow{remoteIdentifier,value}`), never by the flows
>    collector (`nfm-query.ts` writes CORE/EXTENDED categories to the flows table). So the
>    `FlowEdge[]` this lens consumes never contains an `INTERNET` flow — the widget is always empty.
> 2. `nameFlow` (`dns.ts:36-38`) is built from `flowIps` (CORE/EXTENDED `a.ip`/`b.ip`) ∩ resolver
>    answer IPs — external egress IPs never enter that set, so the domain map lacks egress IPs anyway.
>
> "Egress cost **by domain**" therefore cannot be built on the current pipeline. Moved to Non-Goals.
> The original design below is retained for the record. Reverted commit: `46603df`.

**What:** which external domains drive internet-egress cost (Datadog "group destination by domain", but with our $ estimate — a differentiator).

- **Lens** (new, pure) `app/src/lib/analytics/egress-domains.ts`: inputs `(flows: FlowEdge[], nameFlow: {ip:string;name:string}[])`. Take `INTERNET`-category `DATA_TRANSFERRED` flows, resolve each flow's external endpoint IP via a `Map<ip,name>` built from `nameFlow`, group by domain, sum bytes and `bytesToUsd(bytes,'INTERNET')`... **NOTE:** `INTERNET` is not in `BILLED_CATEGORIES`, so `bytesToUsd` returns 0 for it. Egress-to-internet IS a real AWS cost (data-transfer-out), so this lens uses its OWN rate constant `INTERNET_EGRESS_USD_PER_GB` (define in `cost.ts` next to `AZ_TRANSFER_USD_PER_GB`, with a comment: AWS data-transfer-out first-tier ~$0.09/GB, flagged as an estimate) and a dedicated `egressBytesToUsd`. Unmapped IPs group under `unresolved`. Output: `{ domain: string; bytes: number; usd: number }[]`, desc by usd.
- **Data:** the `nameFlow` array is on `DnsAggregate` (`DNS#latest`), already loaded by the DNS read path (`app/src/lib/ddb.ts` / dns route). The cost-explorer route (or a small addition to it) passes `nameFlow` + the INTERNET flows into the lens.
- **UI:** a "Egress cost by domain" `Toplist` (sortable) section on the Cost Explorer page (`app/src/app/cost/page.tsx` or `/api/cost-explorer`), with the estimate disclaimer.
- **Test:** lens maps IP→domain, sums usd via the internet rate, buckets unmapped as `unresolved`, sorts desc.

## G3 — DNS resolver comparison (collector + app)

**What:** compare DNS sources (CoreDNS vs Route53 Resolver) side-by-side on latency + failure rate (Datadog DNS "isolate & compare per server").

- **Collector** `collector/src/dns.ts` `aggregateDns`: add `bySource` to `DnsAggregate`: `{ coredns: DnsSourceStat; resolver: DnsSourceStat }` where `DnsSourceStat = { latencyP50: number; latencyP95: number; failRate: number; count: number }`. Compute per `DnsRecord.source` in the existing single pass (partition durations + rcode counts by source). Keep the existing aggregate fields unchanged (additive). Mirror the type in `app/src/lib/types.ts` (kept aligned per collector/CLAUDE.md).
- **Deploy:** `npm -w collector run build` + `cdk deploy NfmDash-Data`; `bySource` fills after the next collection cycles (older `DNS#latest` lacks it → UI shows an "awaiting data" state, tolerate `undefined`).
- **UI:** Insights · DNS page — a compact "resolver comparison" panel: two rows (CoreDNS / Resolver) with p50/p95 latency + fail-rate, dual-encoded. Tolerates a missing `bySource` (renders the awaiting-data state).
- **Test:** `aggregateDns` splits stats by source (collector test); the DNS panel renders both sources + the awaiting-data state (app test).

## G5 — Composite-condition view (app-only, dashboard signal, NOT a CloudWatch alarm)

**What:** surface entities that are simultaneously bad on multiple signals (retransmission rate up AND RTT high AND volume dropped) — Datadog's recommended composite-alarm pattern, as a dashboard highlight that cuts single-metric alert noise.

- **Lens** (new, pure) `app/src/lib/analytics/composite-conditions.ts`: over the current+prior flow windows, compute per service-entity: retransmission rate (reliability lens), RTT tier, and window-over-window volume delta (movers lens). Flag an entity when ≥2 conditions breach (e.g. `retransRate > DANGER` AND (`rttHigh` OR `volumeDropPct > X`)). Output rows: `{ label: string; conditions: string[]; severity: 'critical'|'warn' }`, ranked by condition count then severity. Reuse existing thresholds/lenses — do NOT invent new pricing/threshold constants.
- **UI:** a "Composite conditions" section on the Alerts page (`app/src/app/alerts/page.tsx`), listing flagged entities with their breached-condition chips. No CloudWatch alarm is created (app-only signal).
- **Test:** lens flags an entity breaching ≥2 conditions, ignores single-condition entities, ranks by count; the Alerts section renders flagged rows + empty-state.

## Cross-cutting constraints

- All USD via `cost.ts` (`bytesToUsd` for billed categories; the new `egressBytesToUsd` for internet egress) — no pricing recomputed elsewhere.
- All UI strings via `t()` in BOTH ko.json/en.json.
- Colors only from chart-tokens; dual-encode severity/health.
- Tests co-located; repo has NO jest-dom / NO vitest globals.
- G3 changes the collector — mirror the `DnsAggregate` type in `app/src/lib/types.ts`, keep other aggregate fields byte-identical, and note the redeploy + backfill-latency in the plan.

## Non-Goals (YAGNI)

- L7 HTTP/gRPC breakdown, network-policy verdicts (infeasible on NFM data).
- **G2 egress cost by domain (dropped 2026-07-14)** — `INTERNET` volume lives only in `WI#latest`
  (not the flows table) and `nameFlow` never contains external egress IPs, so a per-domain egress
  breakdown is not derivable from current NFM/DNS data. A WI-based egress *total* remains possible
  as future work but was not in scope.
- Real CloudWatch Composite Alarm resources (G5 chosen as an app-only view).
- New charting library; reuse existing Toplist / bars / tables.

## Files (summary)

- New lenses: `port-mix.ts`, `egress-domains.ts`, `composite-conditions.ts` (+ `.test.ts` each).
- Edit: `cost.ts` (add `INTERNET_EGRESS_USD_PER_GB` + `egressBytesToUsd`), `network-analytics.ts` + `network/page.tsx` (port scope), `cost` page / `cost-explorer` route (egress-by-domain), `alerts/page.tsx` (composite view), Insights·DNS page (resolver compare).
- Collector: `dns.ts` (`bySource`), `app/src/lib/types.ts` + `collector/src/types.ts` (DnsAggregate mirror), `dns.test.ts`.
- i18n: new keys in ko/en.
- Docs (auto-sync follow-up): reference/api.md, ui.md, frontend.md, architecture.md.
