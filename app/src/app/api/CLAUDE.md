# app/src/app/api — API Module

## Role
Next.js route handlers — the dashboard's entire API surface. All routes are protected by `app/src/middleware.ts` (Cognito session cookie + CloudFront origin-verify) except `/api/health` and `/api/auth/*`.

## Endpoints
- `ai/route.ts` — AI chat: SSE stream, Bedrock Converse loop with AgentCore MCP tools (`maxDuration = 300`)
- `auth/{login,callback,logout}/route.ts` — Cognito Hosted UI + PKCE session flow
- `flows`, `topology`, `paths`, `workload`, `overview` — DynamoDB-backed dashboard data (via `app/src/lib/ddb.ts`)
- `analytics/{latency,reliability,cost,dns,dependencies}` — aggregations (via `app/src/lib/analytics/*`)
- `monitors/route.ts`, `monitors/[name]/route.ts` — NFM monitor list/detail (CloudWatch)
- `insights`, `diagnose`, `agents` — workload insights, diagnose context, agent/coverage status
- `nfm/refresh/route.ts` — manual collection refresh trigger
- `health/route.ts` — unauthenticated ALB healthcheck

## Rules
- Handlers stay thin: parse/validate input, call `app/src/lib/*`, shape the response. No business logic in routes.
- Streaming responses use `app/src/lib/sse.ts` helpers (`sseEvent`); send keepalives on long streams (see `ai/route.ts`).
- New endpoint => update this file and `docs/reference/api.md`; UI-facing strings still go through i18n on the client side.
- Tests for route logic live next to the extracted lib code in `app/src/lib` (keep routes trivially thin).
