# API Reference

Next.js route handlers under `app/src/app/api/*`. All handlers are `dynamic = 'force-dynamic'` (never statically cached); CloudFront additionally pins `/api/*` to `CACHING_DISABLED`.

## Base URL

- Production: `https://dv4r4bnlhlpcx.cloudfront.net/api`
- Local dev: `http://localhost:3000/api` (`AUTH_DISABLED=1 npm -w app run dev`)

## Authentication

Cognito Hosted UI (authorization code + PKCE, public client). The Next.js middleware verifies the `nfm_session` id-token cookie on every request and the `X-Origin-Verify` header injected by CloudFront. Browser flows use `/api/auth/login` → Cognito → `/api/auth/callback`. `/api/health` is unauthenticated (ALB health check).

## Endpoints

### Dashboard data (DynamoDB / CloudWatch reads)

| Method | Path | Purpose | Key response shape |
|--------|------|---------|--------------------|
| GET | `/api/overview` | Landing-page payload: fleet KPIs (value, half-window deltaPct, sparkline) from CloudWatch NFM metrics, top cost talkers and reliability breach count from one shared flows window | `{ kpis, rttP50, rttP95, nhi, topTalkers[], breachCount, series, status, coverage }` |
| GET | `/api/flows` | Flow edges for a 5-min bucket, or a pod's flows. Query: `bucket`, `monitor`, `ns`+`pod` (must be paired, else 400), `limit` (1–1000, default 200) | `{ flows: FlowEdge[] }` |
| GET | `/api/paths` | Time series for one edge. Query: `edge` (required, else 400); returns up to 288 bucket#metric items (~6h of 5-min buckets, newest first) | `{ series[], latest }` |
| GET | `/api/topology` | Latest topology snapshot | `{ generatedAt, nodes[], edges[] }` |
| GET | `/api/insights` | Workload Insights totals per destination category (11 categories); falls back to aggregating the topology snapshot when `WI#latest` is absent | `{ byCategory: Record<DestCategory, {dataTransferred, retransmissions, timeouts}>, rows[] }` |
| GET | `/api/workload` | Latest Workload Insights top-contributors snapshot (`WI#latest/all`) | `{ rows[], cycleTs }` |
| GET | `/api/monitors` | NFM monitor list built from CloudWatch metrics, sorted by traffic desc | `{ monitors: MonitorListItem[] }` |
| GET | `/api/monitors/[name]` | Detail for one monitor (404 when the name has no metrics) | `MonitorDetail` |
| GET | `/api/agents` | Agent/onboarding coverage, collection status and history | `{ coverage, status, history }` |
| POST | `/api/nfm/refresh` | Manually invoke the collector Lambda (`InvocationType: Event`, fire-and-forget) | `{ triggered: true }` |
| GET | `/api/health` | Liveness probe (unauthenticated; ALB target health check) | `{ ok: true }` |

### Analytics lenses (computed in-app over a flows window)

Lens routes accept `range` (`15m` \| `1h` \| `3h` \| `24h` → bucket count), `namespace` and `category` filters, parsed by `parseLensParams`.

| Method | Path | Purpose | Key response shape |
|--------|------|---------|--------------------|
| GET | `/api/analytics/cost` | Cross-AZ/inter-region transfer cost estimate ($0.01/GB heuristic) | `{ totalUsd, byCategory, top[], series[], regionArcs[], stream[] }` (`CostLensResult`) |
| GET | `/api/analytics/reliability` | Retransmission/timeout hotspots + CloudWatch HealthIndicator lanes (CW failure degrades to flows-only, never 500) | `{ hotspots[], breaches[], nhi, nhiSwimlanes[], scatter[] }` (`ReliabilityLensResult`) |
| GET | `/api/analytics/latency` | RTT percentiles, intra vs inter AZ, slowest paths, trend, distribution, hour heatmap | `{ overall, intra, inter, slowest[], trend, distribution[], hourHeatmap[] }` (`LatencyLensResult`) |
| GET | `/api/analytics/dependencies` | Service dependency sankey, ports, namespaces, categories, hop counts, path tree | `{ sankey, sankeyTruncated, ports[], namespaces[], categories[], hops[], pathTree, pathTreeTruncated }` |
| GET | `/api/analytics/dns` | Latest DNS aggregate (`DNS#latest`) from CoreDNS + Route53 Resolver logs; empty-but-valid shape when absent | `{ enabled, topDomains[], failures[], latency{p50,p90,p95,max,count}, queryTypes[], resolution{nodes,links}, nameFlow[] }` |

### AI (Bedrock, SSE streaming)

Both routes return `text/event-stream` (`maxDuration = 300`) with events: `status` (stages incl. `keepalive` every 15s, `tool:<name>`, `fallback`), `chunk` (`{delta}`), `followups` (`{questions[]}`), `done` (`{content, elapsedMs, model, ...}`), `error` (`{message}`). `lang` resolves body field → `Accept-Language` → `ko`.

| Method | Path | Purpose | Request body |
|--------|------|---------|--------------|
| POST | `/api/ai` | AI chatbot: Bedrock ConverseStream agent loop (max 8 turns) with MCP tools from the AgentCore gateway (SigV4); gateway/SSM failure degrades to a tool-less answer. `done` also carries `usedTools[]` (deduplicated) | `{ messages: {role:'user'\|'assistant', content}[], lang?: 'ko'\|'en' }` (400 on invalid JSON / empty messages) |
| POST | `/api/diagnose` | One-shot LLM network diagnosis: topology + collection status + top anomaly edges injected as context into ConverseStream | `{ focus?: string, lang?: 'ko'\|'en', regenerate?: boolean }` |

### Auth (Cognito Hosted UI, PKCE)

| Method | Path | Purpose | Response |
|--------|------|---------|----------|
| GET | `/api/auth/login` | Start login: generates PKCE verifier, CSRF state and OIDC nonce, sets HttpOnly transient cookies, redirects to Cognito authorize URL | `302` → Cognito |
| GET | `/api/auth/callback` | Exchange `code` for tokens (public client, PKCE `code_verifier`), validate state/nonce, verify `id_token`, set session cookie; any failure redirects to `/login?error=1`. Transient cookies cleared either way | `302` → `/` or `/login?error=1` |
| GET | `/api/auth/logout` | Clear the session cookie and redirect to the Cognito logout URL | `302` → Cognito logout |

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request — invalid JSON body, missing/unpaired query params (`edge`, `ns`+`pod`, `messages[]`) |
| 404 | Not Found — `/api/monitors/[name]` with no matching metrics |
| 500 | Internal error — logged server-side as `[api/<route>]`; body is always `{ "error": "internal error" }` |

SSE routes never return HTTP 5xx after the stream starts; failures are emitted as an `error` event on the stream.

## Rate Limits

No application-level rate limiting. Upstream constraints: Bedrock ConverseStream account quotas, NFM query concurrency (collector-side), CloudFront/ALB defaults. `POST /api/nfm/refresh` triggers a full collector cycle — avoid tight polling.
