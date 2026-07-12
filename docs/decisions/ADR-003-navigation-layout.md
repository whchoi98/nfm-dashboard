# ADR-003: Grouped Left Sidebar for Primary Navigation

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Status
Accepted — 2026-07-11

## Context
The NFM Dashboard's primary navigation has flip-flopped between two layouts,
and this ADR records the deliberate decision to settle on one — a grouped left
sidebar — to guard against a third reversal.

The history (see `CHANGELOG.md` and `git log`):

- The app originally shipped with a left `Sidebar` + `Topbar`
  (`857262a feat(app): nextjs scaffold ... responsive shell`).
- In the v0.4.0 era it was replaced by a horizontal top-nav
  (`af8321f feat(app): horizontal top-nav layout + centered max-width content
  (retire left sidebar)`): the left `Sidebar`/`Topbar` were removed, all menus
  moved into a single horizontal bar, the main content was capped at
  `max-w-[1536px]`, and menus that overflowed the row were hidden behind a
  "더보기 / More" dropdown. A follow-up (`f528b48`) even had to hide the brand
  text below `sm` to stop the header overflowing on mobile.
- In v0.6.0 (`5f0b49a feat(app): grouped left sidebar (6 groups, all menus) +
  full-width content; retire top-nav`) it was **reverted** to a grouped left
  sidebar, and `TopNav.tsx` was deleted.

The forcing function is the menu count. The navigation model in
`app/src/components/layout/nav.ts` exposes every top-level page. At the time of
this decision (v0.6.0) that was 16 menus; the count has only grown since (the
History page added in v0.7.0 makes 17). A single horizontal bar cannot show
that many items on a typical viewport without pushing roughly ten of them
behind a "More" overflow dropdown — which buries most of the product's surface
and makes discovery poor.

A comparison against `llm-monitor.whchoi.net` informed the choice: that
dashboard has only ~9 flat menus, which genuinely do fit one horizontal row, so
a top-nav is appropriate there. NFM Dashboard's menu set is nearly double that
and is semantically groupable, so the constraints are different.

## Options Considered

### Option 1: Grouped left sidebar (chosen)
A fixed-width left sidebar (`Sidebar.tsx`, `lg:w-60`) that renders
`NAV_GROUPS` from `nav.ts` — six semantic sections (Overview / Network /
Analysis / Operations / Business / Tools) — with every menu visible under its
group heading. A slim `Topbar.tsx` holds only the refresh / language / theme
controls, and the main content area runs full-width beside the sidebar.
- **Pros**: All menus are visible at once (no hidden overflow); semantic
  grouping aids scanning and discovery; scales as the menu count grows (already
  16 → 17 without layout change); vertical space for labels is effectively
  unbounded; content area reclaims the full width.
- **Cons**: A fixed left column (`lg:w-60`, ~240px) is permanently spent on
  chrome; needs a separate small-screen treatment (see `MobileTabs.tsx`).

### Option 2: Horizontal top-nav with a "More" overflow dropdown
A single horizontal bar carrying brand + version + menus + controls, with menus
beyond the visible width collapsed into a "더보기 / More" dropdown, and the
main content capped at `max-w-[1536px]`.
- **Pros**: No permanent left column — more horizontal room for content;
  familiar for products with a short, flat menu list; keeps all chrome on one
  row.
- **Cons**: With 16+ menus, roughly ten land in the "More" dropdown, hiding most
  of the product and hurting discoverability; the row is prone to overflow on
  smaller widths (the brand text had to be hidden below `sm` in `f528b48`); no
  room for semantic grouping; the `max-w-[1536px]` cap wastes space on wide
  monitors. This is the layout that was reverted.

## Decision
Adopt **Option 1**: a grouped left sidebar as the primary navigation. The
source of truth is `NAV_GROUPS` in
`app/src/components/layout/nav.ts` (six groups), with `NAV_ITEMS` derived as a
`flatMap` for flat consumers. `Sidebar.tsx` renders the grouped sidebar for
`lg` and up; `Topbar.tsx` is reduced to a slim control bar; `MobileTabs.tsx`
provides the `< lg` bottom-tab navigation (a primary-tabs set plus a "More"
sheet). `TopNav.tsx` is deleted and the `max-w-[1536px]` content cap is removed
in favor of full-width content.

The horizontal top-nav (Option 2) is explicitly rejected because the NFM
Dashboard's 16+ semantically groupable menus do not fit one row without hiding
most of them behind an overflow dropdown. This ADR is written specifically as a
reversal record so that a future change does not flip back to a top-nav without
first reckoning with the menu-count constraint documented here.

## Consequences

### Positive
- Every menu (all six groups) is exposed without an overflow dropdown, with
  semantic grouping that aids scanning and discovery.
- The layout scales with the menu count: the set grew from 16 (v0.6.0) to 17
  (v0.7.0, History) with no navigation rework.
- Removing the `max-w-[1536px]` cap gives the content the full width beside the
  sidebar.

### Negative
- A fixed left column (`Sidebar` at `lg:w-60`) is permanently reserved for
  navigation chrome on `lg`+ viewports.
- Small screens still require a separate navigation surface — `MobileTabs.tsx`
  remains for `< lg` (a primary bottom-tab set plus a "More" sheet).

## References
- `app/src/components/layout/nav.ts` — `NAV_GROUPS` (six-group source of truth)
  + `NAV_ITEMS` (`flatMap`) + `isActive`
- `app/src/components/layout/Sidebar.tsx` — grouped left sidebar (`lg:w-60`,
  `lg`+ only)
- `app/src/components/layout/Topbar.tsx` — slim control bar (refresh / language
  / theme)
- `app/src/components/layout/MobileTabs.tsx` — `< lg` bottom-tab navigation with
  a "More" sheet
- `app/src/components/layout/AppShell.tsx` — composes Sidebar + Topbar +
  MobileTabs (full-width `main`)
- `CHANGELOG.md` — `[0.6.0] - 2026-07-11` (left sidebar), `[0.4.0] - 2026-07-11`
  (horizontal top-nav, since reverted)
- `git log` — `5f0b49a` (revert to sidebar, retire top-nav), `af8321f`
  (top-nav), `857262a` (original sidebar)

---

<a id="korean"></a>

# 한국어

## 상태
승인됨 — 2026-07-11

## 배경
NFM Dashboard의 기본 내비게이션은 두 가지 레이아웃 사이를 오갔다. 본 ADR은 세
번째 번복을 막기 위해 하나 — 그룹형 좌측 사이드바 — 로 정착하기로 한 의도적
결정을 기록한다.

경위(`CHANGELOG.md` 및 `git log` 참조):

- 앱은 처음에 좌측 `Sidebar` + `Topbar`로 출시되었다
  (`857262a feat(app): nextjs scaffold ... responsive shell`).
- v0.4.0 시기에 수평 top-nav로 교체되었다
  (`af8321f feat(app): horizontal top-nav layout + centered max-width content
  (retire left sidebar)`): 좌측 `Sidebar`/`Topbar`가 제거되고, 모든 메뉴가 하나의
  수평 바로 옮겨졌으며, 본문은 `max-w-[1536px]`로 제한되고, 한 줄을 넘치는 메뉴는
  "더보기 / More" 드롭다운 뒤로 숨겨졌다. 후속 커밋(`f528b48`)에서는 모바일에서
  헤더가 넘치지 않도록 `sm` 미만에서 브랜드 텍스트를 숨겨야 했다.
- v0.6.0(`5f0b49a feat(app): grouped left sidebar (6 groups, all menus) +
  full-width content; retire top-nav`)에서 그룹형 좌측 사이드바로 **번복**되었고
  `TopNav.tsx`가 삭제되었다.

강제 요인은 메뉴 개수다. `app/src/components/layout/nav.ts`의 내비게이션 모델은
모든 최상위 페이지를 노출한다. 본 결정 시점(v0.6.0)에는 16개 메뉴였고, 이후로
개수는 늘기만 했다(v0.7.0에서 추가된 History 페이지로 17개). 하나의 수평 바로는
일반적인 뷰포트에서 이만큼의 항목을 약 열 개를 "더보기" 오버플로 드롭다운 뒤로
밀어넣지 않고는 표시할 수 없으며, 이는 제품 표면의 대부분을 묻어버려 발견성을
떨어뜨린다.

`llm-monitor.whchoi.net`과의 비교가 선택에 영향을 주었다: 그 대시보드는 평평한
메뉴가 ~9개뿐이라 실제로 한 줄에 들어가므로 top-nav가 적합하다. NFM Dashboard의
메뉴 집합은 그 거의 두 배이고 의미상 그룹화가 가능하므로 제약이 다르다.

## 검토한 옵션

### 옵션 1: 그룹형 좌측 사이드바 (채택)
`nav.ts`의 `NAV_GROUPS`를 렌더링하는 고정 폭 좌측 사이드바(`Sidebar.tsx`,
`lg:w-60`) — 여섯 개의 의미론적 섹션(Overview / Network / Analysis /
Operations / Business / Tools) — 로, 모든 메뉴가 각 그룹 제목 아래에 보인다. 슬림한
`Topbar.tsx`는 새로고침 / 언어 / 테마 컨트롤만 담고, 본문 영역은 사이드바 옆에서
전체 폭을 사용한다.
- **장점**: 모든 메뉴가 한 번에 보임(숨겨진 오버플로 없음). 의미론적 그룹화가
  훑어보기와 발견을 도움. 메뉴 개수가 늘어도 확장됨(레이아웃 변경 없이 이미
  16 → 17). 레이블을 위한 세로 공간이 사실상 무제한. 본문이 전체 폭을 회수.
- **단점**: 고정 좌측 열(`lg:w-60`, 약 240px)이 크롬에 영구히 소비됨. 소형 화면을
  위한 별도 처리가 필요함(`MobileTabs.tsx` 참조).

### 옵션 2: "더보기" 오버플로 드롭다운이 있는 수평 top-nav
브랜드 + 버전 + 메뉴 + 컨트롤을 담은 하나의 수평 바로, 보이는 폭을 넘는 메뉴는
"더보기 / More" 드롭다운으로 접히고, 본문은 `max-w-[1536px]`로 제한된다.
- **장점**: 영구 좌측 열이 없음 — 본문을 위한 수평 공간이 더 많음. 짧고 평평한
  메뉴 목록을 가진 제품에 익숙함. 모든 크롬을 한 줄에 유지.
- **단점**: 16개 이상의 메뉴에서는 약 열 개가 "더보기" 드롭다운으로 들어가 제품의
  대부분을 숨기고 발견성을 해침. 좁은 폭에서 줄이 넘치기 쉬움(`f528b48`에서 `sm`
  미만 브랜드 텍스트를 숨겨야 했음). 의미론적 그룹화 여지가 없음. `max-w-[1536px]`
  제한이 와이드 모니터에서 공간을 낭비함. 이것이 번복된 레이아웃이다.

## 결정
**옵션 1**을 채택한다: 기본 내비게이션으로 그룹형 좌측 사이드바. 진실의 원천은
`app/src/components/layout/nav.ts`의 `NAV_GROUPS`(여섯 그룹)이며, 평면 소비자를
위해 `NAV_ITEMS`가 `flatMap`으로 파생된다. `Sidebar.tsx`는 `lg` 이상에서 그룹형
사이드바를 렌더링하고, `Topbar.tsx`는 슬림한 컨트롤 바로 축소되며,
`MobileTabs.tsx`가 `< lg` 하단 탭 내비게이션(기본 탭 세트 + "더보기" 시트)을
제공한다. `TopNav.tsx`는 삭제되고 `max-w-[1536px]` 본문 제한은 제거되어 전체 폭
본문을 사용한다.

수평 top-nav(옵션 2)는 명시적으로 기각한다: NFM Dashboard의 16개 이상, 의미상
그룹화 가능한 메뉴는 대부분을 오버플로 드롭다운 뒤로 숨기지 않고는 한 줄에 들어가지
않기 때문이다. 본 ADR은 향후 변경이 여기 기록된 메뉴 개수 제약을 먼저 고려하지
않고 top-nav로 되돌아가지 않도록 하는 번복 기록으로서 특별히 작성되었다.

## 영향

### 긍정적
- 모든 메뉴(여섯 그룹 전체)가 오버플로 드롭다운 없이 노출되며, 훑어보기와 발견을
  돕는 의미론적 그룹화가 적용됨.
- 레이아웃이 메뉴 개수에 따라 확장됨: 집합이 16개(v0.6.0)에서 17개(v0.7.0,
  History)로 늘었으나 내비게이션 재작업이 없었음.
- `max-w-[1536px]` 제한 제거로 본문이 사이드바 옆에서 전체 폭을 사용함.

### 부정적
- 고정 좌측 열(`Sidebar`, `lg:w-60`)이 `lg`+ 뷰포트에서 내비게이션 크롬에 영구
  예약됨.
- 소형 화면은 여전히 별도의 내비게이션 표면이 필요함 — `< lg`용 `MobileTabs.tsx`가
  유지됨(기본 하단 탭 세트 + "더보기" 시트).

## 참고 자료
- `app/src/components/layout/nav.ts` — `NAV_GROUPS`(여섯 그룹 진실의 원천)
  + `NAV_ITEMS`(`flatMap`) + `isActive`
- `app/src/components/layout/Sidebar.tsx` — 그룹형 좌측 사이드바(`lg:w-60`,
  `lg`+ 전용)
- `app/src/components/layout/Topbar.tsx` — 슬림 컨트롤 바(새로고침 / 언어 / 테마)
- `app/src/components/layout/MobileTabs.tsx` — "더보기" 시트가 있는 `< lg` 하단 탭
  내비게이션
- `app/src/components/layout/AppShell.tsx` — Sidebar + Topbar + MobileTabs 조합
  (전체 폭 `main`)
- `CHANGELOG.md` — `[0.6.0] - 2026-07-11`(좌측 사이드바), `[0.4.0] - 2026-07-11`
  (수평 top-nav, 이후 번복됨)
- `git log` — `5f0b49a`(사이드바로 번복, top-nav 폐기), `af8321f`(top-nav),
  `857262a`(원래 사이드바)
