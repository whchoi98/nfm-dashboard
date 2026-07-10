# Architecture

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## System Overview

NFM Dashboard is an AWS-native, serverless network-observability system built on CloudWatch Network Flow Monitor (NFM). A collector Lambda runs every 5 minutes to pull NFM top-contributor flows, Workload Insights (11 flow categories), CloudWatch metrics, and DNS logs into a DynamoDB single-table store; a Next.js application (ECS Fargate behind CloudFront + ALB, Cognito-gated) reads that store, computes analytics in-app, and renders the dashboard plus a Bedrock AgentCore AI chatbot. All infrastructure is defined as six AWS CDK stacks.

## Components by Layer

- **Ingestion** — `collector` Lambda (`nfm-dashboard-collector`, every 5 min via EventBridge Scheduler): async NFM `MonitorTopContributors` (flows) + `WorkloadInsightsTopContributors` (11 categories) queries, `AWS/NetworkFlowMonitor` CloudWatch metrics, and Route53 Resolver / CoreDNS logs via CloudWatch Logs Insights. Concurrency 5 + exponential backoff; partial failures tolerated.
- **Storage** — DynamoDB single-table design: `nfm-dashboard-flows` (flow records, 7-day TTL, GSI for pod/edge time series) and `nfm-dashboard-meta` (topology snapshots, collection status/history, coverage, `WI#latest`, `DNS#latest`). Key-based access only.
- **Processing** — In-app analytics lenses (`app/src/lib/analytics/*`): cost, reliability, latency, dependencies, dns — pure functions over recent flow windows. No DB-side aggregation.
- **Query** — Next.js route handlers (`app/src/app/api/*`): overview, flows, topology, paths, insights, analytics/{cost,reliability,latency,dependencies,dns}, monitors, workload, agents, ai, diagnose, health, auth.
- **Presentation** — Next.js 16 App-Router dashboard (topology graph, insights hub, per-monitor, workload, overview/flows/paths/agents) + AI chatbot (floating drawer + `/chat-popup`), ko/en i18n, SnowUI tokens, light/dark, mobile responsive.
- **Observability** — `NfmDash-Ops` CloudWatch alarms (collector errors, ALB no-healthy-hosts, ALB 5xx) → SNS `nfm-dashboard-alarms`; collection status surfaced on `/agents`.
- **Security** — Cognito user pool + Hosted UI (Authorization Code + PKCE), JWT verification in Next.js middleware, `X-Origin-Verify` header (CloudFront-only ALB access), SigV4/AWS_IAM to the AgentCore MCP gateway, secrets in Secrets Manager.

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
                                 ┌───────────────────────────┐
                                 │ DynamoDB (single-table)   │
                                 │  nfm-dashboard-flows (TTL)│
                                 │  nfm-dashboard-meta       │
                                 └─────────────┬─────────────┘
                                               │ key-based reads
   User (desktop/iPhone)                       ▼
        │ HTTPS          ┌──────────────────────────────────────┐
        ▼                │ Next.js API routes (+ analytics lenses)│
   CloudFront ──▶ ALB ──▶│ ECS Fargate (arm64, private subnets)  │
    (X-Origin-Verify)    │ Next.js 16 UI + FloatingChat          │
        ▲                └───────────┬───────────────┬──────────┘
        │ Cognito Hosted UI          │               │ /api/ai, /api/diagnose (SSE)
        │ (JWT / PKCE)               │               ▼
        └────────────────────────────┘      ┌────────────────────────┐
                                             │ Bedrock ConverseStream │
                                             │  + AgentCore Gateway   │
                                             │  (MCP, SigV4, 27 tools)│
                                             └────────────────────────┘
```

## Data Flow Summary

NFM/CW/DNS sources ▶ Collector Lambda (5 min) ▶ DynamoDB single-table ▶ Next.js API + in-app analytics ▶ dashboard UI / AI chatbot (Bedrock + AgentCore gateway).

## Infrastructure

| Stack | Purpose | Key resources |
|-------|---------|---------------|
| `NfmDash-Data` | Storage + ingestion | DynamoDB `nfm-dashboard-flows` / `nfm-dashboard-meta` (TTL), Collector Lambda, EventBridge Scheduler (5 min) |
| `NfmDash-Onboarding` | Account-wide NFM rollout | NFM Scope + 5 monitors, EKS add-on `aws-network-flow-monitoring-agent` ×4 (Pod Identity), SSM Distributor + State Manager Association for EC2 |
| `NfmDash-AgentCore` | AI tool backend | 3 MCP tool Lambdas (network/nfm/ddb), AgentCore Gateway `nfm-gateway` (AWS_IAM/SigV4, ~27 tools; created out-of-band by `setup-gateway.sh`) |
| `NfmDash-App` | Web application | ECS Fargate (arm64), CloudFront, ALB, Cognito user pool, ECR (immutable tags) |
| `NfmDash-Ops` | Alarms | 3 CloudWatch alarms + SNS `nfm-dashboard-alarms` |
| `NfmDash-Dns` | DNS visibility | Route53 Resolver query logging + CoreDNS log plugin (reversible) |

## Key Design Decisions

- **DynamoDB single-table for operational data** — Access is entirely key-based (latest snapshots, recent flow-bucket ranges, per-pod/per-edge series). Serverless, on-demand, TTL-bounded. Long-term historical analytics (weeks/months, ad-hoc) are intentionally out of scope; add Amazon Timestream or S3+Athena beside DynamoDB if that need arises.
- **In-app analytics lenses (not DB aggregation)** — The lenses are pure functions over recent flow windows, so the DB stays a simple key-value store and single-digit-ms reads keep the UI responsive. Time-series charts read CloudWatch metrics directly.
- **SigV4 gateway call from ECS (not AgentCore Runtime)** — The Next.js `/api/ai` route calls the AgentCore MCP gateway directly with SigV4, avoiding an extra runtime hop while keeping IAM-scoped access.
- **5-minute collection cadence** — Matches NFM's aggregation grid; bounds query volume (≤ concurrency 5) and cost while keeping the dashboard near-real-time.
- **NFM 11-category Workload Insights** — The live NFM API accepts 11 `destinationCategory` values (incl. INTERNET, AWS_SERVICE, TRANSIT_GATEWAY, LOCAL_ZONE); the collector queries all 11 each cycle so `/workload` reflects the full flow taxonomy.
- **Immutable per-commit ECR image tags** — Each commit is a new tag; deploys pin the SHA, so task restarts never swap the image and rollback is a redeploy of the prior tag.

## Operations

See `docs/runbooks/` for operational procedures (deploy, redeploy, incident response, alarm subscription). Live coordinates, alarms, and the collection cycle are documented in `README.md` (Operations section) and surfaced on the `/agents` page.

---

<a id="korean"></a>

# 한국어

## 시스템 개요

NFM Dashboard는 CloudWatch Network Flow Monitor(NFM) 기반의 AWS 네이티브 서버리스 네트워크 관측 시스템입니다. Collector Lambda가 5분마다 NFM 상위 기여자 플로우, Workload Insights(흐름 범주 11종), CloudWatch 지표, DNS 로그를 DynamoDB 단일 테이블 스토어로 수집합니다. Next.js 애플리케이션(CloudFront + ALB 뒤의 ECS Fargate, Cognito 게이트)이 이 스토어를 읽어 앱 내부에서 분석을 계산하고, 대시보드와 Bedrock AgentCore AI 챗봇을 렌더링합니다. 모든 인프라는 6개 AWS CDK 스택으로 정의됩니다.

## 계층별 구성 요소

- **수집(Ingestion)** — `collector` Lambda(`nfm-dashboard-collector`, EventBridge Scheduler로 5분마다): 비동기 NFM `MonitorTopContributors`(플로우) + `WorkloadInsightsTopContributors`(범주 11종) 쿼리, `AWS/NetworkFlowMonitor` CloudWatch 지표, CloudWatch Logs Insights를 통한 Route53 Resolver / CoreDNS 로그. 동시성 5 + 지수 백오프, 부분 실패 허용.
- **저장(Storage)** — DynamoDB 단일 테이블 설계: `nfm-dashboard-flows`(플로우 레코드, 7일 TTL, pod/edge 시계열 GSI)와 `nfm-dashboard-meta`(토폴로지 스냅샷, 수집 상태/이력, 커버리지, `WI#latest`, `DNS#latest`). 키 기반 접근만 사용.
- **처리(Processing)** — 앱 내부 분석 렌즈(`app/src/lib/analytics/*`): 비용, 신뢰성, 지연, 의존성, DNS — 최근 플로우 윈도우에 대한 순수 함수. DB 측 집계 없음.
- **쿼리(Query)** — Next.js 라우트 핸들러(`app/src/app/api/*`): overview, flows, topology, paths, insights, analytics/{cost,reliability,latency,dependencies,dns}, monitors, workload, agents, ai, diagnose, health, auth.
- **표현(Presentation)** — Next.js 16 App-Router 대시보드(토폴로지 그래프, 인사이트 허브, per-monitor, workload, overview/flows/paths/agents) + AI 챗봇(플로팅 드로어 + `/chat-popup`), ko/en i18n, SnowUI 토큰, 라이트/다크, 모바일 반응형.
- **관측성(Observability)** — `NfmDash-Ops` CloudWatch 알람(collector 오류, ALB no-healthy-hosts, ALB 5xx) → SNS `nfm-dashboard-alarms`; 수집 상태는 `/agents`에 표시.
- **보안(Security)** — Cognito 사용자 풀 + Hosted UI(Authorization Code + PKCE), Next.js 미들웨어의 JWT 검증, `X-Origin-Verify` 헤더(CloudFront 경유만 ALB 접근), AgentCore MCP 게이트웨이에 대한 SigV4/AWS_IAM, Secrets Manager의 비밀.

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
                                 ┌───────────────────────────┐
                                 │ DynamoDB (single-table)   │
                                 │  nfm-dashboard-flows (TTL)│
                                 │  nfm-dashboard-meta       │
                                 └─────────────┬─────────────┘
                                               │ key-based reads
   User (desktop/iPhone)                       ▼
        │ HTTPS          ┌──────────────────────────────────────┐
        ▼                │ Next.js API routes (+ analytics lenses)│
   CloudFront ──▶ ALB ──▶│ ECS Fargate (arm64, private subnets)  │
    (X-Origin-Verify)    │ Next.js 16 UI + FloatingChat          │
        ▲                └───────────┬───────────────┬──────────┘
        │ Cognito Hosted UI          │               │ /api/ai, /api/diagnose (SSE)
        │ (JWT / PKCE)               │               ▼
        └────────────────────────────┘      ┌────────────────────────┐
                                             │ Bedrock ConverseStream │
                                             │  + AgentCore Gateway   │
                                             │  (MCP, SigV4, 27 tools)│
                                             └────────────────────────┘
```

## 데이터 흐름 요약

NFM/CW/DNS 소스 ▶ Collector Lambda(5분) ▶ DynamoDB 단일 테이블 ▶ Next.js API + 앱 내부 분석 ▶ 대시보드 UI / AI 챗봇(Bedrock + AgentCore 게이트웨이).

## 인프라

| 스택 | 목적 | 주요 리소스 |
|-------|---------|---------------|
| `NfmDash-Data` | 저장 + 수집 | DynamoDB `nfm-dashboard-flows` / `nfm-dashboard-meta`(TTL), Collector Lambda, EventBridge Scheduler(5분) |
| `NfmDash-Onboarding` | 계정 전역 NFM 롤아웃 | NFM Scope + 모니터 5개, EKS 애드온 `aws-network-flow-monitoring-agent` ×4(Pod Identity), EC2용 SSM Distributor + State Manager Association |
| `NfmDash-AgentCore` | AI 도구 백엔드 | MCP 도구 Lambda 3개(network/nfm/ddb), AgentCore Gateway `nfm-gateway`(AWS_IAM/SigV4, 약 27개 도구; `setup-gateway.sh`가 별도 생성) |
| `NfmDash-App` | 웹 애플리케이션 | ECS Fargate(arm64), CloudFront, ALB, Cognito 사용자 풀, ECR(불변 태그) |
| `NfmDash-Ops` | 알람 | CloudWatch 알람 3종 + SNS `nfm-dashboard-alarms` |
| `NfmDash-Dns` | DNS 가시성 | Route53 Resolver 쿼리 로깅 + CoreDNS log 플러그인(가역적) |

## 주요 설계 결정

- **운영 데이터에 DynamoDB 단일 테이블** — 접근이 전적으로 키 기반(최신 스냅샷, 최근 플로우 버킷 범위, per-pod/per-edge 시계열)입니다. 서버리스·온디맨드·TTL로 경계가 잡힙니다. 장기 히스토리 분석(수주·수개월, 애드혹)은 의도적으로 범위 밖이며, 필요 시 DynamoDB 옆에 Amazon Timestream 또는 S3+Athena를 추가합니다.
- **앱 내부 분석 렌즈(DB 집계 아님)** — 렌즈는 최근 플로우 윈도우에 대한 순수 함수이므로 DB는 단순 키-값 스토어로 유지되고, 한 자릿수 ms 읽기가 UI 반응성을 보장합니다. 시계열 차트는 CloudWatch 지표를 직접 읽습니다.
- **ECS에서 SigV4 게이트웨이 호출(AgentCore Runtime 아님)** — Next.js `/api/ai`가 AgentCore MCP 게이트웨이를 SigV4로 직접 호출하여 런타임 홉을 줄이면서 IAM 범위 접근을 유지합니다.
- **5분 수집 주기** — NFM 집계 그리드에 맞추고, 쿼리 볼륨(동시성 ≤ 5)과 비용을 제한하면서 대시보드를 준실시간으로 유지합니다.
- **NFM 11범주 Workload Insights** — 라이브 NFM API는 11개 `destinationCategory` 값(INTERNET, AWS_SERVICE, TRANSIT_GATEWAY, LOCAL_ZONE 포함)을 받으며, 수집기가 매 주기 11종을 모두 쿼리하여 `/workload`가 전체 흐름 분류를 반영합니다.
- **커밋별 불변 ECR 이미지 태그** — 각 커밋이 새 태그이며, 배포가 SHA를 고정하므로 태스크 재시작이 이미지를 바꾸지 않고 롤백은 이전 태그 재배포로 처리됩니다.

## 운영

운영 절차(배포, 재배포, 장애 대응, 알람 구독)는 `docs/runbooks/`를 참고합니다. 라이브 좌표·알람·수집 주기는 `README.md`(운영 섹션)에 문서화되어 있으며 `/agents` 페이지에 표시됩니다.
