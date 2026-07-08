# NFM Dashboard

**AWS CloudWatch Network Flow Monitor(NFM) 기반 네트워크 관측 대시보드 + AI 챗봇/진단.**

An AWS-native network observability dashboard built on CloudWatch Network Flow Monitor.
It onboards NFM across the whole account/region (4 EKS clusters + standalone EC2), collects
flow data every 5 minutes, identifies **EKS Pod-to-Pod communication in detail (including the
traversed network path)**, and ships an **AI chatbot / LLM diagnosis** powered by Bedrock and
27 MCP tools behind an AgentCore Gateway.

- 계정/리전 / Account & Region: `<ACCOUNT_ID>` / `ap-northeast-2`
- 배포 URL / Live URL: https://dv4r4bnlhlpcx.cloudfront.net (Cognito 로그인 필요 — 초기 관리자 `admin@whchoi.net`)
- LLM: `global.anthropic.claude-sonnet-5` (Bedrock cross-region global inference profile, 폴백: `global.anthropic.claude-sonnet-4-5-20250929-v1:0`)

## 아키텍처 / Architecture

```
사용자 (데스크톱 / iPhone)
   │ HTTPS
   ▼
CloudFront (E2H1U7CDVRIL9Q, *.cloudfront.net)
   │  X-Origin-Verify 커스텀 헤더 (Next.js middleware에서 검증)
   │  ALB SG ingress = CloudFront origin-facing prefix list pl-22a6434b 만 허용
   ▼
ALB (internet-facing, Public subnets)
   ▼ :3000 (앱 SG는 ALB SG에서만 ingress)
ECS Fargate (arm64, Private subnets, cc-on-bedrock-vpc vpc-0dfa5610180dfa628)
 └─ Next.js 16 풀스택 (UI 7페이지 + FloatingChat + i18n ko/en, Cognito JWT 검증)
     ├─ /api/overview /flows /topology /paths /insights /agents   ← DynamoDB · CloudWatch 조회
     ├─ /api/ai        ← 에이전트 루프: Bedrock ConverseStream + nfm-gateway(MCP, SigV4) [SSE]
     ├─ /api/diagnose  ← DDB 컨텍스트 주입 + ConverseStream 진단 / regenerate [SSE]
     └─ /api/nfm/refresh ← Collector Lambda 수동 invoke

EventBridge Scheduler (5분) ─▶ Collector Lambda (Node 22, arm64)
   ─▶ NFM 비동기 쿼리 (StartQuery → poll → GetQueryResults, 동시성 5 + 백오프)
   ─▶ 정규화(edgeHash) · 토폴로지 스냅샷 ─▶ DynamoDB
        ├─ nfm-dashboard-flows  (TTL 7일, GSI: pod / edge 시계열)
        └─ nfm-dashboard-meta   (토폴로지 스냅샷, 수집 상태, 커버리지)
   └─ 신규 standalone EC2 자동 온보딩(태깅 + 정책 attach)

AgentCore Gateway `nfm-gateway` (MCP, AWS_IAM/SigV4 — 27 tools)
 ├─ network-mcp-target → Lambda nfm-network-mcp (VPC/TGW/방화벽/reachability 16 도구)
 ├─ nfm-mcp-target     → Lambda nfm-flowmonitor-mcp (NFM API 조회 5 도구)
 └─ ddb-mcp-target     → Lambda nfm-ddb-mcp (적재 데이터 조회 6 도구)

NFM 온보딩 (NfmDash-Onboarding):
  Scope ×1 (Workload Insights) · 모니터 5개 (nfm-eks-<cluster> ×4 + nfm-vpc-all)
  EKS add-on aws-network-flow-monitoring-agent ×4 (Pod Identity)
  SSM Distributor + State Manager Association → standalone EC2 에이전트 설치
```

## 리포 구조 / Repository Layout

npm workspaces 모노레포(`infra`, `app`, `collector`) + Python 디렉터리(`tools`, `onboarding`).

| 경로 / Path | 내용 / Contents |
|---|---|
| `infra/` | AWS CDK (TypeScript) — 스택 5개: `NfmDash-Data`, `NfmDash-Onboarding`, `NfmDash-AgentCore`, `NfmDash-App`, `NfmDash-Ops` |
| `app/` | Next.js 16 풀스택 (App Router, Tailwind v4, React Flow 토폴로지, SnowUI 디자인 토큰, i18n ko/en, 모바일 반응형) |
| `collector/` | Collector Lambda (TypeScript, esbuild → `dist/handler.mjs`) — NFM 쿼리/정규화/저장/자동 온보딩 |
| `tools/` | Gateway MCP 도구 Lambda 3종 (Python 3.13) + `create_gateway.py` (Gateway/타겟 생성) |
| `onboarding/` | NFM 온보딩 CFN Custom Resource Lambda (Python 3.13) |
| `e2e/` | Playwright 스모크 테스트 (라이브 URL 대상 3 spec) |
| `scripts/` | `save-cognito-secret.sh` · `build-push.sh` · `setup-gateway.sh` · `smoke.sh` |
| `docs/` | 설계 스펙(`docs/superpowers/specs/`), 실행 플랜, SnowUI 디자인 레퍼런스 |

## 사전 요구사항 / Prerequisites

- AWS 계정 (`<ACCOUNT_ID>`) 관리자 자격 증명, 리전 `ap-northeast-2`
- CDK bootstrap 완료 (`cdk bootstrap aws://<ACCOUNT_ID>/ap-northeast-2`, qualifier `hnb659fds`)
- Node.js 22 (`.nvmrc`), npm workspaces
- Python 3.13 (Lambda 런타임 — 로컬 pytest는 3.9+ 동작), `boto3`, `pytest`
- Docker — **arm64 이미지 빌드** (빌드 호스트가 arm64이거나 buildx 에뮬레이션)
- AWS CLI v2 (Secrets Manager / SNS / CloudFormation 조회)
- 기존 인프라 전제: `cc-on-bedrock-vpc`(`vpc-0dfa5610180dfa628`, NATGW/VPC 엔드포인트 재사용), EKS 클러스터 4개, Bedrock `global.anthropic.claude-sonnet-5` 접근 권한, AgentCore(ap-northeast-2) 사용 가능

```bash
npm ci                          # 루트에서 전체 워크스페이스 설치
cd tools && pip install -r requirements-dev.txt   # (테스트/게이트웨이 스크립트용)
```

## 배포 가이드 / Deployment Guide

> **참고**: `NfmDash-App`이 synth 시점에 ECR 이미지 태그를 고정하므로, **모든 `cdk` 명령에
> `-c imageTag=<tag>`가 필요**합니다 (App 이외 스택 배포 시에는 값이 소비되지 않으므로
> 아직 이미지가 없어도 임의 값으로 무방). 아래에서는 `TAG=$(git rev-parse --short HEAD)` 사용.

```bash
TAG=$(git rev-parse --short HEAD)
```

**1. Cognito 초기 관리자 비밀번호 저장** (Secrets Manager `nfm-dashboard/cognito-admin` — 평문은 코드/템플릿/git에 남지 않음)

```bash
bash scripts/save-cognito-secret.sh
```

**2. Data 스택** (DynamoDB 2테이블, Collector Lambda, 5분 Scheduler)

```bash
npm -w collector run build
npx -w infra cdk deploy NfmDash-Data -c imageTag=$TAG --require-approval never
```

**3. NFM 온보딩 스택** (Scope → 모니터 5개 → EKS add-on ×4 → SSM Association → EC2 태깅/IAM)

```bash
npx -w infra cdk deploy NfmDash-Onboarding -c imageTag=$TAG --require-approval never
```

> ⏱ 에이전트 설치 후 **첫 데이터 유입까지 약 20분** 소요. 그동안 대시보드는 "수집 준비 중" 상태를 표시한다.

**4. AgentCore 스택 + Gateway 생성** (도구 Lambda 3개 배포 → boto3로 `nfm-gateway` + 타겟 3개 생성 — Gateway는 CloudFormation 미지원이라 스크립트로 생성하며, MCP URL을 SSM `/nfm-dashboard/gateway-url`(SecureString)에 기록)

```bash
npx -w infra cdk deploy NfmDash-AgentCore -c imageTag=$TAG --require-approval never
bash scripts/setup-gateway.sh
```

**5. 앱 이미지 빌드/푸시 (arm64) → App 스택** (ECS/ALB/CloudFront/Cognito). `build-push.sh`가 git short SHA를 불변 태그로 푸시하고, 배포는 그 태그를 고정한다.

```bash
bash scripts/build-push.sh          # → "Pushed image tag: <sha>" 출력
npx -w infra cdk deploy NfmDash-App -c imageTag=$TAG --require-approval never
```

**6. 운영 알람 스택** (CloudWatch 알람 3종 + SNS)

```bash
npx -w infra cdk deploy NfmDash-Ops -c imageTag=$TAG --require-approval never
```

**7. 스모크 테스트** (라이브 URL 대상 — APP_URL/비밀번호는 CFN output과 Secrets Manager에서 자동 주입)

```bash
bash scripts/smoke.sh
```

