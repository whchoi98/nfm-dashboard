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

## [1.4.0] - 2026-07-11

### Changed
- **Horizontal top-nav layout**: replace the left sidebar with a horizontal top navigation bar (brand + version + menu with a "More" overflow dropdown + language/theme/refresh controls), and constrain the main content to a centered `max-w-[1536px]` so wide monitors no longer stretch content edge-to-edge.

### Removed
- Left `Sidebar` and `Topbar` components — their branding, version label, navigation, and controls now live in the new top-nav header.

## [1.3.0] - 2026-07-11

### Added
- **Network Analytics** menu (`/network`): Datadog-CNM-style source-scope → dest-scope aggregation (service/namespace/subnet/AZ/VPC/category/monitor), a metric toggle (volume/throughput/retransmits/RTT), per-row sparklines, retransmit-rate health coloring, and drill-down.
- Reusable **FacetRail** and inline **Sparkline** components.

### Changed
- **Visual polish** toward a Datadog-dense aesthetic: refined tokens, card/table chrome, table density, and empty/loading states (light + dark).
- **Topology graph**: edges are now colored by connection health (retransmit rate) alongside throughput dashing, with a health legend and metric-aware edge width.
- Broaden entity search to also match instance IDs, monitor names, and VPC IDs.

### Fixed
- Reduce anomaly spike noise with a minimum-absolute-change floor (large spikes and threshold anomalies still fire).
- Fix a CategoryDonut legend overflow in narrow cards (dark mode).

## [1.2.0] - 2026-07-11

### Added
- **Alerts / Events** menu: live CloudWatch alarm states plus a derived event feed (NHI degradation, reliability breaches, collection gaps, retransmission/timeout spikes).
- **Search** menu: unified entity search across topology nodes, recent flows, and DNS names, with deep links to the relevant page.
- **Settings** menu: user-tunable thresholds (retransmission/timeout/cost/anomaly σ), default time range, monitor filter (persisted in localStorage), and an alarm-subscribe helper.
- **Cost Explorer** menu: billed cost grouped by cluster / namespace / category / monitor, monthly run-rate, savings recommendations, and a trend.
- **Anomalies** menu: baseline-deviation detection (threshold + window-over-window spike) with an overview anomaly badge.
- **Reports / Export** menu: Markdown / CSV / print export of the current network state, plus a CSV export button on the flows table.

### Changed
- Grant the app task role `cloudwatch:DescribeAlarms` (for the Alerts menu).

## [1.1.0] - 2026-07-11

### Added
- Insights hub **Efficiency & Cost-optimization** tab: billed vs free (inter-AZ/VPC/Region) traffic ratio, estimated monthly cost run-rate, top cross-AZ talkers, and a billed-cost trend.
- Insights hub **Reliability Scorecard / SLO** tab: per-monitor NHI availability %, retransmission/timeout rates, a composite 0-100 reliability score with status, an overall availability gauge, a breach timeline, and worst services.
- Insights hub **Top Movers** tab: entities whose data-transferred / retransmissions / timeouts changed most versus the prior window (window-over-window deltas with direction).
- **DNS tab deep-dive**: internal vs external query ratio, top NXDOMAIN sources, resolver-latency band, failure breakdown by rcode, and top query sources.

## [1.0.1] - 2026-07-10

### Fixed
- Fix a React hydration mismatch (#418) on `/flows`: the bucket list was seeded from `Date.now()` + `toLocaleTimeString` in a `useState` initializer, differing between the server render and client hydration. It now starts empty and fills client-side on mount.

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

[Unreleased]: https://github.com/whchoi98/nfm-dashboard/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/whchoi98/nfm-dashboard/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/whchoi98/nfm-dashboard/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/whchoi98/nfm-dashboard/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/whchoi98/nfm-dashboard/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/whchoi98/nfm-dashboard/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/whchoi98/nfm-dashboard/releases/tag/v1.0.0

---

<a id="korean"></a>

# 한국어

이 프로젝트의 모든 주요 변경 사항은 이 파일에 기록됩니다.
이 문서는 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 기반으로 하며,
[Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 따릅니다.

> 앱 UI에 표시되는 버전은 `app/src/lib/version.ts`의 `APP_VERSION`을 읽습니다 — 이 값과 `app/package.json`을 이 파일의 최상단 항목과 동기화하여 유지합니다.

## [Unreleased]

## [1.4.0] - 2026-07-11

### Changed
- **상단 가로 내비게이션 레이아웃**: 좌측 사이드바를 상단 가로 내비게이션 바(브랜드 + 버전 + "더보기" 오버플로우 드롭다운 메뉴 + 언어/테마/새로고침 컨트롤)로 교체하고, 메인 콘텐츠를 중앙 정렬된 `max-w-[1536px]`로 제한하여 넓은 모니터에서 콘텐츠가 좌우로 과하게 늘어나지 않도록 개선.

### Removed
- 좌측 `Sidebar` 및 `Topbar` 컴포넌트 제거 — 브랜딩·버전 표기·내비게이션·컨트롤은 새 상단 내비 헤더로 이전.

## [1.3.0] - 2026-07-11

### Added
- **네트워크 분석** 메뉴(`/network`): Datadog CNM 스타일 source scope → dest scope 집계(service/namespace/subnet/AZ/VPC/category/monitor), 지표 토글(볼륨/처리량/재전송/RTT), 행별 스파크라인, 재전송률 건강도 색상, 드릴다운 추가.
- 재사용 가능한 **FacetRail** 및 inline **Sparkline** 컴포넌트 추가.

### Changed
- Datadog식 dense 미학을 향한 **비주얼 폴리시**: 토큰, 카드/테이블 크롬, 테이블 밀도, empty/loading 상태 정리(라이트+다크).
- **토폴로지 그래프**: 엣지를 처리율 점선과 함께 연결 건강도(재전송률)로 색상화, 건강도 범례 + 지표 반영 엣지 폭 추가.
- 엔티티 검색이 인스턴스 ID·모니터 이름·VPC ID까지 매칭하도록 확대.

### Fixed
- 이상 징후 spike 노이즈를 최소 절대 변화량 하한으로 감소(대형 spike와 임계값 이상은 계속 탐지).
- 좁은 카드에서 CategoryDonut 범례 오버플로우 수정(다크 모드).

## [1.2.0] - 2026-07-11

### Added
- **알림 / 이벤트** 메뉴: CloudWatch 알람 상태 + 파생 이벤트 피드(NHI 저하, 신뢰성 breach, 수집 공백, 재전송/타임아웃 급증) 추가.
- **검색** 메뉴: 토폴로지 노드·최근 플로우·DNS 이름 통합 검색 + 관련 페이지 딥링크 추가.
- **설정** 메뉴: 사용자 조정 임계값(재전송/타임아웃/비용/이상 σ), 기본 기간, 모니터 필터(localStorage 유지), 알람 구독 도우미 추가.
- **비용 탐색** 메뉴: 클러스터/네임스페이스/범주/모니터별 과금 비용, 월간 run-rate, 절감 후보, 추세 추가.
- **이상 징후** 메뉴: baseline 편차 탐지(임계값 + 창 대비 급증) + 개요 이상 배지 추가.
- **리포트 / 내보내기** 메뉴: 현재 네트워크 상태 Markdown/CSV/인쇄 내보내기 + 플로우 테이블 CSV 버튼 추가.

### Changed
- 앱 태스크 역할에 `cloudwatch:DescribeAlarms` 권한 부여(알림 메뉴용).

## [1.1.0] - 2026-07-11

### Added
- 인사이트 허브 **효율성 & 비용 최적화** 탭: 과금 vs 무료(inter-AZ/VPC/Region) 트래픽 비율, 월간 비용 run-rate 추정, 상위 cross-AZ talker, 과금 비용 추세 추가.
- 인사이트 허브 **신뢰성 스코어카드 / SLO** 탭: 모니터별 NHI 가용성 %, 재전송/타임아웃률, 0-100 복합 신뢰성 점수 + 상태, 전체 가용성 게이지, breach 타임라인, 상위 불안정 서비스 추가.
- 인사이트 허브 **Top Movers** 탭: 직전 창 대비 데이터 전송량/재전송/타임아웃이 가장 크게 변한 엔티티(창 대비 델타 + 방향) 추가.
- **DNS 탭 심화**: 내부 vs 외부 쿼리 비율, 상위 NXDOMAIN 소스, 리졸버 지연 대역, rcode별 실패 분해, 상위 질의 소스 추가.

## [1.0.1] - 2026-07-10

### Fixed
- `/flows`의 React hydration mismatch(#418) 수정: 버킷 목록을 `useState` 초기화에서 `Date.now()` + `toLocaleTimeString`으로 생성해 서버 렌더와 클라이언트 하이드레이션이 달랐음. 이제 빈 상태로 시작해 마운트 시 클라이언트에서 채움.

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

[Unreleased]: https://github.com/whchoi98/nfm-dashboard/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/whchoi98/nfm-dashboard/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/whchoi98/nfm-dashboard/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/whchoi98/nfm-dashboard/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/whchoi98/nfm-dashboard/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/whchoi98/nfm-dashboard/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/whchoi98/nfm-dashboard/releases/tag/v1.0.0
