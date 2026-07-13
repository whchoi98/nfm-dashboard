# Runbook: Production Deploy

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Overview
The procedure for shipping a change to the live NFM Dashboard
(https://dv4r4bnlhlpcx.cloudfront.net, AWS account `<ACCOUNT_ID>`, region
`ap-northeast-2`). Covers building the artifacts, deploying the affected CDK
stack(s), verifying the rollout, running the smoke test, and rolling back.

## When to Use
- Deploying an app (Next.js) change → rebuild + push the image, deploy `NfmDash-App`.
- Deploying a collector or data-tier change (collector Lambda, flows/meta tables,
  the flow-archive pipeline) → rebuild the collector bundle, deploy `NfmDash-Data`.
- Deploying infra-only changes to Ops / Dns / AgentCore / Onboarding stacks.

## Prerequisites
- AWS credentials for account `<ACCOUNT_ID>` with CDK/ECR/ECS/CloudFormation access.
- Docker (buildx, `linux/arm64` — the app image is arm64).
- Node.js + repo dependencies installed (`npm ci` at repo root).
- Working directory: repo root, `/home/ec2-user/my-project/nfm-dashboard`.
- **ECR is tag-IMMUTABLE**: a re-push of an existing SHA tag is rejected by
  design. **A new commit = a new tag.** To rebuild the same commit you must pass
  a fresh tag. Pick the deploy tag now (default is the current git short SHA):
  ```bash
  SHA=$(git rev-parse --short HEAD)
  ```

## Procedure

### 1. Build
For an **app** change, build + push the arm64 image to ECR (pushes the immutable
per-commit SHA tag and a convenience `latest`):
```bash
bash scripts/build-push.sh "$SHA"      # -> "Pushed image tag: <SHA>"
```
For a **Data-stack** change (collector and/or the flow-archive transform), build
the collector bundle first — the CDK synth throws if `collector/dist/handler.mjs`
or `collector/dist/archive-transform.mjs` is missing:
```bash
npm -w collector run build             # emits dist/handler.mjs + dist/archive-transform.mjs
npm -w collector run test              # optional but recommended
```

### 2. Deploy (per stack)
**ALL cdk commands require `-c imageTag`.** Only `NfmDash-App` consumes the real
tag; every other stack may pass `-c imageTag=unused`.
```bash
cd infra

# App change (image was built/pushed in step 1 as $SHA):
npx cdk deploy NfmDash-App  --require-approval never -c imageTag="$SHA"

# Data-tier change (collector bundle rebuilt in step 1):
npx cdk deploy NfmDash-Data --require-approval never -c imageTag=unused

# Ops / Dns / AgentCore / Onboarding (infra-only):
npx cdk deploy NfmDash-Ops  --require-approval never -c imageTag=unused
```
Deploy only the stack(s) you changed. If both app and data changed, deploy
`NfmDash-Data` first, then `NfmDash-App`.

> **Flow-archive note (first Data deploy / TRIM_HORIZON, no backfill):** the
> archive transform reads the flows DynamoDB Stream from `TRIM_HORIZON`, so
> archiving begins at the records present when the pipeline is created — rows
> written **before** the archive existed are **not backfilled**. Do not expect
> historical flows in the S3/Athena archive for dates before the pipeline's
> first deploy; the 7-day hot window in DynamoDB remains the only source for
> that pre-archive period until it TTL-expires.

### 3. Verify
```bash
cd infra
# a) Stack settled cleanly:
aws cloudformation describe-stacks --stack-name NfmDash-App \
  --query "Stacks[0].StackStatus" --output text          # UPDATE_COMPLETE (or CREATE_COMPLETE)

# b) ECS rollout finished (app deploys only):
aws ecs describe-services --cluster nfm-dashboard --services nfm-dashboard-app \
  --query "services[0].deployments[?rolloutState=='COMPLETED'].rolloutState" --output text

# c) ALB has a healthy target:
#    (HealthyHostCount >= 1 — same signal the NfmDash-Ops alarm watches)

# d) CloudFront edge serving:
curl -s -o /dev/null -w "%{http_code}\n" https://dv4r4bnlhlpcx.cloudfront.net/login   # 200
curl -s -o /dev/null -w "%{http_code}\n" https://dv4r4bnlhlpcx.cloudfront.net/        # 302 (-> Cognito login) — or 200 when the `authDisabled` toggle is on (ADR-005)
```

### 4. Smoke
```bash
bash scripts/smoke.sh          # live E2E; expect 3 passed (3/3)
```
The script resolves `APP_URL` from the `NfmDash-App` stack output and pulls the
Cognito admin password from Secrets Manager at runtime (never on disk).

## Verification
- [ ] Target stack status is `UPDATE_COMPLETE` / `CREATE_COMPLETE`.
- [ ] (App) ECS rollout state is `COMPLETED`.
- [ ] ALB `HealthyHostCount >= 1`.
- [ ] CloudFront `/login` → `200` and `/` → `302` (auth on) / `200` (`authDisabled` toggle).
- [ ] `bash scripts/smoke.sh` → 3/3 passing.
- [ ] No new `NfmDash-Ops` alarm (collector-errors / no-healthy-hosts / alb-5xx) in ALARM.

## Rollback
- **App**: redeploy the previous good image tag — the immutable SHA of the last
  known-good commit is still in ECR:
  ```bash
  cd infra && npx cdk deploy NfmDash-App --require-approval never -c imageTag="<previous-SHA>"
  ```
  (ECS performs a rolling replacement back to the old task definition; verify
  again per step 3–4.)
- **Data / other stacks**: `git checkout <previous-commit>` the infra change,
  rebuild the collector if it changed (`npm -w collector run build`), and
  redeploy the stack. Note the flows/meta tables and the S3 archive bucket are
  `RETAIN` — a stack rollback does not delete ingested data.
- If a deploy fails mid-rollout, CloudFormation auto-rolls-back to the previous
  template; confirm the stack returns to `UPDATE_COMPLETE`/`UPDATE_ROLLBACK_COMPLETE`
  and re-run the smoke test.

## Notes
- Live URL is unchanged across deploys: https://dv4r4bnlhlpcx.cloudfront.net.
- `-c imageTag` is mandatory on every cdk invocation (synth reads it); non-App
  stacks use `-c imageTag=unused`.
- ECR repo `nfm-dashboard-app` is tag-immutable — never reuse a SHA tag.
- Last verified: 2026-07-12

---

<a id="korean"></a>

# 한국어

## 개요
라이브 NFM Dashboard(https://dv4r4bnlhlpcx.cloudfront.net, AWS 계정
`<ACCOUNT_ID>`, 리전 `ap-northeast-2`)에 변경을 배포하는 절차. 아티팩트 빌드,
영향받는 CDK 스택 배포, 롤아웃 검증, 스모크 테스트 실행, 롤백을 다룬다.

## 사용 시점
- 앱(Next.js) 변경 배포 → 이미지 재빌드 + 푸시, `NfmDash-App` 배포.
- 컬렉터 또는 데이터 계층 변경(컬렉터 Lambda, flows/meta 테이블, flow-archive
  파이프라인) → 컬렉터 번들 재빌드, `NfmDash-Data` 배포.
- Ops / Dns / AgentCore / Onboarding 스택의 인프라 전용 변경 배포.

## 사전 요구 사항
- 계정 `<ACCOUNT_ID>`에 대한 CDK/ECR/ECS/CloudFormation 접근 권한이 있는 AWS
  자격 증명.
- Docker(buildx, `linux/arm64` — 앱 이미지는 arm64).
- Node.js + 저장소 의존성 설치(저장소 루트에서 `npm ci`).
- 작업 디렉터리: 저장소 루트, `/home/ec2-user/my-project/nfm-dashboard`.
- **ECR은 태그 IMMUTABLE**: 기존 SHA 태그의 재푸시는 설계상 거부된다.
  **새 커밋 = 새 태그.** 동일 커밋을 재빌드하려면 새 태그를 넘겨야 한다. 지금
  배포 태그를 정한다(기본값은 현재 git short SHA):
  ```bash
  SHA=$(git rev-parse --short HEAD)
  ```

## 절차

### 1. 빌드
**앱** 변경의 경우, arm64 이미지를 빌드하여 ECR에 푸시한다(불변 커밋별 SHA 태그와
편의용 `latest`를 푸시):
```bash
bash scripts/build-push.sh "$SHA"      # -> "Pushed image tag: <SHA>"
```
**Data 스택** 변경의 경우(컬렉터 및/또는 flow-archive 변환), 먼저 컬렉터 번들을
빌드한다 — `collector/dist/handler.mjs`나 `collector/dist/archive-transform.mjs`가
없으면 CDK synth가 예외를 던진다:
```bash
npm -w collector run build             # dist/handler.mjs + dist/archive-transform.mjs 생성
npm -w collector run test              # 선택이지만 권장
```

### 2. 배포(스택별)
**모든 cdk 명령에 `-c imageTag`가 필요하다.** 실제 태그를 소비하는 것은
`NfmDash-App`뿐이며, 다른 모든 스택은 `-c imageTag=unused`를 넘겨도 된다.
```bash
cd infra

# 앱 변경(1단계에서 $SHA로 이미지 빌드/푸시됨):
npx cdk deploy NfmDash-App  --require-approval never -c imageTag="$SHA"

# 데이터 계층 변경(1단계에서 컬렉터 번들 재빌드):
npx cdk deploy NfmDash-Data --require-approval never -c imageTag=unused

# Ops / Dns / AgentCore / Onboarding(인프라 전용):
npx cdk deploy NfmDash-Ops  --require-approval never -c imageTag=unused
```
변경한 스택만 배포한다. 앱과 데이터를 모두 변경했다면 `NfmDash-Data`를 먼저,
그다음 `NfmDash-App`을 배포한다.

> **Flow-archive 주의(첫 Data 배포 / TRIM_HORIZON, 백필 없음):** 아카이브 변환은
> flows DynamoDB Stream을 `TRIM_HORIZON`부터 읽으므로, 아카이빙은 파이프라인이
> 생성될 때 존재하는 레코드에서 시작된다 — 아카이브 존재 **이전**에 쓰인 행은
> **백필되지 않는다.** 파이프라인 최초 배포 이전 날짜의 과거 플로우가 S3/Athena
> 아카이브에 있으리라 기대하지 말 것. 그 아카이브 이전 기간에 대해서는 DynamoDB의
> 7일 hot 윈도가 TTL로 만료되기 전까지 유일한 소스로 남는다.

### 3. 검증
```bash
cd infra
# a) 스택이 정상적으로 안정됨:
aws cloudformation describe-stacks --stack-name NfmDash-App \
  --query "Stacks[0].StackStatus" --output text          # UPDATE_COMPLETE (또는 CREATE_COMPLETE)

# b) ECS 롤아웃 완료(앱 배포만 해당):
aws ecs describe-services --cluster nfm-dashboard --services nfm-dashboard-app \
  --query "services[0].deployments[?rolloutState=='COMPLETED'].rolloutState" --output text

# c) ALB에 정상 타깃 존재:
#    (HealthyHostCount >= 1 — NfmDash-Ops 알람이 감시하는 것과 동일한 신호)

# d) CloudFront 엣지 서빙:
curl -s -o /dev/null -w "%{http_code}\n" https://dv4r4bnlhlpcx.cloudfront.net/login   # 200
curl -s -o /dev/null -w "%{http_code}\n" https://dv4r4bnlhlpcx.cloudfront.net/        # 302 (-> Cognito 로그인) — `authDisabled` 토글 ON이면 200 (ADR-005)
```

### 4. 스모크
```bash
bash scripts/smoke.sh          # 라이브 E2E; 3 passed(3/3) 기대
```
스크립트는 `NfmDash-App` 스택 출력에서 `APP_URL`을 해석하고, 런타임에 Secrets
Manager에서 Cognito 관리자 비밀번호를 가져온다(디스크에 저장하지 않음).

## 검증
- [ ] 대상 스택 상태가 `UPDATE_COMPLETE` / `CREATE_COMPLETE`.
- [ ] (앱) ECS 롤아웃 상태가 `COMPLETED`.
- [ ] ALB `HealthyHostCount >= 1`.
- [ ] CloudFront `/login` → `200`, `/` → `302`(인증 ON) / `200`(`authDisabled` 토글).
- [ ] `bash scripts/smoke.sh` → 3/3 통과.
- [ ] `NfmDash-Ops` 알람(collector-errors / no-healthy-hosts / alb-5xx) 신규 ALARM 없음.

## 롤백
- **앱**: 직전 정상 이미지 태그를 재배포한다 — 마지막 known-good 커밋의 불변
  SHA가 여전히 ECR에 있다:
  ```bash
  cd infra && npx cdk deploy NfmDash-App --require-approval never -c imageTag="<이전-SHA>"
  ```
  (ECS가 이전 태스크 정의로 롤링 교체를 수행; 3~4단계로 재검증.)
- **Data / 기타 스택**: 인프라 변경을 `git checkout <이전-커밋>` 하고, 컬렉터가
  변경되었다면 재빌드(`npm -w collector run build`) 후 스택을 재배포한다.
  flows/meta 테이블과 S3 아카이브 버킷은 `RETAIN`이므로 스택 롤백으로 수집된
  데이터는 삭제되지 않는다.
- 배포가 롤아웃 도중 실패하면 CloudFormation이 이전 템플릿으로 자동 롤백한다.
  스택이 `UPDATE_COMPLETE`/`UPDATE_ROLLBACK_COMPLETE`로 돌아왔는지 확인하고
  스모크 테스트를 다시 실행한다.

## 참고
- 라이브 URL은 배포 전반에 걸쳐 불변: https://dv4r4bnlhlpcx.cloudfront.net.
- 모든 cdk 호출에 `-c imageTag`가 필수(synth가 읽음). 비-App 스택은
  `-c imageTag=unused`를 사용한다.
- ECR 저장소 `nfm-dashboard-app`은 태그 불변 — SHA 태그를 재사용하지 말 것.
- 최종 검증일: 2026-07-12
