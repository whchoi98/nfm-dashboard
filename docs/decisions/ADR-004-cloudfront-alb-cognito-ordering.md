# ADR-004: CloudFront → ALB → Cognito Circular-Dependency Ordering in the App Stack

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Status
Accepted — 2026-07-08 (original infra)

## Context
`infra/lib/app-stack.ts` provisions the public front end of the NFM Dashboard:
an ECR image on ECS Fargate (arm64) behind an internet-facing ALB, fronted by a
CloudFront distribution, with authentication via the Cognito Hosted UI (public
client + PKCE). These constructs have a naive **circular reference**:

- The **ALB** is CloudFront's origin — CloudFront needs the ALB's DNS name.
- The **CloudFront distribution** domain name is the app's public URL — call it
  `APP_URL` (`https://<distributionDomainName>`).
- **Cognito** must know `APP_URL` at creation time: the `UserPoolClient`
  `callbackUrls`/`logoutUrls` (`${APP_URL}/api/auth/callback`, `${APP_URL}/login`)
  and the OAuth redirect flow are pinned to that exact host.
- The **container env** also needs `APP_URL`, plus `COGNITO_*` values, so the
  running app can build the same redirect/callback URLs and verify tokens.

Written the obvious way — ALB → listener/target group pointing at the ECS
service, service using a task definition that embeds `APP_URL`, `APP_URL` derived
from CloudFront, CloudFront's origin being the ALB — CloudFormation sees a cycle
it cannot topologically order, and `cdk synth`/deploy fails. A second, quieter
source of churn is the `X-Origin-Verify` shared secret used to prove requests
reached the ALB via CloudFront (the ALB security group only admits the CloudFront
origin-facing managed prefix list): if that secret were generated at synth time
it would change on every deploy and force both the CloudFront distribution and
the ECS task definition to be replaced on each rollout.

## Options Considered

### Option 1: Break the cycle with a deferred ALB listener + one-directional URL token (chosen)
Create the ALB first **without** any listener or target group — CloudFront only
needs the ALB's `loadBalancerDnsName`, not its targets. Build the CloudFront
distribution against that DNS name; its `distributionDomainName` token becomes
`APP_URL`. That single token then flows **one-directionally** into both the
Cognito `UserPoolClient` callback/logout URLs and the ECS task-definition env.
The listener and target group (which reference the ECS service) are added
**last**, after the service exists. CloudFormation now has a linear order:
ALB → Distribution → (UserPoolClient, TaskDefinition) → Service →
Listener/TargetGroup.
- **Pros**: No cycle, no custom resources or lookups to bridge it; the ordering
  is expressed purely through normal CDK token dependencies; matches how the ALB
  is already used elsewhere (its DNS name is stable and known before targets
  exist).
- **Cons**: The ordering is implicit — a future edit that makes CloudFront (or
  Cognito) depend on the ECS service, or that adds the listener before the
  service, silently reintroduces the cycle. The header comment in `app-stack.ts`
  exists specifically to warn against that.

### Option 2: Custom/pre-provisioned domain, or a two-phase deploy
Assign a stable custom domain (Route 53 + ACM) to CloudFront up front, or deploy
in two passes (create CloudFront, read its domain, feed it back into Cognito and
the task def on a second deploy).
- **Pros**: `APP_URL` is known independently of the CloudFront token, fully
  decoupling Cognito and the container from distribution creation.
- **Cons**: A custom domain is extra infrastructure and DNS/cert lifecycle the
  project does not otherwise need (the app is reached at the raw
  `*.cloudfront.net` name); a two-phase deploy is operationally fragile and
  breaks single-command `cdk deploy NfmDash-App`.

### Option 3: Wildcard/looser Cognito callback URLs
Register broad or placeholder callback/logout URLs so Cognito need not depend on
`APP_URL` at all.
- **Pros**: Trivially removes Cognito from the dependency chain.
- **Cons**: Cognito requires exact-match redirect URIs for the authorization
  code grant; loosening them weakens the OAuth security posture and still would
  not decouple the container env, which genuinely needs `APP_URL`.

## Decision
Adopt **Option 1**, exactly as implemented in `infra/lib/app-stack.ts` and
documented in that file's header comment:

1. The ALB is created first with **no listener targets** — CloudFront only
   consumes its DNS name.
2. The CloudFront `Distribution` references the ALB DNS (`HttpOrigin(alb
   .loadBalancerDnsName)`); its `distributionDomainName` token becomes
   `APP_URL` (`const appUrl = \`https://${distribution.distributionDomainName}\``).
3. The Cognito `UserPoolClient` `callbackUrls`/`logoutUrls` and the container env
   both **consume** the `appUrl` token — a one-way dependency, so CloudFormation
   orders: ALB → Distribution → (UserPoolClient, TaskDefinition) → Service →
   Listener/TargetGroup. The listener/target group are added only after the
   `FargateService` exists.
4. `ORIGIN_VERIFY_SECRET` is a Secrets Manager **generated** secret
   (`nfm-dashboard/origin-verify`), stable across deploys (no synth-time
   randomness → no task-def/distribution churn), injected into CloudFront as the
   `X-Origin-Verify` custom header via a CloudFormation dynamic reference and into
   the container via ECS `secrets` — never as plaintext in the template.

We reject a custom domain / two-phase deploy (Option 2) and loosened Cognito URLs
(Option 3): Option 1 keeps a single-command, single-pass deploy with exact-match
OAuth redirects and no extra DNS/cert surface.

## Consequences

### Positive
- `cdk deploy NfmDash-App` synthesizes and deploys in one pass with no cycle,
  no custom bridging resource, and no manual domain wiring.
- Exact-match Cognito redirect URIs are preserved (strong OAuth posture).
- The origin-verify secret is stable, so routine deploys do not needlessly
  replace the CloudFront distribution or the ECS task definition, and the secret
  never appears in the CloudFormation template.

### Negative
- The correct ordering is implicit in construct creation order and token flow.
  Making CloudFront or Cognito depend (directly or transitively) on the ECS
  service, or adding the ALB listener before the service, reintroduces the
  circular dependency. The header comment in `infra/lib/app-stack.ts` is the
  guardrail — read it before changing ordering.
- `APP_URL` is bound to the generated `*.cloudfront.net` domain; moving to a
  custom domain later means updating Cognito callback URLs and the container env
  together.

## References
- `infra/lib/app-stack.ts` — header comment (circular-dependency resolution +
  ordering) and the constructs it describes: `Alb` (listener added last),
  `OriginVerify` secret, `Dist` distribution + `appUrl` token, `UserPool`/
  `Client` callback/logout URLs, `TaskDef` container env + `secrets`, and the
  `Http` listener / `App` target group added after the `Service`.
- `infra/CLAUDE.md` — "Header comment documents the ALB → CloudFront → Cognito
  circular-dependency resolution — read it before touching ordering."
- `docs/reference/security.md` — Cognito auth, origin-verify, CloudFront→ALB
  perimeter.
- `docs/reference/infrastructure.md` — CloudFront + ALB + ECS Fargate runtime.

---

<a id="korean"></a>

# 한국어

## 상태
승인됨 — 2026-07-08 (최초 인프라)

## 배경
`infra/lib/app-stack.ts`는 NFM Dashboard의 공개 프런트엔드를 프로비저닝한다:
인터넷 대면 ALB 뒤의 ECS Fargate(arm64) ECR 이미지, 그 앞단의 CloudFront
배포, 그리고 Cognito Hosted UI(public client + PKCE) 인증. 이 구성요소들은
단순하게 작성하면 **순환 참조**를 갖는다:

- **ALB**가 CloudFront의 오리진이다 — CloudFront는 ALB의 DNS 이름이 필요하다.
- **CloudFront 배포**의 도메인 이름이 앱의 공개 URL이다 — 이를 `APP_URL`
  (`https://<distributionDomainName>`)이라 하자.
- **Cognito**는 생성 시점에 `APP_URL`을 알아야 한다: `UserPoolClient`의
  `callbackUrls`/`logoutUrls`(`${APP_URL}/api/auth/callback`, `${APP_URL}/login`)와
  OAuth 리다이렉트 플로우가 정확히 그 호스트에 고정된다.
- **컨테이너 환경변수**에도 `APP_URL`과 `COGNITO_*` 값이 필요하다. 실행 중인
  앱이 동일한 리다이렉트/콜백 URL을 구성하고 토큰을 검증하기 위해서다.

명백한 방식으로 작성하면 — ALB → ECS 서비스를 가리키는 리스너/타깃 그룹, `APP_URL`을
포함한 태스크 정의를 쓰는 서비스, CloudFront에서 파생된 `APP_URL`, ALB가 오리진인
CloudFront — CloudFormation은 위상 정렬이 불가능한 순환을 만나 `cdk synth`/배포가
실패한다. 두 번째의 더 조용한 churn 원인은 요청이 CloudFront를 통해 ALB에
도달했음을 증명하는 `X-Origin-Verify` 공유 시크릿이다(ALB 보안 그룹은 CloudFront
origin-facing 관리형 프리픽스 리스트만 허용). 이 시크릿을 synth 시점에 생성하면
배포마다 값이 바뀌어 CloudFront 배포와 ECS 태스크 정의가 매 롤아웃마다 교체된다.

## 검토한 옵션

### 옵션 1: 리스너 지연 생성 + 단방향 URL 토큰으로 순환 해소 (채택)
ALB를 리스너나 타깃 그룹 **없이** 먼저 생성한다 — CloudFront는 타깃이 아니라
ALB의 `loadBalancerDnsName`만 필요하기 때문이다. 그 DNS 이름으로 CloudFront
배포를 구성하고, 그 `distributionDomainName` 토큰이 `APP_URL`이 된다. 이 단일
토큰이 이후 Cognito `UserPoolClient`의 콜백/로그아웃 URL과 ECS 태스크 정의
환경변수 양쪽으로 **단방향** 흐른다. ECS 서비스를 참조하는 리스너와 타깃
그룹은 서비스가 존재한 뒤 **마지막**에 추가한다. 이제 CloudFormation은 선형
순서를 갖는다: ALB → Distribution → (UserPoolClient, TaskDefinition) → Service
→ Listener/TargetGroup.
- **장점**: 순환 없음, 이를 잇기 위한 커스텀 리소스나 lookup 불필요. 순서가
  일반적인 CDK 토큰 의존성만으로 표현됨. ALB가 이미 사용되는 방식과 일치함(타깃
  존재 전에 DNS 이름이 안정적으로 알려짐).
- **단점**: 순서가 암묵적임 — CloudFront(또는 Cognito)가 ECS 서비스에
  의존하게 만들거나 서비스보다 먼저 리스너를 추가하는 향후 수정은 순환을
  조용히 재도입한다. `app-stack.ts`의 헤더 주석이 바로 이를 경고하기 위해
  존재한다.

### 옵션 2: 커스텀/사전 프로비저닝 도메인, 또는 2단계 배포
CloudFront에 안정적인 커스텀 도메인(Route 53 + ACM)을 미리 부여하거나, 2단계로
배포한다(CloudFront 생성 → 도메인 읽기 → 2차 배포에서 Cognito와 태스크 정의에
주입).
- **장점**: `APP_URL`이 CloudFront 토큰과 독립적으로 알려져, Cognito와 컨테이너를
  배포 생성에서 완전히 분리함.
- **단점**: 커스텀 도메인은 프로젝트가 달리 필요로 하지 않는 추가 인프라이자
  DNS/인증서 수명주기다(앱은 원시 `*.cloudfront.net` 이름으로 접근). 2단계 배포는
  운영상 취약하고 단일 명령 `cdk deploy NfmDash-App`을 깨뜨린다.

### 옵션 3: 와일드카드/느슨한 Cognito 콜백 URL
Cognito가 `APP_URL`에 전혀 의존하지 않도록 넓거나 자리표시자 콜백/로그아웃 URL을
등록한다.
- **장점**: Cognito를 의존성 체인에서 손쉽게 제거함.
- **단점**: Cognito는 authorization code grant에 대해 정확히 일치하는 리다이렉트
  URI를 요구한다. 이를 느슨하게 하면 OAuth 보안 태세가 약해지고, 실제로 `APP_URL`이
  필요한 컨테이너 환경변수는 여전히 분리되지 않는다.

## 결정
`infra/lib/app-stack.ts`에 구현되고 그 파일 헤더 주석에 문서화된 대로 **옵션 1**을
채택한다:

1. ALB를 **리스너 타깃 없이** 먼저 생성한다 — CloudFront는 DNS 이름만 소비한다.
2. CloudFront `Distribution`이 ALB DNS(`HttpOrigin(alb.loadBalancerDnsName)`)를
   참조하고, 그 `distributionDomainName` 토큰이 `APP_URL`이 된다
   (`const appUrl = \`https://${distribution.distributionDomainName}\``).
3. Cognito `UserPoolClient`의 `callbackUrls`/`logoutUrls`와 컨테이너 환경변수
   양쪽이 `appUrl` 토큰을 **소비**한다 — 단방향 의존이므로 CloudFormation은
   ALB → Distribution → (UserPoolClient, TaskDefinition) → Service →
   Listener/TargetGroup 순으로 정렬한다. 리스너/타깃 그룹은 `FargateService`가
   존재한 뒤에만 추가된다.
4. `ORIGIN_VERIFY_SECRET`은 Secrets Manager **생성** 시크릿
   (`nfm-dashboard/origin-verify`)으로, 배포 간 안정적이다(synth 시점 무작위성
   없음 → 태스크 정의/배포 churn 없음). CloudFront에는 CloudFormation 동적
   참조를 통해 `X-Origin-Verify` 커스텀 헤더로, 컨테이너에는 ECS `secrets`로
   주입되며 템플릿에 평문으로 절대 나타나지 않는다.

커스텀 도메인/2단계 배포(옵션 2)와 느슨한 Cognito URL(옵션 3)은 기각한다: 옵션
1은 정확히 일치하는 OAuth 리다이렉트와 추가 DNS/인증서 표면 없이 단일 명령·단일
패스 배포를 유지한다.

## 영향

### 긍정적
- `cdk deploy NfmDash-App`이 순환·커스텀 브리지 리소스·수동 도메인 배선 없이
  단일 패스로 synth 및 배포된다.
- 정확히 일치하는 Cognito 리다이렉트 URI가 유지된다(강한 OAuth 태세).
- origin-verify 시크릿이 안정적이라 일상 배포가 CloudFront 배포나 ECS 태스크
  정의를 불필요하게 교체하지 않으며, 시크릿이 CloudFormation 템플릿에 나타나지
  않는다.

### 부정적
- 올바른 순서가 구성요소 생성 순서와 토큰 흐름에 암묵적으로 존재한다. CloudFront나
  Cognito가 ECS 서비스에 (직접·간접) 의존하게 하거나, 서비스보다 먼저 ALB 리스너를
  추가하면 순환 의존성이 재도입된다. `infra/lib/app-stack.ts`의 헤더 주석이
  가드레일이다 — 순서를 바꾸기 전에 반드시 읽을 것.
- `APP_URL`이 생성된 `*.cloudfront.net` 도메인에 묶여 있다. 이후 커스텀 도메인으로
  이동하려면 Cognito 콜백 URL과 컨테이너 환경변수를 함께 갱신해야 한다.

## 참고 자료
- `infra/lib/app-stack.ts` — 헤더 주석(순환 의존성 해소 + 순서)과 그것이 설명하는
  구성요소: `Alb`(리스너 마지막 추가), `OriginVerify` 시크릿, `Dist` 배포 +
  `appUrl` 토큰, `UserPool`/`Client` 콜백/로그아웃 URL, `TaskDef` 컨테이너
  환경변수 + `secrets`, 그리고 `Service` 이후 추가되는 `Http` 리스너 / `App`
  타깃 그룹.
- `infra/CLAUDE.md` — "Header comment documents the ALB → CloudFront → Cognito
  circular-dependency resolution — read it before touching ordering."
- `docs/reference/security.md` — Cognito 인증, origin-verify, CloudFront→ALB
  경계.
- `docs/reference/infrastructure.md` — CloudFront + ALB + ECS Fargate 런타임.
