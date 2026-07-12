# Phase 13 (②) — Flow Archive (S3 Parquet) + Athena History Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Lenses/pure helpers TDD. Read `/.superpowers/sdd/infra_digest.md` (scratchpad copy at `/tmp/claude-1000/-home-ec2-user-my-project-nfm-dashboard/f40dbeed-6bad-43f4-83ac-9417da3ee409/scratchpad/infra_digest.md`) for exact construct/file facts before infra tasks.

**Goal:** Archive every flow write to S3 as date-partitioned Parquet BEFORE the 7-day DynamoDB TTL deletes it, catalog it in Glue, and let operators query arbitrary date ranges (> 7 days) from a new dashboard **History** page backed by Athena.

**Architecture:** DynamoDB Streams (NEW_IMAGE) on `nfm-dashboard-flows` → a small TS transform Lambda (unmarshall + flatten `a_*`/`b_*`, serialize `traversed_constructs`, derive `dt` from `bucket`) → Kinesis Data Firehose (L1 `CfnDeliveryStream`, record-format-conversion to **Parquet** via a Glue schema, **dynamic partitioning** on `dt`) → S3 archive bucket `flows/dt=YYYY-MM-DD/`. A Glue `CfnDatabase` + `CfnTable` (with **partition projection** on `dt` — no crawler) catalogs it; an Athena `CfnWorkGroup` runs queries. The app gains a `/api/history` route (Athena StartQuery→poll→GetResults) + a **History** page with a date-range picker. All archive infra co-locates in `NfmDash-Data` (avoids cross-stack stream-ARN import); the app task role (in `NfmDash-App`) gains Athena/Glue/S3 read perms via fixed resource names.

**Tech Stack:** AWS CDK v2 (`aws-cdk-lib ^2.170.0`; Firehose/Glue/Athena via **L1 Cfn** constructs — no L2/alpha available), TS Lambda (esbuild asset, mirrors collector), Next.js 16 App Router, `@aws-sdk/client-athena` (NEW dep), vitest.

## Global Constraints

- Version bump **0.7.0** at the end (`app/src/lib/version.ts` + `app/package.json` + `CHANGELOG.md` [0.7.0] EN+KR + ref links; version.test passes). (Current is 0.6.0; item-1 7d-range ships in this same release.)
- All visible UI strings via `t()` in BOTH `ko.json` + `en.json`. chart-tokens only (no hardcoded hex). App API routes: `export const dynamic = 'force-dynamic'` + try/catch → `Response.json({error:'internal error'},{status:500})`.
- Fixed AWS resource names (so data-stack creates + app-stack references by name/ARN, no cross-stack export): S3 archive bucket `nfm-dashboard-flow-archive-<ACCOUNT_ID>`; Athena results bucket `nfm-dashboard-athena-results-<ACCOUNT_ID>`; Glue database `nfm_dashboard`; Glue table `flows_archive`; Athena workgroup `nfm-dashboard`. Region `ap-northeast-2`, account `<ACCOUNT_ID>`.
- Least privilege: transform Lambda = `grantStreamRead` + Firehose PutRecordBatch only; app task role = `athena:StartQueryExecution/GetQueryExecution/GetQueryResults/StopQueryExecution` on the workgroup + `glue:GetTable/GetDatabase/GetPartitions` on the db/table + `s3:GetObject/ListBucket` on the archive bucket + `s3:GetObject/PutObject/ListBucket` on the results bucket (Athena writes results there).
- No new npm deps except `@aws-sdk/client-athena` (app) + `@aws-sdk/util-dynamodb` (transform Lambda). Conventional commits + `Claude-Session:` trailer. Serial. dev branch `dev/phase13-history-extension` (item-1 already committed there) → merge → deploy (USER-AUTHORIZED; provisions billable infra).
- IaC change → update `infra/CLAUDE.md` + `docs/reference/iac.md` + `docs/reference/data.md`; new API → `app/src/app/api/CLAUDE.md` + `docs/reference/api.md`.

## FlowEdge → Parquet schema (flattened)

DynamoDB NEW_IMAGE = the collector's `flowItem` (edge spread + wrapper keys `pk`/`sk`/`gsi*`/`ttl`). The transform Lambda `unmarshall()`s it and emits ONE flat JSON record per edge with these fields (Glue/Parquet columns, all lowercase snake_case):

| column | type | source |
|---|---|---|
| edge_hash | string | edgeHash |
| monitor | string | monitor |
| metric | string | metric |
| category | string | category |
| bucket | string | bucket (ISO 5-min) |
| value | double | value |
| unit | string | unit |
| a_ip, a_instance_id, a_subnet_id, a_az, a_vpc_id, a_region, a_pod_name, a_pod_namespace, a_service_name | string | a.* |
| b_ip, b_instance_id, b_subnet_id, b_az, b_vpc_id, b_region, b_pod_name, b_pod_namespace, b_service_name | string | b.* |
| snat_ip, dnat_ip | string | snatIp/dnatIp |
| target_port | int | targetPort |
| traversed_constructs | string | JSON.stringify(traversedConstructs) |

Partition column: **`dt` string** = `bucket.slice(0,10)` (YYYY-MM-DD). NOT a data column — it's the Firehose dynamic-partition key + Glue projected partition.

## Task sequence (serial)

| # | Task | Deliverable |
|---|---|---|
| 2 | Transform Lambda (code + TDD) | `collector/src/archive-transform.ts` flatten fn + handler + esbuild bundle |
| 3 | Archive infra (CDK, data-stack) | Streams + S3×2 + Glue db/table(projection) + Athena WG + Firehose(Parquet) + event source + IAM |
| 4 | `/api/history` route + app IAM | Athena client + query route + app-stack task-role perms + env vars |
| 5 | History page + nav + i18n | `/history` page with date-range picker + nav item |
| 6 | Finalize | build + review + deploy (Data+App) + end-to-end verify + v0.7.0 + merge |

---

## Task 2: Transform Lambda (DynamoDB stream record → flat Parquet-ready JSON)

**Files:** Create `collector/src/archive-transform.ts` (+ `archive-transform.test.ts`). Modify `collector/package.json` build script (esbuild a SECOND entrypoint → `collector/dist/archive-transform.mjs`) + add `@aws-sdk/util-dynamodb` dep. Modify `collector/CLAUDE.md`.

**Interfaces:**
- Produces: `export function flattenFlowImage(image: Record<string, AttributeValue>): FlatFlowRow | null` — `unmarshall`s a DDB NEW_IMAGE, returns the flat row (schema above) with `dt`, or `null` if the item is not a FLOW# edge (skip STATUS#/other). `export interface FlatFlowRow { ... dt: string }`. `export const handler` — a DynamoDB stream handler that maps `event.Records` (filter `eventName INSERT/MODIFY`, `dynamodb.NewImage` present) through `flattenFlowImage`, drops nulls, and `PutRecordBatch`es them to Firehose (stream name from env `FIREHOSE_STREAM`), each record = `JSON.stringify(row) + "\n"`.

- [ ] Step 1: Write failing test for `flattenFlowImage` — feed a marshalled NEW_IMAGE resembling `flowItem(edge, ttl)` (edge with a/b endpoints, traversedConstructs, targetPort) and assert every column maps (a_service_name, b_az, value as number, traversed_constructs is the JSON string, dt = bucket.slice(0,10)); a non-FLOW item (pk `STATUS#collect`) → `null`; missing optional endpoint fields → empty string not `undefined`.
- [ ] Step 2: Run — expect FAIL.
- [ ] Step 3: Implement `flattenFlowImage` (use `@aws-sdk/util-dynamodb` `unmarshall`; guard `pk?.startsWith('FLOW#')`; coerce numbers; default missing strings to `''`; `dt = String(bucket).slice(0,10)`). Implement `handler` (batch to Firehose via `@aws-sdk/client-firehose` `PutRecordBatchCommand`, chunk to ≤500 records/batch, log failures, never throw on partial — return so the stream checkpoints; on total failure throw to retry).
- [ ] Step 4: Run — expect PASS. `npm -w collector run build` produces BOTH `dist/handler.mjs` (existing) and `dist/archive-transform.mjs` (new esbuild entry).
- [ ] Step 5: Commit `feat(collector): flow-archive stream transform lambda (DDB NEW_IMAGE → flat JSON for Firehose)`.

*(Add `@aws-sdk/client-firehose` + `@aws-sdk/util-dynamodb` to collector deps; both are AWS SDK v3, no license concern.)*

---

## Task 3: Archive infrastructure (CDK — data-stack.ts)

**Files:** Modify `infra/lib/data-stack.ts`. Modify `infra/CLAUDE.md`, `docs/reference/iac.md`, `docs/reference/data.md`. Read `infra_digest.md` first for the exact table/collector construct lines.

**Steps (no unit test — CDK synth is the gate; each step verified by `npx cdk synth NfmDash-Data -c imageTag=unused`):**
- [ ] Add `stream: ddb.StreamViewType.NEW_IMAGE` to the existing `nfm-dashboard-flows` Table props.
- [ ] Create S3 archive bucket (`nfm-dashboard-flow-archive-<ACCOUNT_ID>`, versioned off, `removalPolicy RETAIN` — archive is the durable copy, block public access, SSE-S3) and Athena results bucket (`nfm-dashboard-athena-results-<ACCOUNT_ID>`, `removalPolicy DESTROY`, lifecycle expire results after 30 days).
- [ ] Glue `CfnDatabase` (`nfm_dashboard`) + `CfnTable` (`flows_archive`): columns per the schema table above; `PARQUET` (`parquet.hive.serde` / `ParquetHiveSerDe`, input `MapredParquetInputFormat`, output `MapredParquetOutputFormat`); `partitionKeys: [{name:'dt', type:'string'}]`; location `s3://<archive-bucket>/flows/`; TableInput.Parameters enable **partition projection**: `projection.enabled='true'`, `projection.dt.type='date'`, `projection.dt.format='yyyy-MM-dd'`, `projection.dt.range='2026-07-01,NOW'`, `projection.dt.interval='1'`, `projection.dt.interval.unit='DAYS'`, `storage.location.template='s3://<archive-bucket>/flows/dt=${dt}/'`. (Projection = no crawler, no ALTER TABLE ADD PARTITION.)
- [ ] Athena `CfnWorkGroup` (`nfm-dashboard`): `resultConfiguration.outputLocation = s3://<results-bucket>/athena/`, enforce workgroup config, bytes-scanned cutoff per query (e.g. 2 GB safety cap).
- [ ] Firehose `CfnDeliveryStream` (DirectPut): S3 destination = archive bucket, prefix `flows/dt=!{partitionKeyFromQuery:dt}/`, errorOutputPrefix `errors/!{firehose:error-output-type}/`, buffering (128 MB / 300 s), **DynamicPartitioningConfiguration enabled**, ProcessingConfiguration with a **MetadataExtraction** JQ processor (`{dt:.dt}`) OR rely on the Lambda-set `dt` via `partitionKeyFromQuery` (choose the JQ MetadataExtraction processor: `MetadataExtractionQuery = '{dt:.dt}'`, `JsonParsingEngine=JQ-1.6`), and **DataFormatConversionConfiguration** enabled: input `OpenXJsonSerDe`, output `ParquetSerDe`, schema = the Glue db/table (`SchemaConfiguration` → region/db `nfm_dashboard`/table `flows_archive`, roleArn). Firehose IAM role: read Glue schema, write archive bucket, invoke nothing else.
- [ ] Deploy the transform Lambda (`lambda.Function`, NODEJS_22_X/ARM_64, `code: Code.fromAsset('collector/dist')`, handler `archive-transform.handler`, env `FIREHOSE_STREAM`) + wire the stream: `flowTable.grantStreamRead(fn)` + `fn.addEventSource(new DynamoEventSource(flowTable, { startingPosition: TRIM_HORIZON, batchSize: 100, retryAttempts: 3, bisectBatchOnError: true }))` + grant `firehose:PutRecordBatch` on the delivery stream ARN.
- [ ] `npx cdk synth NfmDash-Data -c imageTag=unused` clean; `npx cdk diff NfmDash-Data -c imageTag=unused` shows only additive resources + the table StreamSpecification update.
- [ ] Commit `feat(infra): flow archive pipeline — DDB streams → firehose(parquet) → S3 + glue/athena catalog`.

---

## Task 4: `/api/history` route + app IAM + Athena client

**Files:** Create `app/src/lib/athena.ts` (client + query helper), `app/src/app/api/history/route.ts`. Modify `app/package.json` (add `@aws-sdk/client-athena`), `infra/lib/app-stack.ts` (task-role IAM + env vars), `app/src/app/api/CLAUDE.md`, `docs/reference/api.md`.

**Interfaces:**
- `app/src/lib/athena.ts`: lazy `??=` `AthenaClient` singleton (region pattern like `ddb.ts`). `export async function runHistoryQuery(opts: { from: string; to: string; monitor?: string; namespace?: string; limit?: number }): Promise<{ columns: string[]; rows: string[][]; scannedBytes: number }>` — builds a parameterized SQL over `nfm_dashboard.flows_archive` with `WHERE dt BETWEEN :from AND :to` (partition pruning) + optional filters, `LIMIT` (default 1000, cap 5000); StartQueryExecution (workgroup `nfm-dashboard`), poll GetQueryExecution until SUCCEEDED/FAILED (≤ ~25s, small sleeps), GetQueryResults → columns+rows. Env: `ATHENA_WORKGROUP`, `GLUE_DB`, `GLUE_TABLE`. SQL-inject-safe: `from`/`to` validated as `YYYY-MM-DD`, identifiers fixed, string filters escaped/validated.
- Route: `dynamic='force-dynamic'`; parse `?from=&to=&monitor=&namespace=&limit=`; validate dates; try/catch→500; return the athena result JSON.

- [ ] Step 1 (TDD the pure bits): test date validation + SQL builder (`buildHistorySql(opts)` returns expected SQL with dt BETWEEN + escaped filters; rejects bad dates) in `athena.test.ts` (extract `buildHistorySql` as a pure exported fn so it's testable without AWS).
- [ ] Step 2: FAIL → implement `buildHistorySql` + `runHistoryQuery` + route → PASS.
- [ ] Step 3: app-stack: `task.addToPrincipalPolicy(...)` for Athena/Glue/S3 (per Global Constraints least-privilege list, by fixed ARNs) + add env vars `ATHENA_WORKGROUP=nfm-dashboard`, `GLUE_DB=nfm_dashboard`, `GLUE_TABLE=flows_archive` to the task container. `npx -w app vitest run`, `tsc`, `build` green; `cdk synth NfmDash-App -c imageTag=unused` clean.
- [ ] Step 4: Commit `feat(app): /api/history athena-backed archive query + task-role IAM`.

---

## Task 5: History page + nav + i18n

**Files:** Create `app/src/app/history/page.tsx`. Modify `app/src/components/layout/nav.ts` (+ i18n), `ko.json`/`en.json`.

- [ ] `/history` page ('use client'): a date-range picker (two date inputs `from`/`to`, default last 7 days, ALLOWING arbitrary ranges incl. > 7d up to the archive's start), optional monitor/namespace filter, a "Run query" button (Athena is async + billed — query on demand, NOT on every keystroke), a results table (columns from the response) + a scanned-bytes/`n rows` caption, LensState loading/empty/error. testid `history-page`. Reuse `Widget`/`Toplist`/table chrome + tokens. Note in-page that History reads the S3 archive (up to ~2 years) vs the live 7-day hot path.
- [ ] nav: add `{ href:'/history', key:'nav.history', icon: <History or Archive lucide> }` to the **Analysis** group in `NAV_GROUPS` (nav.ts). i18n `nav.history` (ko "히스토리" / en "History") + page/picker/column labels + `nav.group.*` unaffected. i18n parity ko+en.
- [ ] `npx -w app vitest run`, `tsc`, `build` green. Headless (authless dev): `/history` renders picker + runs a query (against whatever the dev env can reach; if Athena unreachable locally, assert the page + picker render + error state is graceful). 
- [ ] Commit `feat(app): history page (athena archive, arbitrary date range) + nav`.

---

## Task 6: Finalize — review + deploy + end-to-end verify + v0.7.0

- [ ] Step 1: `npm -w collector run build` (both bundles) + `npm -w app run build` + full `vitest` + `tsc` green.
- [ ] Step 2: Final whole-branch adversarial review (strongest model) over `git merge-base main HEAD`..HEAD. Focus: transform-Lambda flatten correctness (all columns, null-skip, number coercion, dt), Firehose/Glue schema ↔ transform output column MATCH (a mismatch silently routes records to the Firehose error prefix — the #1 failure mode; verify column names/types line up exactly), partition projection range/template correctness, SQL-injection safety in `buildHistorySql` (date + identifier validation), least-privilege IAM (no wildcards beyond the fixed ARNs), 7d-range item-1 still intact, i18n parity, no regressed testids. Fix Critical/Important.
- [ ] Step 3: Version bump **0.7.0** (version.ts + package.json + CHANGELOG [0.7.0] EN+KR: Added = 7d range + flow archive pipeline + History page; + ref links). version.test passes.
- [ ] Step 4: Commit `chore(release): v0.7.0 — 7d query range + S3/Parquet flow archive + Athena history page`. Merge `--no-ff` to main.
- [ ] Step 5: Deploy (USER-AUTHORIZED — provisions billable infra). `npm -w collector run build`; `cd infra && npx cdk deploy NfmDash-Data -c imageTag=unused` (creates streams/S3/Glue/Athena/Firehose/transform-Lambda) THEN `bash scripts/build-push.sh <sha>` + `npx cdk deploy NfmDash-App -c imageTag=<sha>` (task-role IAM + env + new image). Verify both stacks UPDATE_COMPLETE.
- [ ] Step 6: End-to-end verify: (a) confirm the flows table now has a stream ARN + the transform Lambda has the event-source mapping (Enabled); (b) wait for one collector 5-min cycle (or invoke it) so writes flow through Streams→transform→Firehose; (c) after Firehose buffer flush (≤5 min), confirm Parquet objects under `s3://…flow-archive…/flows/dt=YYYY-MM-DD/` and NO objects under `errors/` (errors = schema mismatch — must debug); (d) run an Athena query via the workgroup (CLI: `aws athena start-query-execution` `SELECT count(*) FROM nfm_dashboard.flows_archive WHERE dt='<today>'`) → returns rows; (e) prod smoke `smoke.sh` 3/3; (f) authenticated headless: `/history` renders, a date-range query returns rows (or a clean empty state if the archive is still filling). Report the archive object count + Athena row count.

---

## Phase 13-② self-review checklist
- [ ] Transform Lambda flatten: every FlowEdge field → a column; null-skip non-FLOW; dt from bucket; TDD.
- [ ] Firehose Parquet schema columns/types EXACTLY match the transform output + Glue table (no error-prefix routing).
- [ ] Partition projection (no crawler); dynamic partitioning by dt; buffering sane.
- [ ] `/api/history` SQL partition-pruned + injection-safe; least-privilege app IAM by fixed ARN.
- [ ] History page: on-demand query (billed), arbitrary >7d range, graceful empty/error; nav+i18n ko/en.
- [ ] Archive infra co-located in NfmDash-Data; app perms/env in NfmDash-App; fixed resource names (no cross-stack export).
- [ ] v0.7.0 synced; deploy both stacks (authorized); end-to-end Parquet+Athena+History verified; docs (iac/data/api + CLAUDE.md) updated.
