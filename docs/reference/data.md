# Data / 데이터 구성 상세

[![English](https://img.shields.io/badge/Language-English-blue)](#english)
[![한국어](https://img.shields.io/badge/Language-한국어-red)](#korean)

<a id="english"></a>
## English

### 1. Overview
The collector Lambda queries CloudWatch Network Flow Monitor every 5 minutes and writes flow edges, topology snapshots, DNS aggregates, and cycle metadata to two DynamoDB tables (`nfm-dashboard-flows`, `nfm-dashboard-meta`); the app reads them back on a shared 5-minute bucket grid, plus live CloudWatch metrics.

**Flow archive (Phase 13-②):** every flow write is captured before the 7-day DynamoDB TTL deletes it. A DynamoDB Stream (`NEW_IMAGE`) on `nfm-dashboard-flows` triggers the `nfm-dashboard-archive-transform` Lambda (`collector/src/archive-transform.ts`), which unmarshalls each edge, flattens `a_*`/`b_*` endpoints, serializes `traversed_constructs`, derives `dt = bucket[0:10]`, and `PutRecordBatch`es flat JSON to Firehose `nfm-dashboard-flow-archive`. Firehose converts to Parquet (via the Glue schema), dynamic-partitions by `dt`, and writes `s3://nfm-dashboard-flow-archive-<ACCOUNT_ID>/flows/dt=YYYY-MM-DD/`. A Glue database `nfm_dashboard` + external table `flows_archive` (partition projection on `dt`, no crawler) catalogs it; the Athena workgroup `nfm-dashboard` (results → `nfm-dashboard-athena-results-<ACCOUNT_ID>`, 2 GB per-query scan cap) queries it. The `flows_archive` columns MUST match the transform Lambda's `FlatFlowRow` exactly (minus `dt`) or Firehose silently routes records to the `errors/` prefix.

### 2. Components
| Component | Path | Purpose |
|---|---|---|
| Dashboard read path | `app/src/lib/ddb.ts` | DynamoDB reads (topology snapshot, flow buckets); `recentBuckets()` 5-min grid keys |
| Collector write path | `collector/src/storage.ts` | `writeCycle` / `buildTopology`: persists edges, snapshots, cycle stats |
| Collector entry | `collector/src/handler.ts` | Lambda handler: NFM query matrix, workload insights, DNS collection per cycle |
| NFM queries | `collector/src/nfm-query.ts` | `runQueryMatrix` — top-contributor queries per metric |
| CloudWatch metrics | `app/src/lib/cw-metrics.ts` | Monitor metrics reads (`listMonitorNames`, series) |
| Archive transform | `collector/src/archive-transform.ts` | DDB Stream (`NEW_IMAGE`) → `flattenFlowImage` (→ `FlatFlowRow`) → Firehose `PutRecordBatch` |
| Data stack | `infra/lib/data-stack.ts` | `NfmDash-Data`: DynamoDB tables + collector Lambda + schedule + flow-archive pipeline (Streams + S3×2 + Glue db/table + Athena WG + Firehose + transform Lambda) |

### 3. Key Decisions
<!-- TODO: list 3-5 decisions or link to docs/decisions/ADR-*.md -->

### 4. Code Pointers
<!-- TODO: 3-7 entries; paths must be valid (checked by /sync-docs) -->
- `app/src/lib/ddb.ts` — `recentBuckets()` doc comment: the bucket formula `Math.floor(t/300000)*300000 → ISO (no ms)` MUST match the collector exactly; meta key example `pk: 'TOPO#latest', sk: 'snapshot'`
- `collector/src/handler.ts` — same bucket formula; query window `now-7min → now-2min`; monitor→cluster map from `MONITORS` env
- `collector/src/types.ts` and `app/src/lib/types.ts` — shared shapes (`FlowEdge`, `TopologySnapshot`, `DnsAggregate`, `Coverage`, …) kept aligned by hand
- `app/src/lib/cw-metrics.ts` — CloudWatch side of the data layer (NFM monitor metrics)

### 5. Cross-references
<!-- TODO -->
- Related modules: `collector/CLAUDE.md`, `app/src/lib/CLAUDE.md`
- Related ADRs:
- Related runbooks:

<a id="korean"></a>
## 한국어

### 1. 개요
collector Lambda가 5분마다 CloudWatch Network Flow Monitor를 조회해 flow edge, 토폴로지 스냅샷, DNS 집계, 사이클 메타데이터를 DynamoDB 두 테이블(`nfm-dashboard-flows`, `nfm-dashboard-meta`)에 기록하고, 앱은 동일한 5분 버킷 그리드로 읽어온다. 실시간 지표는 CloudWatch 메트릭으로 보강한다.

**Flow 아카이브 (Phase 13-②):** 7일 DynamoDB TTL로 삭제되기 전에 모든 flow 쓰기를 보존한다. `nfm-dashboard-flows`의 DynamoDB 스트림(`NEW_IMAGE`)이 `nfm-dashboard-archive-transform` Lambda(`collector/src/archive-transform.ts`)를 트리거하고, 각 edge를 unmarshall해 `a_*`/`b_*` 엔드포인트를 평탄화하고 `traversed_constructs`를 직렬화하며 `dt = bucket[0:10]`을 도출한 뒤 flat JSON을 Firehose `nfm-dashboard-flow-archive`로 `PutRecordBatch`한다. Firehose는 (Glue 스키마 기반) Parquet로 변환하고 `dt`로 동적 파티셔닝해 `s3://nfm-dashboard-flow-archive-<ACCOUNT_ID>/flows/dt=YYYY-MM-DD/`에 기록한다. Glue database `nfm_dashboard` + 외부 테이블 `flows_archive`(`dt` 파티션 프로젝션, crawler 불필요)가 카탈로그하고, Athena 워크그룹 `nfm-dashboard`(결과 → `nfm-dashboard-athena-results-<ACCOUNT_ID>`, 쿼리당 2 GB 스캔 상한)가 조회한다. `flows_archive` 컬럼은 transform Lambda의 `FlatFlowRow`와 정확히 일치해야 하며(`dt` 제외), 어긋나면 Firehose가 레코드를 `errors/` 프리픽스로 조용히 보낸다.

### 2. 구성요소
| 구성요소 | 경로 | 목적 |
|---|---|---|
| 대시보드 읽기 경로 | `app/src/lib/ddb.ts` | DynamoDB 읽기(토폴로지 스냅샷, flow 버킷); `recentBuckets()` 5분 그리드 키 |
| collector 쓰기 경로 | `collector/src/storage.ts` | `writeCycle` / `buildTopology`: edge·스냅샷·사이클 통계 저장 |
| collector 엔트리 | `collector/src/handler.ts` | Lambda 핸들러: 사이클마다 NFM query matrix, workload insights, DNS 수집 |
| NFM 쿼리 | `collector/src/nfm-query.ts` | `runQueryMatrix` — 메트릭별 top-contributor 쿼리 |
| CloudWatch 메트릭 | `app/src/lib/cw-metrics.ts` | 모니터 메트릭 조회(`listMonitorNames`, 시계열) |
| 아카이브 transform | `collector/src/archive-transform.ts` | DDB 스트림(`NEW_IMAGE`) → `flattenFlowImage`(→ `FlatFlowRow`) → Firehose `PutRecordBatch` |
| Data 스택 | `infra/lib/data-stack.ts` | `NfmDash-Data`: DynamoDB 테이블 + collector Lambda + 스케줄 + flow 아카이브 파이프라인(Streams + S3×2 + Glue db/table + Athena WG + Firehose + transform Lambda) |

### 3. 주요 결정
<!-- TODO: 3-5개 결정 나열 또는 docs/decisions/ADR-*.md 링크 -->

### 4. 코드 포인터
<!-- TODO: 3-7개 항목; 경로는 실재해야 함 (/sync-docs가 점검) -->
- `app/src/lib/ddb.ts` — `recentBuckets()` 주석: 버킷 공식 `Math.floor(t/300000)*300000 → ISO(ms 제거)`는 collector와 반드시 일치해야 함; meta 키 예시 `pk: 'TOPO#latest', sk: 'snapshot'`
- `collector/src/handler.ts` — 동일한 버킷 공식; 쿼리 윈도우 `now-7분 → now-2분`; `MONITORS` env로 모니터→클러스터 매핑
- `collector/src/types.ts`, `app/src/lib/types.ts` — 공유 타입(`FlowEdge`, `TopologySnapshot`, `DnsAggregate`, `Coverage` 등) 수동 동기화
- `app/src/lib/cw-metrics.ts` — 데이터 계층의 CloudWatch 측(NFM 모니터 메트릭)

### 5. 상호 참조
<!-- TODO -->
- 관련 모듈: `collector/CLAUDE.md`, `app/src/lib/CLAUDE.md`
- 관련 ADR:
- 관련 런북:
