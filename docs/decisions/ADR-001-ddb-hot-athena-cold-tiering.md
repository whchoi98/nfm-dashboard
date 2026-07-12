# ADR-001: DynamoDB Hot Store + S3/Athena Cold Archive Tiering

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Status
Accepted — 2026-07-12

## Context
The NFM Dashboard collector runs every 5 minutes, writing NFM top-contributor
flow rows, monitor health, and DNS samples. The write pattern is **bursty**
(hundreds of rows per cycle, then idle) and the dominant read pattern is
**key-based recent-window lookups** — the dashboard almost always asks for
"the last N buckets for monitor X", where a bucket is a 5-minute slot whose key
formula must stay identical between `collector` and `app/src/lib/ddb.ts`.

Two forces pull in opposite directions:

- **Operational (hot) path** — the dashboard and its APIs need low-latency,
  key-addressable reads over a short recent window (≤ 7 days), with writes that
  scale to zero when the collector is idle and cost nothing at rest. Flow rows
  carry a 7-day `ttl` so the hot table stays small and cheap.
- **Analytics (cold) path** — Phase 13 added the History page and
  `/api/history`, which must answer arbitrary-date-range / **> 7-day** queries.
  Those rows no longer exist in DynamoDB: the 7-day TTL has deleted them. We
  need a durable, long-term, query-on-demand copy without inflating the hot
  store or its cost.

A single store cannot serve both well: keeping everything hot in DynamoDB for
long-range analytics means unbounded table growth, expensive scans (no natural
key for "all flows between two arbitrary dates"), and rising at-rest cost, while
a scan-oriented analytics engine would be a poor fit for the 5-minute
key-lookup hot path. This ADR records the deliberate choice to **split the two
tiers** rather than migrate to a single relational database.

## Options Considered

### Option 1: DynamoDB hot + S3(Parquet)/Glue/Athena cold (chosen)
Keep DynamoDB as the hot operational store (bursty writes, key-based
recent-window reads, 7-day TTL, serverless/Lambda-native, near-zero idle cost).
Add a cold analytics tier: a DynamoDB Stream (`NEW_IMAGE`) on
`nfm-dashboard-flows` → transform Lambda → Kinesis Firehose (Parquet conversion
via a Glue schema, dynamic partitioning by `dt`) → S3 archive bucket, catalogued
in Glue (`nfm_dashboard.flows_archive`, partition projection on `dt`) and
queried through an Athena workgroup by `/api/history` + the History page.
- **Pros**: Each tier matches its access pattern; the hot table stays small and
  cheap (TTL bounds it); the archive is durable beyond TTL and cheap at rest
  (S3 + columnar Parquet, scan cost bounded by an Athena per-query cutoff);
  fully serverless — no cluster to size, patch, or pay for while idle; the
  archive pipeline is additive and did not disturb the hot read/write paths.
- **Cons**: Two data systems and a streaming pipeline to operate; cold queries
  are higher-latency (on-demand Athena, seconds not milliseconds); schema is
  duplicated (the Glue columns MUST match the transform Lambda's `FlatFlowRow`
  or Firehose silently routes records to `errors/`); eventual-consistency lag
  between a flow write and its archived copy.

### Option 2: Aurora PostgreSQL / MySQL (single relational store)
Move both hot and cold workloads into one managed relational database.
- **Pros**: One store and one query language (SQL) for both recent and
  historical ranges; familiar relational modeling, joins, and indexing;
  arbitrary-date-range queries are trivial.
- **Cons**: Not serverless in the same sense — even Aurora Serverless v2 keeps a
  minimum ACU billed continuously, so idle cost is real and constant, which is
  the opposite of the collector's bursty-then-idle profile; requires VPC
  wiring, connection pooling/management from Lambda, and ongoing
  patch/version/capacity operations; long-term retention means unbounded table
  growth and storage cost with no natural TTL-to-archive tiering; heavier
  operational surface than the current all-serverless design.

### Option 3: Amazon Timestream
Use a purpose-built time-series database for the flow metrics.
- **Pros**: Native time-series semantics with built-in hot→cold memory/magnetic
  tiering and retention; SQL query surface.
- **Cons**: Another service to model and operate; the data is not purely
  metric time-series — flow rows carry rich dimensional context (pod/service/
  subnet/AZ/VPC endpoints, NAT IPs, traversed constructs) better served by the
  key-addressable hot table and columnar Parquet archive; ingestion would still
  need a transform layer; less flexible than Athena/Parquet for the arbitrary
  ad-hoc archive queries the History page targets; weaker fit with the existing
  DynamoDB single-table hot model already tuned to the dashboard's access
  patterns.

## Decision
Adopt **Option 1**: keep DynamoDB as the hot operational tier and add an
S3(Parquet) + Glue + Athena cold analytics tier, fed asynchronously from the
DynamoDB Stream. `/api/history` and the History page query the cold tier for
`> 7-day` / arbitrary-date-range requests; everything within the 7-day hot
window continues to be served directly from DynamoDB. We explicitly reject
consolidating onto Aurora PostgreSQL/MySQL (Option 2) or Timestream (Option 3):
neither preserves the serverless, scale-to-zero, near-zero-idle-cost property
that fits the collector's bursty write / key-lookup read profile, and the
tiered design lets each half be sized and priced for its own access pattern.

## Consequences

### Positive
- Hot table stays small, fast, and cheap: 7-day TTL bounds its size; PPR
  (pay-per-request) billing means near-zero cost while the collector is idle.
- Long-term history survives TTL deletion in a durable, cheap S3 archive;
  columnar Parquet + partition projection on `dt` keeps Athena scans (and their
  cost) bounded, reinforced by the workgroup's per-query scan cutoff.
- Fully serverless end to end — no database cluster to size, patch, fail over,
  or pay for at idle.
- The archive pipeline is additive: it reads the stream and does not touch the
  dashboard's hot read/write paths.

### Negative
- Two storage systems plus a streaming pipeline (Stream → Lambda → Firehose →
  S3 + Glue + Athena) to understand, monitor, and operate.
- Schema is maintained in two places: the Glue table columns MUST stay in sync
  with the transform Lambda's `FlatFlowRow`, or Firehose silently drops records
  into the `errors/` prefix.
- Cold-tier queries are higher-latency and asynchronous — there is
  eventual-consistency lag between a flow write and its archived, queryable copy
  (Firehose buffering + Parquet conversion), and archiving only begins from the
  stream's `TRIM_HORIZON` at pipeline creation (no backfill of rows written
  before the archive existed).

## References
- `infra/lib/data-stack.ts` — flows table (`NEW_IMAGE` stream, 7-day `ttl`) +
  archive pipeline (transform Lambda → Firehose → S3 + Glue + Athena)
- `infra/lib/app-stack.ts` — app task-role Athena/Glue/S3 IAM + `ATHENA_WORKGROUP`
  / `GLUE_DB` / `GLUE_TABLE` env
- `app/src/lib/ddb.ts` — hot-path 5-minute bucket read (formula must match the collector)
- `app/src/lib/athena.ts` — `buildHistorySql` (injection-guarded) + `runHistoryQuery`
- `app/src/app/api/history/route.ts`, `app/src/app/history/page.tsx` — cold-tier API + page
- `collector/src/archive-transform.ts` — DynamoDB Stream → Firehose transform (`FlatFlowRow`)
- `docs/reference/data.md` — DynamoDB single-table + CloudWatch metrics
- `CHANGELOG.md` — `[0.7.0] - 2026-07-12` (flow archive, History page)

---

<a id="korean"></a>

# 한국어

## 상태
승인됨 — 2026-07-12

## 배경
NFM Dashboard 컬렉터는 5분마다 실행되어 NFM top-contributor 플로우 행, 모니터
상태, DNS 샘플을 기록한다. 쓰기 패턴은 **버스트성**(한 사이클당 수백 행을 쓴 뒤
유휴)이며, 지배적 읽기 패턴은 **키 기반의 최근 구간 조회**다 — 대시보드는 거의
항상 "모니터 X의 최근 N개 버킷"을 요청하고, 여기서 버킷은 5분 슬롯으로 그 키
공식은 `collector`와 `app/src/lib/ddb.ts` 사이에서 동일하게 유지되어야 한다.

두 가지 힘이 서로 반대 방향으로 작용한다:

- **운영(hot) 경로** — 대시보드와 API는 짧은 최근 구간(≤ 7일)에 대해
  저지연·키 주소 지정 읽기가 필요하고, 컬렉터가 유휴일 때 0으로 스케일되며
  대기 상태 비용이 없는 쓰기가 필요하다. 플로우 행은 7일 `ttl`을 가져 hot
  테이블이 작고 저렴하게 유지된다.
- **분석(cold) 경로** — Phase 13에서 History 페이지와 `/api/history`가 추가되어,
  임의 날짜 범위 / **7일 초과** 쿼리에 응답해야 한다. 이 행들은 DynamoDB에 더
  이상 존재하지 않는다: 7일 TTL이 삭제했기 때문이다. hot 저장소나 그 비용을
  부풀리지 않으면서 내구성 있고 장기적인, 온디맨드 쿼리 가능한 사본이 필요하다.

단일 저장소로는 양쪽을 모두 잘 감당할 수 없다: 장기 분석을 위해 모든 것을
DynamoDB에 hot 상태로 유지하면 테이블이 무한히 커지고, 스캔 비용이 비싸지며
("임의의 두 날짜 사이 모든 플로우"에 대한 자연 키가 없음) 대기 비용이 상승한다.
반대로 스캔 지향 분석 엔진은 5분 키 조회 hot 경로에는 잘 맞지 않는다. 본 ADR은
단일 관계형 데이터베이스로 이전하는 대신 **두 계층을 분리**하기로 한 의도적
결정을 기록한다.

## 검토한 옵션

### 옵션 1: DynamoDB hot + S3(Parquet)/Glue/Athena cold (채택)
DynamoDB를 hot 운영 저장소로 유지한다(버스트성 쓰기, 키 기반 최근 구간 읽기,
7일 TTL, 서버리스/Lambda 네이티브, 대기 비용 거의 0). cold 분석 계층을 추가한다:
`nfm-dashboard-flows`의 DynamoDB Stream(`NEW_IMAGE`) → 변환 Lambda → Kinesis
Firehose(Glue 스키마로 Parquet 변환, `dt` 동적 파티셔닝) → S3 아카이브 버킷,
Glue(`nfm_dashboard.flows_archive`, `dt` 파티션 프로젝션)에 카탈로그화되고
Athena 워크그룹을 통해 `/api/history` + History 페이지가 쿼리한다.
- **장점**: 각 계층이 자신의 접근 패턴에 맞음. hot 테이블은 작고 저렴하게 유지
  (TTL이 크기 제한). 아카이브는 TTL 이후에도 내구성 있고 대기 비용이 저렴함
  (S3 + 컬럼형 Parquet, Athena 쿼리당 스캔 컷오프로 비용 제한). 완전한 서버리스
  — 유휴 시 크기 조정·패치·비용이 필요한 클러스터 없음. 아카이브 파이프라인은
  가산적이어서 hot 읽기/쓰기 경로를 건드리지 않음.
- **단점**: 운영할 데이터 시스템 2개와 스트리밍 파이프라인. cold 쿼리는 지연이
  더 큼(온디맨드 Athena, 밀리초가 아닌 초 단위). 스키마가 이중화됨(Glue 컬럼이
  변환 Lambda의 `FlatFlowRow`와 반드시 일치해야 하며, 아니면 Firehose가 조용히
  레코드를 `errors/`로 라우팅). 플로우 쓰기와 아카이브 사본 간 최종 일관성 지연.

### 옵션 2: Aurora PostgreSQL / MySQL (단일 관계형 저장소)
hot과 cold 워크로드를 하나의 관리형 관계형 데이터베이스로 통합한다.
- **장점**: 최근·과거 범위 모두 하나의 저장소와 하나의 쿼리 언어(SQL). 익숙한
  관계형 모델링·조인·인덱싱. 임의 날짜 범위 쿼리가 간단함.
- **단점**: 동일한 의미의 서버리스가 아님 — Aurora Serverless v2조차 최소 ACU가
  지속적으로 과금되어 대기 비용이 실재하고 상시적이며, 이는 컬렉터의 버스트-후-
  유휴 프로파일과 정반대다. VPC 배선, Lambda로부터의 커넥션 풀링/관리, 지속적인
  패치/버전/용량 운영이 필요함. 장기 보존은 자연스러운 TTL→아카이브 계층화 없이
  테이블 무한 증가와 스토리지 비용을 의미함. 현재의 전면 서버리스 설계보다 운영
  표면이 무거움.

### 옵션 3: Amazon Timestream
플로우 메트릭에 대해 목적 특화 시계열 데이터베이스를 사용한다.
- **장점**: 네이티브 시계열 의미론과 내장 hot→cold(메모리/마그네틱) 계층화 및
  보존. SQL 쿼리 표면.
- **단점**: 모델링·운영할 또 다른 서비스. 데이터가 순수 메트릭 시계열이 아님 —
  플로우 행은 풍부한 차원 컨텍스트(pod/service/subnet/AZ/VPC 엔드포인트, NAT IP,
  통과한 구성요소)를 담고 있어 키 주소 지정 hot 테이블과 컬럼형 Parquet
  아카이브에 더 적합함. 수집에 여전히 변환 계층이 필요함. History 페이지가
  목표로 하는 임의의 애드혹 아카이브 쿼리에는 Athena/Parquet보다 유연성이 낮음.
  대시보드 접근 패턴에 이미 튜닝된 기존 DynamoDB 단일 테이블 hot 모델과의 적합성
  약함.

## 결정
**옵션 1**을 채택한다: DynamoDB를 hot 운영 계층으로 유지하고, DynamoDB Stream에서
비동기로 공급되는 S3(Parquet) + Glue + Athena cold 분석 계층을 추가한다.
`/api/history`와 History 페이지는 `7일 초과` / 임의 날짜 범위 요청에 대해 cold
계층을 쿼리하고, 7일 hot 윈도 내의 모든 것은 계속 DynamoDB에서 직접 제공된다.
Aurora PostgreSQL/MySQL(옵션 2) 또는 Timestream(옵션 3)으로의 통합은 명시적으로
기각한다: 어느 쪽도 컬렉터의 버스트성 쓰기 / 키 조회 읽기 프로파일에 맞는
서버리스·scale-to-zero·대기 비용 거의 0 특성을 보존하지 못하며, 계층화 설계는
각 절반을 자신의 접근 패턴에 맞게 크기·가격을 정할 수 있게 한다.

## 영향

### 긍정적
- hot 테이블이 작고 빠르며 저렴하게 유지됨: 7일 TTL이 크기를 제한하고, PPR
  (요청당 과금) 방식이라 컬렉터 유휴 시 비용이 거의 0.
- 장기 히스토리가 내구성 있고 저렴한 S3 아카이브에서 TTL 삭제를 견딤. 컬럼형
  Parquet + `dt` 파티션 프로젝션이 Athena 스캔(및 비용)을 제한하고, 워크그룹의
  쿼리당 스캔 컷오프가 이를 보강함.
- 엔드투엔드 완전 서버리스 — 크기 조정·패치·페일오버·유휴 과금이 필요한
  데이터베이스 클러스터 없음.
- 아카이브 파이프라인은 가산적: 스트림을 읽을 뿐 대시보드의 hot 읽기/쓰기
  경로를 건드리지 않음.

### 부정적
- 스토리지 시스템 2개와 스트리밍 파이프라인(Stream → Lambda → Firehose → S3 +
  Glue + Athena)을 이해·모니터링·운영해야 함.
- 스키마가 두 곳에서 유지됨: Glue 테이블 컬럼이 변환 Lambda의 `FlatFlowRow`와
  동기화되어야 하며, 아니면 Firehose가 조용히 레코드를 `errors/` 프리픽스로
  버림.
- cold 계층 쿼리는 지연이 더 크고 비동기적임 — 플로우 쓰기와 아카이브된 쿼리
  가능 사본 사이에 최종 일관성 지연이 있고(Firehose 버퍼링 + Parquet 변환),
  아카이빙은 파이프라인 생성 시점의 스트림 `TRIM_HORIZON`에서만 시작됨(아카이브
  존재 이전에 쓰인 행은 백필되지 않음).

## 참고 자료
- `infra/lib/data-stack.ts` — flows 테이블(`NEW_IMAGE` 스트림, 7일 `ttl`) +
  아카이브 파이프라인(변환 Lambda → Firehose → S3 + Glue + Athena)
- `infra/lib/app-stack.ts` — 앱 태스크 역할 Athena/Glue/S3 IAM + `ATHENA_WORKGROUP`
  / `GLUE_DB` / `GLUE_TABLE` 환경변수
- `app/src/lib/ddb.ts` — hot 경로 5분 버킷 읽기(공식은 컬렉터와 일치해야 함)
- `app/src/lib/athena.ts` — `buildHistorySql`(인젝션 방어) + `runHistoryQuery`
- `app/src/app/api/history/route.ts`, `app/src/app/history/page.tsx` — cold 계층 API + 페이지
- `collector/src/archive-transform.ts` — DynamoDB Stream → Firehose 변환(`FlatFlowRow`)
- `docs/reference/data.md` — DynamoDB 단일 테이블 + CloudWatch 메트릭
- `CHANGELOG.md` — `[0.7.0] - 2026-07-12`(flow archive, History 페이지)
