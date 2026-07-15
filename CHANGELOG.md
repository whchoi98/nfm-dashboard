# Changelog

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> The version shown in the app UI reads `APP_VERSION` from `app/src/lib/version.ts` — keep it and `app/package.json` in sync with the top entry here.

## [Unreleased]

## [0.11.0] - 2026-07-15

### Added
- Hourly rollup tier: the collector writes hour-grain HFLOW rows (same item shape, counters summed, RTT averaged, top-200 per monitor/metric/category, 15-day TTL) after each closed hour, auto-backfilling the last 7 days on first deploy; lens reads over 3h use closed-hour rollups plus a live 5-minute tail, cutting a cold 24h read from ~1,440 to ~180 queries and 7d to ~840 (ADR-009).
- Restore the 7d interactive range on the lens pages, superseding the 24h cap (ADR-008).
- Real User Monitoring via aws-rum-pipeline: `RumProvider` loads the self-hosted RUM SDK and stamps every event with `appName: nfm-dashboard` (page views, SPA route dwell time, Core Web Vitals, JS errors). Enabled only when `NEXT_PUBLIC_RUM_ENDPOINT`/`NEXT_PUBLIC_RUM_API_KEY` are exported before `scripts/build-push.sh` (Docker build args).
- Anomaly detail panel: selecting a row on `/anomalies` opens a right-hand slide-over with entity detail (metric, current-vs-baseline, overshoot, severity) and working deep-links — `/topology?focus=<ns/name>` focuses the node, `/network?ns=<namespace>` presets the namespace facet; the panel live-updates with polling and auto-closes when the anomaly resolves.
- Fancy report on `/reports`: a styled `ReportDocument` leads with a cost-estimation-basis block (inter-AZ transfer rate, billed categories, monthly run-rate), then KPI tiles, a per-category cost table, top talkers, and anomalies, with a Download PDF button (browser print-to-PDF). The `.md`/`.csv` downloads stay.
- Network Analytics `port` destination scope (G1): the source-to-destination matrix aggregates the destination side by target port, with well-known ports labeled (HTTPS, DNS, PostgreSQL, and so on).
- DNS resolver comparison (G3): the collector aggregates per-source DNS stats (`bySource` — CoreDNS vs Route53 Resolver: p50/p95 latency, fail rate, sample count) and the Insights DNS tab renders a resolver-comparison panel. Resolver latency shows "no data" instead of a fabricated 0 ms when Route53 Resolver query logs carry no latency sample.
- Composite-condition view (G5) on `/alerts`: a dashboard highlight listing service entities that breach two or more signals at once (high retransmission rate and a large window-over-window volume drop). It is an app-side signal, not a CloudWatch alarm.
- Per-page intro boxes: each of the 17 sidebar pages shows an overview/features (개요/기능) description box under its title, via a shared `PageIntro` component with bilingual copy.

### Changed
- The middleware now honors an explicit `AUTH_DISABLED=1` in production, injected only via the `authDisabled` CDK context (default OFF — login enforced). Only the Cognito session gate is skipped when set; the `x-origin-verify` CloudFront perimeter and all Cognito resources stay either way (ADR-005). `scripts/smoke.sh` / e2e mirror the toggle via `E2E_AUTH_DISABLED`.
- Align the flows/lens cache to the collector cycle: cached windows and computed lens responses (`cachedLens`, wired into the 8 pure flow-lens routes) stay valid until the collector writes a new cycle or the 5-minute bucket grid rolls, so polling serves from memory between cycles (measured: `/api/network?buckets=72` 4.5 s → 0.02 s, `/api/anomalies?buckets=288` 40 s → 0.13 s warm) while new data still appears within ~15 s of a cycle write. ElastiCache Serverless was evaluated and declined for the single-task topology (ADR-007).
- Cap interactive lens time ranges at 24h (`MAX_BUCKETS` 288): the 7d option moves off the lens pages until collector pre-aggregated rollups land — 7d+ queries are served by the Athena-backed `/history` page (ADR-008). Legacy `?buckets=2016` requests clamp to 288, and a persisted 7d default range falls back to 1h. (Interim during 0.11.0 development; superseded by the hourly-rollup tier in this same release — ADR-009.)
- Raise the app task to 4096 MiB (with a V8 heap ceiling via `NODE_OPTIONS=--max-old-space-size=3072`) and the ALB target group `unhealthyThresholdCount` to 5, so a slow cold 24h window compute can no longer get the task killed mid-computation.

### Fixed
- Production 502/504 outage (2026-07-14): the 2 GB task was OOM-killed (exit 137) under analytics load — the DynamoDB bucket-query fan-out queued hundreds of requests on the SDK's default 50-socket agent (stalling every menu) while multi-day raw flow windows filled the heap. Fixed with a 512-socket keep-alive agent, `getFlowsWindowPair` joining the shared window cache with a single concurrency pool across both halves, settle-based cache eviction, and the 4096 MiB task.
- CPU crash loop (2026-07-15): opening a 7d lens view cold ran minutes of synchronous fetch+aggregation on the 1-vCPU task, blocking the event loop until ALB health checks killed the task; the in-process cache died with it and browser polling immediately re-triggered the same cold compute on the replacement. Fixed by the interim 24h cap — superseded by hourly rollups in this release — and the health-check tolerance above.
- Intermittent login failure ("first attempt fails, retry works"): concurrent `/api/auth/login` calls (stale tabs after re-enabling auth, or a double button press) overwrote the one-shot `state`/`pkce`/`nonce` cookies, so the first callback failed CSRF `state` validation. The callback now transparently auto-restarts the login once on a transient/CSRF failure (guarded by an `nfm_auth_retry` marker against loops); token-exchange / id_token-verification failures are not retried. The failing step is now logged (step name only, no secret values).

## [0.10.0] - 2026-07-12

### Added
- **Sortable ranked lists**: the value-ranked lists (top talkers, target ports, DNS domains/query-types/failures/resolvers, cost by cluster/namespace/monitor, reliability hotspots, scorecard worst monitors, top movers, slowest paths, cross-AZ, hop composition) gain an opt-in click-to-sort header — sort by name or value, ascending/descending, keyed off raw values. Compact overview/flows/workload teasers keep their fixed top-N ranking.

## [0.9.0] - 2026-07-12

### Added
- **Sortable data tables**: click a column header to sort ascending/descending with type-aware comparison (string, number, boolean) — applied to flows, latency tail-paths, reliability breaches, network pairs, workload contributors, agent coverage, and the Athena history results (numeric/string column sniffing). Sorting keys off raw values (not the formatted display text), preserves each table's default order until you click, and adds `aria-sort` for accessibility.

### Changed
- The agent-coverage table now defaults to a deterministic `instanceId` ascending order (previously the arbitrary EC2-API order).

## [0.8.0] - 2026-07-12

### Added
- **Topology node grouping** (namespace / AZ / cluster) with collapse/expand and aggregate edges — collapse a dense pod map into a handful of group nodes and expand only what you are investigating; the AZ mode surfaces cross-zone traffic.
- **Click-to-isolate ego-network** (1- or 2-hop) plus a **canvas search** that focuses and pans to a node.
- **Min-traffic threshold slider** (with a hidden-edge count) and an **interactive health legend** (click a status to isolate that class).
- **Node kind icons** (pod / node / vpc / external) plus **cross-AZ** and **high-retransmit badges** — colour stays reserved for health, so the extra signals use shape/icon/badge.
- **Deterministic topology layout** with persisted node positions (stable across reloads and filter changes) and a **live minimap**.

## [0.7.0] - 2026-07-12

### Added
- **7-day analytics range**: the time-range selector gains a `7d` option (analytics query window raised from 24h to 7 days, up to `MAX_BUCKETS` 2016 five-minute buckets). The per-bucket flow-query fan-out is now bounded (concurrency pool) so a wide window doesn't storm DynamoDB.
- **Flow archive (S3 + Parquet)**: every flow write is streamed (DynamoDB Streams → transform Lambda → Kinesis Firehose with Parquet conversion) to a date-partitioned S3 archive before the 7-day DynamoDB TTL deletes it, catalogued in AWS Glue (`nfm_dashboard.flows_archive`, partition projection on `dt`) and queryable via an Athena workgroup.
- **History page** (`/history`): an Athena-backed page to query the archive over an arbitrary date range (beyond the live 7-day hot path), with on-demand queries, monitor/namespace/metric filters, and a results table.

### Changed
- Grant the app task role least-privilege Athena/Glue/S3 permissions (for `/api/history`); add DynamoDB Streams to the flows table.

## [0.6.0] - 2026-07-11

### Added
- **Overview summary cards**: 6 at-a-glance cards on the landing page — reliability score (SLO 0..100), estimated monthly cost run-rate, billed-traffic ratio, DNS health (failure rate + resolver p95), traffic concentration (top-pair share), and monitor status (healthy/total) — each deep-linking to its detail page.

### Changed
- **Left sidebar navigation**: replaced the horizontal top-nav with a grouped left sidebar exposing all menus across 6 sections (Overview / Network / Analysis / Operations / Business / Tools); controls (refresh, language, theme) moved to a slim top bar.
- **Full-width content**: removed the 1536px content cap — the main area now uses the full width beside the sidebar.

## [0.5.0] - 2026-07-11

### Added
- **Fleet retransmission total + rate** on the Network Analytics header (events and events/GB across all pairs).
- **Latency tail metrics**: p99 alongside p50/p90/p95/min/max, plus a per-path p95 & jitter (p95−p50) ranking on the Latency tab.
- **Monitor reliability chips**: retransmission/timeout rate (events/GB) health chips on the monitor list cards.
- **Overview golden-signal strip**: a per-bucket fleet retransmission-rate / timeout-rate trend.
- **RTT↔retransmission correlation** (Pearson r) badge on the Reliability tab. The originally-planned per-category Workload-Insights RTT was dropped (the NFM WorkloadInsights API does not expose `ROUND_TRIP_TIME`) and replaced by this correlation.
- **Traffic concentration** scalars (normalized Shannon entropy, Gini, top-pair share) on the Dependencies tab.
- **Went-silent detection**: entities present in the prior window but zero in the current window, listed on the Movers tab.
- **Edge-health adjacency matrix** (green/amber/red by retransmission/timeout rate) with a metric/health toggle and legend on the Topology page.

### Changed
- Extract a shared `ratePerGb` helper and consolidate retransmission/timeout rate health thresholds (warn 5 / danger 10 events per GB), applied consistently across the monitor chips, topology health matrix, and network table.

## [0.4.0] - 2026-07-11

### Changed
- **Horizontal top-nav layout**: replace the left sidebar with a horizontal top navigation bar (brand + version + menu with a "More" overflow dropdown + language/theme/refresh controls), and constrain the main content to a centered `max-w-[1536px]` so wide monitors no longer stretch content edge-to-edge.

### Removed
- Left `Sidebar` and `Topbar` components — their branding, version label, navigation, and controls now live in the new top-nav header.

## [0.3.0] - 2026-07-11

### Added
- **Network Analytics** menu (`/network`): Datadog-CNM-style source-scope → dest-scope aggregation (service/namespace/subnet/AZ/VPC/category/monitor), a metric toggle (volume/throughput/retransmits/RTT), per-row sparklines, retransmit-rate health coloring, and drill-down.
- Reusable **FacetRail** and inline **Sparkline** components.

### Changed
- **Visual polish** toward a Datadog-dense aesthetic: refined tokens, card/table chrome, table density, and empty/loading states (light + dark).
- **Topology graph**: edges are now colored by connection health (retransmit rate) alongside throughput dashing, with a health legend and metric-aware edge width.
- Broaden entity search to also match instance IDs, monitor names, and VPC IDs.

### Fixed
- Reduce anomaly spike noise with a minimum-absolute-change floor (large spikes and threshold anomalies still fire).
- Fix a CategoryDonut legend overflow in narrow cards (dark mode).

## [0.2.0] - 2026-07-11

### Added
- **Alerts / Events** menu: live CloudWatch alarm states plus a derived event feed (NHI degradation, reliability breaches, collection gaps, retransmission/timeout spikes).
- **Search** menu: unified entity search across topology nodes, recent flows, and DNS names, with deep links to the relevant page.
- **Settings** menu: user-tunable thresholds (retransmission/timeout/cost/anomaly σ), default time range, monitor filter (persisted in localStorage), and an alarm-subscribe helper.
- **Cost Explorer** menu: billed cost grouped by cluster / namespace / category / monitor, monthly run-rate, savings recommendations, and a trend.
- **Anomalies** menu: baseline-deviation detection (threshold + window-over-window spike) with an overview anomaly badge.
- **Reports / Export** menu: Markdown / CSV / print export of the current network state, plus a CSV export button on the flows table.

### Changed
- Grant the app task role `cloudwatch:DescribeAlarms` (for the Alerts menu).

## [0.1.0] - 2026-07-11

### Added
- Insights hub **Efficiency & Cost-optimization** tab: billed vs free (inter-AZ/VPC/Region) traffic ratio, estimated monthly cost run-rate, top cross-AZ talkers, and a billed-cost trend.
- Insights hub **Reliability Scorecard / SLO** tab: per-monitor NHI availability %, retransmission/timeout rates, a composite 0-100 reliability score with status, an overall availability gauge, a breach timeline, and worst services.
- Insights hub **Top Movers** tab: entities whose data-transferred / retransmissions / timeouts changed most versus the prior window (window-over-window deltas with direction).
- **DNS tab deep-dive**: internal vs external query ratio, top NXDOMAIN sources, resolver-latency band, failure breakdown by rcode, and top query sources.

## [0.0.1] - 2026-07-10

### Fixed
- Fix a React hydration mismatch (#418) on `/flows`: the bucket list was seeded from `Date.now()` + `toLocaleTimeString` in a `useState` initializer, differing between the server render and client hydration. It now starts empty and fills client-side on mount.

## [0.0.0] - 2026-07-10

First full release: AWS Network Flow Monitor (NFM) Pod-to-Pod observability dashboard with an Amazon Bedrock AgentCore chatbot, plus the Phase 6 analytics enrichment.

### Added
- **Core dashboard (Phases 1–5)**
  - Overview page with NFM KPI tiles (data transferred, retransmissions, timeouts, RTT, Network Health Indicator), deltas, sparklines, top talkers, and CloudWatch deep links.
  - Flows, Paths, Monitors, Agents, and Diagnose pages backed by a DynamoDB collector pipeline (NFM top-contributor queries, agent/monitor status, hop-path data).
  - AgentCore-powered chatbot (floating chat + `/chat-popup` standalone window) with SSE streaming, MCP tooling, and AI diagnosis.
  - Cognito login, ko/en i18n with full key parity, SnowUI design tokens with light/dark themes, mobile layout (bottom tabs, safe-area handling).
- **Analytics enrichment (Phase 6)**
  - WhaTap-style force-directed topology graph (d3-force) with tier flow map, resource icons, tag filtering, and live legend.
  - 5-tab Insights hub (Cost, Reliability, Latency, Dependencies, DNS) over analytics aggregates, with lens filters and Sankey/Toplist/StatDelta widgets.
  - Per-monitor detail pages with metric explorer, NHI striped band, hop-path stepper, and per-chart CloudWatch view/alarm links.
  - Workload Insights page (`/workload`): per-metric top contributors by flow category.
  - Flow categories expanded from 3 to all 11 NFM `destinationCategory` values (added INTERNET, AWS_SERVICE, TRANSIT_GATEWAY, LOCAL_ZONE).
  - Chatbot rework: right-side drawer, syntax highlighting, follow-up chips, stop button, and code-copy.
  - Page enrichment: overview stat deltas + sparklines, flows aggregate strip, paths default content, agents coverage gauges + collection-cycle sparkline.
  - App version label in the sidebar, synced to this changelog via `app/src/lib/version.ts`.
  - DNS insights tab loading skeleton (no "logging disabled" flash during first load).

### Changed
- Bump `app/package.json` version to 1.0.0.

### Removed
- SnowUI footer attribution link from the app shell (the CC BY 4.0 design attribution remains in README.md).

[Unreleased]: https://github.com/whchoi98/nfm-dashboard/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/whchoi98/nfm-dashboard/compare/v0.0.0...v0.0.1
[0.0.0]: https://github.com/whchoi98/nfm-dashboard/releases/tag/v0.0.0

---

<a id="korean"></a>

# 한국어

이 프로젝트의 모든 주요 변경 사항은 이 파일에 기록됩니다.
이 문서는 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 기반으로 하며,
[Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 따릅니다.

> 앱 UI에 표시되는 버전은 `app/src/lib/version.ts`의 `APP_VERSION`을 읽습니다 — 이 값과 `app/package.json`을 이 파일의 최상단 항목과 동기화하여 유지합니다.

## [Unreleased]

## [0.11.0] - 2026-07-15

### Added
- 시간 단위 rollup 계층 추가: 수집기가 매 시간 마감 후 시간 단위 HFLOW row(동일 아이템 형태, 카운터 합산, RTT 평균, 모니터/메트릭/카테고리별 top-200, 15일 TTL)를 기록하고 최초 배포 시 최근 7일을 자동 백필; 3시간 초과 lens 조회는 마감된 시간 rollup + 실시간 5분 tail을 조합해 사용 — 콜드 24시간 조회를 쿼리 약 1,440회에서 약 180회로, 7일 조회를 약 840회로 절감 (ADR-009).
- lens 페이지의 7일 인터랙티브 범위 복원 — 기존 24시간 상한을 대체 (ADR-008).
- aws-rum-pipeline 연동 RUM(Real User Monitoring): `RumProvider`가 자체 호스팅 SDK를 로드해 모든 이벤트에 `appName: nfm-dashboard`를 스탬핑 (페이지뷰·SPA 체류시간·Core Web Vitals·JS 에러). `scripts/build-push.sh` 실행 전 `NEXT_PUBLIC_RUM_*` export 시에만 활성화 (Docker build args).
- 이상 징후 상세 패널: `/anomalies`에서 행을 선택하면 엔티티 상세(지표, 현재값 대비 베이스라인, 초과분, 심각도)와 동작하는 딥링크를 갖춘 우측 슬라이드오버 표시 — `/topology?focus=<ns/name>`은 해당 노드를 포커스, `/network?ns=<namespace>`는 네임스페이스 facet을 프리셋; 패널은 폴링으로 실시간 갱신되며 이상 징후 해소 시 자동 닫힘 기능 추가.
- `/reports` 리포트 개선: 스타일드 `ReportDocument`가 비용 산정 근거 블록(AZ 간 전송 요율, 청구 카테고리, 월 예상 run-rate)을 앞세우고 KPI 타일, 카테고리별 비용 표, 상위 트래픽, 이상 징후를 렌더링하며 Download PDF 버튼(브라우저 print-to-PDF) 추가. `.md`/`.csv` 다운로드 유지.
- 네트워크 분석 `port` 목적지 스코프(G1): source-to-destination 매트릭스가 목적지 측을 target port로 집계하며 잘 알려진 포트(HTTPS, DNS, PostgreSQL 등) 라벨링 추가.
- DNS resolver 비교(G3): 수집기가 소스별 DNS 통계(`bySource` — CoreDNS vs Route53 Resolver: p50/p95 지연, 실패율, 샘플 수)를 집계하고 Insights DNS 탭이 resolver 비교 패널을 렌더링. Route53 Resolver 쿼리 로그에 지연 샘플이 없으면 조작된 0 ms 대신 "데이터 없음" 표시.
- `/alerts` 복합 조건 뷰(G5): 동시에 2개 이상 신호(높은 재전송률 및 윈도우 대비 큰 트래픽 급감)를 위반한 서비스 엔티티를 나열하는 대시보드 하이라이트 추가. CloudWatch 알람이 아닌 앱 측 신호.
- 페이지별 소개 박스: 17개 사이드바 페이지 각각의 제목 아래에 개요/기능 설명 박스 표시 — 공유 `PageIntro` 컴포넌트 + 한/영 카피.

### Changed
- 미들웨어가 프로덕션에서도 명시적 `AUTH_DISABLED=1`을 허용 — `authDisabled` CDK 컨텍스트로만 주입 (기본 OFF — 로그인 강제). 설정 시 Cognito 세션 게이트만 스킵되며 `x-origin-verify` CloudFront 경계와 Cognito 리소스는 어느 경우든 유지 (ADR-005). `scripts/smoke.sh`/e2e는 `E2E_AUTH_DISABLED`로 토글을 미러링.
- flows/lens 캐시를 수집기 사이클에 정렬: 캐시된 윈도우와 계산된 lens 응답(`cachedLens`, 순수 flow-lens 라우트 8개에 적용)이 수집기가 새 사이클을 기록하거나 5분 버킷 그리드가 넘어갈 때까지 유효 — 사이클 사이 폴링은 메모리에서 응답 (실측: `/api/network?buckets=72` 4.5초 → 0.02초, `/api/anomalies?buckets=288` 40초 → 0.13초 warm), 새 데이터는 사이클 기록 후 ~15초 내 반영. 단일 태스크 토폴로지에서 ElastiCache Serverless는 검토 후 미채택 (ADR-007).
- 인터랙티브 lens 시간 범위를 24h로 상한 (`MAX_BUCKETS` 288): 수집기 사전 집계(rollup) 도입 전까지 7d 옵션을 lens 페이지에서 제거 — 7d+ 조회는 Athena 기반 `/history` 페이지가 담당 (ADR-008). 레거시 `?buckets=2016` 요청은 288로 클램프, 저장된 7d 기본 범위는 1h로 폴백. (0.11.0 개발 중의 임시 조치; 같은 릴리스의 hourly rollup 계층으로 대체 — ADR-009.)
- 앱 태스크를 4096 MiB로 증설 (`NODE_OPTIONS=--max-old-space-size=3072` V8 힙 상한 포함) 및 ALB 타깃 그룹 `unhealthyThresholdCount`를 5로 상향 — 느린 콜드 24h 윈도우 계산 도중 태스크가 사살되지 않도록 조치.

### Fixed
- 프로덕션 502/504 장애 (2026-07-14): 분석 부하에서 2 GB 태스크가 OOM으로 사살(exit 137)되던 문제 — DynamoDB 버킷 쿼리 fan-out이 SDK 기본 50소켓 agent에 수백 요청을 큐잉(전 메뉴 지연)하는 동안 다일(multi-day) 원시 flow 윈도우가 힙을 채움. 512소켓 keep-alive agent, `getFlowsWindowPair`의 공유 윈도우 캐시 합류 + 양쪽 half 단일 동시성 풀, settle 기준 캐시 축출, 4096 MiB 태스크로 수정.
- CPU 크래시 루프 (2026-07-15): 7d lens 뷰 콜드 조회가 1 vCPU 태스크에서 수 분간 동기 fetch+집계를 실행해 이벤트 루프를 블록, ALB 헬스체크가 태스크를 사살하고 인프로세스 캐시가 함께 소실되어 브라우저 폴링이 교체 태스크에 동일한 콜드 계산을 즉시 재유발하던 문제. 임시 24h 상한(같은 릴리스의 hourly rollup으로 대체)과 위의 헬스체크 완화로 수정.
- 간헐적 로그인 실패("첫 시도 실패, 재시도 성공"): 동시 `/api/auth/login` 호출(인증 재활성화 후 남은 stale 탭, 또는 버튼 중복 클릭)이 1회성 `state`/`pkce`/`nonce` 쿠키를 덮어써 첫 콜백이 CSRF `state` 검증에 실패하던 문제. 이제 콜백이 transient/CSRF 실패 시 로그인을 1회 투명하게 자동 재시작(`nfm_auth_retry` 마커로 루프 방지)하며, 토큰 교환·id_token 검증 실패는 재시도하지 않는다. 실패 단계는 로그로 남긴다(단계명만, 시크릿 값 없음).

## [0.10.0] - 2026-07-12

### Added
- **정렬 가능한 랭킹 리스트**: 값 순위 리스트(top talker·타깃 포트·DNS 도메인/쿼리타입/실패/리졸버·비용(클러스터/네임스페이스/모니터)·신뢰성 hotspot·scorecard worst·top movers·slowest·cross-AZ·hop 구성)에 opt-in 클릭 정렬 헤더 추가 — 이름/값 기준 오름/내림차순, 원시값 기준. 개요/플로우/워크로드 컴팩트 티저는 고정 top-N 유지.

## [0.9.0] - 2026-07-12

### Added
- **정렬 가능한 데이터 테이블**: 컬럼 헤더 클릭으로 오름/내림차순 정렬(문자열·숫자·불리언 타입 인지) — 플로우·지연 tail·신뢰성 breach·네트워크 페어·워크로드·에이전트 커버리지 + Athena 히스토리 결과(숫자/문자열 컬럼 자동 판별). 표시 문자열이 아닌 **원시값 기준** 정렬, 클릭 전까지 기본 순서 유지, `aria-sort` 접근성 추가.

### Changed
- 에이전트 커버리지 테이블 기본 정렬을 결정론적 `instanceId` 오름차순으로 변경(기존 임의의 EC2 API 순서).

## [0.8.0] - 2026-07-12

### Added
- **토폴로지 노드 그룹핑**(namespace/AZ/cluster) + collapse/expand + 집계 엣지 — 밀집 pod 맵을 소수의 그룹 노드로 접고 조사 대상만 전개; AZ 모드는 cross-zone 트래픽을 드러냄.
- **클릭→ego-network 격리**(1/2-hop) + 노드로 이동하는 **캔버스 검색**.
- **min-traffic 임계 슬라이더**(숨김 엣지 수 표시) + **인터랙티브 헬스 legend**(상태 클릭 시 해당 클래스만 격리).
- **노드 kind 아이콘**(pod/node/vpc/external) + **cross-AZ**·**high-retransmit 배지** — 색은 health 전용 유지, 부가 신호는 모양/아이콘/배지로.
- **결정론적 토폴로지 레이아웃** + 위치 지속(리로드·필터 변경에도 안정) + **라이브 미니맵**.

## [0.7.0] - 2026-07-12

### Added
- **7일 분석 범위**: 기간 선택기에 `7d` 옵션 추가(분석 조회 창을 24시간 → 7일, 최대 `MAX_BUCKETS` 2016개 5분 버킷). 넓은 창이 DynamoDB를 폭주시키지 않도록 버킷별 플로우 쿼리 팬아웃에 동시성 풀(상한) 적용.
- **플로우 아카이브(S3 + Parquet)**: 모든 플로우 쓰기를 스트리밍(DynamoDB Streams → 변환 Lambda → Kinesis Firehose Parquet 변환)해 7일 DynamoDB TTL 삭제 전에 날짜 파티션 S3 아카이브로 저장, AWS Glue(`nfm_dashboard.flows_archive`, `dt` 파티션 프로젝션)에 카탈로그화하고 Athena 워크그룹으로 조회 가능.
- **히스토리 페이지**(`/history`): 아카이브를 임의 기간(라이브 7일 핫 경로를 넘어서)으로 조회하는 Athena 기반 페이지 — 온디맨드 쿼리, 모니터/네임스페이스/메트릭 필터, 결과 테이블.

### Changed
- 앱 태스크 역할에 최소 권한 Athena/Glue/S3 권한 부여(`/api/history`용); flows 테이블에 DynamoDB Streams 추가.

## [0.6.0] - 2026-07-11

### Added
- **개요 요약 카드**: 랜딩 페이지에 한눈 요약 카드 6종 추가 — 신뢰성 점수(SLO 0~100), 월 예상 비용 run-rate, 청구 트래픽 비율, DNS 상태(실패율 + 리졸버 p95), 트래픽 집중도(최상위 페어 점유율), 모니터 상태(정상/전체) — 각 카드는 상세 페이지로 딥링크.

### Changed
- **좌측 사이드바 내비게이션**: 상단 가로 내비를 6개 그룹(개요/네트워크/분석/운영/비즈니스/도구)으로 전체 메뉴를 노출하는 좌측 사이드바로 교체; 컨트롤(새로고침·언어·테마)은 얇은 상단바로 이동.
- **전체 폭 콘텐츠**: 1536px 폭 제한 제거 — 메인 영역이 사이드바 옆 전체 폭 사용.

## [0.5.0] - 2026-07-11

### Added
- 네트워크 분석 헤더에 **fleet 재전송 총량 + rate/GB**(전체 페어 합계) 추가.
- **지연 tail 지표**: p50/p90/p95/min/max에 p99 추가 + Latency 탭에 per-path p95·지터(p95−p50) 랭킹 추가.
- **모니터 신뢰성 칩**: 모니터 목록 카드에 재전송/타임아웃 rate(events/GB) 건강도 칩 추가.
- **개요 골든시그널 스트립**: 버킷별 fleet 재전송률/타임아웃률 추세 추가.
- Reliability 탭에 **RTT↔재전송 상관계수(Pearson r)** 배지 추가. 당초 계획한 Workload Insights 카테고리별 RTT는 NFM WorkloadInsights API가 `ROUND_TRIP_TIME`을 제공하지 않아 제외하고 이 상관계수로 대체.
- Dependencies 탭에 **트래픽 집중도** 스칼라(정규화 Shannon 엔트로피·Gini·최상위 페어 점유율) 추가.
- **무음 전환 탐지**: 직전 창에는 있었으나 현재 창에서 0이 된 엔티티를 Movers 탭에 목록화.
- Topology 페이지에 **엣지 헬스 인접 매트릭스**(재전송/타임아웃 rate 기준 green/amber/red) + metric/health 토글 + 범례 추가.

### Changed
- 공유 `ratePerGb` 헬퍼 추출 및 재전송/타임아웃 rate 건강도 임계값(warn 5 / danger 10 events per GB) 통합 — 모니터 칩·토폴로지 헬스 매트릭스·네트워크 표에서 일관 적용.

## [0.4.0] - 2026-07-11

### Changed
- **상단 가로 내비게이션 레이아웃**: 좌측 사이드바를 상단 가로 내비게이션 바(브랜드 + 버전 + "더보기" 오버플로우 드롭다운 메뉴 + 언어/테마/새로고침 컨트롤)로 교체하고, 메인 콘텐츠를 중앙 정렬된 `max-w-[1536px]`로 제한하여 넓은 모니터에서 콘텐츠가 좌우로 과하게 늘어나지 않도록 개선.

### Removed
- 좌측 `Sidebar` 및 `Topbar` 컴포넌트 제거 — 브랜딩·버전 표기·내비게이션·컨트롤은 새 상단 내비 헤더로 이전.

## [0.3.0] - 2026-07-11

### Added
- **네트워크 분석** 메뉴(`/network`): Datadog CNM 스타일 source scope → dest scope 집계(service/namespace/subnet/AZ/VPC/category/monitor), 지표 토글(볼륨/처리량/재전송/RTT), 행별 스파크라인, 재전송률 건강도 색상, 드릴다운 추가.
- 재사용 가능한 **FacetRail** 및 inline **Sparkline** 컴포넌트 추가.

### Changed
- Datadog식 dense 미학을 향한 **비주얼 폴리시**: 토큰, 카드/테이블 크롬, 테이블 밀도, empty/loading 상태 정리(라이트+다크).
- **토폴로지 그래프**: 엣지를 처리율 점선과 함께 연결 건강도(재전송률)로 색상화, 건강도 범례 + 지표 반영 엣지 폭 추가.
- 엔티티 검색이 인스턴스 ID·모니터 이름·VPC ID까지 매칭하도록 확대.

### Fixed
- 이상 징후 spike 노이즈를 최소 절대 변화량 하한으로 감소(대형 spike와 임계값 이상은 계속 탐지).
- 좁은 카드에서 CategoryDonut 범례 오버플로우 수정(다크 모드).

## [0.2.0] - 2026-07-11

### Added
- **알림 / 이벤트** 메뉴: CloudWatch 알람 상태 + 파생 이벤트 피드(NHI 저하, 신뢰성 breach, 수집 공백, 재전송/타임아웃 급증) 추가.
- **검색** 메뉴: 토폴로지 노드·최근 플로우·DNS 이름 통합 검색 + 관련 페이지 딥링크 추가.
- **설정** 메뉴: 사용자 조정 임계값(재전송/타임아웃/비용/이상 σ), 기본 기간, 모니터 필터(localStorage 유지), 알람 구독 도우미 추가.
- **비용 탐색** 메뉴: 클러스터/네임스페이스/범주/모니터별 과금 비용, 월간 run-rate, 절감 후보, 추세 추가.
- **이상 징후** 메뉴: baseline 편차 탐지(임계값 + 창 대비 급증) + 개요 이상 배지 추가.
- **리포트 / 내보내기** 메뉴: 현재 네트워크 상태 Markdown/CSV/인쇄 내보내기 + 플로우 테이블 CSV 버튼 추가.

### Changed
- 앱 태스크 역할에 `cloudwatch:DescribeAlarms` 권한 부여(알림 메뉴용).

## [0.1.0] - 2026-07-11

### Added
- 인사이트 허브 **효율성 & 비용 최적화** 탭: 과금 vs 무료(inter-AZ/VPC/Region) 트래픽 비율, 월간 비용 run-rate 추정, 상위 cross-AZ talker, 과금 비용 추세 추가.
- 인사이트 허브 **신뢰성 스코어카드 / SLO** 탭: 모니터별 NHI 가용성 %, 재전송/타임아웃률, 0-100 복합 신뢰성 점수 + 상태, 전체 가용성 게이지, breach 타임라인, 상위 불안정 서비스 추가.
- 인사이트 허브 **Top Movers** 탭: 직전 창 대비 데이터 전송량/재전송/타임아웃이 가장 크게 변한 엔티티(창 대비 델타 + 방향) 추가.
- **DNS 탭 심화**: 내부 vs 외부 쿼리 비율, 상위 NXDOMAIN 소스, 리졸버 지연 대역, rcode별 실패 분해, 상위 질의 소스 추가.

## [0.0.1] - 2026-07-10

### Fixed
- `/flows`의 React hydration mismatch(#418) 수정: 버킷 목록을 `useState` 초기화에서 `Date.now()` + `toLocaleTimeString`으로 생성해 서버 렌더와 클라이언트 하이드레이션이 달랐음. 이제 빈 상태로 시작해 마운트 시 클라이언트에서 채움.

## [0.0.0] - 2026-07-10

첫 정식 릴리스: Amazon Bedrock AgentCore 챗봇을 포함한 AWS Network Flow Monitor(NFM) Pod-to-Pod 관측 대시보드, 그리고 Phase 6 분석 고도화.

### Added
- **핵심 대시보드 (Phase 1–5)**
  - NFM KPI 타일(데이터 전송량, 재전송, 타임아웃, RTT, 네트워크 상태 지표), 델타, 스파크라인, 상위 talker, CloudWatch 딥링크를 갖춘 개요 페이지 추가.
  - DynamoDB 수집 파이프라인(NFM 상위 기여자 쿼리, 에이전트/모니터 상태, 홉 경로 데이터) 기반의 Flows·Paths·Monitors·Agents·Diagnose 페이지 추가.
  - SSE 스트리밍·MCP 도구·AI 진단을 갖춘 AgentCore 챗봇(플로팅 챗 + `/chat-popup` 독립 창) 추가.
  - Cognito 로그인, 키 패리티를 갖춘 ko/en i18n, 라이트/다크 테마의 SnowUI 디자인 토큰, 모바일 레이아웃(하단 탭, safe-area 처리) 추가.
- **분석 고도화 (Phase 6)**
  - WhaTap 스타일 force-directed 토폴로지 그래프(d3-force) — 티어 플로우 맵, 리소스 아이콘, 태그 필터, 라이브 범례 추가.
  - 분석 집계 기반 5탭 Insights 허브(비용, 신뢰성, 지연, 의존성, DNS) — 렌즈 필터 + Sankey/Toplist/StatDelta 위젯 추가.
  - per-monitor 상세 페이지 — 지표 탐색기, NHI 줄무늬 밴드, 홉 경로 스텝퍼, 차트별 CloudWatch 보기/경보 링크 추가.
  - Workload Insights 페이지(`/workload`) — 흐름 범주별 지표 상위 기여자 추가.
  - 흐름 범주를 3종에서 NFM `destinationCategory` 11종 전부로 확장(INTERNET, AWS_SERVICE, TRANSIT_GATEWAY, LOCAL_ZONE 추가).
  - 챗봇 재설계 — 우측 드로어, 구문 강조, 후속 질문 칩, 정지 버튼, 코드 복사.
  - 페이지 풍성화 — 개요 델타 + 스파크라인, 플로우 집계 스트립, 경로 기본 콘텐츠, 에이전트 커버리지 게이지 + 수집 사이클 스파크라인.
  - `app/src/lib/version.ts`로 이 변경 로그와 동기화되는 사이드바 앱 버전 라벨 추가.
  - DNS 인사이트 탭 로딩 스켈레톤 추가(첫 로드 시 "로깅 비활성화" 깜빡임 제거).

### Changed
- `app/package.json` 버전을 1.0.0으로 상향.

### Removed
- 앱 셸에서 SnowUI 푸터 저작자 표시 링크 제거(CC BY 4.0 디자인 저작자 표시는 README.md에 유지).

[Unreleased]: https://github.com/whchoi98/nfm-dashboard/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/whchoi98/nfm-dashboard/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/whchoi98/nfm-dashboard/compare/v0.0.0...v0.0.1
[0.0.0]: https://github.com/whchoi98/nfm-dashboard/releases/tag/v0.0.0
