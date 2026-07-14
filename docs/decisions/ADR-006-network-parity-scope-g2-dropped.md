# ADR-006: Network-Observability Parity Scope — G2 Egress-by-Domain Dropped as Infeasible on NFM Data

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Status

Accepted — 2026-07-14. G1, G3, and G5 shipped and merged (`8a48224`); G2 was implemented, then reverted (`46603df` → `ec65c5d`) and dropped.

## Context

A feature-gap study against Datadog Cloud Network Monitoring and Cilium Hubble produced a shortlist of parity features feasible on the CloudWatch Network Flow Monitor (NFM) data source. L7 HTTP/gRPC breakdown and network-policy allow/drop verdicts were ruled out up front — they require a Cilium/eBPF agent that the NFM data source does not provide. Four candidates advanced:

- G1 — port/service traffic mix (a stand-in for a protocol view, off `targetPort`).
- G2 — internet-egress cost broken down by destination domain.
- G3 — DNS resolver comparison (CoreDNS vs Route53 Resolver).
- G5 — composite-condition view (entities breaching two or more signals at once).

G2 was the differentiator versus Datadog, so it was implemented first. It requires joining `INTERNET`-category flow volume to DNS domains and pricing the result.

## Decision

Drop G2. Ship G1, G3, and G5.

G2 is infeasible on the current pipeline for two independent reasons, both verified against the collector code:

1. `INTERNET`-category volume is produced only by the Workload Insights collector (`collector/src/wi-query.ts` → `WI#latest`, a `WiRow` aggregated per `remoteIdentifier`), never by the flows collector, which writes CORE/EXTENDED categories to the hot flows table that the cost lens reads. So `egressByDomain(getFlowsWindow(...))` is always empty.
2. `DnsAggregate.nameFlow` — the only IP-to-domain map available — is built in `collector/src/dns.ts` from `flowIps` (CORE/EXTENDED `a.ip`/`b.ip`) intersected with resolver answer IPs. External egress IPs never enter that set, so even the domain map lacks egress IPs.

There is no reliable path from "internet egress bytes" to "which domain" on the current NFM/DNS data. G1/G3/G5 are all feasible and were built as app-side lenses (G3 also adds a collector `bySource` aggregation); none needs an eBPF/Cilium agent.

## Consequences

- The Cost Explorer page is unchanged — no per-domain egress breakdown ships.
- A Workload-Insights-based internet-egress *total* (not by domain) remains possible as future work, but was out of scope here.
- Process lesson: verify data-shape feasibility at the spec stage. The shortlist assumed `DnsAggregate.nameFlow` made G2 app-only; it does not, because that map is derived from non-egress flow IPs. A one-file read of `dns.ts`/`wi-query.ts` during design would have caught this before implementation.
- G3's resolver latency is unavailable (Route53 Resolver query logs carry no per-query latency), so the resolver-comparison panel renders "no data" rather than a fabricated `0 ms`, guarded by `latencySampleCount`.

## References

- Spec: `docs/superpowers/specs/2026-07-14-network-observability-parity-design.md` (G2 marked dropped / Non-Goals).
- Plan: `docs/superpowers/plans/2026-07-14-network-observability-parity.md` (Task 2 annotated DROPPED).
- Commits: `46603df` (G2 feat) → `ec65c5d` (revert) → `be80a35` (docs: drop G2); merge `8a48224`.

---

<a id="korean"></a>

# 한국어

## 상태

수락됨 — 2026-07-14. G1·G3·G5는 구현·병합 완료(`8a48224`), G2는 구현 후 되돌리고(`46603df` → `ec65c5d`) 제외.

## 배경

Datadog Cloud Network Monitoring 및 Cilium Hubble 대비 기능 격차를 조사해, CloudWatch Network Flow Monitor(NFM) 데이터 소스로 구현 가능한 패리티 기능 후보를 추렸습니다. L7 HTTP/gRPC 분해와 네트워크 정책 allow/drop 판정은 Cilium/eBPF 에이전트가 필요하므로(NFM 데이터 소스가 제공하지 않음) 처음부터 제외했습니다. 네 개 후보가 남았습니다.

- G1 — 포트/서비스 트래픽 믹스(`targetPort` 기반 프로토콜 뷰 대체).
- G2 — 목적지 도메인별 인터넷 egress 비용 분해.
- G3 — DNS resolver 비교(CoreDNS vs Route53 Resolver).
- G5 — 복합 조건 뷰(동시에 2개 이상 신호를 위반한 엔티티).

G2는 Datadog 대비 차별화 요소라 가장 먼저 구현했습니다. 이는 `INTERNET` 카테고리 플로우 볼륨을 DNS 도메인과 조인하고 그 결과를 가격 책정해야 합니다.

## 결정

G2를 제외합니다. G1·G3·G5를 배송합니다.

G2는 현재 파이프라인에서 두 가지 독립적인 이유로 구현 불가능하며, 둘 다 수집기 코드로 검증했습니다.

1. `INTERNET` 카테고리 볼륨은 Workload Insights 수집기(`collector/src/wi-query.ts` → `WI#latest`, `remoteIdentifier`별 집계 `WiRow`)에서만 생성되고, 비용 렌즈가 읽는 핫 flows 테이블에 CORE/EXTENDED 카테고리를 쓰는 flows 수집기는 이를 생성하지 않습니다. 따라서 `egressByDomain(getFlowsWindow(...))`는 항상 비어 있습니다.
2. 유일하게 사용 가능한 IP→도메인 맵인 `DnsAggregate.nameFlow`는 `collector/src/dns.ts`에서 `flowIps`(CORE/EXTENDED `a.ip`/`b.ip`)와 resolver answer IP의 교집합으로 만들어집니다. 외부 egress IP는 이 집합에 들어오지 않으므로 도메인 맵에도 egress IP가 없습니다.

현재 NFM/DNS 데이터로는 "인터넷 egress 바이트"에서 "어느 도메인"으로 이어지는 신뢰할 수 있는 경로가 없습니다. G1/G3/G5는 모두 구현 가능하며 앱 측 렌즈로 구축되었고(G3는 수집기 `bySource` 집계도 추가), 어느 것도 eBPF/Cilium 에이전트를 필요로 하지 않습니다.

## 결과

- Cost Explorer 페이지는 변경 없음 — 도메인별 egress 분해는 배송하지 않습니다.
- Workload Insights 기반 인터넷 egress *총합*(도메인별 아님)은 향후 작업으로 가능하지만 이번 범위에서는 제외했습니다.
- 프로세스 교훈: 데이터 형태 실현 가능성을 spec 단계에서 검증해야 합니다. 후보 선정 시 `DnsAggregate.nameFlow`가 G2를 app-only로 만든다고 가정했으나, 그 맵은 egress가 아닌 flow IP에서 파생되므로 그렇지 않습니다. 설계 중 `dns.ts`/`wi-query.ts`를 한 번만 읽었다면 구현 전에 발견했을 것입니다.
- G3의 resolver 지연은 사용 불가(Route53 Resolver 쿼리 로그에 쿼리별 지연 없음)하므로, resolver 비교 패널은 조작된 `0 ms` 대신 "데이터 없음"을 표시하며 `latencySampleCount`로 가드합니다.

## 참고

- Spec: `docs/superpowers/specs/2026-07-14-network-observability-parity-design.md` (G2 dropped / Non-Goals 표기).
- Plan: `docs/superpowers/plans/2026-07-14-network-observability-parity.md` (Task 2 DROPPED 주석).
- 커밋: `46603df`(G2 feat) → `ec65c5d`(revert) → `be80a35`(docs: G2 제외); 병합 `8a48224`.
