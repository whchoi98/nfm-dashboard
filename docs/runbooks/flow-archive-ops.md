# Runbook: Flow Archive (Cold Tier) Operations

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Overview
Operating the cold-tier flow archive that persists NFM flow rows beyond the
DynamoDB 7-day TTL. The pipeline is (see `infra/lib/data-stack.ts`,
"Phase 13 flow archive"):

```text
nfm-dashboard-flows (DynamoDB Stream, NEW_IMAGE)
  → nfm-dashboard-archive-transform (Lambda, archive-transform.handler)
  → nfm-dashboard-flow-archive (Kinesis Firehose, DirectPut, Parquet conversion)
  → s3://nfm-dashboard-flow-archive-<ACCOUNT_ID>/flows/dt=YYYY-MM-DD/
  → Glue nfm_dashboard.flows_archive (partition projection on dt)
  → Athena workgroup nfm-dashboard  →  /api/history + History page
```
AWS account `<ACCOUNT_ID>`, region `ap-northeast-2`. See `docs/decisions/ADR-001-ddb-hot-athena-cold-tiering.md` for the tiering rationale.

## When to Use
- Routine health check of the archive pipeline.
- The History page / `/api/history` returns empty or stale results for a
  `> 7-day` / arbitrary-date range.
- After deploying a `collector` or `NfmDash-Data` change that touched
  `collector/src/archive-transform.ts` (`FlatFlowRow`) or the Glue table columns
  in `infra/lib/data-stack.ts` — the #1 failure mode below.

## Prerequisites
- AWS credentials for account `<ACCOUNT_ID>` with read access to Lambda,
  Firehose, S3, Glue, Athena, and CloudWatch Logs in `ap-northeast-2`.
- AWS CLI v2. Working directory: repo root, `/home/ec2-user/my-project/nfm-dashboard`.

## Procedure

### 1. Health check
Confirm the transform Lambda is invoking with **0 errors** (last hour):
```bash
aws cloudwatch get-metric-statistics --namespace AWS/Lambda \
  --metric-name Errors --dimensions Name=FunctionName,Value=nfm-dashboard-archive-transform \
  --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --period 3600 --statistics Sum \
  --region ap-northeast-2                                   # Sum should be 0

aws cloudwatch get-metric-statistics --namespace AWS/Lambda \
  --metric-name Invocations --dimensions Name=FunctionName,Value=nfm-dashboard-archive-transform \
  --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --period 3600 --statistics Sum \
  --region ap-northeast-2                                   # > 0 when the collector is writing flows
```
Confirm Firehose is **ACTIVE**:
```bash
aws firehose describe-delivery-stream --delivery-stream-name nfm-dashboard-flow-archive \
  --region ap-northeast-2 --query "DeliveryStreamDescription.DeliveryStreamStatus" --output text   # ACTIVE
```
Confirm Parquet objects are landing under today's partition (and that the
`errors/` prefix is empty — see step 2):
```bash
aws s3 ls "s3://nfm-dashboard-flow-archive-<ACCOUNT_ID>/flows/dt=$(date -u +%Y-%m-%d)/" \
  --recursive --region ap-northeast-2                       # expect >= 1 .parquet object
aws s3 ls "s3://nfm-dashboard-flow-archive-<ACCOUNT_ID>/errors/" \
  --recursive --region ap-northeast-2                       # expect EMPTY
```
> Firehose buffers `128 MB` or `300 s` (whichever first, per
> `extendedS3DestinationConfiguration.bufferingHints`), so a freshly written
> flow takes up to ~5 minutes to appear as a Parquet object. Only `FLOW#` items
> are archived — `flattenFlowImage` skips `STATUS#`/`TOPO#`/`COVERAGE#` meta rows.

### 2. The #1 failure mode — schema drift (records in `errors/`)
Any object under `s3://nfm-dashboard-flow-archive-<ACCOUNT_ID>/errors/` means
Firehose could **not** convert a record to Parquet. The dominant cause is a
**schema drift** between the transform Lambda's `FlatFlowRow`
(`collector/src/archive-transform.ts`) and the Glue table columns
(`archiveColumns` in `infra/lib/data-stack.ts`, table `nfm_dashboard.flows_archive`).
The 29 data columns MUST match **name-for-name and type-for-type** (the Glue
table adds `dt` as the partition key on top of those 29; `FlatFlowRow` carries
`dt` as its 30th field, used only for the `flows/dt=…/` prefix). A single
renamed or retyped column makes Firehose silently route every record to
`errors/` — the transform Lambda still succeeds (0 errors) and the Stream still
checkpoints, so the health check in step 1 looks green while nothing lands in
`flows/`.

**Detect:**
```bash
# a) Objects accumulating under errors/ (the primary signal):
aws s3 ls "s3://nfm-dashboard-flow-archive-<ACCOUNT_ID>/errors/" \
  --recursive --region ap-northeast-2

# b) Firehose delivery/conversion errors in its CloudWatch log group:
aws logs tail /aws/kinesisfirehose/nfm-dashboard-flow-archive \
  --since 1h --region ap-northeast-2
#   look for DataFormatConversion / schema errors (log stream: S3Delivery)
```

**Fix (realign the 29 data columns):**
1. Diff the two sources of truth:
   - `FlatFlowRow` in `collector/src/archive-transform.ts` (lines ~8-16).
   - `archiveColumns` in `infra/lib/data-stack.ts` (the `glue.CfnTable.ColumnProperty[]`).
   Column names and Glue types must line up (`value` → `double`,
   `target_port` → `int`, everything else `string`). `dt` is the partition key
   only — it is not in `archiveColumns`.
2. Correct whichever side drifted, keeping the two in lockstep.
3. Rebuild + redeploy per `docs/runbooks/deploy.md` (Data-tier change):
   ```bash
   npm -w collector run build          # if FlatFlowRow changed
   cd infra && npx cdk deploy NfmDash-Data --require-approval never -c imageTag=unused
   ```
   Firehose reads the Glue schema at `versionId: LATEST`, so a redeployed Glue
   table takes effect for subsequent records — no manual Firehose restart needed.
4. Re-run step 1 and confirm new Parquet objects land in `flows/dt=…/` and
   `errors/` stops growing. Records already in `errors/` are not reprocessed
   (there is no backfill); they can be inspected then deleted manually.

### 3. Querying the archive (Athena + `/api/history`)
The Glue table uses **partition projection** on `dt`
(`projection.dt.range = 2026-07-01,NOW`, daily), so partitions are computed at
query time — **no Glue crawler and no `ALTER TABLE ... ADD PARTITION`** are ever
required. New `dt=YYYY-MM-DD/` prefixes become queryable automatically.

Query via the app: `/api/history` → `app/src/lib/athena.ts`
(`buildHistorySql` + `runHistoryQuery`) runs on the `nfm-dashboard` workgroup.
It is injection-guarded — `from`/`to` must match `YYYY-MM-DD`, string filters
must match `[A-Za-z0-9._/-]+` — filters on `dt BETWEEN from AND to`
(+ optional `monitor` / `namespace` / `metric`), orders by `bucket DESC`, and
clamps `LIMIT` to 1000 (max 5000).

Ad-hoc from the CLI (same workgroup; results land in the Athena results bucket):
```bash
aws athena start-query-execution --region ap-northeast-2 --work-group nfm-dashboard \
  --query-string "SELECT dt, monitor, metric, count(*) FROM nfm_dashboard.flows_archive \
WHERE dt BETWEEN '2026-07-12' AND '$(date -u +%Y-%m-%d)' GROUP BY dt, monitor, metric ORDER BY dt DESC"
```
> The workgroup enforces a `2 GB` per-query scan cutoff
> (`bytesScannedCutoffPerQuery`) and writes results to
> `s3://nfm-dashboard-athena-results-<ACCOUNT_ID>/athena/`. Always filter on
> `dt` to prune partitions and stay under the cutoff.

## Verification
- [ ] `nfm-dashboard-archive-transform` Lambda Errors = 0 (last hour), Invocations > 0 while collector is active.
- [ ] Firehose `nfm-dashboard-flow-archive` status = `ACTIVE`.
- [ ] Parquet object(s) present under `flows/dt=<today>/`.
- [ ] `errors/` prefix is empty.
- [ ] An Athena `SELECT ... WHERE dt BETWEEN ...` returns rows; `/api/history` / History page renders data.

## Rollback
- **Schema drift**: this is a roll-forward fix (realign columns + redeploy
  `NfmDash-Data`), not a data rollback. Missed records that hit `errors/` during
  the drift window are **not** recoverable from the archive — the 7-day
  DynamoDB hot window is the only fallback for that period until it TTL-expires.
- **Bad `NfmDash-Data` change**: `git checkout <previous-commit>` the infra /
  collector change, `npm -w collector run build`, redeploy `NfmDash-Data`
  (see `docs/runbooks/deploy.md`). The archive bucket is `RETAIN` — a stack
  rollback never deletes archived Parquet data.

## Notes
- **TRIM_HORIZON = no backfill.** The transform Lambda's DynamoDB Stream event
  source starts at `TRIM_HORIZON` (`infra/lib/data-stack.ts`), so archiving
  begins from the records present when the pipeline was first deployed
  (**2026-07-12**). Rows written before that are **not** in the archive; for
  pre-archive dates the 7-day DynamoDB hot window is the only source until TTL
  expiry. This also bounds the projection lower edge (`projection.dt.range`
  starts `2026-07-01`).
- **Archive bucket is `RETAIN`** (`nfm-dashboard-flow-archive-<ACCOUNT_ID>`,
  S3-managed encryption, not versioned): it survives `NfmDash-Data` teardown and
  must be emptied/deleted manually if ever decommissioned. It has **no lifecycle
  rule** — cold Parquet data accumulates indefinitely; add an S3 lifecycle
  transition (e.g. to Glacier) or expiration if long-term cost becomes a concern.
- The Athena **results** bucket (`nfm-dashboard-athena-results-<ACCOUNT_ID>`) is
  the disposable counterpart: `DESTROY` + `autoDeleteObjects` + a 30-day
  expiration lifecycle rule.
- Last verified: 2026-07-12

---

<a id="korean"></a>

# 한국어

## 개요
DynamoDB 7일 TTL 이후에도 NFM 플로우 행을 보존하는 cold 계층 flow 아카이브 운영.
파이프라인은 다음과 같다(`infra/lib/data-stack.ts`의 "Phase 13 flow archive" 참고):

```text
nfm-dashboard-flows (DynamoDB Stream, NEW_IMAGE)
  → nfm-dashboard-archive-transform (Lambda, archive-transform.handler)
  → nfm-dashboard-flow-archive (Kinesis Firehose, DirectPut, Parquet 변환)
  → s3://nfm-dashboard-flow-archive-<ACCOUNT_ID>/flows/dt=YYYY-MM-DD/
  → Glue nfm_dashboard.flows_archive (dt 파티션 프로젝션)
  → Athena 워크그룹 nfm-dashboard  →  /api/history + History 페이지
```
AWS 계정 `<ACCOUNT_ID>`, 리전 `ap-northeast-2`. 계층화 근거는
`docs/decisions/ADR-001-ddb-hot-athena-cold-tiering.md` 참고.

## 사용 시점
- 아카이브 파이프라인의 정기 상태 점검.
- History 페이지 / `/api/history`가 `7일 초과` / 임의 날짜 범위에 대해 비어 있거나
  오래된 결과를 반환할 때.
- `collector/src/archive-transform.ts`(`FlatFlowRow`)나 `infra/lib/data-stack.ts`의
  Glue 테이블 컬럼을 건드린 `collector` / `NfmDash-Data` 변경 배포 이후 — 아래 #1
  실패 모드.

## 사전 요구 사항
- 계정 `<ACCOUNT_ID>`에서 `ap-northeast-2`의 Lambda, Firehose, S3, Glue, Athena,
  CloudWatch Logs 읽기 권한이 있는 AWS 자격 증명.
- AWS CLI v2. 작업 디렉터리: 저장소 루트, `/home/ec2-user/my-project/nfm-dashboard`.

## 절차

### 1. 상태 점검
변환 Lambda가 **오류 0**으로 호출되는지 확인(최근 1시간):
```bash
aws cloudwatch get-metric-statistics --namespace AWS/Lambda \
  --metric-name Errors --dimensions Name=FunctionName,Value=nfm-dashboard-archive-transform \
  --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --period 3600 --statistics Sum \
  --region ap-northeast-2                                   # Sum은 0이어야 함

aws cloudwatch get-metric-statistics --namespace AWS/Lambda \
  --metric-name Invocations --dimensions Name=FunctionName,Value=nfm-dashboard-archive-transform \
  --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --period 3600 --statistics Sum \
  --region ap-northeast-2                                   # 컬렉터가 플로우를 쓰는 동안 > 0
```
Firehose가 **ACTIVE**인지 확인:
```bash
aws firehose describe-delivery-stream --delivery-stream-name nfm-dashboard-flow-archive \
  --region ap-northeast-2 --query "DeliveryStreamDescription.DeliveryStreamStatus" --output text   # ACTIVE
```
오늘 파티션 아래에 Parquet 객체가 도착하는지(그리고 `errors/` 프리픽스가 비어
있는지 — 2단계 참고) 확인:
```bash
aws s3 ls "s3://nfm-dashboard-flow-archive-<ACCOUNT_ID>/flows/dt=$(date -u +%Y-%m-%d)/" \
  --recursive --region ap-northeast-2                       # .parquet 객체 >= 1개 기대
aws s3 ls "s3://nfm-dashboard-flow-archive-<ACCOUNT_ID>/errors/" \
  --recursive --region ap-northeast-2                       # 비어 있어야 함
```
> Firehose는 `128 MB` 또는 `300초`(둘 중 먼저,
> `extendedS3DestinationConfiguration.bufferingHints`) 버퍼링하므로, 방금 쓴
> 플로우가 Parquet 객체로 나타나기까지 최대 약 5분이 걸린다. `FLOW#` 항목만
> 아카이브된다 — `flattenFlowImage`는 `STATUS#`/`TOPO#`/`COVERAGE#` 메타 행을
> 건너뛴다.

### 2. #1 실패 모드 — 스키마 드리프트(`errors/`에 레코드)
`s3://nfm-dashboard-flow-archive-<ACCOUNT_ID>/errors/` 아래의 객체는 Firehose가
레코드를 Parquet로 변환하지 **못했음**을 의미한다. 지배적 원인은 변환 Lambda의
`FlatFlowRow`(`collector/src/archive-transform.ts`)와 Glue 테이블 컬럼
(`infra/lib/data-stack.ts`의 `archiveColumns`, 테이블 `nfm_dashboard.flows_archive`)
사이의 **스키마 드리프트**다. 29개 데이터 컬럼은 **이름 대 이름, 타입 대 타입**으로
일치해야 한다(Glue 테이블은 이 29개 위에 `dt`를 파티션 키로 추가하고,
`FlatFlowRow`는 `dt`를 30번째 필드로 갖되 `flows/dt=…/` 프리픽스에만 사용).
컬럼 하나만 이름/타입이 바뀌어도 Firehose는 모든 레코드를 조용히 `errors/`로
라우팅한다 — 변환 Lambda는 여전히 성공하고(오류 0) Stream도 체크포인트하므로,
1단계 상태 점검은 초록불로 보이지만 `flows/`에는 아무것도 도착하지 않는다.

**탐지:**
```bash
# a) errors/ 아래 객체 누적(주요 신호):
aws s3 ls "s3://nfm-dashboard-flow-archive-<ACCOUNT_ID>/errors/" \
  --recursive --region ap-northeast-2

# b) Firehose CloudWatch 로그 그룹의 delivery/변환 오류:
aws logs tail /aws/kinesisfirehose/nfm-dashboard-flow-archive \
  --since 1h --region ap-northeast-2
#   DataFormatConversion / schema 오류 확인(로그 스트림: S3Delivery)
```

**해결(29개 데이터 컬럼 재정렬):**
1. 두 진실 소스를 비교한다:
   - `collector/src/archive-transform.ts`의 `FlatFlowRow`(약 8-16행).
   - `infra/lib/data-stack.ts`의 `archiveColumns`(`glue.CfnTable.ColumnProperty[]`).
   컬럼 이름과 Glue 타입이 정렬되어야 한다(`value` → `double`,
   `target_port` → `int`, 나머지 전부 `string`). `dt`는 파티션 키일 뿐이며
   `archiveColumns`에 없다.
2. 드리프트된 쪽을 수정하여 둘을 lockstep으로 맞춘다.
3. `docs/runbooks/deploy.md`(Data 계층 변경)에 따라 재빌드 + 재배포:
   ```bash
   npm -w collector run build          # FlatFlowRow가 변경된 경우
   cd infra && npx cdk deploy NfmDash-Data --require-approval never -c imageTag=unused
   ```
   Firehose는 `versionId: LATEST`로 Glue 스키마를 읽으므로, 재배포된 Glue 테이블은
   이후 레코드에 적용된다 — 수동 Firehose 재시작 불필요.
4. 1단계를 다시 실행하여 새 Parquet 객체가 `flows/dt=…/`에 도착하고 `errors/`가
   더 이상 증가하지 않는지 확인한다. 이미 `errors/`에 있는 레코드는 재처리되지
   않는다(백필 없음). 검사 후 수동 삭제할 수 있다.

### 3. 아카이브 쿼리(Athena + `/api/history`)
Glue 테이블은 `dt`에 대해 **파티션 프로젝션**을 사용하므로
(`projection.dt.range = 2026-07-01,NOW`, 일 단위) 파티션이 쿼리 시점에 계산된다 —
**Glue 크롤러나 `ALTER TABLE ... ADD PARTITION`이 전혀 필요 없다.** 새
`dt=YYYY-MM-DD/` 프리픽스는 자동으로 쿼리 가능해진다.

앱을 통한 쿼리: `/api/history` → `app/src/lib/athena.ts`
(`buildHistorySql` + `runHistoryQuery`)가 `nfm-dashboard` 워크그룹에서 실행된다.
인젝션 방어됨 — `from`/`to`는 `YYYY-MM-DD`와 일치해야 하고 문자열 필터는
`[A-Za-z0-9._/-]+`와 일치해야 함 — `dt BETWEEN from AND to`
(+ 선택적 `monitor` / `namespace` / `metric`)로 필터링하고 `bucket DESC`로
정렬하며 `LIMIT`을 1000(최대 5000)으로 제한한다.

CLI 애드혹(동일 워크그룹, 결과는 Athena 결과 버킷에 저장):
```bash
aws athena start-query-execution --region ap-northeast-2 --work-group nfm-dashboard \
  --query-string "SELECT dt, monitor, metric, count(*) FROM nfm_dashboard.flows_archive \
WHERE dt BETWEEN '2026-07-12' AND '$(date -u +%Y-%m-%d)' GROUP BY dt, monitor, metric ORDER BY dt DESC"
```
> 워크그룹은 쿼리당 `2 GB` 스캔 컷오프(`bytesScannedCutoffPerQuery`)를 강제하고
> 결과를 `s3://nfm-dashboard-athena-results-<ACCOUNT_ID>/athena/`에 쓴다. 파티션을
> 프루닝하고 컷오프 아래로 유지하기 위해 항상 `dt`로 필터링할 것.

## 검증
- [ ] `nfm-dashboard-archive-transform` Lambda Errors = 0(최근 1시간), 컬렉터 활성 시 Invocations > 0.
- [ ] Firehose `nfm-dashboard-flow-archive` 상태 = `ACTIVE`.
- [ ] `flows/dt=<오늘>/` 아래에 Parquet 객체 존재.
- [ ] `errors/` 프리픽스가 비어 있음.
- [ ] Athena `SELECT ... WHERE dt BETWEEN ...`가 행을 반환; `/api/history` / History 페이지가 데이터를 렌더링.

## 롤백
- **스키마 드리프트**: 이는 데이터 롤백이 아니라 roll-forward 수정(컬럼 재정렬 +
  `NfmDash-Data` 재배포)이다. 드리프트 기간에 `errors/`로 간 누락 레코드는
  아카이브에서 **복구 불가** — 그 기간에 대해서는 7일 DynamoDB hot 윈도가 TTL
  만료 전까지 유일한 폴백이다.
- **잘못된 `NfmDash-Data` 변경**: 인프라 / 컬렉터 변경을
  `git checkout <이전-커밋>` 하고 `npm -w collector run build` 후 `NfmDash-Data`를
  재배포한다(`docs/runbooks/deploy.md` 참고). 아카이브 버킷은 `RETAIN`이므로 스택
  롤백으로 아카이브된 Parquet 데이터가 삭제되지 않는다.

## 참고
- **TRIM_HORIZON = 백필 없음.** 변환 Lambda의 DynamoDB Stream 이벤트 소스는
  `TRIM_HORIZON`에서 시작하므로(`infra/lib/data-stack.ts`), 아카이빙은 파이프라인이
  최초 배포된 시점(**2026-07-12**)에 존재하는 레코드에서 시작된다. 그 이전에 쓰인
  행은 아카이브에 **없다**. 아카이브 이전 날짜에 대해서는 7일 DynamoDB hot 윈도가
  TTL 만료 전까지 유일한 소스다. 이는 프로젝션 하한도 제한한다
  (`projection.dt.range`가 `2026-07-01`부터).
- **아카이브 버킷은 `RETAIN`**(`nfm-dashboard-flow-archive-<ACCOUNT_ID>`,
  S3 관리형 암호화, 버저닝 없음): `NfmDash-Data` 해체 후에도 살아남으며, 폐기 시
  수동으로 비우고 삭제해야 한다. **라이프사이클 규칙이 없어** cold Parquet 데이터가
  무기한 누적된다. 장기 비용이 우려되면 S3 라이프사이클 전환(예: Glacier)이나 만료를
  추가할 것.
- Athena **결과** 버킷(`nfm-dashboard-athena-results-<ACCOUNT_ID>`)은 일회성
  대응물이다: `DESTROY` + `autoDeleteObjects` + 30일 만료 라이프사이클 규칙.
- 최종 검증일: 2026-07-12
