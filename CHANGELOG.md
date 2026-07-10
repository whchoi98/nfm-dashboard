# Changelog

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> The version shown in the app UI reads `APP_VERSION` from `app/src/lib/version.ts` — keep it and `app/package.json` in sync with the top entry here.

## [Unreleased]

## [1.0.0] - 2026-07-10

First full release: AWS Network Flow Monitor (NFM) Pod-to-Pod observability dashboard with an Amazon Bedrock AgentCore chatbot, plus the Phase 6 analytics enrichment.

### Added
- **Core dashboard (Phases 1–5)**
  - Overview page with NFM KPI tiles (data transferred, retransmissions, timeouts, RTT, Network Health Indicator), deltas, sparklines, top talkers, and CloudWatch deep links.
  - Flows, Paths, Monitors, Agents, and Diagnose pages backed by a DynamoDB collector pipeline (NFM top-contributor queries, agent/monitor status, hop-path data).
  - AgentCore-powered chatbot (floating chat + `/chat-popup` standalone window) with SSE streaming, MCP tooling, and AI diagnosis.
  - Cognito login, ko/en i18n with full key parity, SnowUI design tokens with light/dark themes, mobile layout (bottom tabs, safe-area handling).
- **Analytics enrichment (Phase 6)**
  - WhaTap-style force-directed topology graph (d3-force) with tier flow map, resource icons, tag filtering, and live legend.
  - 5-tab Insights hub (Cost, Reliability, Latency, Dependencies, DNS) over analytics aggregates, with lens filters and Sankey/Toplist/StatDelta widgets.
  - Per-monitor detail pages with metric explorer, NHI striped band, hop-path stepper, and per-chart CloudWatch view/alarm links.
  - Workload Insights page (`/workload`): per-metric top contributors by flow category.
  - Flow categories expanded from 3 to all 11 NFM `destinationCategory` values (added INTERNET, AWS_SERVICE, TRANSIT_GATEWAY, LOCAL_ZONE).
  - Chatbot rework: right-side drawer, syntax highlighting, follow-up chips, stop button, and code-copy.
  - Page enrichment: overview stat deltas + sparklines, flows aggregate strip, paths default content, agents coverage gauges + collection-cycle sparkline.
  - App version label in the sidebar, synced to this changelog via `app/src/lib/version.ts`.
  - DNS insights tab loading skeleton (no "logging disabled" flash during first load).

### Changed
- Bump `app/package.json` version to 1.0.0.

### Removed
- SnowUI footer attribution link from the app shell (the CC BY 4.0 design attribution remains in README.md).

[Unreleased]: https://github.com/whchoi98/nfm-dashboard/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/whchoi98/nfm-dashboard/releases/tag/v1.0.0

---

<a id="korean"></a>

# 한국어

이 프로젝트의 모든 주요 변경 사항은 이 파일에 기록됩니다.
이 문서는 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 기반으로 하며,
[Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 따릅니다.

> 앱 UI에 표시되는 버전은 `app/src/lib/version.ts`의 `APP_VERSION`을 읽습니다 — 이 값과 `app/package.json`을 이 파일의 최상단 항목과 동기화하여 유지합니다.

## [Unreleased]

## [1.0.0] - 2026-07-10

첫 정식 릴리스: Amazon Bedrock AgentCore 챗봇을 포함한 AWS Network Flow Monitor(NFM) Pod-to-Pod 관측 대시보드, 그리고 Phase 6 분석 고도화.

### Added
- **핵심 대시보드 (Phase 1–5)**
  - NFM KPI 타일(데이터 전송량, 재전송, 타임아웃, RTT, 네트워크 상태 지표), 델타, 스파크라인, 상위 talker, CloudWatch 딥링크를 갖춘 개요 페이지 추가.
  - DynamoDB 수집 파이프라인(NFM 상위 기여자 쿼리, 에이전트/모니터 상태, 홉 경로 데이터) 기반의 Flows·Paths·Monitors·Agents·Diagnose 페이지 추가.
  - SSE 스트리밍·MCP 도구·AI 진단을 갖춘 AgentCore 챗봇(플로팅 챗 + `/chat-popup` 독립 창) 추가.
  - Cognito 로그인, 키 패리티를 갖춘 ko/en i18n, 라이트/다크 테마의 SnowUI 디자인 토큰, 모바일 레이아웃(하단 탭, safe-area 처리) 추가.
- **분석 고도화 (Phase 6)**
  - WhaTap 스타일 force-directed 토폴로지 그래프(d3-force) — 티어 플로우 맵, 리소스 아이콘, 태그 필터, 라이브 범례 추가.
  - 분석 집계 기반 5탭 Insights 허브(비용, 신뢰성, 지연, 의존성, DNS) — 렌즈 필터 + Sankey/Toplist/StatDelta 위젯 추가.
  - per-monitor 상세 페이지 — 지표 탐색기, NHI 줄무늬 밴드, 홉 경로 스텝퍼, 차트별 CloudWatch 보기/경보 링크 추가.
  - Workload Insights 페이지(`/workload`) — 흐름 범주별 지표 상위 기여자 추가.
  - 흐름 범주를 3종에서 NFM `destinationCategory` 11종 전부로 확장(INTERNET, AWS_SERVICE, TRANSIT_GATEWAY, LOCAL_ZONE 추가).
  - 챗봇 재설계 — 우측 드로어, 구문 강조, 후속 질문 칩, 정지 버튼, 코드 복사.
  - 페이지 풍성화 — 개요 델타 + 스파크라인, 플로우 집계 스트립, 경로 기본 콘텐츠, 에이전트 커버리지 게이지 + 수집 사이클 스파크라인.
  - `app/src/lib/version.ts`로 이 변경 로그와 동기화되는 사이드바 앱 버전 라벨 추가.
  - DNS 인사이트 탭 로딩 스켈레톤 추가(첫 로드 시 "로깅 비활성화" 깜빡임 제거).

### Changed
- `app/package.json` 버전을 1.0.0으로 상향.

### Removed
- 앱 셸에서 SnowUI 푸터 저작자 표시 링크 제거(CC BY 4.0 디자인 저작자 표시는 README.md에 유지).

[Unreleased]: https://github.com/whchoi98/nfm-dashboard/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/whchoi98/nfm-dashboard/releases/tag/v1.0.0
