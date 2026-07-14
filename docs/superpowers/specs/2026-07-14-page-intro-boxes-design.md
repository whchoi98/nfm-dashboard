# Per-Page Intro Boxes — Design

**Date:** 2026-07-14
**Status:** Approved (design accepted by user)
**Scope:** app-only (Next.js UI + i18n). No collector/infra changes. No new nav menus.

## Goal

Under each page's title, show a compact box describing **what the dashboard is (개요)** and **what functionality it provides (기능)** — so a viewer immediately understands each of the 17 sidebar pages.

## Decisions (user-approved)

- **Style:** a labeled two-row tinted box (`개요` / `기능`), placed directly under the page `<h1>`. Persistent (NOT dismissible). SnowUI tokens, light/dark, mobile responsive.
- **Scope:** all 17 sidebar pages (Overview → Settings).

## Component

`app/src/components/PageIntro.tsx` (client component — uses `useLanguage`):
- Props: `{ page: string }` — a stable key (`overview`, `topology`, `network`, `flows`, `paths`, `insights`, `workload`, `monitors`, `history`, `alerts`, `anomalies`, `diagnose`, `agents`, `cost`, `reports`, `search`, `settings`).
- Renders a tinted/bordered box, two labeled rows:
  - `t('pageintro.overview')` label + `t(\`pageintro.${page}.what\`)`
  - `t('pageintro.features')` label + `t(\`pageintro.${page}.features\`)`
- Colors ONLY from chart-tokens / token classes (no hardcoded hex). `data-testid="page-intro"` + `data-page={page}`.

## i18n (ko + en, both)

- Common labels: `pageintro.overview` = "개요"/"Overview", `pageintro.features` = "기능"/"Features".
- Per page (34 keys): `pageintro.<page>.what` + `pageintro.<page>.features`, for all 17 pages.
- Copy MUST reflect each page's ACTUAL functionality (derived by reading each page's real source), concise, consistent tone/terminology. `.features` is a short "·"-separated capability list.

## Placement

Insert `<PageIntro page="…" />` immediately after each page's title (additive — do not restructure the existing `<h1>`/title area, to minimize layout regression). Pages with non-standard headers (Overview cards, Insights tabs, Workload) get it directly under their title region.

## Testing (co-located vitest; NO jest-dom / NO vitest globals)

- `PageIntro.test.tsx` — renders the `개요`/`기능` labels + a page's what/features text (via `LanguageProvider`); `data-testid="page-intro"` present.
- Coverage test — every one of the 17 page keys has both `.what` and `.features` in BOTH `ko.json` and `en.json` (no locale drift, no missing page).

## Non-Goals (YAGNI)

- No dismiss/collapse (persistent box).
- No new nav menu (nav.ts unchanged).
- No per-page custom layouts beyond the shared box.

## Files

- New: `app/src/components/PageIntro.tsx` (+ `.test.tsx`).
- Edit: 17 page files under `app/src/app/*/page.tsx` (+ `app/src/app/page.tsx` for Overview) — insert `<PageIntro>`.
- Edit: `app/src/lib/i18n/translations/{ko,en}.json` — common labels + 34 per-page keys.
- Docs (auto-sync follow-up): `docs/reference/{ui,frontend}.md` note the PageIntro box.
