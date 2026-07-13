# ADR-005: Temporary Cognito Auth Disable via `authDisabled` CDK Context

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Status
Accepted — 2026-07-13. The mechanism is permanent; the toggle was briefly ON
(login disabled) on 2026-07-13 and turned **OFF the same day — login is
currently enforced**. The `demo@whchoi.net` user was added at re-enable time.

## Context
The dashboard is gated by Cognito Hosted UI (PKCE) enforced in
`app/src/middleware.ts`. The operator decided to run the dashboard **without
user login for now** (e.g. frictionless demo access), while keeping the option
to restore authentication at any time.

The middleware already had an `AUTH_DISABLED=1` bypass for local dev, but a
fail-open guard refused it in production builds (`NODE_ENV === 'production'`).
Simply relaxing that guard would have been dangerous: the bypass sat **before**
the `x-origin-verify` check, so honoring it in production would also have
disabled the CloudFront→ALB perimeter.

## Decision
1. **Middleware** (`app/src/middleware.ts`): the `AUTH_DISABLED=1` bypass is
   honored in every environment, but it was **moved below** the
   `x-origin-verify` check and the public-path handling — it skips ONLY the
   Cognito session gate. The `NODE_ENV` fail-open guard is removed (the flag is
   now a deliberate, infra-managed input, not an accident to be guarded
   against). Covered by `app/src/middleware.test.ts`, including the invariant
   *"AUTH_DISABLED=1 still returns 403 on an origin-verify mismatch"*.
2. **Infra** (`infra/lib/app-stack.ts`): a new `authDisabled` CDK context
   (persisted in `infra/cdk.json`, overridable with `-c authDisabled=...`)
   conditionally injects `AUTH_DISABLED: '1'` into the ECS task environment.
   When the context is off, the synthesized template is byte-identical to the
   pre-toggle template (the existing "no AUTH_DISABLED by default" stack test
   still passes).
3. **Cognito resources stay.** UserPool (RETAIN), client, Hosted UI domain,
   admin-user custom resource, and the `nfm-dashboard/cognito-admin` secret are
   untouched — re-enabling login requires no resource re-creation.
4. **Smoke/e2e mirror the toggle**: `scripts/smoke.sh` reads the `authDisabled`
   context from `infra/cdk.json` and exports `E2E_AUTH_DISABLED`; the spec then
   asserts the matching flow (login vs. direct entry). The mode is explicit,
   not auto-detected — auto-detection would mis-report a broken auth deploy as
   a healthy no-auth deploy.

## Consequences
- **The dashboard is publicly readable while the toggle is ON** (the only
  remaining perimeter is CloudFront + `x-origin-verify` + the ALB prefix-list
  SG, which authenticate the *path*, not the *user*). This includes the
  Bedrock-backed `/api/ai` chat and Athena-backed `/api/history` — anonymous
  visitors can incur LLM/query cost. Keep the toggle short-lived.
- Session-expiry (401) client paths go dormant but remain in place.
- RUM (aws-rum-pipeline) is unaffected — it never depended on the user login.

## Revert procedure
```bash
# 1. Remove "authDisabled": true from infra/cdk.json context (or pass -c authDisabled=false)
# 2. Redeploy the app stack (any already-pushed image tag works — the flag is env-only):
cd infra && npx cdk deploy NfmDash-App --require-approval never -c imageTag=<current-sha>
# 3. Verify: / → 302 to /login, bash scripts/smoke.sh (login flow) → 3/3
```

---

<a id="korean"></a>

# 한국어

## 상태
승인 — 2026-07-13. 메커니즘은 영구적이며, 토글은 2026-07-13 잠시 ON(로그인
비활성)이었다가 **같은 날 OFF로 전환 — 현재 로그인 강제** 상태다. 재활성화
시점에 `demo@whchoi.net` 사용자를 추가했다.

## 배경
대시보드는 `app/src/middleware.ts`가 강제하는 Cognito Hosted UI(PKCE)로
보호된다. 운영자는 인증을 언제든 원복할 수 있다는 전제 하에, **당분간
로그인 없이** 대시보드를 운영하기로 결정했다(예: 마찰 없는 데모 접근).

미들웨어에는 로컬 dev용 `AUTH_DISABLED=1` 바이패스가 이미 있었지만,
fail-open 가드가 프로덕션 빌드(`NODE_ENV === 'production'`)에서 이를
거부했다. 이 가드를 단순히 완화하는 것은 위험했다: 바이패스가
`x-origin-verify` 검증보다 **앞**에 있었기 때문에, 프로덕션에서 허용하면
CloudFront→ALB 경계까지 함께 무력화됐을 것이다.

## 결정
1. **미들웨어**(`app/src/middleware.ts`): `AUTH_DISABLED=1` 바이패스를 모든
   환경에서 허용하되, `x-origin-verify` 검증과 공개 경로 처리 **뒤로 이동** —
   Cognito 세션 게이트만 스킵한다. `NODE_ENV` fail-open 가드는 제거(이제
   플래그는 인프라가 의도적으로 주입하는 입력이지, 사고로 새는 값이 아님).
   `app/src/middleware.test.ts`가 커버하며, 특히 *"AUTH_DISABLED=1이어도
   origin-verify 불일치 시 403"* 불변식을 고정한다.
2. **인프라**(`infra/lib/app-stack.ts`): 신규 `authDisabled` CDK 컨텍스트
   (`infra/cdk.json`에 지속화, `-c authDisabled=...`로 오버라이드 가능)가
   ECS 태스크 환경에 `AUTH_DISABLED: '1'`을 조건부 주입. 컨텍스트가 꺼지면
   합성 템플릿은 토글 도입 전과 바이트 단위로 동일(기존 "기본값엔
   AUTH_DISABLED 없음" 스택 테스트 유지).
3. **Cognito 리소스는 유지.** UserPool(RETAIN), 클라이언트, Hosted UI 도메인,
   admin-user 커스텀 리소스, `nfm-dashboard/cognito-admin` 시크릿 모두 그대로 —
   로그인 재활성화에 리소스 재생성이 필요 없다.
4. **스모크/e2e가 토글을 미러링**: `scripts/smoke.sh`가 `infra/cdk.json`의
   `authDisabled` 컨텍스트를 읽어 `E2E_AUTH_DISABLED`를 export하고, spec은
   해당 모드의 플로우(로그인 vs 직행)를 단언한다. 모드는 자동 감지가 아닌
   명시 플래그 — 자동 감지는 인증이 고장난 배포를 "정상 무인증 배포"로
   오판한다.

## 결과
- **토글 ON 동안 대시보드는 공개 열람 가능**(남는 경계는 CloudFront +
  `x-origin-verify` + ALB prefix-list SG뿐이며, 이는 *경로*를 인증할 뿐
  *사용자*를 인증하지 않는다). Bedrock 기반 `/api/ai` 챗과 Athena 기반
  `/api/history`도 포함 — 익명 방문자가 LLM/쿼리 비용을 유발할 수 있다.
  토글은 단기간만 유지할 것.
- 세션 만료(401) 클라이언트 경로는 휴면 상태가 되지만 그대로 남는다.
- RUM(aws-rum-pipeline)은 영향 없음 — 애초에 사용자 로그인에 의존하지 않았다.

## 원복 절차
```bash
# 1. infra/cdk.json context에서 "authDisabled": true 제거 (또는 -c authDisabled=false)
# 2. 앱 스택 재배포 (이미 푸시된 아무 이미지 태그나 가능 — 플래그는 env 전용):
cd infra && npx cdk deploy NfmDash-App --require-approval never -c imageTag=<current-sha>
# 3. 검증: / → 302 → /login, bash scripts/smoke.sh (로그인 플로우) → 3/3
```
