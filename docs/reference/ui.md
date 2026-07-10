# UI / UI 구현 상세

[![English](https://img.shields.io/badge/Language-English-blue)](#english)
[![한국어](https://img.shields.io/badge/Language-한국어-red)](#korean)

<a id="english"></a>
## English

### 1. Overview
Presentational component layer built on Tailwind CSS v4 with SnowUI design tokens: recharts + custom SVG chart primitives, a reactflow topology graph, chat UI, and the app shell. All colors flow from `app/src/lib/chart-tokens.ts`.

### 2. Components
| Component | Path | Purpose |
|---|---|---|
| Chart primitives | `app/src/components/charts/` | TimeSeries, Sankey, Heatmap, Treemap, Icicle, Pareto, Gauge, StreamGraph, RegionArcMap, … + `ChartTooltip.tsx` |
| Topology graph | `app/src/components/topology/` | reactflow-based pod/service topology view |
| Chat UI | `app/src/components/chat/` | `FloatingChat`, `ChatPanel`, `ChatMessages` |
| App shell | `app/src/components/layout/` | `AppShell`, `Sidebar`, `Topbar`, `MobileTabs`, `nav.ts` |
| Page widgets | `app/src/components/{cards,analytics,monitors}/` | Overview cards, analytics views, monitor widgets |
| Shared pieces | `app/src/components/{FlowTable,HopPath,Markdown,CodeBlock}.tsx`, `app/src/components/ui/Controls.tsx` | Tables, hop paths, markdown rendering, controls |
| Design tokens | `app/src/lib/chart-tokens.ts`, `app/tailwind.config.ts` | SnowUI palette — the two files must stay in sync |

### 3. Key Decisions
<!-- TODO: list 3-5 decisions or link to docs/decisions/ADR-*.md -->

### 4. Code Pointers
<!-- TODO: 3-7 entries; paths must be valid (checked by /sync-docs) -->
- `app/src/lib/chart-tokens.ts` — header comment: pastel palette is not fully CVD/contrast safe, so dual-encoding (legend + tooltip/value labels/tables) is mandatory; mirrors `app/tailwind.config.ts`
- `app/src/components/charts/ChartTooltip.tsx` — shared tooltip used across chart primitives
- `app/src/components/charts/charts-recharts.test.tsx`, `charts-custom.test.tsx` — chart test suites (co-located vitest)

### 5. Cross-references
<!-- TODO -->
- Related modules: `app/src/components/CLAUDE.md`, `app/src/lib/CLAUDE.md`
- Related ADRs:
- Related runbooks:

<a id="korean"></a>
## 한국어

### 1. 개요
Tailwind CSS v4 + SnowUI 디자인 토큰 기반 프레젠테이션 컴포넌트 계층: recharts + 커스텀 SVG 차트 프리미티브, reactflow 토폴로지 그래프, 채팅 UI, 앱 셸로 구성. 모든 색상은 `app/src/lib/chart-tokens.ts`에서 나온다.

### 2. 구성요소
| 구성요소 | 경로 | 목적 |
|---|---|---|
| 차트 프리미티브 | `app/src/components/charts/` | TimeSeries, Sankey, Heatmap, Treemap, Icicle, Pareto, Gauge, StreamGraph, RegionArcMap 등 + `ChartTooltip.tsx` |
| 토폴로지 그래프 | `app/src/components/topology/` | reactflow 기반 pod/서비스 토폴로지 뷰 |
| 채팅 UI | `app/src/components/chat/` | `FloatingChat`, `ChatPanel`, `ChatMessages` |
| 앱 셸 | `app/src/components/layout/` | `AppShell`, `Sidebar`, `Topbar`, `MobileTabs`, `nav.ts` |
| 페이지 위젯 | `app/src/components/{cards,analytics,monitors}/` | 오버뷰 카드, 분석 뷰, 모니터 위젯 |
| 공용 컴포넌트 | `app/src/components/{FlowTable,HopPath,Markdown,CodeBlock}.tsx`, `app/src/components/ui/Controls.tsx` | 테이블, hop 경로, 마크다운 렌더링, 컨트롤 |
| 디자인 토큰 | `app/src/lib/chart-tokens.ts`, `app/tailwind.config.ts` | SnowUI 팔레트 — 두 파일은 항상 동기화 유지 |

### 3. 주요 결정
<!-- TODO: 3-5개 결정 나열 또는 docs/decisions/ADR-*.md 링크 -->

### 4. 코드 포인터
<!-- TODO: 3-7개 항목; 경로는 실재해야 함 (/sync-docs가 점검) -->
- `app/src/lib/chart-tokens.ts` — 헤더 주석: 파스텔 팔레트는 CVD/명도 대비를 완전히 만족하지 못하므로 이중 인코딩(범례 + 툴팁/값 라벨/테이블) 필수; `app/tailwind.config.ts`를 미러링
- `app/src/components/charts/ChartTooltip.tsx` — 차트 프리미티브 공용 툴팁
- `app/src/components/charts/charts-recharts.test.tsx`, `charts-custom.test.tsx` — 차트 테스트 스위트(코-로케이티드 vitest)

### 5. 상호 참조
<!-- TODO -->
- 관련 모듈: `app/src/components/CLAUDE.md`, `app/src/lib/CLAUDE.md`
- 관련 ADR:
- 관련 런북:
