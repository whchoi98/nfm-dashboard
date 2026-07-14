# app/src/lib — Data & Domain Library

## Role
Server-side data access (DynamoDB, CloudWatch, SSM), Bedrock/MCP clients, auth helpers, plus shared client-safe utilities (i18n, chart tokens, formatting, SSE hooks). Route handlers and pages stay thin — logic lives here.

## Data Model
- `nfm-dashboard-flows` / `nfm-dashboard-meta` DynamoDB tables (env: `TABLE_FLOWS` / `TABLE_META`), written by the collector, read via `ddb.ts`.
- Meta table holds e.g. `pk: 'TOPO#latest', sk: 'snapshot'` topology snapshots; flow items are keyed by 5-minute grid buckets.
- `recentBuckets(n)` in `ddb.ts` generates bucket keys — the formula MUST match the collector (`Math.floor(t/300000)*300000`).
- Storage tiering (deliberate): DynamoDB is the HOT operational store (bursty writes, key-based recent-window reads, 7-day TTL, serverless); the S3+Parquet+Athena archive (`athena.ts`) is the COLD long-term analytics tier, queried for >7-day / arbitrary-range history after the TTL deletes the DynamoDB rows.

## Key Files
- `ddb.ts` — DynamoDB read path (hot store; bounded-concurrency pool `K=40` for the per-bucket flow-query fan-out — `getFlowsWindowPair` shares ONE pool across both halves; 512-socket keep-alive agent `ddbSocketAgent`; `getFlowsWindow`/`getFlowsWindowPair`/`cachedLens` share a VERSIONED cache with in-flight dedup — valid while (collector cycleTs unchanged [STATUS#collect probe, ~15s memo] AND 5-min bucket boundary unrolled), swept on access + unref'd max-age timer, 200-entry cap. `cachedLens(lensCacheKey(route, req.url), compute)` caches computed lens JSON for PURE flow-lens routes ONLY (cost/dependencies/efficiency/latency/movers/anomalies/network/cost-explorer) — never wrap CW-alarm/metric or user-specific data. See the 2026-07-14 OOM incident notes in `cachedFetch`); `cw-metrics.ts` — CloudWatch metrics + `healthByMonitor`; `cw-alarms.ts` — CloudWatch alarm states; `ssm.ts` — cached SSM params (e.g. `/nfm-dashboard/gateway-url`)
- `athena.ts` — Athena archive query client over the S3/Parquet flow archive (`nfm_dashboard.flows_archive`): `buildHistorySql` (injection-guarded via date + allowlist regex) + `runHistoryQuery`; backs `/api/history`
- `bedrock.ts` — BedrockRuntimeClient singleton, `MODEL_ID` + `FALLBACK_MODEL_ID`, Converse/ConverseStream helpers
- `mcp-client.ts` — SigV4-signed MCP (JSON-RPC over streamable HTTP) client for the AgentCore gateway
- `auth.ts` — Cognito ID-token verification, session cookie, `safeEqual`
- `i18n/` — `LanguageContext.tsx` + `translations/{ko,en}.json` (`t()`)
- `chart-tokens.ts` — SnowUI palette (mirrors `app/tailwind.config.ts` — keep in sync)
- `analytics/` — flow lenses (pure, no I/O): `latency`, `reliability`, `cost`, `cost-explorer`, `dns-insights`, `dependencies`, `edge-health`, `efficiency`, `scorecard`, `movers`, `anomalies`, `network-analytics`, `port-mix` (G1 — `portLabel`/`PORT_LABELS` for the network matrix `port` dest-scope), `composite-conditions` (G5 — entities breaching >=2 signals at once: high retrans rate via `ratePer`/`RETRANS_RATE_DANGER` AND a window-over-window volume drop via `moversLens(...).dataTransferred`/`VOLUME_DROP_PCT`; consumed by `/api/alerts`, a dashboard signal not a CW alarm); shared `aggregate` + `filters` (`TimeRange` incl. `7d`, `parseLensParams`/`applyFlowFilters`)
- Domain/view logic: `topology.ts`, `topology-graph.ts` (`buildGraphModel` + `applyGrouping` namespace/AZ/cluster + `crossAz`/min-edge thresholds), `graph-focus.ts` (pure ego-network `neighbors()` — 1/2-hop induced subgraph for click-to-isolate), `graph-layout.ts` (deterministic force-layout seed: `seedPosition` id-hash + `graphSignature`), `flow-aggregates.ts`, `overview-metrics.ts`, `workload.ts`, `monitors.ts`, `recent-paths.ts`, `diagnose-context.ts`, `followups.ts`, `alerts.ts`, `report.ts`, `search.ts`
- Client/util: `sse.ts`, `use-sse.ts`, `use-polling.ts`, `use-sortable.ts` (shared click-to-sort primitive — `useSortableRows` + `compareBy`, type-aware string/number/boolean, paired with `components/SortableHeader.tsx`), `hooks/useAnalyticsFilters.ts`, `format.ts`, `csv.ts`, `settings.ts`, `ua.ts`, `cloudwatch-url.ts`, `types.ts`, `version.ts`

## Rules
- AWS SDK imports here are server-only; client components may only import client-safe modules (tokens, format, i18n, hooks).
- Never fork the bucket formula; change it in lockstep with `collector/src`.
- Tests co-located (`*.test.ts`); run with `npx -w app vitest run`.
