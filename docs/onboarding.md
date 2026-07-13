# Developer Onboarding

## Quick Start

### 1. Prerequisites

- [ ] Node.js 20+ installed (the `infra` workspace warns for node < 22 during build; Node 22 recommended)
- [ ] npm (workspaces-aware, ships with Node 20+)
- [ ] Docker with `linux/arm64` build support (the app image is arm64 for ECS Fargate Graviton)
- [ ] AWS CLI v2 configured with credentials for account `<ACCOUNT_ID>` (region `ap-northeast-2`)
- [ ] Python 3.11+ (only for `tools/` MCP Lambda dev and `scripts/setup-gateway.sh` which runs `tools/create_gateway.py` via boto3)
- [ ] Repository access granted

### 2. Setup

```bash
# Clone and install all workspaces (infra, app, collector) from the repo root
cd nfm-dashboard
npm install

# Build the collector Lambda bundle (required BEFORE any cdk deploy of NfmDash-Data:
# data-stack.ts fails synth if collector/dist/handler.mjs is missing)
npm -w collector run build

# Run the test suites
npm test                 # collector unit tests (vitest)
npm -w app run test      # app unit tests (vitest)
npm -w infra run test    # infra tests
```

#### Full stack deployment (first time)

All `cdk` commands require `-c imageTag=<tag>` because `NfmDash-App` validates the tag at synth time. Capture one tag up front and reuse it for every step:

```bash
TAG=$(git rev-parse --short HEAD)

# 0. One-time secret: Cognito initial-admin credentials (Secrets Manager
#    nfm-dashboard/cognito-admin — read inside a Lambda, never in the template)
bash scripts/save-cognito-secret.sh

# 1. Data plane: DynamoDB tables + collector Lambda + 5-min EventBridge schedule
npx -w infra cdk deploy NfmDash-Data -c imageTag=$TAG --require-approval never

# 2. NFM onboarding: scope, monitors, EKS add-ons, EC2 agent install (SSM)
npx -w infra cdk deploy NfmDash-Onboarding -c imageTag=$TAG --require-approval never

# 3. AgentCore: 3 MCP tool Lambdas + gateway role, then create the nfm-gateway
#    (Gateway is not CloudFormation-supported — the script creates it with boto3
#    and writes the MCP URL to SSM SecureString /nfm-dashboard/gateway-url)
npx -w infra cdk deploy NfmDash-AgentCore -c imageTag=$TAG --require-approval never
bash scripts/setup-gateway.sh

# 4. App image (arm64) → ECR, then the App stack (ECS/ALB/CloudFront/Cognito)
bash scripts/build-push.sh "$TAG"
npx -w infra cdk deploy NfmDash-App -c imageTag=$TAG --require-approval never

# 5. Operational alarms (SNS topic nfm-dashboard-alarms; subscribe out-of-band)
npx -w infra cdk deploy NfmDash-Ops -c imageTag=$TAG --require-approval never

# 6. DNS observability: Route53 Resolver query logging + CoreDNS log enablement
npx -w infra cdk deploy NfmDash-Dns -c imageTag=$TAG --require-approval never
```

Redeploying only the data plane has a shortcut (uses a placeholder tag):

```bash
npm run deploy:data   # = collector build + cdk deploy NfmDash-Data -c imageTag=unused
```

#### Local development

```bash
# Run the Next.js dashboard locally without Cognito. In production the same
# flag is honored only when set deliberately via the `authDisabled` CDK context
# (ADR-005). AWS creds are still required for DynamoDB/CloudWatch/Bedrock reads.
AUTH_DISABLED=1 npm -w app run dev
# → http://localhost:3000
```

### 3. Verify

```bash
# Health endpoint (local)
curl -s http://localhost:3000/api/health          # → {"ok":true}

# Deployed dashboard
open https://dv4r4bnlhlpcx.cloudfront.net          # Cognito login required

# Collector ran recently? (STATUS#collect/latest in the meta table)
aws dynamodb get-item --table-name nfm-dashboard-meta \
  --key '{"pk":{"S":"STATUS#collect"},"sk":{"S":"latest"}}' --region ap-northeast-2

# Smoke test script
bash scripts/smoke.sh
```

## Project Overview

npm workspaces monorepo (`infra`, `app`, `collector`) plus Python directories (`tools`, `onboarding`).

- `app/` — Next.js 16 full-stack dashboard (App Router). API route handlers under `app/src/app/api/*` read DynamoDB/CloudWatch and run in-app analytics lenses; `/api/ai` and `/api/diagnose` stream Bedrock ConverseStream responses over SSE.
- `collector/` — NFM collector Lambda (TypeScript, esbuild bundle → `dist/handler.mjs`). Runs every 5 minutes: NFM top-contributor queries, Workload Insights, CloudWatch metrics, DNS log aggregation → DynamoDB.
- `infra/` — AWS CDK (TypeScript), 6 stacks: `NfmDash-Data`, `NfmDash-Onboarding`, `NfmDash-AgentCore`, `NfmDash-App`, `NfmDash-Ops`, `NfmDash-Dns`.
- `tools/` — Python MCP tool Lambdas (network / nfm / ddb) exposed via the Bedrock AgentCore gateway `nfm-gateway`, plus `create_gateway.py`.
- `onboarding/` — Python Lambdas for NFM onboarding and CoreDNS `log` plugin enablement (CDK custom resources).

Read next:

- `CLAUDE.md` for project context and conventions
- `docs/architecture.md` for system design and data flow
- `docs/api-reference.md` for the HTTP API surface
- `docs/decisions/` for architectural decisions (ADRs)
- `docs/runbooks/` for operational procedures

## Development Workflow

- Branch naming: `feat/`, `fix/`, `docs/`, `refactor/`
- Commit convention: Conventional Commits
- Redeploy after app changes: `TAG=$(git rev-parse --short HEAD)` → `bash scripts/build-push.sh "$TAG"` → `npx -w infra cdk deploy NfmDash-App -c imageTag=$TAG`. Image tags are immutable (per-commit SHA), so a task restart can never silently pull a different image.
- Tests first: collector and app logic are vitest-covered; add tests alongside `*.ts` sources (`*.test.ts`).

## Key Concepts

- **NFM (CloudWatch Network Flow Monitor)**: AWS-managed agents on EKS nodes / EC2 publish flow telemetry; the collector queries `MonitorTopContributors` (flows) and `WorkloadInsightsTopContributors` (11 destination categories).
- **Single-table DynamoDB**: `nfm-dashboard-flows` (5-min bucketed flow edges, TTL, 3 GSIs for pod/edge time series) and `nfm-dashboard-meta` (topology snapshot, collection status, coverage, `WI#latest`, `DNS#latest`).
- **Analytics lenses**: cost / reliability / latency / dependencies / dns are computed in the app from a recent flows window — no pre-aggregation pipeline.
- **AgentCore gateway (`nfm-gateway`)**: MCP endpoint (AWS_IAM/SigV4) fronting 3 tool Lambdas; the app discovers its URL from SSM SecureString `/nfm-dashboard/gateway-url`.
- **imageTag context**: every `cdk` invocation needs `-c imageTag=...` (placeholder `unused` when not touching `NfmDash-App`).

## Troubleshooting

- `collector/dist/handler.mjs missing` at synth → run `npm -w collector run build` first.
- `Missing CDK context 'imageTag'` → pass `-c imageTag=$(git rev-parse --short HEAD)` (or `unused` for non-App stacks).
- ECR push rejected for an existing tag → the repo is tag-IMMUTABLE by design; a new commit = a new tag.
- AI chat answers without tools → check SSM `/nfm-dashboard/gateway-url` and the gateway (`/api/ai` degrades to a tool-less answer on gateway/SSM failure instead of erroring).
- Empty dashboard right after deploy → the collector needs a few 5-minute cycles; trigger one manually with `POST /api/nfm/refresh` or `aws lambda invoke --function-name nfm-dashboard-collector /dev/null`.

## Resources

- `README.md` — bilingual overview, deployment guide, environment variable table
- `docs/architecture.md` — layers, ASCII diagram, CDK stack table, design decisions
- Live URL: https://dv4r4bnlhlpcx.cloudfront.net (account `<ACCOUNT_ID>`, `ap-northeast-2`)
