# NFM Dashboard

[![License](https://img.shields.io/badge/License-Proprietary-lightgrey.svg)]()
[![Version](https://img.shields.io/badge/Version-1.0.0-green.svg)]()
<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

An AWS-native network observability dashboard with an AI chatbot and LLM diagnosis, built on CloudWatch Network Flow Monitor | AWS CloudWatch Network Flow Monitor(NFM) 기반 네트워크 관측 대시보드 + AI 챗봇/진단

---

<a id="english"></a>

# English

## Overview

NFM Dashboard is an AWS-native network observability dashboard built on CloudWatch Network Flow Monitor. It onboards NFM across the whole account/region (4 EKS clusters + standalone EC2), collects flow data every 5 minutes, and identifies EKS Pod-to-Pod communication in detail, including the traversed network path. It also ships an AI chatbot and LLM diagnosis powered by Bedrock and 27 MCP tools behind an AgentCore Gateway.

- Account & Region: `<ACCOUNT_ID>` / `ap-northeast-2`
- Live URL: https://dv4r4bnlhlpcx.cloudfront.net (Cognito login required — initial admin `admin@whchoi.net`)
- LLM: `global.anthropic.claude-sonnet-5` (Bedrock cross-region global inference profile, fallback: `global.anthropic.claude-sonnet-4-5-20250929-v1:0`)

### Architecture

```text
User (desktop / iPhone)
   │ HTTPS
   ▼
CloudFront (E2H1U7CDVRIL9Q, *.cloudfront.net)
   │  X-Origin-Verify custom header (validated in Next.js middleware)
   │  ALB SG ingress allows only the CloudFront origin-facing prefix list pl-22a6434b
   ▼
ALB (internet-facing, public subnets)
   ▼ :3000 (app SG accepts ingress only from the ALB SG)
ECS Fargate (arm64, private subnets, cc-on-bedrock-vpc vpc-0dfa5610180dfa628)
 └─ Next.js 16 full stack (7 UI pages + FloatingChat + i18n ko/en, Cognito JWT verification)
     ├─ /api/overview /flows /topology /paths /insights /agents   ← DynamoDB · CloudWatch reads
     ├─ /api/ai        ← agent loop: Bedrock ConverseStream + nfm-gateway (MCP, SigV4) [SSE]
     ├─ /api/diagnose  ← DDB context injection + ConverseStream diagnosis / regenerate [SSE]
     └─ /api/nfm/refresh ← manual Collector Lambda invoke

EventBridge Scheduler (5 min) ─▶ Collector Lambda (Node 22, arm64)
   ─▶ async NFM queries (StartQuery → poll → GetQueryResults, concurrency 5 + backoff)
   ─▶ normalization (edgeHash) · topology snapshot ─▶ DynamoDB
        ├─ nfm-dashboard-flows  (TTL 7 days, GSI: pod / edge time series)
        └─ nfm-dashboard-meta   (topology snapshots, collection status, coverage)
   └─ auto-onboarding of new standalone EC2 (tagging + policy attach)

AgentCore Gateway `nfm-gateway` (MCP, AWS_IAM/SigV4 — 27 tools)
 ├─ network-mcp-target → Lambda nfm-dashboard-mcp-network (16 VPC/TGW/firewall/reachability tools)
 ├─ nfm-mcp-target     → Lambda nfm-dashboard-mcp-nfm (5 NFM API query tools)
 └─ ddb-mcp-target     → Lambda nfm-dashboard-mcp-ddb (6 stored-data query tools)

NFM onboarding (NfmDash-Onboarding):
  Scope ×1 (Workload Insights) · 5 monitors (nfm-eks-<cluster> ×4 + nfm-vpc-all)
  EKS add-on aws-network-flow-monitoring-agent ×4 (Pod Identity)
  SSM Distributor + State Manager Association → agent install on standalone EC2
```

## Features

- **Account-wide NFM onboarding** — Provisions 1 Scope (Workload Insights), 5 monitors (4 EKS clusters + all-VPC), the EKS add-on `aws-network-flow-monitoring-agent` ×4 (Pod Identity), and SSM Distributor/State Manager agent install on standalone EC2, with auto-onboarding of newly launched EC2 instances.
- **5-minute collection pipeline** — EventBridge Scheduler invokes the Collector Lambda (Node 22, arm64), which runs async NFM queries (concurrency 5 + exponential backoff), normalizes flows (edgeHash), snapshots topology, and stores results in DynamoDB with a 7-day TTL.
- **Pod-to-Pod observability UI** — 7 pages: overview KPIs + Network Health Indicator, force-directed topology graph with filters and edge-to-path panel, flow tables/cards, pod-pair paths (pod → node → subnet → AZ → VPC with traversedConstructs and SNAT/DNAT), Workload Insights, diagnosis, and agent coverage.
- **AI chatbot with 27 MCP tools** — Agent loop over Bedrock ConverseStream calling the `nfm-gateway` AgentCore Gateway (MCP, SigV4) with token-level SSE streaming, available as a floating chat or a standalone popup window.
- **LLM diagnosis** — Streams a diagnosis built from the latest topology plus anomalous flows (top retransmissions/timeouts) as injected context, with a Regenerate button.
- **Bilingual, themed, responsive** — ko/en i18n (including SSE status messages), light/dark themes with SnowUI design tokens, and iPhone (Safari) responsive layout.

## Prerequisites

- AWS account (`<ACCOUNT_ID>`) administrator credentials, region `ap-northeast-2`
- CDK bootstrap completed (`cdk bootstrap aws://<ACCOUNT_ID>/ap-northeast-2`, qualifier `hnb659fds`)
- Node.js 22 (`.nvmrc`), npm workspaces
- Python 3.13 (Lambda runtime — local pytest works on 3.9+), `boto3`, `pytest`
- Docker — **arm64 image builds** (arm64 build host or buildx emulation)
- AWS CLI v2 (Secrets Manager / SNS / CloudFormation lookups)
- Existing infrastructure assumptions: `cc-on-bedrock-vpc` (`vpc-0dfa5610180dfa628`, reuses NAT GW/VPC endpoints), 4 EKS clusters, Bedrock `global.anthropic.claude-sonnet-5` access, AgentCore available in ap-northeast-2

## Installation

```bash
# Clone the repository
git clone https://github.com/whchoi98/nfm-dashboard.git
cd nfm-dashboard

# Install every workspace from the repo root
npm ci

# Install Python dev dependencies (for tests / gateway scripts)
cd tools && pip install -r requirements-dev.txt
```

### Deployment Guide

> **Note**: `NfmDash-App` pins the ECR image tag at synth time, so **every `cdk` command requires `-c imageTag=<tag>`** (stacks other than App do not consume the value, so any placeholder works before an image exists). The steps below use `TAG=$(git rev-parse --short HEAD)`.

```bash
TAG=$(git rev-parse --short HEAD)
```

**1. Store the initial Cognito admin password** (Secrets Manager `nfm-dashboard/cognito-admin` — the plaintext never lands in code/templates/git)

```bash
bash scripts/save-cognito-secret.sh
```

**2. Data stack** (2 DynamoDB tables, Collector Lambda, 5-minute Scheduler)

```bash
npm -w collector run build
npx -w infra cdk deploy NfmDash-Data -c imageTag=$TAG --require-approval never
```

**3. NFM onboarding stack** (Scope → 5 monitors → EKS add-on ×4 → SSM Association → EC2 tagging/IAM)

```bash
npx -w infra cdk deploy NfmDash-Onboarding -c imageTag=$TAG --require-approval never
```

> After agent installation, the **first data takes about 20 minutes** to arrive. The dashboard shows a "collection warming up" state in the meantime.

**4. AgentCore stack + Gateway creation** (deploys the 3 tool Lambdas, then creates `nfm-gateway` plus 3 targets via boto3 — the Gateway is not supported by CloudFormation, so a script creates it and records the MCP URL in SSM `/nfm-dashboard/gateway-url` as a SecureString)

```bash
npx -w infra cdk deploy NfmDash-AgentCore -c imageTag=$TAG --require-approval never
bash scripts/setup-gateway.sh
```

**5. Build/push the app image (arm64) → App stack** (ECS/ALB/CloudFront/Cognito). Pass the `$TAG` captured at the start **explicitly** to `build-push.sh` so the build/push and the App deployment always use the same tag (safe even if new commits land mid-guide).

```bash
bash scripts/build-push.sh "$TAG"   # → prints "Pushed image tag: <sha>"
npx -w infra cdk deploy NfmDash-App -c imageTag=$TAG --require-approval never
```

**6. Operations alarm stack** (3 CloudWatch alarms + SNS)

```bash
npx -w infra cdk deploy NfmDash-Ops -c imageTag=$TAG --require-approval never
```

**7. Smoke tests** (against the live URL — APP_URL/password are injected automatically from CFN outputs and Secrets Manager)

```bash
bash scripts/smoke.sh
```

## Usage

1. **Sign in**: https://dv4r4bnlhlpcx.cloudfront.net redirects to `/login` → "Sign in" → log in on the Cognito Hosted UI with `admin@whchoi.net` and the stored password.
2. **Pages**: `/` (4 KPIs + NHI) · `/topology` (Pod-to-Pod graph, filters, edge-to-path panel) · `/flows` (flow table/cards) · `/paths` (pod-pair paths: pod → node → subnet → AZ → VPC + traversedConstructs + SNAT/DNAT) · `/insights` (Workload Insights) · `/diagnose` · `/agents` (agent coverage).
3. **AI chat**: Click the floating button at the bottom right and type a question. The agent calls the gateway's 27 MCP tools (NFM queries, stored data, VPC/TGW/reachability) with token-level SSE streaming. The popup icon detaches the chat into a separate window/sheet.
4. **LLM diagnosis**: `/diagnose` — streams a diagnosis using the latest topology plus anomalous flows (top retransmissions/timeouts) as context; the **Regenerate** button reruns it.
5. **Language/theme**: Toggle Korean/English in the top bar (persisted in localStorage, bilingual including SSE status messages) and light/dark theme. Responsive on iPhone web (Safari).
6. **Manual collection**: The dashboard refresh button (`POST /api/nfm/refresh`) runs the Collector immediately.

## Configuration

Container (ECS Task) environment variables — **injected automatically by the NfmDash-App stack at deploy time** (no manual setup required):

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Blocks the dev-only `AUTH_DISABLED` bypass (fail-open guard) | `production` |
| `AWS_REGION` | AWS SDK region | `ap-northeast-2` |
| `APP_URL` | OAuth redirect_uri and absolute URL assembly | CloudFront distribution URL |
| `COGNITO_USER_POOL_ID` | JWT verification (`aws-jwt-verify`) | `ap-northeast-2_xJEbOZ95O` |
| `COGNITO_CLIENT_ID` | OAuth Authorization Code + PKCE | User Pool app client ID |
| `COGNITO_DOMAIN` | Hosted UI / token endpoint | `https://nfm-dashboard-<ACCOUNT_ID>.auth.ap-northeast-2.amazoncognito.com` |
| `TABLE_FLOWS` | Flow data reads | `nfm-dashboard-flows` |
| `TABLE_META` | Topology/status reads | `nfm-dashboard-meta` |
| `COLLECTOR_FUNCTION` | Manual collection via `/api/nfm/refresh` | `nfm-dashboard-collector` |
| `MONITORS` | Monitor-to-cluster mapping | cdk context `nfmMonitors` (`monitor=cluster,...`) |
| `ORIGIN_VERIFY_SECRET` | Verifies traffic came through CloudFront — blocks direct ALB access | Secrets Manager (ECS `secrets`) |

Other runtime settings (not env vars):

| Item | Where | Value |
|------|-------|-------|
| Gateway MCP URL | SSM SecureString `/nfm-dashboard/gateway-url` (written by `setup-gateway.sh`, read with caching by the app) | `nfm-gateway` MCP endpoint |
| LLM model ID | Constant in `app/src/lib/bedrock.ts` | `global.anthropic.claude-sonnet-5` (+ fallback) |
| Collector Lambda env | Injected by the NfmDash-Data stack | `TABLE_FLOWS` `TABLE_META` `MONITORS` `CONCURRENCY=5` |
| Local dev auth skip | `AUTH_DISABLED=1` (dev only — ignored in production) | `AUTH_DISABLED=1 npm -w app run dev` |
| E2E | `APP_URL` `E2E_EMAIL` `E2E_PASSWORD` | injected automatically by `scripts/smoke.sh` |

## Project Structure

npm workspaces monorepo (`infra`, `app`, `collector`) plus Python directories (`tools`, `onboarding`).

```text
nfm-dashboard/
  infra/       # AWS CDK (TypeScript) — 5 stacks: NfmDash-Data, NfmDash-Onboarding,
               #   NfmDash-AgentCore, NfmDash-App, NfmDash-Ops
  app/         # Next.js 16 full stack (App Router, Tailwind v4, React Flow topology,
               #   SnowUI design tokens, i18n ko/en, mobile responsive)
  collector/   # Collector Lambda (TypeScript, esbuild -> dist/handler.mjs) —
               #   NFM query/normalize/store/auto-onboarding
  tools/       # 3 Gateway MCP tool Lambdas (Python 3.13) + create_gateway.py
               #   (creates the Gateway/targets)
  onboarding/  # NFM onboarding CFN Custom Resource Lambda (Python 3.13)
  e2e/         # Playwright smoke tests (3 specs against the live URL)
  scripts/     # save-cognito-secret.sh, build-push.sh, setup-gateway.sh, smoke.sh
  docs/        # Design specs (docs/superpowers/specs/), execution plans, SnowUI design reference
```

## Testing

```bash
# App unit tests (Vitest)
npx -w app vitest run

# Collector unit tests (Vitest)
npm -w collector run test

# Python Lambda tests (pytest — tools/ and onboarding/)
cd tools && pytest
cd onboarding && pytest

# E2E smoke tests against the live URL (3 Playwright specs)
bash scripts/smoke.sh
bash scripts/smoke.sh -g login   # run a filtered subset
```

The E2E suite verifies login-to-KPI flow, a real chat SSE response, and no horizontal scrolling on an iPhone viewport, all against the live URL.

## API Documentation

Next.js API routes (Cognito JWT required; served by the ECS app):

| Endpoint | Description |
|----------|-------------|
| `/api/overview`, `/api/flows`, `/api/topology`, `/api/paths`, `/api/insights`, `/api/agents` | Dashboard data reads from DynamoDB and CloudWatch |
| `/api/ai` | Agent loop: Bedrock ConverseStream + `nfm-gateway` (MCP, SigV4), SSE streaming |
| `/api/diagnose` | DDB context injection + ConverseStream diagnosis / regenerate, SSE streaming |
| `POST /api/nfm/refresh` | Manual Collector Lambda invoke |

The AgentCore Gateway `nfm-gateway` (MCP, AWS_IAM/SigV4) exposes 27 tools across 3 Lambda targets: `nfm-dashboard-mcp-network` (16 VPC/TGW/firewall/reachability tools), `nfm-dashboard-mcp-nfm` (5 NFM API query tools), and `nfm-dashboard-mcp-ddb` (6 stored-data query tools). External API references are listed in the References section below.

## Contributing

1. Fork the repository
2. Create your branch (`git checkout -b feat/amazing-feature`)
3. Commit changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages (`feat:`, `fix:`, `docs:`, `chore:`, etc.).

## License

Proprietary — no open-source license file is included in this repository; all rights reserved. The UI design references SnowUI by ByeWind under CC BY 4.0 (see the Attribution section below).

## Contact

- Maintainer: [whchoi98](https://github.com/whchoi98)
- Email: whchoi98@gmail.com
- Issues: https://github.com/whchoi98/nfm-dashboard/issues

## Operations

- **Alarms** (NfmDash-Ops → SNS topic `nfm-dashboard-alarms`, notifies on both ALARM and OK): `nfm-dashboard-collector-errors` (Lambda Errors >= 1, 3 consecutive 5-minute periods), `nfm-dashboard-alb-no-healthy-hosts` (HealthyHostCount < 1 for 3 minutes), `nfm-dashboard-alb-5xx` (ELB 5xx > 10 per 5 minutes). Subscribe with:

  ```bash
  aws sns subscribe --topic-arn arn:aws:sns:ap-northeast-2:<ACCOUNT_ID>:nfm-dashboard-alarms \
    --protocol email --notification-endpoint you@example.com
  ```

- **E2E smoke**: `bash scripts/smoke.sh` (all 3 specs) / `bash scripts/smoke.sh -g login` (filtered). Verifies login-to-KPI, a real chat SSE response, and no horizontal scrolling on an iPhone viewport against the live URL.
- **Collection cycle**: EventBridge Scheduler every 5 minutes. Up to 60 NFM queries per cycle (5 monitors × 4 metrics × 3 categories) plus Workload Insights, concurrency 5 with exponential backoff, partial failures tolerated. Data TTL is 7 days. Collection status is visible in `nfm-dashboard-meta` and on the `/agents` page.
- **Redeploy**: after app changes, capture `TAG=$(git rev-parse --short HEAD)`, then `bash scripts/build-push.sh "$TAG"` → `cdk deploy NfmDash-App -c imageTag=$TAG`. Tags are immutable, so task restarts never swap the image.
- **Cost notes** (rough): always-on cost is 1 ECS Fargate task (1 vCPU/2GB, arm64) + ALB + NAT GW traffic. Usage-based cost is DynamoDB on-demand, Collector/tool Lambdas (5-minute cycle), CloudFront, NFM queries, and Bedrock tokens when chat/diagnosis is used. Bedrock cost is 0 when unused.

## Attribution

- **UI design**: [SnowUI — Dashboard UI Kit](https://www.figma.com/community/file/1210542873091115123/dashboard-ui-kit-dashboard-free-admin-dashboard) by **ByeWind**, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This project references SnowUI's layout, color tokens, and typography.
- **Pattern reference**: [whchoi98/awsops](https://github.com/whchoi98/awsops) — the original patterns for AgentCore Gateway/target creation, the Lambda MCP handler contract, SSE event conventions, and the i18n structure.

## Known Limitations

- **Single account/single region**: NFM allows 1 Scope per account/region (fixed quota). Multi-account/multi-region, custom domains (Route53), and AgentCore Runtime/Memory are out of scope.
- **Gateway lives outside CFN**: `nfm-gateway` is created by `scripts/setup-gateway.sh` (boto3) — deleting the stacks does not delete it, so clean it up via the script/console as well.
- **Every cdk command needs `-c imageTag`**: the App stack validates the tag at synth time (see the Deployment Guide above). Even cdk commands touching only non-App stacks need a placeholder — e.g. the `deploy:data` npm script passes `-c imageTag=unused`. A pre-existing ECR repo in the account may be MUTABLE (new ones are created IMMUTABLE) — deployments pin SHA tags, so there is no practical impact.
- **Cognito tokens are valid for 8 hours**: re-login is required after expiry. The initial user is only `admin@whchoi.net` (create additional users via the console/CLI).
- **EKS metadata constraints** (inherent to NFM): remote pods in other clusters are not resolved, control-plane-owned pods do not expose names, and NodePort/LB instance mode with `ExternalTrafficPolicy: Cluster` is reported as node IPs.
- **Old SSM Agents**: some older EC2 instances may need `AWS-UpdateSSMAgent` before the Distributor install (the State Manager Association retries daily).
- **Collector alarm blind spot**: if the Scheduler is disabled and invocations drop to zero, the error alarm cannot catch it.

## References

- Design spec: `docs/superpowers/specs/2026-07-08-nfm-dashboard-design.md`
- [NFM API Reference](https://docs.aws.amazon.com/networkflowmonitor/2.0/APIReference/API_Operations.html) · [KubernetesMetadata](https://docs.aws.amazon.com/networkflowmonitor/2.0/APIReference/API_KubernetesMetadata.html) · [EKS add-on installation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-NetworkFlowMonitor-agents-kubernetes-eks.html) · [CW metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-NetworkFlowMonitor-cw-metrics.html)

---

<a id="korean"></a>

# 한국어

## 개요

NFM Dashboard는 CloudWatch Network Flow Monitor 기반의 AWS 네이티브 네트워크 관측 대시보드입니다. 계정/리전 전체(EKS 클러스터 4개 + 독립형 EC2)에 NFM을 온보딩하고, 5분마다 플로우 데이터를 수집하며, 통과하는 네트워크 경로를 포함해 EKS Pod-to-Pod 통신을 상세히 식별합니다. 또한 Bedrock과 AgentCore Gateway 뒤의 27개 MCP 도구로 구동되는 AI 챗봇과 LLM 진단을 제공합니다.

- 계정 & 리전: `<ACCOUNT_ID>` / `ap-northeast-2`
- 라이브 URL: https://dv4r4bnlhlpcx.cloudfront.net (Cognito 로그인 필요 — 초기 관리자 `admin@whchoi.net`)
- LLM: `global.anthropic.claude-sonnet-5` (Bedrock 교차 리전 글로벌 추론 프로파일, 폴백: `global.anthropic.claude-sonnet-4-5-20250929-v1:0`)

### 아키텍처

```text
User (desktop / iPhone)
   │ HTTPS
   ▼
CloudFront (E2H1U7CDVRIL9Q, *.cloudfront.net)
   │  X-Origin-Verify custom header (validated in Next.js middleware)
   │  ALB SG ingress allows only the CloudFront origin-facing prefix list pl-22a6434b
   ▼
ALB (internet-facing, public subnets)
   ▼ :3000 (app SG accepts ingress only from the ALB SG)
ECS Fargate (arm64, private subnets, cc-on-bedrock-vpc vpc-0dfa5610180dfa628)
 └─ Next.js 16 full stack (7 UI pages + FloatingChat + i18n ko/en, Cognito JWT verification)
     ├─ /api/overview /flows /topology /paths /insights /agents   ← DynamoDB · CloudWatch reads
     ├─ /api/ai        ← agent loop: Bedrock ConverseStream + nfm-gateway (MCP, SigV4) [SSE]
     ├─ /api/diagnose  ← DDB context injection + ConverseStream diagnosis / regenerate [SSE]
     └─ /api/nfm/refresh ← manual Collector Lambda invoke

EventBridge Scheduler (5 min) ─▶ Collector Lambda (Node 22, arm64)
   ─▶ async NFM queries (StartQuery → poll → GetQueryResults, concurrency 5 + backoff)
   ─▶ normalization (edgeHash) · topology snapshot ─▶ DynamoDB
        ├─ nfm-dashboard-flows  (TTL 7 days, GSI: pod / edge time series)
        └─ nfm-dashboard-meta   (topology snapshots, collection status, coverage)
   └─ auto-onboarding of new standalone EC2 (tagging + policy attach)

AgentCore Gateway `nfm-gateway` (MCP, AWS_IAM/SigV4 — 27 tools)
 ├─ network-mcp-target → Lambda nfm-dashboard-mcp-network (16 VPC/TGW/firewall/reachability tools)
 ├─ nfm-mcp-target     → Lambda nfm-dashboard-mcp-nfm (5 NFM API query tools)
 └─ ddb-mcp-target     → Lambda nfm-dashboard-mcp-ddb (6 stored-data query tools)

NFM onboarding (NfmDash-Onboarding):
  Scope ×1 (Workload Insights) · 5 monitors (nfm-eks-<cluster> ×4 + nfm-vpc-all)
  EKS add-on aws-network-flow-monitoring-agent ×4 (Pod Identity)
  SSM Distributor + State Manager Association → agent install on standalone EC2
```

## 기능

- **계정 전역 NFM 온보딩** — Scope 1개(Workload Insights), 모니터 5개(EKS 클러스터 4개 + 전체 VPC), EKS 애드온 `aws-network-flow-monitoring-agent` ×4(Pod Identity), 독립형 EC2에 대한 SSM Distributor/State Manager 에이전트 설치를 프로비저닝하며, 신규 기동 EC2 인스턴스를 자동 온보딩합니다.
- **5분 수집 파이프라인** — EventBridge Scheduler가 Collector Lambda(Node 22, arm64)를 호출하여 비동기 NFM 쿼리(동시성 5 + 지수 백오프)를 실행하고, 플로우를 정규화(edgeHash)하고, 토폴로지를 스냅샷으로 저장하며, 7일 TTL로 DynamoDB에 결과를 보관합니다.
- **Pod-to-Pod 관측 UI** — 7개 페이지: 개요 KPI + 네트워크 상태 지표, 필터·엣지→경로 패널을 갖춘 force-directed 토폴로지 그래프, 플로우 테이블/카드, pod-쌍 경로(pod → node → subnet → AZ → VPC, traversedConstructs 및 SNAT/DNAT 포함), Workload Insights, 진단, 에이전트 커버리지.
- **27개 MCP 도구 AI 챗봇** — Bedrock ConverseStream 기반 에이전트 루프가 `nfm-gateway` AgentCore Gateway(MCP, SigV4)를 호출하며 토큰 단위 SSE 스트리밍을 제공하고, 플로팅 챗 또는 독립 팝업 창으로 사용할 수 있습니다.
- **LLM 진단** — 최신 토폴로지와 이상 플로우(상위 재전송/타임아웃)를 주입 컨텍스트로 삼아 진단을 스트리밍하며, 재생성(Regenerate) 버튼을 제공합니다.
- **이중 언어·테마·반응형** — ko/en i18n(SSE 상태 메시지 포함), SnowUI 디자인 토큰의 라이트/다크 테마, iPhone(Safari) 반응형 레이아웃.

## 사전 요구사항

- AWS 계정(`<ACCOUNT_ID>`) 관리자 자격 증명, 리전 `ap-northeast-2`
- CDK 부트스트랩 완료(`cdk bootstrap aws://<ACCOUNT_ID>/ap-northeast-2`, qualifier `hnb659fds`)
- Node.js 22(`.nvmrc`), npm workspaces
- Python 3.13(Lambda 런타임 — 로컬 pytest는 3.9+에서 동작), `boto3`, `pytest`
- Docker — **arm64 이미지 빌드**(arm64 빌드 호스트 또는 buildx 에뮬레이션)
- AWS CLI v2(Secrets Manager / SNS / CloudFormation 조회)
- 기존 인프라 전제: `cc-on-bedrock-vpc`(`vpc-0dfa5610180dfa628`, NAT GW/VPC 엔드포인트 재사용), EKS 클러스터 4개, Bedrock `global.anthropic.claude-sonnet-5` 접근 권한, ap-northeast-2의 AgentCore 사용 가능

## 설치

```bash
# 저장소 클론
git clone https://github.com/whchoi98/nfm-dashboard.git
cd nfm-dashboard

# 저장소 루트에서 전체 워크스페이스 설치
npm ci

# Python 개발 의존성 설치 (테스트 / 게이트웨이 스크립트용)
cd tools && pip install -r requirements-dev.txt
```

### 배포 가이드

> **참고**: `NfmDash-App`은 synth 시점에 ECR 이미지 태그를 고정하므로 **모든 `cdk` 명령은 `-c imageTag=<tag>`가 필요**합니다(App 이외 스택은 이 값을 사용하지 않으므로 이미지 생성 전에는 아무 placeholder나 가능). 아래 단계는 `TAG=$(git rev-parse --short HEAD)`를 사용합니다.

```bash
TAG=$(git rev-parse --short HEAD)
```

**1. 초기 Cognito 관리자 비밀번호 저장** (Secrets Manager `nfm-dashboard/cognito-admin` — 평문은 코드/템플릿/git에 남지 않음)

```bash
bash scripts/save-cognito-secret.sh
```

**2. 데이터 스택** (DynamoDB 테이블 2개, Collector Lambda, 5분 Scheduler)

```bash
npm -w collector run build
npx -w infra cdk deploy NfmDash-Data -c imageTag=$TAG --require-approval never
```

**3. NFM 온보딩 스택** (Scope → 모니터 5개 → EKS 애드온 ×4 → SSM Association → EC2 태깅/IAM)

```bash
npx -w infra cdk deploy NfmDash-Onboarding -c imageTag=$TAG --require-approval never
```

> 에이전트 설치 후 **첫 데이터는 약 20분** 후에 도착합니다. 그동안 대시보드는 "수집 준비 중" 상태를 표시합니다.

**4. AgentCore 스택 + Gateway 생성** (도구 Lambda 3개 배포 후 boto3로 `nfm-gateway`와 3개 타깃 생성 — Gateway는 CloudFormation 미지원이라 스크립트가 생성하고 MCP URL을 SSM `/nfm-dashboard/gateway-url` SecureString에 기록)

```bash
npx -w infra cdk deploy NfmDash-AgentCore -c imageTag=$TAG --require-approval never
bash scripts/setup-gateway.sh
```

**5. 앱 이미지(arm64) 빌드/푸시 → App 스택** (ECS/ALB/CloudFront/Cognito). 빌드/푸시와 App 배포가 항상 동일 태그를 쓰도록 시작 시 캡처한 `$TAG`를 `build-push.sh`에 **명시적으로** 전달합니다(가이드 중간에 새 커밋이 생겨도 안전).

```bash
bash scripts/build-push.sh "$TAG"   # → "Pushed image tag: <sha>" 출력
npx -w infra cdk deploy NfmDash-App -c imageTag=$TAG --require-approval never
```

**6. 운영 알람 스택** (CloudWatch 알람 3종 + SNS)

```bash
npx -w infra cdk deploy NfmDash-Ops -c imageTag=$TAG --require-approval never
```

**7. 스모크 테스트** (라이브 URL 대상 — APP_URL/비밀번호는 CFN 출력과 Secrets Manager에서 자동 주입)

```bash
bash scripts/smoke.sh
```

## 사용법

1. **로그인**: https://dv4r4bnlhlpcx.cloudfront.net 은 `/login`으로 리다이렉트 → "Sign in" → Cognito Hosted UI에서 `admin@whchoi.net`과 저장된 비밀번호로 로그인.
2. **페이지**: `/`(KPI 4개 + NHI) · `/topology`(Pod-to-Pod 그래프, 필터, 엣지→경로 패널) · `/flows`(플로우 테이블/카드) · `/paths`(pod-쌍 경로: pod → node → subnet → AZ → VPC + traversedConstructs + SNAT/DNAT) · `/insights`(Workload Insights) · `/diagnose` · `/agents`(에이전트 커버리지).
3. **AI 챗**: 우측 하단 플로팅 버튼을 클릭하고 질문을 입력합니다. 에이전트가 게이트웨이의 27개 MCP 도구(NFM 쿼리, 저장 데이터, VPC/TGW/도달성)를 토큰 단위 SSE 스트리밍으로 호출합니다. 팝업 아이콘은 챗을 별도 창/시트로 분리합니다.
4. **LLM 진단**: `/diagnose` — 최신 토폴로지와 이상 플로우(상위 재전송/타임아웃)를 컨텍스트로 진단을 스트리밍하며, **Regenerate** 버튼으로 다시 실행합니다.
5. **언어/테마**: 상단 바에서 한국어/영어(localStorage에 유지, SSE 상태 메시지 포함 이중 언어)와 라이트/다크 테마를 전환합니다. iPhone 웹(Safari) 반응형.
6. **수동 수집**: 대시보드 새로고침 버튼(`POST /api/nfm/refresh`)이 Collector를 즉시 실행합니다.

## 구성

컨테이너(ECS Task) 환경 변수 — **배포 시 NfmDash-App 스택이 자동 주입**(수동 설정 불필요):

| 변수 | 설명 | 기본값 |
|----------|-------------|---------|
| `NODE_ENV` | 개발 전용 `AUTH_DISABLED` 우회 차단(fail-open 가드) | `production` |
| `AWS_REGION` | AWS SDK 리전 | `ap-northeast-2` |
| `APP_URL` | OAuth redirect_uri 및 절대 URL 구성 | CloudFront 배포 URL |
| `COGNITO_USER_POOL_ID` | JWT 검증(`aws-jwt-verify`) | `ap-northeast-2_xJEbOZ95O` |
| `COGNITO_CLIENT_ID` | OAuth Authorization Code + PKCE | User Pool 앱 클라이언트 ID |
| `COGNITO_DOMAIN` | Hosted UI / 토큰 엔드포인트 | `https://nfm-dashboard-<ACCOUNT_ID>.auth.ap-northeast-2.amazoncognito.com` |
| `TABLE_FLOWS` | 플로우 데이터 읽기 | `nfm-dashboard-flows` |
| `TABLE_META` | 토폴로지/상태 읽기 | `nfm-dashboard-meta` |
| `COLLECTOR_FUNCTION` | `/api/nfm/refresh` 통한 수동 수집 | `nfm-dashboard-collector` |
| `MONITORS` | 모니터↔클러스터 매핑 | cdk 컨텍스트 `nfmMonitors`(`monitor=cluster,...`) |
| `ORIGIN_VERIFY_SECRET` | CloudFront 경유 트래픽 검증 — 직접 ALB 접근 차단 | Secrets Manager(ECS `secrets`) |

기타 런타임 설정(환경 변수 아님):

| 항목 | 위치 | 값 |
|------|-------|-------|
| Gateway MCP URL | SSM SecureString `/nfm-dashboard/gateway-url`(`setup-gateway.sh`가 기록, 앱이 캐싱하여 읽음) | `nfm-gateway` MCP 엔드포인트 |
| LLM 모델 ID | `app/src/lib/bedrock.ts`의 상수 | `global.anthropic.claude-sonnet-5`(+ 폴백) |
| Collector Lambda 환경 | NfmDash-Data 스택이 주입 | `TABLE_FLOWS` `TABLE_META` `MONITORS` `CONCURRENCY=5` |
| 로컬 개발 인증 스킵 | `AUTH_DISABLED=1`(개발 전용 — 프로덕션에서 무시) | `AUTH_DISABLED=1 npm -w app run dev` |
| E2E | `APP_URL` `E2E_EMAIL` `E2E_PASSWORD` | `scripts/smoke.sh`가 자동 주입 |

## 프로젝트 구조

npm workspaces 모노레포(`infra`, `app`, `collector`) + Python 디렉터리(`tools`, `onboarding`).

```text
nfm-dashboard/
  infra/       # AWS CDK (TypeScript) — 5개 스택: NfmDash-Data, NfmDash-Onboarding,
               #   NfmDash-AgentCore, NfmDash-App, NfmDash-Ops
  app/         # Next.js 16 풀스택 (App Router, Tailwind v4, React Flow 토폴로지,
               #   SnowUI 디자인 토큰, i18n ko/en, 모바일 반응형)
  collector/   # Collector Lambda (TypeScript, esbuild -> dist/handler.mjs) —
               #   NFM 쿼리/정규화/저장/자동 온보딩
  tools/       # Gateway MCP 도구 Lambda 3개 (Python 3.13) + create_gateway.py
               #   (Gateway/타깃 생성)
  onboarding/  # NFM 온보딩 CFN Custom Resource Lambda (Python 3.13)
  e2e/         # Playwright 스모크 테스트 (라이브 URL 대상 3개 spec)
  scripts/     # save-cognito-secret.sh, build-push.sh, setup-gateway.sh, smoke.sh
  docs/        # 설계 스펙 (docs/superpowers/specs/), 실행 계획, SnowUI 디자인 참조
```

## 테스트

```bash
# 앱 단위 테스트 (Vitest)
npx -w app vitest run

# Collector 단위 테스트 (Vitest)
npm -w collector run test

# Python Lambda 테스트 (pytest — tools/ 및 onboarding/)
cd tools && pytest
cd onboarding && pytest

# 라이브 URL 대상 E2E 스모크 테스트 (Playwright spec 3개)
bash scripts/smoke.sh
bash scripts/smoke.sh -g login   # 필터링된 서브셋 실행
```

E2E 스위트는 로그인→KPI 흐름, 실제 챗 SSE 응답, iPhone 뷰포트에서 가로 스크롤 없음을 모두 라이브 URL 대상으로 검증합니다.

## API 문서

Next.js API 라우트(Cognito JWT 필요, ECS 앱이 서빙):

| 엔드포인트 | 설명 |
|----------|-------------|
| `/api/overview`, `/api/flows`, `/api/topology`, `/api/paths`, `/api/insights`, `/api/agents` | DynamoDB 및 CloudWatch에서 대시보드 데이터 읽기 |
| `/api/ai` | 에이전트 루프: Bedrock ConverseStream + `nfm-gateway`(MCP, SigV4), SSE 스트리밍 |
| `/api/diagnose` | DDB 컨텍스트 주입 + ConverseStream 진단 / 재생성, SSE 스트리밍 |
| `POST /api/nfm/refresh` | Collector Lambda 수동 호출 |

AgentCore Gateway `nfm-gateway`(MCP, AWS_IAM/SigV4)는 3개 Lambda 타깃에 걸쳐 27개 도구를 노출합니다: `nfm-dashboard-mcp-network`(VPC/TGW/방화벽/도달성 도구 16개), `nfm-dashboard-mcp-nfm`(NFM API 쿼리 도구 5개), `nfm-dashboard-mcp-ddb`(저장 데이터 쿼리 도구 6개). 외부 API 참조는 아래 참고 섹션에 있습니다.

## 기여

1. 저장소를 포크합니다
2. 브랜치를 생성합니다 (`git checkout -b feat/amazing-feature`)
3. 변경 사항을 커밋합니다 (`git commit -m 'feat: add amazing feature'`)
4. 브랜치에 푸시합니다 (`git push origin feat/amazing-feature`)
5. Pull Request를 엽니다

커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/)를 사용합니다 (`feat:`, `fix:`, `docs:`, `chore:` 등).

## 라이선스

Proprietary — 이 저장소에는 오픈소스 라이선스 파일이 포함되어 있지 않으며 모든 권리를 보유합니다. UI 디자인은 CC BY 4.0 하의 ByeWind SnowUI를 참조합니다(아래 저작자 표시 섹션 참조).

## 연락처

- 메인테이너: [whchoi98](https://github.com/whchoi98)
- 이메일: whchoi98@gmail.com
- 이슈: https://github.com/whchoi98/nfm-dashboard/issues

## 운영

- **알람**(NfmDash-Ops → SNS 토픽 `nfm-dashboard-alarms`, ALARM 및 OK 모두 알림): `nfm-dashboard-collector-errors`(Lambda Errors >= 1, 연속 3개 5분 주기), `nfm-dashboard-alb-no-healthy-hosts`(HealthyHostCount < 1, 3분간), `nfm-dashboard-alb-5xx`(ELB 5xx > 10 per 5분). 구독:

  ```bash
  aws sns subscribe --topic-arn arn:aws:sns:ap-northeast-2:<ACCOUNT_ID>:nfm-dashboard-alarms \
    --protocol email --notification-endpoint you@example.com
  ```

- **E2E 스모크**: `bash scripts/smoke.sh`(spec 3개 전체) / `bash scripts/smoke.sh -g login`(필터링). 라이브 URL 대상으로 로그인→KPI, 실제 챗 SSE 응답, iPhone 뷰포트 가로 스크롤 없음을 검증합니다.
- **수집 주기**: EventBridge Scheduler가 5분마다. 주기당 최대 60개 NFM 쿼리(모니터 5개 × 지표 4개 × 카테고리 3개) + Workload Insights, 동시성 5 + 지수 백오프, 부분 실패 허용. 데이터 TTL은 7일. 수집 상태는 `nfm-dashboard-meta`와 `/agents` 페이지에서 확인 가능합니다.
- **재배포**: 앱 변경 후 `TAG=$(git rev-parse --short HEAD)`를 캡처한 뒤 `bash scripts/build-push.sh "$TAG"` → `cdk deploy NfmDash-App -c imageTag=$TAG`. 태그는 불변이므로 태스크 재시작이 이미지를 바꾸지 않습니다.
- **비용 참고**(대략): 상시 비용은 ECS Fargate 태스크 1개(1 vCPU/2GB, arm64) + ALB + NAT GW 트래픽. 사용량 기반 비용은 DynamoDB 온디맨드, Collector/도구 Lambda(5분 주기), CloudFront, NFM 쿼리, 그리고 챗/진단 사용 시 Bedrock 토큰. 미사용 시 Bedrock 비용은 0입니다.

## 저작자 표시

- **UI 디자인**: **ByeWind**의 [SnowUI — Dashboard UI Kit](https://www.figma.com/community/file/1210542873091115123/dashboard-ui-kit-dashboard-free-admin-dashboard), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 라이선스. 이 프로젝트는 SnowUI의 레이아웃, 색상 토큰, 타이포그래피를 참조합니다.
- **패턴 참조**: [whchoi98/awsops](https://github.com/whchoi98/awsops) — AgentCore Gateway/타깃 생성, Lambda MCP 핸들러 계약, SSE 이벤트 규칙, i18n 구조의 원본 패턴.

## 알려진 제한

- **단일 계정/단일 리전**: NFM은 계정/리전당 Scope 1개를 허용합니다(고정 쿼터). 다중 계정/다중 리전, 커스텀 도메인(Route53), AgentCore Runtime/Memory는 범위 밖입니다.
- **Gateway는 CFN 외부**: `nfm-gateway`는 `scripts/setup-gateway.sh`(boto3)가 생성합니다 — 스택 삭제로는 삭제되지 않으므로 스크립트/콘솔로 정리해야 합니다.
- **모든 cdk 명령에 `-c imageTag` 필요**: App 스택이 synth 시점에 태그를 검증합니다(위 배포 가이드 참조). App 이외 스택만 다루는 cdk 명령에도 placeholder가 필요합니다 — 예: `deploy:data` npm 스크립트는 `-c imageTag=unused`를 전달. 계정의 기존 ECR 리포지토리는 MUTABLE일 수 있으나(신규는 IMMUTABLE로 생성) 배포가 SHA 태그를 고정하므로 실질적 영향은 없습니다.
- **Cognito 토큰 8시간 유효**: 만료 후 재로그인이 필요합니다. 초기 사용자는 `admin@whchoi.net` 뿐입니다(추가 사용자는 콘솔/CLI로 생성).
- **EKS 메타데이터 제약**(NFM 고유): 다른 클러스터의 원격 pod는 해석되지 않고, 컨트롤 플레인 소유 pod는 이름을 노출하지 않으며, `ExternalTrafficPolicy: Cluster`의 NodePort/LB instance 모드는 노드 IP로 보고됩니다.
- **오래된 SSM Agent**: 일부 구형 EC2 인스턴스는 Distributor 설치 전에 `AWS-UpdateSSMAgent`가 필요할 수 있습니다(State Manager Association이 매일 재시도).
- **Collector 알람 사각지대**: Scheduler가 비활성화되어 호출이 0으로 떨어지면 오류 알람이 이를 잡지 못합니다.

## 참고

- 설계 스펙: `docs/superpowers/specs/2026-07-08-nfm-dashboard-design.md`
- [NFM API Reference](https://docs.aws.amazon.com/networkflowmonitor/2.0/APIReference/API_Operations.html) · [KubernetesMetadata](https://docs.aws.amazon.com/networkflowmonitor/2.0/APIReference/API_KubernetesMetadata.html) · [EKS add-on installation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-NetworkFlowMonitor-agents-kubernetes-eks.html) · [CW metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-NetworkFlowMonitor-cw-metrics.html)
