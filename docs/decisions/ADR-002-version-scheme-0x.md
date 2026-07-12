# ADR-002: Renumber Version Scheme from 1.x to Pre-1.0 0.x

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Status
Accepted — 2026-07-11

## Context
The dashboard was first published as `1.0.0` and shipped a run of releases under
a `1.x` line — `1.0.0` → `1.0.1` → `1.1.0` → … → `1.5.0` (the last `1.x` release
was the Phase 11 metric-enrichment wave, `chore(release): v1.5.0`). Because the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html), a
`1.x` major number is a public promise that the API/UI surface is stable and
that breaking changes will only land on a `2.0`. That promise did not match
reality: the layout, navigation, API routes (`app/src/app/api/*`), and analytics
lens surface were still churning release-to-release (e.g. the sidebar was
introduced, retired for a horizontal top-nav, then reinstated across `1.4.0` →
`0.6.0`), and no external consumers were pinned to a stable contract yet.

Starting from `1.0.0` had over-stated the product's maturity. The next release
(the grouped-sidebar / full-width / overview-summary work, Phase 12) forced the
question: bump to `1.6.0` and keep signalling stability we do not have, or
correct the scheme. The version is surfaced in three places that must agree —
`app/src/lib/version.ts` (`APP_VERSION`, shown in the UI), `app/package.json`
(`"version"`, asserted equal by `version.test.ts`), and the top entry of
`CHANGELOG.md` — plus git tags, so any correction has to be applied uniformly.

## Options Considered

### Option 1: Renumber the whole scheme to pre-1.0 0.x (chosen)
Rewrite the entire version history down one major: every `1.y.z` becomes
`0.y.z`, so `1.0.0` → `0.0.0`, `1.0.1` → `0.0.1`, …, `1.5.0` → `0.5.0`, and
continue development from `0.6.0` (current: `0.7.0`).
- **Pros**: Honestly signals a pre-1.0, not-yet-stable product; aligns with the
  SemVer convention that `0.x` allows breaking changes in *minor* bumps, which
  matches the ongoing layout/API churn; `1.0.0` is reserved for a genuine
  stability commitment; the CHANGELOG stays a single continuous history rather
  than gaining a confusing "reset" entry.
- **Cons**: Rewrites already-published version identifiers (CHANGELOG entries and
  git tags), which is a non-append-only history edit; anyone who saw a `1.x` tag
  or UI label sees the number appear to go "backwards"; all four sources
  (`version.ts`, `package.json`, `CHANGELOG.md`, git tags) must be corrected in
  lockstep or `version.test.ts` fails and the UI disagrees with the changelog.

### Option 2: Keep the 1.x line and continue to 1.6.0
Leave history untouched and release the next work as `1.6.0`.
- **Pros**: No rewrite of published versions or tags; strictly append-only
  history; simplest mechanically.
- **Cons**: Perpetuates the false stability promise — every future breaking
  change to the API/UI would, under SemVer, demand a `2.0.0`, inflating the
  major number for a product that is still pre-stable; misleads any consumer who
  reads `1.x` as an API-stability guarantee.

### Option 3: Stay on 1.x but attach pre-release/`-alpha` tags
Keep `1.x` and denote instability with SemVer pre-release identifiers
(e.g. `1.6.0-alpha.1`).
- **Pros**: No history rewrite; explicitly flags instability in the version
  string.
- **Cons**: The `1` major still implies a shipped stable line underneath the
  pre-release suffix; pre-release strings complicate the `version.ts` /
  `package.json` / CHANGELOG equality the tests assert and the UI label; heavier
  and noisier than simply being honestly `0.x`.

## Decision
Adopt **Option 1**: renumber the whole scheme down one major to a pre-1.0 `0.x`
line. The entire `CHANGELOG.md` history was rewritten major `1` → `0`
(`1.0.0` → `0.0.0` through `1.5.0` → `0.5.0`), development continued from
`0.6.0`, and the current version is `0.7.0` in both `app/src/lib/version.ts`
(`APP_VERSION = '0.7.0'`) and `app/package.json` (`"version": "0.7.0"`). `1.0.0`
is reserved for the point at which the API/UI surface is declared stable. We
reject staying on `1.x` (Option 2) or bolting pre-release tags onto `1.x`
(Option 3) because both keep asserting a stable major that does not exist.

## Consequences

### Positive
- The version now truthfully communicates a pre-1.0, unstable-API product, so
  the layout/API churn between minors is expected rather than a SemVer
  violation.
- Under `0.x` SemVer, breaking changes are permitted in *minor* bumps, matching
  how the project actually evolves, and the major number is freed for a real
  `1.0.0` stability milestone.
- The CHANGELOG remains one continuous, self-consistent history (`0.0.0` …
  `0.7.0`) instead of carrying a jarring re-baseline entry.

### Negative
- The version identifiers were rewritten (a history edit, not append-only):
  published `1.x` git tags and any external reference to them no longer match
  the CHANGELOG, and to an outside observer the number appears to move backward.
- Version now lives in four places that must stay aligned on every release —
  `app/src/lib/version.ts`, `app/package.json`, the top `CHANGELOG.md` entry,
  and the git tag — and `version.test.ts` will fail the build if `version.ts`
  and `package.json` drift apart.

## References
- `app/src/lib/version.ts` — `APP_VERSION = '0.7.0'` (single source of truth for the UI label)
- `app/package.json` — `"version": "0.7.0"` (kept equal by `version.test.ts`)
- `CHANGELOG.md` — full history renumbered `1.x` → `0.x` (`[0.0.0]` … `[0.7.0]`); SemVer + Keep a Changelog
- git `chore(release): v0.6.0 — sidebar layout + full width + overview summary cards (renumber 1.x → 0.x)` — the renumbering release
- git `chore(release): v1.5.0 — metric enrichment first wave` — the last `1.x` release before renumbering

---

<a id="korean"></a>

# 한국어

## 상태
승인됨 — 2026-07-11

## 배경
대시보드는 처음 `1.0.0`으로 배포되어 `1.x` 라인으로 일련의 릴리스를 냈다 —
`1.0.0` → `1.0.1` → `1.1.0` → … → `1.5.0`(마지막 `1.x` 릴리스는 Phase 11
지표 고도화 1차, `chore(release): v1.5.0`). 이 프로젝트는
[Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 따르므로, `1.x`
메이저 번호는 API/UI 표면이 안정적이며 호환성 파괴 변경은 오직 `2.0`에서만
발생한다는 공개 약속이다. 그러나 이 약속은 실제와 맞지 않았다: 레이아웃,
내비게이션, API 라우트(`app/src/app/api/*`), 분석 렌즈 표면이 릴리스마다 계속
바뀌고 있었고(예: 사이드바를 도입했다가 상단 가로 내비로 폐기한 뒤 `1.4.0` →
`0.6.0`에 걸쳐 다시 복원), 아직 안정 계약에 고정된 외부 소비자도 없었다.

`1.0.0`에서 시작한 것은 제품 성숙도를 과장한 것이었다. 다음 릴리스(그룹화
사이드바 / 전체 폭 / 개요 요약 작업, Phase 12)에서 질문이 강제되었다: `1.6.0`으로
올려 없는 안정성을 계속 표방할 것인가, 아니면 스킴을 바로잡을 것인가. 버전은
서로 일치해야 하는 세 곳에 노출된다 — `app/src/lib/version.ts`(`APP_VERSION`,
UI에 표시), `app/package.json`(`"version"`, `version.test.ts`가 동일함을 단언),
그리고 `CHANGELOG.md` 최상단 항목 — 여기에 git 태그까지 더해지므로, 어떤 정정도
균일하게 적용되어야 한다.

## 검토한 옵션

### 옵션 1: 전체 스킴을 pre-1.0 0.x로 재넘버링 (채택)
전체 버전 히스토리를 메이저 하나 아래로 재작성한다: 모든 `1.y.z`를 `0.y.z`로,
즉 `1.0.0` → `0.0.0`, `1.0.1` → `0.0.1`, …, `1.5.0` → `0.5.0`, 그리고 `0.6.0`부터
개발을 계속한다(현재: `0.7.0`).
- **장점**: pre-1.0, 아직 불안정한 제품임을 정직하게 신호함. `0.x`에서는
  *마이너* 범프에도 호환성 파괴 변경이 허용된다는 SemVer 관례와 부합하며, 이는
  지속되는 레이아웃/API 변동과 맞음. `1.0.0`은 진정한 안정성 약속을 위해 예약됨.
  CHANGELOG는 혼란스러운 "리셋" 항목을 얻는 대신 단일 연속 히스토리로 유지됨.
- **단점**: 이미 배포된 버전 식별자(CHANGELOG 항목 및 git 태그)를 재작성하는
  비-append-only 히스토리 편집임. `1.x` 태그나 UI 라벨을 본 사람에게는 번호가
  "뒤로 가는" 것처럼 보임. 네 소스(`version.ts`, `package.json`, `CHANGELOG.md`,
  git 태그)를 일제히 정정하지 않으면 `version.test.ts`가 실패하고 UI가 changelog와
  어긋남.

### 옵션 2: 1.x 라인을 유지하고 1.6.0으로 계속
히스토리를 건드리지 않고 다음 작업을 `1.6.0`으로 릴리스한다.
- **장점**: 배포된 버전이나 태그를 재작성하지 않음. 엄격히 append-only 히스토리.
  기계적으로 가장 단순함.
- **단점**: 거짓 안정성 약속을 지속함 — API/UI에 대한 향후의 모든 호환성 파괴
  변경이 SemVer상 `2.0.0`을 요구하게 되어, 아직 안정 이전인 제품의 메이저 번호를
  부풀림. `1.x`를 API 안정성 보장으로 읽는 소비자를 오도함.

### 옵션 3: 1.x를 유지하되 pre-release/`-alpha` 태그를 부착
`1.x`를 유지하고 SemVer pre-release 식별자(예: `1.6.0-alpha.1`)로 불안정성을
표기한다.
- **장점**: 히스토리 재작성 없음. 버전 문자열에 불안정성을 명시적으로 표시함.
- **단점**: `1` 메이저는 pre-release 접미사 아래에 배포된 안정 라인이 있다는
  의미를 여전히 함축함. pre-release 문자열은 테스트가 단언하는
  `version.ts`/`package.json`/CHANGELOG 동일성과 UI 라벨을 복잡하게 만듦. 그냥
  정직하게 `0.x`가 되는 것보다 무겁고 잡음이 많음.

## 결정
**옵션 1**을 채택한다: 전체 스킴을 메이저 하나 아래로 재넘버링하여 pre-1.0 `0.x`
라인으로 만든다. 전체 `CHANGELOG.md` 히스토리를 메이저 `1` → `0`으로 재작성했고
(`1.0.0` → `0.0.0`부터 `1.5.0` → `0.5.0`까지), 개발은 `0.6.0`부터 계속했으며,
현재 버전은 `app/src/lib/version.ts`(`APP_VERSION = '0.7.0'`)와
`app/package.json`(`"version": "0.7.0"`) 모두에서 `0.7.0`이다. `1.0.0`은 API/UI
표면이 안정적이라고 선언되는 시점을 위해 예약한다. `1.x` 유지(옵션 2)나 `1.x`에
pre-release 태그를 덧붙이는 것(옵션 3)은, 둘 다 존재하지 않는 안정 메이저를
계속 단언하므로 기각한다.

## 영향

### 긍정적
- 버전이 이제 pre-1.0, 불안정 API 제품임을 정직하게 전달하므로, 마이너 간
  레이아웃/API 변동이 SemVer 위반이 아니라 예상된 것으로 취급됨.
- `0.x` SemVer에서는 *마이너* 범프에 호환성 파괴 변경이 허용되어 프로젝트의 실제
  진화 방식과 일치하고, 메이저 번호는 진정한 `1.0.0` 안정성 마일스톤을 위해
  비워짐.
- CHANGELOG가 거슬리는 재기준선 항목을 담는 대신 하나의 연속적이고 자기 정합적인
  히스토리(`0.0.0` … `0.7.0`)로 유지됨.

### 부정적
- 버전 식별자를 재작성했음(append-only가 아닌 히스토리 편집): 배포된 `1.x` git
  태그와 그에 대한 외부 참조는 더 이상 CHANGELOG와 일치하지 않으며, 외부
  관찰자에게는 번호가 뒤로 이동한 것처럼 보임.
- 이제 버전이 릴리스마다 정렬을 유지해야 하는 네 곳에 존재함 —
  `app/src/lib/version.ts`, `app/package.json`, `CHANGELOG.md` 최상단 항목, git
  태그 — 그리고 `version.ts`와 `package.json`이 어긋나면 `version.test.ts`가
  빌드를 실패시킴.

## 참고 자료
- `app/src/lib/version.ts` — `APP_VERSION = '0.7.0'`(UI 라벨의 단일 진실 소스)
- `app/package.json` — `"version": "0.7.0"`(`version.test.ts`가 동일하게 유지)
- `CHANGELOG.md` — 전체 히스토리를 `1.x` → `0.x`로 재넘버링(`[0.0.0]` … `[0.7.0]`); SemVer + Keep a Changelog
- git `chore(release): v0.6.0 — sidebar layout + full width + overview summary cards (renumber 1.x → 0.x)` — 재넘버링 릴리스
- git `chore(release): v1.5.0 — metric enrichment first wave` — 재넘버링 직전의 마지막 `1.x` 릴리스
