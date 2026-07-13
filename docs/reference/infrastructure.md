# Infrastructure / 인프라 구현 상세

[![English](https://img.shields.io/badge/Language-English-blue)](#english)
[![한국어](https://img.shields.io/badge/Language-한국어-red)](#korean)

<a id="english"></a>
## English

### 1. Overview
Runtime infrastructure for the dashboard: a Next.js container image (linux/arm64) runs on ECS Fargate behind an ALB, fronted by CloudFront with Cognito Hosted UI auth, plus CloudWatch operational alarms. Live at https://dv4r4bnlhlpcx.cloudfront.net (account `<ACCOUNT_ID>`, `ap-northeast-2`).

### 2. Components
| Component | Path | Purpose |
|---|---|---|
| App container image | `app/Dockerfile` | Next.js standalone build; linux/arm64 image consumed by `NfmDash-App` |
| App stack | `infra/lib/app-stack.ts` | `NfmDash-App`: ECR image → ECS Fargate (arm64) behind ALB, fronted by CloudFront, Cognito Hosted UI (PKCE); login temporarily disabled via `authDisabled` context (ADR-005) |
| Ops alarms stack | `infra/lib/ops-alarms.ts` | `NfmDash-Ops`: CloudWatch alarms on the ALB / target group from AppStack |
| Image build script | `scripts/build-push.sh` | Builds and pushes the app image to ECR (tag = git sha) |
| Smoke test | `scripts/smoke.sh`, `e2e/smoke.spec.ts` | Playwright e2e smoke against the live CloudFront URL |

### 3. Key Decisions
<!-- TODO: list 3-5 decisions or link to docs/decisions/ADR-*.md -->

### 4. Code Pointers
<!-- TODO: 3-7 entries; paths must be valid (checked by /sync-docs) -->
- `infra/lib/app-stack.ts` — header comment documents the ALB → CloudFront → Cognito circular-dependency resolution and the origin-verify secret wiring; ALB ingress is restricted to the CloudFront origin-facing managed prefix list
- `app/Dockerfile` — image built by `scripts/build-push.sh <sha>` and deployed via `npx cdk deploy NfmDash-App -c imageTag=<sha>`
- `infra/lib/ops-alarms.ts` — takes `alb` / `targetGroup` props from AppStack (see `infra/bin/nfm-dashboard.ts`)
- `app/src/app/api/health/route.ts` — unauthenticated ALB target-group healthcheck endpoint

### 5. Cross-references
<!-- TODO -->
- Related modules: `infra/CLAUDE.md`, `app/CLAUDE.md`
- Related ADRs:
- Related runbooks:

<a id="korean"></a>
## 한국어

### 1. 개요
대시보드 런타임 인프라: Next.js 컨테이너 이미지(linux/arm64)가 ALB 뒤 ECS Fargate에서 실행되고, CloudFront + Cognito Hosted UI 인증으로 프론팅되며, CloudWatch 운영 알람이 붙는다. 라이브: https://dv4r4bnlhlpcx.cloudfront.net (계정 `<ACCOUNT_ID>`, `ap-northeast-2`).

### 2. 구성요소
| 구성요소 | 경로 | 목적 |
|---|---|---|
| 앱 컨테이너 이미지 | `app/Dockerfile` | Next.js standalone 빌드; `NfmDash-App`이 사용하는 linux/arm64 이미지 |
| App 스택 | `infra/lib/app-stack.ts` | `NfmDash-App`: ECR 이미지 → ALB 뒤 ECS Fargate(arm64), CloudFront 프론팅, Cognito Hosted UI(PKCE) |
| Ops 알람 스택 | `infra/lib/ops-alarms.ts` | `NfmDash-Ops`: AppStack의 ALB/타깃그룹에 대한 CloudWatch 알람 |
| 이미지 빌드 스크립트 | `scripts/build-push.sh` | 앱 이미지를 ECR에 빌드/푸시 (태그 = git sha) |
| 스모크 테스트 | `scripts/smoke.sh`, `e2e/smoke.spec.ts` | 라이브 CloudFront URL 대상 Playwright e2e 스모크 |

### 3. 주요 결정
<!-- TODO: 3-5개 결정 나열 또는 docs/decisions/ADR-*.md 링크 -->

### 4. 코드 포인터
<!-- TODO: 3-7개 항목; 경로는 실재해야 함 (/sync-docs가 점검) -->
- `infra/lib/app-stack.ts` — 헤더 주석에 ALB → CloudFront → Cognito 순환 의존성 해소와 origin-verify 시크릿 배선이 문서화됨; ALB 인그레스는 CloudFront origin-facing 관리형 prefix list로 제한
- `app/Dockerfile` — `scripts/build-push.sh <sha>`로 빌드 후 `npx cdk deploy NfmDash-App -c imageTag=<sha>`로 배포
- `infra/lib/ops-alarms.ts` — AppStack의 `alb` / `targetGroup` props 사용 (`infra/bin/nfm-dashboard.ts` 참조)
- `app/src/app/api/health/route.ts` — 비인증 ALB 타깃그룹 헬스체크 엔드포인트

### 5. 상호 참조
<!-- TODO -->
- 관련 모듈: `infra/CLAUDE.md`, `app/CLAUDE.md`
- 관련 ADR:
- 관련 런북:
