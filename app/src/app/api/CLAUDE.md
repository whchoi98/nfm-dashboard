# app/src/app/api — API Module

## Role
Next.js route handlers — the dashboard's entire API surface. All routes are protected by `app/src/middleware.ts` (Cognito session cookie + CloudFront origin-verify) except `/api/health` and `/api/auth/*`.

## Endpoints
- `ai/route.ts` — AI chat: SSE stream, Bedrock Converse loop with AgentCore MCP tools (`maxDuration = 300`)
- `auth/{login,callback,logout}/route.ts` — Cognito Hosted UI + PKCE session flow
- `flows`, `topology`, `paths`, `workload` — DynamoDB-backed dashboard data (via `app/src/lib/ddb.ts`)
- `overview/route.ts` — landing payload: fleet KPIs (CloudWatch) + an additive `summary` block composing the scorecard/efficiency/concentration/dns lenses over ONE shared flows window
- `analytics/{latency,reliability,cost,dns,dependencies,efficiency,movers,scorecard}` — flow-lens aggregations (via `app/src/lib/analytics/*`)
- `cost-explorer`, `network`, `anomalies` — cost-explorer / network-analytics (source→dest) / anomaly-detection lenses over the flows window
- `alerts/route.ts` — derived alert-event feed (CW alarms + reliability breaches + collector failures + window-over-window spikes)
- `reports/route.ts` — `ReportData` for the /reports export page (KPIs + top talkers + breaches + anomalies from one shared window)
- `search/route.ts` — unified entity search across topology / recent flows / monitors / DNS
- `monitors/route.ts`, `monitors/[name]/route.ts` — NFM monitor list/detail (CloudWatch)
- `insights`, `diagnose`, `agents` — workload insights, diagnose context, agent/coverage status
- `nfm/refresh/route.ts` — manual collection refresh trigger
- `health/route.ts` — unauthenticated ALB healthcheck
- `history/route.ts` — Athena-backed query over the S3/Parquet flow archive (`nfm_dashboard.flows_archive`) via `app/src/lib/athena.ts`; `?from=&to=&monitor=&namespace=&metric=&limit=`, defaults to the last 7 days

## Rules
- Handlers stay thin: parse/validate input, call `app/src/lib/*`, shape the response. No business logic in routes.
- Streaming responses use `app/src/lib/sse.ts` helpers (`sseEvent`); send keepalives on long streams (see `ai/route.ts`).
- New endpoint => update this file and `docs/reference/api.md`; UI-facing strings still go through i18n on the client side.
- Tests for route logic live next to the extracted lib code in `app/src/lib` (keep routes trivially thin).
