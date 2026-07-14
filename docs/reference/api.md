# API / API 구성 상세

[![English](https://img.shields.io/badge/Language-English-blue)](#english)
[![한국어](https://img.shields.io/badge/Language-한국어-red)](#korean)

<a id="english"></a>
## English

### 1. Overview
The API layer is a set of Next.js App Router route handlers under `app/src/app/api/` — 31 `route.ts` files serving dashboard data, analytics, auth, health, the SSE AI chat, and the Athena-backed flow archive query. All routes except `/api/health` and `/api/auth/*` are gated by `app/src/middleware.ts`.

### 2. Components
| Component | Path | Purpose |
|---|---|---|
| AI chat (SSE) | `app/src/app/api/ai/route.ts` | Bedrock Converse streaming + MCP tool loop; SSE events, `maxDuration = 300` |
| Auth flow | `app/src/app/api/auth/{login,callback,logout}/route.ts` | Cognito Hosted UI + PKCE session flow |
| Flow data | `app/src/app/api/{flows,topology,paths,workload,overview}/route.ts` | DynamoDB-backed dashboard data via `app/src/lib/ddb.ts` |
| Analytics | `app/src/app/api/analytics/{latency,reliability,cost,dns,dependencies,efficiency,scorecard,movers}/route.ts` | Aggregations via `app/src/lib/analytics/*`; the `dns` route also returns per-source stats (`bySource`: CoreDNS vs Route53 Resolver) for the resolver-compare panel (G3) |
| Monitors | `app/src/app/api/monitors/route.ts`, `app/src/app/api/monitors/[name]/route.ts` | NFM monitor list/detail (CloudWatch) |
| Ops & diagnostics | `app/src/app/api/{health,insights,diagnose,agents}/route.ts`, `app/src/app/api/nfm/refresh/route.ts` | Healthcheck, workload insights, diagnose context, agent/coverage status, manual refresh |
| New menus (Phase 8) | `app/src/app/api/{alerts,search,anomalies,cost-explorer,reports,network}/route.ts` | Alerts (CloudWatch alarms + derived event feed + G5 composite-condition view via `app/src/lib/analytics/composite-conditions.ts`), unified entity search, baseline anomaly detection, cost explorer, report data, network (source→dest matrix gains a `port` dest-scope — G1 port/service traffic mix) |
| Flow history (Phase 13) | `app/src/app/api/history/route.ts` | Athena query over the S3/Parquet flow archive (`nfm_dashboard.flows_archive`) via `app/src/lib/athena.ts`; `?from=&to=&monitor=&namespace=&metric=&limit=`, defaults to the last 7 days, injection-safe SQL builder (`buildHistorySql`) |

### 3. Key Decisions
<!-- TODO: list 3-5 decisions or link to docs/decisions/ADR-*.md -->

### 4. Code Pointers
<!-- TODO: 3-7 entries; paths must be valid (checked by /sync-docs) -->
- `app/src/app/api/ai/route.ts` — SSE stream with 15s keepalive `status` events; language pick order: body `lang` → `Accept-Language` → `'ko'`
- `app/src/lib/sse.ts` — `sseEvent()` helper used by streaming routes
- `app/src/middleware.ts` — public paths (`/login`, `/api/health`, `/api/auth/*`) and origin-verify enforcement for everything else

### 5. Cross-references
<!-- TODO -->
- Related modules: `app/src/app/api/CLAUDE.md`, `app/src/lib/CLAUDE.md`
- Related ADRs:
- Related runbooks:

<a id="korean"></a>
## 한국어

### 1. 개요
API 계층은 `app/src/app/api/` 아래 Next.js App Router route handler 모음이다 — 31개의 `route.ts`가 대시보드 데이터, 분석, 인증, 헬스체크, SSE AI 채팅, Athena 기반 flow 아카이브 조회를 제공한다. `/api/health`와 `/api/auth/*`를 제외한 모든 라우트는 `app/src/middleware.ts`가 보호한다.

### 2. 구성요소
| 구성요소 | 경로 | 목적 |
|---|---|---|
| AI 채팅(SSE) | `app/src/app/api/ai/route.ts` | Bedrock Converse 스트리밍 + MCP 툴 루프; SSE 이벤트, `maxDuration = 300` |
| 인증 플로우 | `app/src/app/api/auth/{login,callback,logout}/route.ts` | Cognito Hosted UI + PKCE 세션 플로우 |
| Flow 데이터 | `app/src/app/api/{flows,topology,paths,workload,overview}/route.ts` | `app/src/lib/ddb.ts` 기반 DynamoDB 대시보드 데이터 |
| 분석 | `app/src/app/api/analytics/{latency,reliability,cost,dns,dependencies,efficiency,scorecard,movers}/route.ts` | `app/src/lib/analytics/*` 기반 집계; `dns` 라우트는 resolver 비교 패널(G3)을 위해 소스별 통계(`bySource`: CoreDNS vs Route53 Resolver)도 반환 |
| 모니터 | `app/src/app/api/monitors/route.ts`, `app/src/app/api/monitors/[name]/route.ts` | NFM 모니터 목록/상세(CloudWatch) |
| 운영·진단 | `app/src/app/api/{health,insights,diagnose,agents}/route.ts`, `app/src/app/api/nfm/refresh/route.ts` | 헬스체크, workload insights, 진단 컨텍스트, 에이전트/커버리지 상태, 수동 갱신 |
| 신규 메뉴 (Phase 8) | `app/src/app/api/{alerts,search,anomalies,cost-explorer,reports,network}/route.ts` | 알림(CloudWatch 알람 + 파생 이벤트 피드 + `app/src/lib/analytics/composite-conditions.ts` 기반 G5 복합 조건 뷰), 통합 엔티티 검색, baseline 이상 탐지, 비용 탐색, 리포트 데이터, network(source→dest 매트릭스에 `port` 목적지 스코프 추가 — G1 포트/서비스 트래픽 믹스) |
| Flow 히스토리 (Phase 13) | `app/src/app/api/history/route.ts` | `app/src/lib/athena.ts`를 통해 S3/Parquet flow 아카이브(`nfm_dashboard.flows_archive`)를 Athena로 조회; `?from=&to=&monitor=&namespace=&metric=&limit=`, 기본값은 최근 7일, SQL 인젝션 방어 빌더(`buildHistorySql`) |

### 3. 주요 결정
<!-- TODO: 3-5개 결정 나열 또는 docs/decisions/ADR-*.md 링크 -->

### 4. 코드 포인터
<!-- TODO: 3-7개 항목; 경로는 실재해야 함 (/sync-docs가 점검) -->
- `app/src/app/api/ai/route.ts` — 15초 keepalive `status` 이벤트를 포함한 SSE 스트림; 언어 결정 순서: body `lang` → `Accept-Language` → `'ko'`
- `app/src/lib/sse.ts` — 스트리밍 라우트가 쓰는 `sseEvent()` 헬퍼
- `app/src/middleware.ts` — 공개 경로(`/login`, `/api/health`, `/api/auth/*`)와 그 외 전 경로의 origin-verify 강제

### 5. 상호 참조
<!-- TODO -->
- 관련 모듈: `app/src/app/api/CLAUDE.md`, `app/src/lib/CLAUDE.md`
- 관련 ADR:
- 관련 런북:
