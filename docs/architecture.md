# Architecture

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## System Overview

NFM Dashboard (v0.10.0) is an AWS-native, serverless network-observability system built on CloudWatch Network Flow Monitor (NFM). A collector Lambda runs every 5 minutes to pull NFM top-contributor flows, Workload Insights (11 flow categories), CloudWatch metrics, and DNS logs into a DynamoDB single-table store; a Next.js application (ECS Fargate behind CloudFront + ALB, Cognito-gated) reads that store, computes analytics in-app, and renders a full-width, grouped-sidebar dashboard (an at-a-glance Overview summary plus 15 deeper pages) alongside a Bedrock AgentCore AI chatbot. A second data path archives every flow record out of DynamoDB before its 7-day TTL — via DynamoDB Streams → transform Lambda → Kinesis Firehose (Parquet) → S3 → Glue/Athena — so the History page can run arbitrary-date-range queries beyond the hot window. All infrastructure is defined as six AWS CDK stacks.

## Components by Layer

- **Ingestion** — `collector` Lambda (`nfm-dashboard-collector`, every 5 min via EventBridge Scheduler): async NFM `MonitorTopContributors` (flows) + `WorkloadInsightsTopContributors` (11 categories) queries, `AWS/NetworkFlowMonitor` CloudWatch metrics, and Route53 Resolver / CoreDNS logs via CloudWatch Logs Insights. Concurrency 5 + exponential backoff; partial failures tolerated.
- **Storage (hot)** — DynamoDB single-table design: `nfm-dashboard-flows` (flow records, 7-day TTL, GSI for pod/edge time series, DynamoDB Stream `NEW_IMAGE`) and `nfm-dashboard-meta` (topology snapshots, collection status/history, coverage, `WI#latest`, `DNS#latest`). Key-based access only.
- **Archive / Long-term Analytics (cold)** — `nfm-dashboard-flows` DynamoDB Stream → `archive-transform` Lambda (`collector/src/archive-transform.ts`, esbuild bundle `collector/dist/archive-transform.mjs`) → Kinesis Firehose (`nfm-dashboard-flow-archive`, Parquet conversion via the Glue schema, dynamic partitioning by `dt`) → S3 archive bucket `nfm-dashboard-flow-archive-<ACCOUNT_ID>` (`flows/dt=YYYY-MM-DD/*.parquet`) → Glue Data Catalog (`nfm_dashboard.flows_archive`, partition projection on `dt`, no crawler) → Athena workgroup `nfm-dashboard` (results in `nfm-dashboard-athena-results-<ACCOUNT_ID>`). Captures flows before the 7-day TTL deletes them, enabling >7-day / arbitrary-date-range history queries.
- **Processing** — In-app analytics lenses (`app/src/lib/analytics/*`): cost, reliability, latency, dependencies, dns — pure functions over recent flow windows. No DB-side aggregation. Network-parity lenses (2026-07): port/service traffic mix (`port-mix.ts`, exposed as a `port` dest-scope on the network matrix), a composite-condition signal (`composite-conditions.ts` — flags service entities breaching ≥2 signals at once: high retransmission rate + a large window-over-window volume drop), and per-source DNS stats (`bySource`, computed collector-side in `aggregateDns` — CoreDNS vs Route53 Resolver).
- **Query** — Next.js route handlers (`app/src/app/api/*`): overview (with an additive `summary` block composing the scorecard/efficiency/dns/concentration lenses), flows, topology, paths, insights, analytics/{cost,reliability,latency,dependencies,dns}, monitors, workload, agents, ai, diagnose, health, auth, anomalies, network, alerts, cost-explorer, reports, search, and **history** (on-demand Athena query via `app/src/lib/athena.ts` — `buildHistorySql` injection-guarded + `runHistoryQuery`). Analytics ranges now include a `7d` option (`app/src/lib/analytics/filters.ts`: `rangeToBuckets` 2016, `MAX_BUCKETS` 2016); `app/src/lib/ddb.ts` fans the per-bucket flow queries out through a bounded-concurrency pool (K=40).
- **Presentation** — Next.js 16 App-Router dashboard with a full-width layout and a grouped **left sidebar** (`app/src/components/layout/Sidebar.tsx`, 6 groups — Overview / Network / Analysis / Operations / Business / Tools, all 16 menus exposed) plus a slim `Topbar.tsx` (refresh / lang / theme); nav source is `nav.ts` (`NAV_GROUPS` → `NAV_ITEMS`), mobile handled by `MobileTabs.tsx`. Pages: Overview (6 at-a-glance summary cards — reliability / cost / billed / dns / concentration / monitors), topology graph, insights hub, per-monitor, workload, flows/paths/agents, the History page (`app/src/app/history/page.tsx`, Analysis group), the `/anomalies` page's `AnomalyDetailPanel` (`app/src/components/analytics/AnomalyDetailPanel.tsx` — right slide-over, `role=dialog`/`aria-modal`, live-updates with the polling anomaly list and auto-closes if the selected anomaly resolves out of it, with deep-link buttons to `/topology?focus=<ns/name>` and `/network?ns=<namespace>`), + AI chatbot (floating drawer + `/chat-popup`), ko/en i18n, SnowUI tokens, light/dark, mobile responsive. The `/topology` force graph (`app/src/components/topology/NetworkGraph.tsx`) carries **topology-visibility** controls: node grouping by namespace/AZ/cluster with collapse/expand + aggregate edges, click-to-isolate ego-network (1/2-hop) with canvas search/pan-to, a min-traffic threshold slider + interactive health legend (`GraphLegend`), node kind icons (`ResourceIcon`) and cross-AZ / high-retransmit badges (color stays reserved for health; extra signals ride on shape/icon/badge), a deterministic layout (id-hash seed + `fx`/`fy` pinning) with localStorage position persistence (working-set evicted) and a live MiniMap — helpers in `app/src/lib/graph-focus.ts` (neighbors/ego), `app/src/lib/graph-layout.ts` (deterministic seed + `graphSignature`), and grouping/`crossAz`/`minEdgeValue` thresholds in `app/src/lib/topology-graph.ts` (health from `app/src/lib/analytics/edge-health.ts`). A shared **sortable-table/list** primitive (`app/src/lib/use-sortable.ts`: `useSortableRows` + `compareBy` — type-aware string/number/boolean, null-last, sorts RAW values not formatted text — with `SortableHeader.tsx` for `aria-sort`) makes all 7 raw `<table>`s sortable (FlowTable, LatencyTab tail, ReliabilityTab breaches, network pairs, workload contributors, agents coverage, and the dynamic Athena history table via `app/src/app/history/history-sort.ts` numeric/string column sniffing); an opt-in `sortable` prop on the shared `Toplist` (`app/src/components/analytics/Toplist.tsx`) extends the same behavior to ~18 ranked lists (cost / DNS / hotspots / pareto / scorecard / movers / slowest / efficiency / …), while compact teasers keep a fixed top-N. Insights·DNS adds a **resolver-comparison panel** (CoreDNS vs Route53 Resolver latency/fail-rate; resolver latency shows "no data" rather than 0 ms when it has no samples, since Resolver query logs carry no per-query latency), and `/alerts` adds a **composite-conditions** section listing multi-signal breaches (a dashboard highlight, not a CloudWatch alarm).
- **Observability** — `NfmDash-Ops` CloudWatch alarms (collector errors, ALB no-healthy-hosts, ALB 5xx) → SNS `nfm-dashboard-alarms`; collection status surfaced on `/agents`.
- **Security** — Cognito user pool + Hosted UI (Authorization Code + PKCE), JWT verification in Next.js middleware, `X-Origin-Verify` header (CloudFront-only ALB access), SigV4/AWS_IAM to the AgentCore MCP gateway, secrets in Secrets Manager. The Cognito session gate can be temporarily disabled via the `authDisabled` CDK context → task env `AUTH_DISABLED=1` (the `x-origin-verify` perimeter always stays enforced; currently OFF — login is enforced); see ADR-005.

## Architecture Diagram

```text
        ┌──────────────────────────────────────────────────────────────┐
        │  NFM sources: MonitorTopContributors · WorkloadInsights (×11) │
        │  CloudWatch AWS/NetworkFlowMonitor metrics · Route53/CoreDNS  │
        └───────────────────────────────┬──────────────────────────────┘
                                         │ StartQuery→poll→GetResults (conc 5)
                                         ▼
   EventBridge Scheduler (5 min) ──▶ ┌───────────────────┐
                                     │ Collector Lambda  │  normalize (edgeHash),
                                     │ (Node, arm64)     │  topology snapshot
                                     └─────────┬─────────┘
                                               ▼
                                 ┌───────────────────────────┐  hot store
                                 │ DynamoDB (single-table)   │──┐ Stream (NEW_IMAGE)
                                 │  nfm-dashboard-flows (TTL)│  │
                                 │  nfm-dashboard-meta       │  ▼
                                 └─────────────┬─────────────┘  ┌──────────────────────┐
                                               │                │ archive-transform λ  │
                                               │                └───────────┬──────────┘
                                               │                            ▼
                                               │                ┌──────────────────────┐
                                               │                │ Kinesis Firehose     │ Parquet,
                                               │                │  nfm…-flow-archive   │ dt-partition
                                               │                └───────────┬──────────┘
                                               │                            ▼
                                               │                ┌──────────────────────┐
                                               │                │ S3 flows/dt=…/*.pq   │ cold archive
                                               │                └───────────┬──────────┘
                                               │                            ▼
                                               │              Glue nfm_dashboard.flows_archive
                                               │                            │ (partition projection)
                                               │ key-based reads            ▼
                                               │                  Athena wg 'nfm-dashboard'
   User (desktop/iPhone)                       ▼                            │ /api/history
        │ HTTPS          ┌───────────────────────────────────────┐         │
        ▼                │ Next.js API routes (+ analytics lenses)│◀────────┘
   CloudFront ──▶ ALB ──▶│ ECS Fargate (arm64, private subnets)   │
    (X-Origin-Verify)    │ Next.js 16 UI (sidebar) + FloatingChat │
        ▲                └───────────┬───────────────┬───────────┘
        │ Cognito Hosted UI          │               │ /api/ai, /api/diagnose (SSE)
        │ (JWT / PKCE)               │               ▼
        └────────────────────────────┘      ┌────────────────────────┐
                                             │ Bedrock ConverseStream │
                                             │  + AgentCore Gateway   │
                                             │  (MCP, SigV4, 27 tools)│
                                             └────────────────────────┘
```

## Data Flow Summary

NFM/CW/DNS sources ▶ Collector Lambda (5 min) ▶ DynamoDB single-table (hot) ▶ Next.js API + in-app analytics ▶ dashboard UI / AI chatbot (Bedrock + AgentCore gateway).

Archive branch (cold): DynamoDB Stream (NEW_IMAGE) ▶ archive-transform Lambda ▶ Kinesis Firehose (Parquet, dt-partition) ▶ S3 archive ▶ Glue `nfm_dashboard.flows_archive` ▶ Athena workgroup `nfm-dashboard` ▶ `/api/history` ▶ History page.

## Infrastructure

| Stack | Purpose | Key resources |
|-------|---------|---------------|
| `NfmDash-Data` | Storage + ingestion + archive | DynamoDB `nfm-dashboard-flows` / `nfm-dashboard-meta` (TTL, `flows` Stream `NEW_IMAGE`), Collector Lambda, EventBridge Scheduler (5 min); flow-archive pipeline: `archive-transform` Lambda, Kinesis Firehose `nfm-dashboard-flow-archive` (Parquet), S3 `nfm-dashboard-flow-archive-<ACCOUNT_ID>`, Glue `nfm_dashboard.flows_archive`, Athena workgroup `nfm-dashboard` (results `nfm-dashboard-athena-results-<ACCOUNT_ID>`) |
| `NfmDash-Onboarding` | Account-wide NFM rollout | NFM Scope + 5 monitors, EKS add-on `aws-network-flow-monitoring-agent` ×4 (Pod Identity), SSM Distributor + State Manager Association for EC2 |
| `NfmDash-AgentCore` | AI tool backend | 3 MCP tool Lambdas (network/nfm/ddb), AgentCore Gateway `nfm-gateway` (AWS_IAM/SigV4, ~27 tools; created out-of-band by `setup-gateway.sh`) |
| `NfmDash-App` | Web application | ECS Fargate (arm64), CloudFront, ALB, Cognito user pool, ECR (immutable tags); task role granted Athena/Glue/S3 (incl. `s3:GetBucketLocation`) + env `ATHENA_WORKGROUP` / `GLUE_DB` / `GLUE_TABLE` for the History page |
| `NfmDash-Ops` | Alarms | 3 CloudWatch alarms + SNS `nfm-dashboard-alarms` |
| `NfmDash-Dns` | DNS visibility | Route53 Resolver query logging + CoreDNS log plugin (reversible) |

## Key Design Decisions

- **DDB-hot + Athena-cold two-tier storage** — DynamoDB is the *hot* operational store: bursty 5-min writes, key-based recent-window reads, single-digit-ms latency, 7-day TTL, fully serverless. The S3 + Parquet + Athena archive is the *cold*, long-term analytics tier: a DynamoDB Stream (`NEW_IMAGE`) fans every flow record through a transform Lambda into Firehose (Parquet, `dt`-partitioned) before the TTL deletes it, so ad-hoc history over weeks/months is queryable via Athena (`/api/history`) without burdening the hot path. Splitting the tiers keeps each optimized for its access pattern and cost profile.
- **In-app analytics lenses (not DB aggregation)** — The lenses are pure functions over recent flow windows, so the DB stays a simple key-value store and single-digit-ms reads keep the UI responsive. Time-series charts read CloudWatch metrics directly.
- **SigV4 gateway call from ECS (not AgentCore Runtime)** — The Next.js `/api/ai` route calls the AgentCore MCP gateway directly with SigV4, avoiding an extra runtime hop while keeping IAM-scoped access.
- **5-minute collection cadence** — Matches NFM's aggregation grid; bounds query volume (≤ concurrency 5) and cost while keeping the dashboard near-real-time.
- **NFM 11-category Workload Insights** — The live NFM API accepts 11 `destinationCategory` values (incl. INTERNET, AWS_SERVICE, TRANSIT_GATEWAY, LOCAL_ZONE); the collector queries all 11 each cycle so `/workload` reflects the full flow taxonomy.
- **Immutable per-commit ECR image tags** — Each commit is a new tag; deploys pin the SHA, so task restarts never swap the image and rollback is a redeploy of the prior tag.
- **Pre-1.0 version scheme (0.x)** — The version was renumbered from 1.x back to 0.x to signal the project is still pre-release; `APP_VERSION` (`app/src/lib/version.ts`) and `app/package.json` are both `0.10.0`.
- **Temporary auth-disable toggle (reversible, env-only)** — The Cognito session gate is skippable via the `authDisabled` CDK context / `AUTH_DISABLED=1` task env instead of being removed from the code path; the `x-origin-verify` perimeter is always retained regardless of the toggle. See `docs/decisions/ADR-005-temporary-auth-disable-toggle.md`.

## Operations

See `docs/runbooks/` for operational procedures (deploy, redeploy, incident response, alarm subscription). Live coordinates, alarms, and the collection cycle are documented in `README.md` (Operations section) and surfaced on the `/agents` page.

---

<a id="korean"></a>

# 한국어

## 시스템 개요

NFM Dashboard(v0.10.0)는 CloudWatch Network Flow Monitor(NFM) 기반의 AWS 네이티브 서버리스 네트워크 관측 시스템입니다. Collector Lambda가 5분마다 NFM 상위 기여자 플로우, Workload Insights(흐름 범주 11종), CloudWatch 지표, DNS 로그를 DynamoDB 단일 테이블 스토어로 수집합니다. Next.js 애플리케이션(CloudFront + ALB 뒤의 ECS Fargate, Cognito 게이트)이 이 스토어를 읽어 앱 내부에서 분석을 계산하고, 전체 너비(full-width)·그룹형 사이드바 대시보드(한눈에 보는 Overview 요약 + 더 깊은 15개 페이지)와 Bedrock AgentCore AI 챗봇을 렌더링합니다. 두 번째 데이터 경로는 DynamoDB의 7일 TTL이 삭제하기 전에 모든 플로우 레코드를 아카이브합니다 — DynamoDB Streams → 변환 Lambda → Kinesis Firehose(Parquet) → S3 → Glue/Athena — 그래서 History 페이지가 핫 윈도우를 넘어 임의 날짜 범위 쿼리를 실행할 수 있습니다. 모든 인프라는 6개 AWS CDK 스택으로 정의됩니다.

## 계층별 구성 요소

- **수집(Ingestion)** — `collector` Lambda(`nfm-dashboard-collector`, EventBridge Scheduler로 5분마다): 비동기 NFM `MonitorTopContributors`(플로우) + `WorkloadInsightsTopContributors`(범주 11종) 쿼리, `AWS/NetworkFlowMonitor` CloudWatch 지표, CloudWatch Logs Insights를 통한 Route53 Resolver / CoreDNS 로그. 동시성 5 + 지수 백오프, 부분 실패 허용.
- **저장(Storage, 핫)** — DynamoDB 단일 테이블 설계: `nfm-dashboard-flows`(플로우 레코드, 7일 TTL, pod/edge 시계열 GSI, DynamoDB Stream `NEW_IMAGE`)와 `nfm-dashboard-meta`(토폴로지 스냅샷, 수집 상태/이력, 커버리지, `WI#latest`, `DNS#latest`). 키 기반 접근만 사용.
- **아카이브 / 장기 분석(Archive / Long-term Analytics, 콜드)** — `nfm-dashboard-flows` DynamoDB Stream → `archive-transform` Lambda(`collector/src/archive-transform.ts`, esbuild 번들 `collector/dist/archive-transform.mjs`) → Kinesis Firehose(`nfm-dashboard-flow-archive`, Glue 스키마 기반 Parquet 변환, `dt` 동적 파티셔닝) → S3 아카이브 버킷 `nfm-dashboard-flow-archive-<ACCOUNT_ID>`(`flows/dt=YYYY-MM-DD/*.parquet`) → Glue Data Catalog(`nfm_dashboard.flows_archive`, `dt` 파티션 프로젝션, 크롤러 없음) → Athena 워크그룹 `nfm-dashboard`(결과는 `nfm-dashboard-athena-results-<ACCOUNT_ID>`). 7일 TTL이 삭제하기 전에 플로우를 포착하여 7일 초과 / 임의 날짜 범위 히스토리 쿼리를 가능하게 합니다.
- **처리(Processing)** — 앱 내부 분석 렌즈(`app/src/lib/analytics/*`): 비용, 신뢰성, 지연, 의존성, DNS — 최근 플로우 윈도우에 대한 순수 함수. DB 측 집계 없음. 네트워크 패리티 렌즈(2026-07): 포트/서비스 트래픽 믹스(`port-mix.ts`, 네트워크 매트릭스의 `port` 목적지 스코프로 노출), 복합 조건 신호(`composite-conditions.ts` — 동시에 2개 이상 신호를 위반한 서비스 엔티티 표시: 높은 재전송률 + 윈도우 대비 큰 트래픽 급감), 소스별 DNS 통계(`aggregateDns`에서 수집기 측 계산되는 `bySource` — CoreDNS vs Route53 Resolver).
- **쿼리(Query)** — Next.js 라우트 핸들러(`app/src/app/api/*`): overview(scorecard/efficiency/dns/concentration 렌즈를 조합하는 추가(additive) `summary` 블록 포함), flows, topology, paths, insights, analytics/{cost,reliability,latency,dependencies,dns}, monitors, workload, agents, ai, diagnose, health, auth, anomalies, network, alerts, cost-explorer, reports, search, 그리고 **history**(`app/src/lib/athena.ts`를 통한 온디맨드 Athena 쿼리 — 인젝션 방어된 `buildHistorySql` + `runHistoryQuery`). 분석 범위에 `7d` 옵션 추가(`app/src/lib/analytics/filters.ts`: `rangeToBuckets` 2016, `MAX_BUCKETS` 2016); `app/src/lib/ddb.ts`는 버킷별 플로우 쿼리를 경계 동시성 풀(K=40)로 팬아웃합니다.
- **표현(Presentation)** — Next.js 16 App-Router 대시보드, 전체 너비 레이아웃 + 그룹형 **왼쪽 사이드바**(`app/src/components/layout/Sidebar.tsx`, 6개 그룹 — Overview / Network / Analysis / Operations / Business / Tools, 16개 메뉴 전부 노출) + 슬림 `Topbar.tsx`(새로고침 / 언어 / 테마); 내비게이션 소스는 `nav.ts`(`NAV_GROUPS` → `NAV_ITEMS`), 모바일은 `MobileTabs.tsx`가 담당. 페이지: Overview(한눈에 보는 요약 카드 6개 — reliability / cost / billed / dns / concentration / monitors), 토폴로지 그래프, 인사이트 허브, per-monitor, workload, flows/paths/agents, History 페이지(`app/src/app/history/page.tsx`, Analysis 그룹), `/anomalies` 페이지의 `AnomalyDetailPanel`(`app/src/components/analytics/AnomalyDetailPanel.tsx` — 오른쪽 슬라이드오버, `role=dialog`/`aria-modal`, 폴링되는 이상 탐지 목록과 실시간 연동되어 선택한 항목이 목록에서 사라지면 자동으로 닫힘, `/topology?focus=<ns/name>`과 `/network?ns=<namespace>`로 이동하는 딥링크 버튼 포함) + AI 챗봇(플로팅 드로어 + `/chat-popup`), ko/en i18n, SnowUI 토큰, 라이트/다크, 모바일 반응형. `/topology` 포스 그래프(`app/src/components/topology/NetworkGraph.tsx`)는 **토폴로지 가시성(topology-visibility)** 제어를 제공: namespace/AZ/cluster 기준 노드 그룹핑(접기/펼치기 + 집계 엣지), 클릭하여 ego-network(1/2-hop) 격리 + 캔버스 검색/팬투(pan-to), 최소 트래픽 임계값 슬라이더 + 인터랙티브 헬스 범례(`GraphLegend`), 노드 종류 아이콘(`ResourceIcon`)과 cross-AZ / 높은 재전송(high-retransmit) 배지(색상은 헬스 전용으로 예약하고 추가 신호는 모양/아이콘/배지로 표현), 결정론적 레이아웃(id 해시 시드 + `fx`/`fy` 고정) + localStorage 위치 영속화(워킹셋 초과분 제거) + 실시간 MiniMap — 헬퍼는 `app/src/lib/graph-focus.ts`(neighbors/ego), `app/src/lib/graph-layout.ts`(결정론적 시드 + `graphSignature`), 그룹핑/`crossAz`/`minEdgeValue` 임계값은 `app/src/lib/topology-graph.ts`(헬스는 `app/src/lib/analytics/edge-health.ts`). 공유 **정렬 가능 테이블/리스트(sortable-table/list)** 프리미티브(`app/src/lib/use-sortable.ts`의 `useSortableRows` + `compareBy` — 문자열/숫자/불리언 타입 인지, null 후순위, 포맷된 텍스트가 아닌 원시 값 정렬 — 와 `aria-sort`용 `SortableHeader.tsx`)로 7개 원시 `<table>` 전부를 정렬 가능하게 함(FlowTable, LatencyTab tail, ReliabilityTab breaches, network pairs, workload contributors, agents coverage, 그리고 `app/src/app/history/history-sort.ts` 숫자/문자열 컬럼 스니핑을 통한 동적 Athena 히스토리 테이블). 공유 `Toplist`(`app/src/components/analytics/Toplist.tsx`)의 `sortable` prop 옵트인으로 동일한 동작을 ~18개 순위 리스트(cost / DNS / hotspots / pareto / scorecard / movers / slowest / efficiency / …)까지 확장하며, 컴팩트 티저는 고정 top-N을 유지. Insights·DNS에 **resolver 비교 패널**(CoreDNS vs Route53 Resolver 지연/실패율; Resolver 쿼리 로그에는 쿼리별 지연이 없으므로 샘플이 없으면 지연을 0 ms가 아닌 "데이터 없음"으로 표시), `/alerts`에 다중 신호 위반을 나열하는 **복합 조건** 섹션 추가(CloudWatch 알람이 아닌 대시보드 하이라이트).
- **관측성(Observability)** — `NfmDash-Ops` CloudWatch 알람(collector 오류, ALB no-healthy-hosts, ALB 5xx) → SNS `nfm-dashboard-alarms`; 수집 상태는 `/agents`에 표시.
- **보안(Security)** — Cognito 사용자 풀 + Hosted UI(Authorization Code + PKCE), Next.js 미들웨어의 JWT 검증, `X-Origin-Verify` 헤더(CloudFront 경유만 ALB 접근), AgentCore MCP 게이트웨이에 대한 SigV4/AWS_IAM, Secrets Manager의 비밀. Cognito 세션 게이트는 `authDisabled` CDK 컨텍스트 → 태스크 env `AUTH_DISABLED=1`로 임시 비활성화할 수 있습니다(`x-origin-verify` 경계는 항상 유지; 현재는 OFF — 로그인 강제 중). ADR-005 참고.

## 아키텍처 다이어그램

```text
        ┌──────────────────────────────────────────────────────────────┐
        │  NFM sources: MonitorTopContributors · WorkloadInsights (×11) │
        │  CloudWatch AWS/NetworkFlowMonitor metrics · Route53/CoreDNS  │
        └───────────────────────────────┬──────────────────────────────┘
                                         │ StartQuery→poll→GetResults (conc 5)
                                         ▼
   EventBridge Scheduler (5 min) ──▶ ┌───────────────────┐
                                     │ Collector Lambda  │  normalize (edgeHash),
                                     │ (Node, arm64)     │  topology snapshot
                                     └─────────┬─────────┘
                                               ▼
                                 ┌───────────────────────────┐  hot store
                                 │ DynamoDB (single-table)   │──┐ Stream (NEW_IMAGE)
                                 │  nfm-dashboard-flows (TTL)│  │
                                 │  nfm-dashboard-meta       │  ▼
                                 └─────────────┬─────────────┘  ┌──────────────────────┐
                                               │                │ archive-transform λ  │
                                               │                └───────────┬──────────┘
                                               │                            ▼
                                               │                ┌──────────────────────┐
                                               │                │ Kinesis Firehose     │ Parquet,
                                               │                │  nfm…-flow-archive   │ dt-partition
                                               │                └───────────┬──────────┘
                                               │                            ▼
                                               │                ┌──────────────────────┐
                                               │                │ S3 flows/dt=…/*.pq   │ cold archive
                                               │                └───────────┬──────────┘
                                               │                            ▼
                                               │              Glue nfm_dashboard.flows_archive
                                               │                            │ (partition projection)
                                               │ key-based reads            ▼
                                               │                  Athena wg 'nfm-dashboard'
   User (desktop/iPhone)                       ▼                            │ /api/history
        │ HTTPS          ┌───────────────────────────────────────┐         │
        ▼                │ Next.js API routes (+ analytics lenses)│◀────────┘
   CloudFront ──▶ ALB ──▶│ ECS Fargate (arm64, private subnets)   │
    (X-Origin-Verify)    │ Next.js 16 UI (sidebar) + FloatingChat │
        ▲                └───────────┬───────────────┬───────────┘
        │ Cognito Hosted UI          │               │ /api/ai, /api/diagnose (SSE)
        │ (JWT / PKCE)               │               ▼
        └────────────────────────────┘      ┌────────────────────────┐
                                             │ Bedrock ConverseStream │
                                             │  + AgentCore Gateway   │
                                             │  (MCP, SigV4, 27 tools)│
                                             └────────────────────────┘
```

## 데이터 흐름 요약

NFM/CW/DNS 소스 ▶ Collector Lambda(5분) ▶ DynamoDB 단일 테이블(핫) ▶ Next.js API + 앱 내부 분석 ▶ 대시보드 UI / AI 챗봇(Bedrock + AgentCore 게이트웨이).

아카이브 분기(콜드): DynamoDB Stream(NEW_IMAGE) ▶ archive-transform Lambda ▶ Kinesis Firehose(Parquet, dt 파티션) ▶ S3 아카이브 ▶ Glue `nfm_dashboard.flows_archive` ▶ Athena 워크그룹 `nfm-dashboard` ▶ `/api/history` ▶ History 페이지.

## 인프라

| 스택 | 목적 | 주요 리소스 |
|-------|---------|---------------|
| `NfmDash-Data` | 저장 + 수집 + 아카이브 | DynamoDB `nfm-dashboard-flows` / `nfm-dashboard-meta`(TTL, `flows` Stream `NEW_IMAGE`), Collector Lambda, EventBridge Scheduler(5분); 플로우 아카이브 파이프라인: `archive-transform` Lambda, Kinesis Firehose `nfm-dashboard-flow-archive`(Parquet), S3 `nfm-dashboard-flow-archive-<ACCOUNT_ID>`, Glue `nfm_dashboard.flows_archive`, Athena 워크그룹 `nfm-dashboard`(결과 `nfm-dashboard-athena-results-<ACCOUNT_ID>`) |
| `NfmDash-Onboarding` | 계정 전역 NFM 롤아웃 | NFM Scope + 모니터 5개, EKS 애드온 `aws-network-flow-monitoring-agent` ×4(Pod Identity), EC2용 SSM Distributor + State Manager Association |
| `NfmDash-AgentCore` | AI 도구 백엔드 | MCP 도구 Lambda 3개(network/nfm/ddb), AgentCore Gateway `nfm-gateway`(AWS_IAM/SigV4, 약 27개 도구; `setup-gateway.sh`가 별도 생성) |
| `NfmDash-App` | 웹 애플리케이션 | ECS Fargate(arm64), CloudFront, ALB, Cognito 사용자 풀, ECR(불변 태그); History 페이지용으로 태스크 역할에 Athena/Glue/S3(`s3:GetBucketLocation` 포함) 권한 + 환경변수 `ATHENA_WORKGROUP` / `GLUE_DB` / `GLUE_TABLE` 부여 |
| `NfmDash-Ops` | 알람 | CloudWatch 알람 3종 + SNS `nfm-dashboard-alarms` |
| `NfmDash-Dns` | DNS 가시성 | Route53 Resolver 쿼리 로깅 + CoreDNS log 플러그인(가역적) |

## 주요 설계 결정

- **DDB-핫 + Athena-콜드 2계층 스토리지** — DynamoDB는 *핫* 운영 스토어입니다: 5분마다의 버스티 쓰기, 키 기반 최근 윈도우 읽기, 한 자릿수 ms 지연, 7일 TTL, 완전 서버리스. S3 + Parquet + Athena 아카이브는 *콜드* 장기 분석 계층입니다: DynamoDB Stream(`NEW_IMAGE`)이 TTL 삭제 전에 모든 플로우 레코드를 변환 Lambda를 통해 Firehose(Parquet, `dt` 파티션)로 팬아웃하므로, 수주·수개월에 걸친 애드혹 히스토리를 핫 경로에 부담을 주지 않고 Athena(`/api/history`)로 쿼리할 수 있습니다. 계층을 분리하면 각각 자신의 접근 패턴과 비용 프로파일에 최적화된 상태를 유지합니다.
- **앱 내부 분석 렌즈(DB 집계 아님)** — 렌즈는 최근 플로우 윈도우에 대한 순수 함수이므로 DB는 단순 키-값 스토어로 유지되고, 한 자릿수 ms 읽기가 UI 반응성을 보장합니다. 시계열 차트는 CloudWatch 지표를 직접 읽습니다.
- **ECS에서 SigV4 게이트웨이 호출(AgentCore Runtime 아님)** — Next.js `/api/ai`가 AgentCore MCP 게이트웨이를 SigV4로 직접 호출하여 런타임 홉을 줄이면서 IAM 범위 접근을 유지합니다.
- **5분 수집 주기** — NFM 집계 그리드에 맞추고, 쿼리 볼륨(동시성 ≤ 5)과 비용을 제한하면서 대시보드를 준실시간으로 유지합니다.
- **NFM 11범주 Workload Insights** — 라이브 NFM API는 11개 `destinationCategory` 값(INTERNET, AWS_SERVICE, TRANSIT_GATEWAY, LOCAL_ZONE 포함)을 받으며, 수집기가 매 주기 11종을 모두 쿼리하여 `/workload`가 전체 흐름 분류를 반영합니다.
- **커밋별 불변 ECR 이미지 태그** — 각 커밋이 새 태그이며, 배포가 SHA를 고정하므로 태스크 재시작이 이미지를 바꾸지 않고 롤백은 이전 태그 재배포로 처리됩니다.
- **1.0 이전(0.x) 버전 체계** — 프로젝트가 아직 정식 릴리스 이전임을 나타내기 위해 버전을 1.x에서 0.x로 다시 매겼습니다. `APP_VERSION`(`app/src/lib/version.ts`)과 `app/package.json`은 모두 `0.10.0`입니다.
- **임시 인증 비활성화 토글(가역적, env 전용)** — Cognito 세션 게이트는 코드 경로에서 제거하는 대신 `authDisabled` CDK 컨텍스트 / `AUTH_DISABLED=1` 태스크 env로 건너뛸 수 있으며, 토글 여부와 무관하게 `x-origin-verify` 경계는 항상 유지됩니다. `docs/decisions/ADR-005-temporary-auth-disable-toggle.md` 참고.

## 운영

운영 절차(배포, 재배포, 장애 대응, 알람 구독)는 `docs/runbooks/`를 참고합니다. 라이브 좌표·알람·수집 주기는 `README.md`(운영 섹션)에 문서화되어 있으며 `/agents` 페이지에 표시됩니다.
