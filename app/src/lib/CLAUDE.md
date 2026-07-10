# app/src/lib — Data & Domain Library

## Role
Server-side data access (DynamoDB, CloudWatch, SSM), Bedrock/MCP clients, auth helpers, plus shared client-safe utilities (i18n, chart tokens, formatting, SSE hooks). Route handlers and pages stay thin — logic lives here.

## Data Model
- `nfm-dashboard-flows` / `nfm-dashboard-meta` DynamoDB tables (env: `TABLE_FLOWS` / `TABLE_META`), written by the collector, read via `ddb.ts`.
- Meta table holds e.g. `pk: 'TOPO#latest', sk: 'snapshot'` topology snapshots; flow items are keyed by 5-minute grid buckets.
- `recentBuckets(n)` in `ddb.ts` generates bucket keys — the formula MUST match the collector (`Math.floor(t/300000)*300000`).

## Key Files
- `ddb.ts` — DynamoDB read path; `cw-metrics.ts` — CloudWatch metrics; `ssm.ts` — cached SSM params (e.g. `/nfm-dashboard/gateway-url`)
- `bedrock.ts` — BedrockRuntimeClient singleton, `MODEL_ID` + `FALLBACK_MODEL_ID`, Converse/ConverseStream helpers
- `mcp-client.ts` — SigV4-signed MCP (JSON-RPC over streamable HTTP) client for the AgentCore gateway
- `auth.ts` — Cognito ID-token verification, session cookie, `safeEqual`
- `i18n/` — `LanguageContext.tsx` + `translations/{ko,en}.json` (`t()`)
- `chart-tokens.ts` — SnowUI palette (mirrors `app/tailwind.config.ts` — keep in sync)
- `analytics/` — latency/reliability/cost/dns/dependency aggregation
- Domain/view logic: `topology.ts`, `topology-graph.ts`, `flow-aggregates.ts`, `overview-metrics.ts`, `workload.ts`, `monitors.ts`, `recent-paths.ts`, `diagnose-context.ts`, `followups.ts`
- Client utilities: `sse.ts`, `use-sse.ts`, `use-polling.ts`, `hooks/useAnalyticsFilters.ts`, `format.ts`, `types.ts`

## Rules
- AWS SDK imports here are server-only; client components may only import client-safe modules (tokens, format, i18n, hooks).
- Never fork the bucket formula; change it in lockstep with `collector/src`.
- Tests co-located (`*.test.ts`); run with `npx -w app vitest run`.
