# Frontend / Frontend 구현 상세

[![English](https://img.shields.io/badge/Language-English-blue)](#english)
[![한국어](https://img.shields.io/badge/Language-한국어-red)](#korean)

<a id="english"></a>
## English

### 1. Overview
Next.js 16 App Router frontend (React 19): one page per dashboard view under `app/src/app/`, bilingual ko/en UI via a `t()` i18n context, data fetched from the in-app API routes via polling/SSE hooks.

### 2. Components
| Component | Path | Purpose |
|---|---|---|
| Pages | `app/src/app/` | Views: overview (`page.tsx`), flows, topology, paths, workload, monitors, insights, diagnose, agents, chat-popup, login |
| Root layout | `app/src/app/layout.tsx` | App shell wiring, providers, global styles (`globals.css`) |
| i18n | `app/src/lib/i18n/` | `LanguageContext.tsx` + `translations/{ko,en}.json`; every UI string via `t()` |
| Data hooks | `app/src/lib/use-sse.ts`, `app/src/lib/use-polling.ts`, `app/src/lib/hooks/useAnalyticsFilters.ts` | SSE / polling data fetching and filter state |
| View logic | `app/src/lib/{topology-graph,flow-aggregates,overview-metrics,recent-paths,format}.ts` | Client-safe transforms feeding the components |
| Route protection | `app/src/middleware.ts` | Redirects unauthenticated page requests to `/login` |

### 3. Key Decisions
<!-- TODO: list 3-5 decisions or link to docs/decisions/ADR-*.md -->

### 4. Code Pointers
<!-- TODO: 3-7 entries; paths must be valid (checked by /sync-docs) -->
- `app/src/app/layout.tsx` — root layout; new pages register navigation in `app/src/components/layout/nav.ts`
- `app/src/lib/i18n/LanguageContext.tsx` — language state + `t()`; add keys to BOTH `translations/ko.json` and `translations/en.json`
- `app/src/lib/use-sse.ts` — client consumption of SSE endpoints (AI chat)

### 5. Cross-references
<!-- TODO -->
- Related modules: `app/CLAUDE.md`, `app/src/components/CLAUDE.md`
- Related ADRs:
- Related runbooks:

<a id="korean"></a>
## 한국어

### 1. 개요
Next.js 16 App Router 프론트엔드(React 19): `app/src/app/` 아래 대시보드 뷰별 페이지, `t()` i18n 컨텍스트 기반 한/영 이중 UI, polling/SSE 훅으로 인앱 API 라우트에서 데이터 조회.

### 2. 구성요소
| 구성요소 | 경로 | 목적 |
|---|---|---|
| 페이지 | `app/src/app/` | 뷰: overview(`page.tsx`), flows, topology, paths, workload, monitors, insights, diagnose, agents, chat-popup, login |
| 루트 레이아웃 | `app/src/app/layout.tsx` | 앱 셸 연결, 프로바이더, 전역 스타일(`globals.css`) |
| i18n | `app/src/lib/i18n/` | `LanguageContext.tsx` + `translations/{ko,en}.json`; 모든 UI 문자열은 `t()` 경유 |
| 데이터 훅 | `app/src/lib/use-sse.ts`, `app/src/lib/use-polling.ts`, `app/src/lib/hooks/useAnalyticsFilters.ts` | SSE/polling 데이터 조회 및 필터 상태 |
| 뷰 로직 | `app/src/lib/{topology-graph,flow-aggregates,overview-metrics,recent-paths,format}.ts` | 컴포넌트에 공급되는 클라이언트-세이프 변환 |
| 라우트 보호 | `app/src/middleware.ts` | 비인증 페이지 요청을 `/login`으로 리다이렉트 |

### 3. 주요 결정
<!-- TODO: 3-5개 결정 나열 또는 docs/decisions/ADR-*.md 링크 -->

### 4. 코드 포인터
<!-- TODO: 3-7개 항목; 경로는 실재해야 함 (/sync-docs가 점검) -->
- `app/src/app/layout.tsx` — 루트 레이아웃; 새 페이지는 `app/src/components/layout/nav.ts`에 내비게이션 등록
- `app/src/lib/i18n/LanguageContext.tsx` — 언어 상태 + `t()`; 키는 `translations/ko.json`과 `translations/en.json` 양쪽에 추가
- `app/src/lib/use-sse.ts` — SSE 엔드포인트(AI 채팅)의 클라이언트 소비

### 5. 상호 참조
<!-- TODO -->
- 관련 모듈: `app/CLAUDE.md`, `app/src/components/CLAUDE.md`
- 관련 ADR:
- 관련 런북:
