# Security / 보안 구현 상세

[![English](https://img.shields.io/badge/Language-English-blue)](#english)
[![한국어](https://img.shields.io/badge/Language-한국어-red)](#korean)

<a id="english"></a>
## English

### 1. Overview
Defense in depth: CloudFront is the only public entry (ALB ingress limited to CloudFront origin-facing IPs + `x-origin-verify` shared secret), users authenticate via Cognito Hosted UI (PKCE) with a session cookie enforced by Next.js middleware, and server-to-gateway calls are SigV4-signed (AWS_IAM).

### 2. Components
| Component | Path | Purpose |
|---|---|---|
| Auth middleware | `app/src/middleware.ts` | Session-cookie gate on all non-public routes; constant-time `x-origin-verify` check; `AUTH_DISABLED=1` dev bypass refused in production builds |
| Auth library | `app/src/lib/auth.ts` | Cognito ID-token verification, `SESSION_COOKIE_NAME`, `safeEqual` |
| Auth routes | `app/src/app/api/auth/{login,callback,logout}/route.ts` | Hosted UI + PKCE login/callback/logout |
| SigV4 MCP client | `app/src/lib/mcp-client.ts` | Signs AgentCore gateway requests (service `bedrock-agentcore`); unsigned requests get 401 |
| Network perimeter | `infra/lib/app-stack.ts` | ALB SG allows only the CloudFront origin-facing managed prefix list; origin-verify secret generated into Secrets Manager |
| Admin secret script | `scripts/save-cognito-secret.sh` | Stores Cognito admin credentials in Secrets Manager |

### 3. Key Decisions
<!-- TODO: list 3-5 decisions or link to docs/decisions/ADR-*.md -->

### 4. Code Pointers
<!-- TODO: 3-7 entries; paths must be valid (checked by /sync-docs) -->
- `app/src/middleware.ts` — public paths: `/login`, `/api/health`, `/favicon.ico`, `/api/auth/*`, `/_next/*`, static assets (never for `/api/*`); origin-verify compare is digest-based to avoid timing leaks
- `app/src/lib/auth.ts` — token verification consumed by middleware and auth routes
- `app/src/lib/mcp-client.ts` — SigV4 signing with `@smithy/signature-v4` + `defaultProvider` credentials

### 5. Cross-references
<!-- TODO -->
- Related modules: `app/CLAUDE.md`, `infra/CLAUDE.md`
- Related ADRs:
- Related runbooks:

<a id="korean"></a>
## 한국어

### 1. 개요
심층 방어: 공개 진입점은 CloudFront뿐이며(ALB 인그레스는 CloudFront origin-facing IP + `x-origin-verify` 공유 시크릿으로 제한), 사용자는 Cognito Hosted UI(PKCE)로 인증하고 Next.js 미들웨어가 세션 쿠키를 강제한다. 서버→게이트웨이 호출은 SigV4 서명(AWS_IAM)으로 보호된다.

### 2. 구성요소
| 구성요소 | 경로 | 목적 |
|---|---|---|
| 인증 미들웨어 | `app/src/middleware.ts` | 비공개 전 경로 세션 쿠키 게이트; 상수 시간 `x-origin-verify` 검증; `AUTH_DISABLED=1` dev 바이패스는 프로덕션 빌드에서 거부 |
| 인증 라이브러리 | `app/src/lib/auth.ts` | Cognito ID 토큰 검증, `SESSION_COOKIE_NAME`, `safeEqual` |
| 인증 라우트 | `app/src/app/api/auth/{login,callback,logout}/route.ts` | Hosted UI + PKCE 로그인/콜백/로그아웃 |
| SigV4 MCP 클라이언트 | `app/src/lib/mcp-client.ts` | AgentCore 게이트웨이 요청 서명(서비스 `bedrock-agentcore`); 미서명 요청은 401 |
| 네트워크 경계 | `infra/lib/app-stack.ts` | ALB SG는 CloudFront origin-facing 관리형 prefix list만 허용; origin-verify 시크릿은 Secrets Manager 생성 |
| 관리자 시크릿 스크립트 | `scripts/save-cognito-secret.sh` | Cognito 관리자 자격증명을 Secrets Manager에 저장 |

### 3. 주요 결정
<!-- TODO: 3-5개 결정 나열 또는 docs/decisions/ADR-*.md 링크 -->

### 4. 코드 포인터
<!-- TODO: 3-7개 항목; 경로는 실재해야 함 (/sync-docs가 점검) -->
- `app/src/middleware.ts` — 공개 경로: `/login`, `/api/health`, `/favicon.ico`, `/api/auth/*`, `/_next/*`, 정적 자산(`/api/*`에는 미적용); origin-verify 비교는 타이밍 누출 방지를 위해 다이제스트 기반
- `app/src/lib/auth.ts` — 미들웨어·인증 라우트가 사용하는 토큰 검증
- `app/src/lib/mcp-client.ts` — `@smithy/signature-v4` + `defaultProvider` 자격증명으로 SigV4 서명

### 5. 상호 참조
<!-- TODO -->
- 관련 모듈: `app/CLAUDE.md`, `infra/CLAUDE.md`
- 관련 ADR:
- 관련 런북:
