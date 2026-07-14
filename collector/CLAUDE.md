# collector — NFM Data Collector Lambda

## Role
Scheduled Lambda (5-minute cycle) that queries CloudWatch Network Flow Monitor (query matrix + workload insights), discovers onboarding coverage (EC2/IAM), collects CoreDNS data, and writes flow edges / topology snapshots / cycle metadata to DynamoDB (`nfm-dashboard-flows`, `nfm-dashboard-meta`). Deployed by the `NfmDash-Data` stack.

## Key Files
- `src/handler.ts` — Lambda entry: computes the 5-min bucket, orchestrates one collection cycle
- `src/nfm-query.ts` — NFM `runQueryMatrix` (top-contributors queries per metric)
- `src/wi-query.ts` — workload insights collection
- `src/dns-collect.ts` / `src/dns-parse.ts` / `src/dns.ts` — CoreDNS log collection and parsing; `dns.ts` `aggregateDns` also computes per-source DNS stats (`bySource`: CoreDNS vs Route53 Resolver — p50/p95 latency, fail rate, `latencySampleCount`) for the G3 resolver-comparison panel (resolver has no per-query latency, so its `latencySampleCount` is 0 and the UI renders "no data")
- `src/storage.ts` — `writeCycle` / `buildTopology`: DynamoDB write path
- `src/categories.ts` — destination-category classification per cycle
- `src/onboard.ts` — onboarding coverage discovery (EC2/IAM)
- `src/types.ts` — shared types (keep aligned with `app/src/lib/types.ts`)
- `src/archive-transform.ts` — DynamoDB Streams (`nfm-dashboard-flows` NEW_IMAGE) → flat JSON → Firehose `PutRecordBatch` (Phase 13 flow archive; `flattenFlowImage` is pure, `handler` is the stream Lambda entry)

## Rules
- Build: `npm -w collector run build` (esbuild → `dist/handler.mjs` AND `dist/archive-transform.mjs`, two entrypoints in one script). ALWAYS build before deploying `NfmDash-Data` (root script `npm run deploy:data` does both).
- Test: `npm -w collector run test` (vitest, co-located `*.test.ts`).
- The 5-minute bucket formula `new Date(Math.floor(t/300000)*300000).toISOString().replace(/\.\d+Z/,'Z')` MUST stay identical to `recentBuckets()` in `app/src/lib/ddb.ts`.
- Monitor→cluster mapping comes from the `MONITORS` env var (`name=cluster,...`); table names from `TABLE_FLOWS` / `TABLE_META` env vars.
