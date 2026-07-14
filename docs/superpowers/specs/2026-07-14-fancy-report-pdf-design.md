# Fancy Report + Cost Basis + PDF — Design

**Date:** 2026-07-14
**Status:** Approved (ready for implementation plan)
**Scope:** app-only (Next.js UI + one API route field extension + pure-fn extension). No collector/infra changes.

## Problem

`/reports` renders `buildReportMarkdown` output through the generic `<Markdown>` component and offers `.md` / `.csv` / browser-print. Three gaps:
1. The output is plain Markdown — not a polished, print-ready document.
2. There is no explicit PDF affordance (only a generic Print button).
3. The cost figures show a total with no stated pricing basis; the user wants the estimation basis (e.g. inter-AZ transfer rate detail) surfaced at the top.

## Goal

A dedicated, fancy report layout on `/reports` that (a) leads with a cost-estimation-basis block, (b) presents KPIs / cost detail / top talkers / anomalies as styled sections, and (c) prints cleanly to PDF via a "Download PDF" button + print CSS. Existing `.md`/`.csv` downloads stay.

## Non-Goals (YAGNI)

- Server-side PDF (puppeteer/headless Chrome).
- Client PDF libraries (jsPDF/html2pdf) — print→PDF keeps zero deps + vector/text quality.
- New charting library — reuse existing CSS bars.
- Redefining pricing — all USD math stays in `cost.ts` (`bytesToUsd`), the single source.

## Data

Extend `ReportData.cost` (in `app/src/lib/report.ts`) from `{ totalUsd }` to:

```typescript
export interface ReportCost {
  totalUsd: number;
  monthlyRunRate: number;        // totalUsd × (2_592_000 / windowSeconds)
  windowSeconds: number;         // 12 buckets × 300 = 3600 (1h)
  ratePerGbPerDirection: number; // = AZ_TRANSFER_USD_PER_GB (imported from cost.ts)
  billedCategories: DestCategory[]; // INTER_AZ / INTER_VPC / INTER_REGION
  byCategory: { category: DestCategory; bytes: number; usd: number }[]; // billed cats only, desc by usd
}
```

`/api/reports/route.ts` already computes `costLens(current)` — it exposes `byCategory` (per-DestCategory `{bytes,usd}`) and `totalUsd`. The route change: set `windowSeconds = 12 * 300` (the `getFlowsWindowPair(12)` window = 3600s), derive `monthlyRunRate = totalUsd × (MONTH_SECONDS / windowSeconds)`, pull `ratePerGbPerDirection` + `billedCategories` from `cost.ts`, and project `costLens.byCategory` down to the billed categories with usd>0 (or bytes>0), sorted desc by usd.

Shared-constant hygiene (avoid duplicating magic numbers): `cost-explorer.ts` currently has a module-private `MONTH_SECONDS = 2_592_000` — `export` it and import it in the route (do NOT redefine 2_592_000 in the route). `cost.ts` must `export const BILLED_CATEGORIES` (currently module-private) so the route and tests share the one definition; `AZ_TRANSFER_USD_PER_GB` is already exported.

## Components & Data Flow

- **`ReportDocument.tsx`** (new, `app/src/components/analytics/`): pure presentational, props `{ data: ReportData; generatedAt: string }` (+ uses `useLanguage` for `t()`). Sections, top-to-bottom:
  1. **Cover header** — report title, `generatedAt` (client ISO), window label ("1h"), a small brand mark. Reuses existing tokens; no new colors.
  2. **Cost-estimation-basis block** (the top ask) — states: inter-AZ transfer billed at `$${ratePerGbPerDirection}/GB` per direction (≈ round-trip $0.02/GB); billed categories = INTER_AZ / INTER_VPC / INTER_REGION; "estimated from NFM byte counts — not an exact bill"; monthly run-rate = window total scaled to 30 days. All strings via `t()`.
  3. **KPI tile grid** — dataTransferred / retransmissions / timeouts / RTT (p50·p95) / NHI, using the existing formatters (`formatBytes`/`formatCount`/`formatMicros`).
  4. **Cost detail** — a small table of `byCategory` (category · bytes · estimated USD), INTER_AZ row emphasized; footer row = total + monthly run-rate.
  5. **Top Talkers** — labeled rows with a CSS bar (bar width = bytes / maxBytes), bytes + USD.
  6. **Anomalies** — severity chip + label + detail (empty-state when none).
  - Dual-encoded severity (color + text), i18n ko/en, SnowUI tokens, light/dark.
- **`/reports/page.tsx`** — replace the `<Markdown>` preview with `<ReportDocument>`. Header buttons: keep Download .md / Download .csv; replace the generic Print button with a **"Download PDF"** button (`window.print()`), with a hint that the browser dialog saves as PDF. `.md` download still uses `buildReportMarkdown` (extended, see below).
- **`buildReportMarkdown`** — add cost-basis lines (rate, billed categories, run-rate) and a per-category cost breakdown to the `## Cost` section, so the downloaded `.md` matches the on-screen basis block. Pure fn, timestamp still injected.

## Print / PDF (print→PDF)

- A print stylesheet (add a `@media print` block; put it in `app/src/app/globals.css` — the app-wide sheet — scoped so it only reshapes `/reports`, e.g. via a `report-print-root` class on the ReportDocument wrapper and `body:has(.report-print-root)` / a print-only utility).
  Rules: hide the sidebar (`[data-testid="sidebar"]`), topbar, nav, and the page's action buttons; show only the report; white background; `print-color-adjust: exact` so token colors/bars survive; sensible page-break-inside avoidance on section cards; constrain to a readable print width.
- "Download PDF" button calls `window.print()`. No new dependency.

## Accessibility & Responsive

- Report sections use semantic headings; KPI tiles and cost table are readable at mobile width (single-column stack < sm) and in print.
- Buttons keep the existing focusable styling; the PDF button has an `aria-label`/title explaining "opens the print dialog — choose Save as PDF".

## i18n

New `t()` keys in BOTH `ko.json` / `en.json` for: the cost-basis block (rate, per-direction, round-trip note, billed-categories label, estimate disclaimer, monthly run-rate), the cost-detail table headers, the "Download PDF" button + its hint, and any new section labels. Reuse existing `report.*` keys where they already exist.

## Testing (co-located vitest)

- `report.test.ts` (exists) — extend: `buildReportMarkdown` now emits the cost-basis lines + per-category breakdown; assert rate, run-rate, and an INTER_AZ line appear. Keep existing assertions.
- `ReportDocument.test.tsx` (new) — renders the cost-basis block (rate text + billed categories), the KPI tiles, the INTER_AZ cost-detail row, top-talker bars, and the anomalies section / empty-state. Repo has no jest-dom / no vitest globals — use `@testing-library/react` + `toBeTruthy()`/`getAttribute()` (reference: `AnomalyDetailPanel.test.tsx`).
- Print CSS: verified visually via a headless print-preview screenshot (not unit-tested).

## Files

- Edit: `app/src/lib/report.ts` (ReportCost interface + buildReportMarkdown cost lines).
- Edit: `app/src/app/api/reports/route.ts` (populate the extended cost fields).
- Edit: `app/src/lib/analytics/cost.ts` (`export` BILLED_CATEGORIES).
- New: `app/src/components/analytics/ReportDocument.tsx` (+ `.test.tsx`).
- Edit: `app/src/app/reports/page.tsx` (render ReportDocument, PDF button).
- Edit: `app/src/app/globals.css` (`@media print` block for the report).
- Edit: `app/src/lib/i18n/translations/{ko,en}.json` (new keys).
- Edit: `app/src/lib/report.test.ts` (extended assertions).
- Docs (auto-sync, follow-up): `docs/reference/{api,ui,frontend}.md` note the report basis + PDF.