## 환경 변수 / Environment Variables

컨테이너(ECS Task) — **NfmDash-App 스택이 배포 시 자동 주입** (수동 설정 불필요):

| 변수 / Variable | 값 / Value | 용도 / Purpose |
|---|---|---|
| `NODE_ENV` | `production` | dev 전용 `AUTH_DISABLED` 우회 차단 (fail-open 가드) |
| `AWS_REGION` | `ap-northeast-2` | AWS SDK 리전 |
| `APP_URL` | CloudFront 배포 URL | OAuth redirect_uri, 절대 URL 조립 |
| `COGNITO_USER_POOL_ID` | `ap-northeast-2_xJEbOZ95O` | JWT 검증 (`aws-jwt-verify`) |
| `COGNITO_CLIENT_ID` | User Pool 앱 클라이언트 ID | OAuth Authorization Code + PKCE |
| `COGNITO_DOMAIN` | `https://nfm-dashboard-<ACCOUNT_ID>.auth.ap-northeast-2.amazoncognito.com` | Hosted UI / token endpoint |
| `TABLE_FLOWS` | `nfm-dashboard-flows` | 플로우 데이터 조회 |
| `TABLE_META` | `nfm-dashboard-meta` | 토폴로지/상태 조회 |
| `COLLECTOR_FUNCTION` | `nfm-dashboard-collector` | `/api/nfm/refresh` 수동 수집 |
| `MONITORS` | cdk context `nfmMonitors` (`monitor=cluster,...`) | 모니터↔클러스터 매핑 |
| `ORIGIN_VERIFY_SECRET` | Secrets Manager (ECS `secrets`) | CloudFront 경유 검증 — ALB 직접 접근 차단 |

기타 런타임 설정 (env 아님):

| 항목 / Item | 위치 / Where | 값 / Value |
|---|---|---|
| Gateway MCP URL | SSM SecureString `/nfm-dashboard/gateway-url` (`setup-gateway.sh`가 기록, 앱이 캐시 조회) | `nfm-gateway` MCP endpoint |
| LLM 모델 ID | `app/src/lib/bedrock.ts` 상수 | `global.anthropic.claude-sonnet-5` (+폴백) |
| Collector Lambda env | NfmDash-Data 스택 주입 | `TABLE_FLOWS` `TABLE_META` `MONITORS` `CONCURRENCY=5` |
| 로컬 dev 인증 스킵 | `AUTH_DISABLED=1` (dev 전용 — production에선 무시됨) | `AUTH_DISABLED=1 npm -w app run dev` |
| E2E | `APP_URL` `E2E_EMAIL` `E2E_PASSWORD` | `scripts/smoke.sh`가 자동 주입 |

## 사용법 / Usage

1. **접속**: https://dv4r4bnlhlpcx.cloudfront.net → 자동으로 `/login` → "Sign in" → Cognito Hosted UI에서 `admin@whchoi.net` + 저장한 비밀번호로 로그인.
2. **페이지**: `/`(KPI 4종 + NHI) · `/topology`(Pod-to-Pod 그래프, 필터, 엣지→경로 패널) · `/flows`(플로우 테이블/카드) · `/paths`(pod쌍 경로: pod→노드→서브넷→AZ→VPC + traversedConstructs + SNAT/DNAT) · `/insights`(Workload Insights) · `/diagnose` · `/agents`(에이전트 커버리지).
3. **AI 챗**: 우하단 플로팅 버튼 → 질문 입력. 에이전트가 gateway의 27개 MCP 도구(NFM 조회, 적재 데이터, VPC/TGW/reachability)를 호출하며 토큰 단위 SSE 스트리밍. 팝업 아이콘으로 별도 창/시트 분리 가능.
4. **LLM 진단**: `/diagnose` — 최신 토폴로지 + 이상 플로우(재전송·타임아웃 상위) 컨텍스트로 스트리밍 진단, **Regenerate** 버튼으로 재생성.
5. **언어/테마**: 상단 바에서 한/영 토글(localStorage 저장, SSE 상태 메시지 포함 이중언어) 및 라이트/다크 토글. iPhone 웹(Safari) 반응형 지원.
6. **수동 수집**: 대시보드 새로고침 버튼(→ `POST /api/nfm/refresh`)으로 Collector 즉시 실행.

## 운영 / Operations

- **알람** (NfmDash-Ops → SNS 토픽 `nfm-dashboard-alarms`, ALARM+OK 모두 발송): `nfm-dashboard-collector-errors`(Lambda Errors ≥1 ×3회/5분), `nfm-dashboard-alb-no-healthy-hosts`(HealthyHostCount <1 ×3분), `nfm-dashboard-alb-5xx`(ELB 5xx >10/5분). 구독:

  ```bash
  aws sns subscribe --topic-arn arn:aws:sns:ap-northeast-2:<ACCOUNT_ID>:nfm-dashboard-alarms \
    --protocol email --notification-endpoint you@example.com
  ```

- **E2E 스모크**: `bash scripts/smoke.sh` (전체 3 spec) / `bash scripts/smoke.sh -g login` (필터). 로그인→KPI, 챗 SSE 실응답, iPhone 뷰포트 무가로스크롤을 라이브 URL에서 검증.
- **수집 주기**: EventBridge Scheduler 5분. 사이클당 최대 60 NFM 쿼리(모니터 5 × metric 4 × category 3) + Workload Insights, 동시성 5 + 지수 백오프, 부분 실패 허용. 데이터 TTL 7일. 수집 상태는 `nfm-dashboard-meta`와 `/agents` 페이지에서 확인.
- **재배포**: 앱 변경 시 `bash scripts/build-push.sh` → `cdk deploy NfmDash-App -c imageTag=<새 sha>`. 태그가 불변이므로 태스크 재시작으로 이미지가 바뀌는 일이 없다.
- **비용 메모** (개략): 상시 비용은 ECS Fargate 1 task(1 vCPU/2GB, arm64) + ALB + NATGW 트래픽. 종량 비용은 DynamoDB on-demand, Collector/도구 Lambda(5분 주기), CloudFront, NFM 쿼리, 그리고 챗/진단 사용 시 Bedrock 토큰. 미사용 시 Bedrock 비용은 0.

## 어트리뷰션 / Attribution

- **UI 디자인**: [SnowUI — Dashboard UI Kit](https://www.figma.com/community/file/1210542873091115123/dashboard-ui-kit-dashboard-free-admin-dashboard) by **ByeWind**, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). 본 프로젝트는 SnowUI의 레이아웃/컬러 토큰/타이포그래피를 참조해 구현했습니다.
- **패턴 참조**: [whchoi98/awsops](https://github.com/whchoi98/awsops) — AgentCore Gateway/타겟 생성, Lambda MCP 핸들러 계약, SSE 이벤트 규약, i18n 구조의 원본 패턴.

## 알려진 제약 / Known Limitations

- **단일 계정/단일 리전**: NFM Scope는 계정/리전당 1개(고정 쿼터). 멀티 계정/리전, 커스텀 도메인(Route53), AgentCore Runtime/Memory는 범위 외.
- **Gateway는 CFN 밖에서 생성**: `nfm-gateway`는 `scripts/setup-gateway.sh`(boto3)로 생성 — 스택 삭제 시 함께 삭제되지 않으므로 정리도 스크립트/콘솔로 수행.
- **모든 cdk 명령에 `-c imageTag` 필요**: App 스택이 synth 시 태그를 검증하기 때문 (위 배포 가이드 참조). 계정에 이미 존재하던 ECR 리포는 MUTABLE일 수 있음(신규 생성 시엔 IMMUTABLE) — 배포는 SHA 태그 고정이라 실질 영향 없음.
- **Cognito 토큰 유효기간 8시간**: 만료 시 재로그인 필요. 초기 사용자는 `admin@whchoi.net` 1명(추가 사용자는 콘솔/CLI로 생성).
- **EKS 메타데이터 제약**(NFM 자체): 타 클러스터의 remote pod는 미해석, control plane 소유 pod는 이름 비노출, `ExternalTrafficPolicy: Cluster`의 NodePort/LB instance mode는 노드 IP로 보고됨.
- **구형 SSM Agent**: 일부 오래된 EC2는 Distributor 설치 전 `AWS-UpdateSSMAgent` 선행이 필요할 수 있음(State Manager Association이 1일 주기로 재시도).
- **collector 알람 사각지대**: Scheduler가 비활성화되어 호출 자체가 0이 되는 경우는 오류 알람이 잡지 못함.

## 참조 문서 / References

- 설계 스펙: `docs/superpowers/specs/2026-07-08-nfm-dashboard-design.md`
- [NFM API Reference](https://docs.aws.amazon.com/networkflowmonitor/2.0/APIReference/API_Operations.html) · [KubernetesMetadata](https://docs.aws.amazon.com/networkflowmonitor/2.0/APIReference/API_KubernetesMetadata.html) · [EKS add-on 설치](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-NetworkFlowMonitor-agents-kubernetes-eks.html) · [CW 메트릭](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-NetworkFlowMonitor-cw-metrics.html)
