# Fancy Report + Cost Basis + PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/reports` into a polished, print-to-PDF document that leads with the cost-estimation basis (inter-AZ transfer rate, billed categories, monthly run-rate) and renders KPIs / cost detail / top talkers / anomalies as styled sections.

**Architecture:** Extend `ReportData.cost` with basis + per-category fields (populated from the `costLens` the API route already computes). Replace the Markdown preview with a dedicated presentational `ReportDocument` component. Add a "Download PDF" button that calls `window.print()`, backed by a `@media print` stylesheet that isolates the report. No new runtime dependencies.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4 (SnowUI tokens), vitest + @testing-library/react (jsdom).

## Global Constraints

- All visible UI strings go through `t()` and are added to BOTH `app/src/lib/i18n/translations/ko.json` and `en.json` — no hardcoded UI strings.
- Colors only from `app/src/lib/chart-tokens.ts` (`STATUS`, `TOKENS`) — never hardcode hex. Severity dual-encoded (color + text).
- Tests co-located; repo has NO jest-dom and NO vitest globals — import from `vitest`; component tests use `@testing-library/react` with `.toBeTruthy()` / `.getAttribute()` (reference: `app/src/components/analytics/AnomalyDetailPanel.test.tsx`).
- All USD math stays in `cost.ts` (`bytesToUsd`) — do not recompute pricing anywhere else. `AZ_TRANSFER_USD_PER_GB` is the single rate constant.
- Pricing facts (verbatim): inter-AZ transfer = `$0.01/GB` per direction (≈ round-trip `$0.02/GB`); billed categories = `INTER_AZ` / `INTER_VPC` / `INTER_REGION`; NFM byte counts are an ESTIMATE, not an exact bill; `monthlyRunRate = totalUsd × (MONTH_SECONDS / windowSeconds)`, `MONTH_SECONDS = 2_592_000`, report `windowSeconds = 12 × 300 = 3600`.
- `formatUsd` is imported from `@/app/insights/tabs/shared`; `formatBytes`/`formatCount`/`formatMicros` from `@/lib/format`.
- Run from repo root: `npx -w app vitest run`, `npx -w app tsc --noEmit`, `npm -w app run build`.

---

### Task 1: Extend the data model (report.ts) + shared constants + Markdown

**Files:**
- Modify: `app/src/lib/analytics/cost.ts` (export `BILLED_CATEGORIES`)
- Modify: `app/src/lib/analytics/cost-explorer.ts` (export `MONTH_SECONDS`)
- Modify: `app/src/lib/report.ts` (`ReportCost` interface + `buildReportMarkdown` cost section)
- Modify: `app/src/lib/report.test.ts` (extend fixtures + assertions)
- Modify: `app/src/lib/i18n/translations/ko.json`, `app/src/lib/i18n/translations/en.json`

**Interfaces:**
- Produces:
  - `cost.ts`: `export const BILLED_CATEGORIES: ReadonlySet<DestCategory>` (was module-private).
  - `cost-explorer.ts`: `export const MONTH_SECONDS = 2_592_000` (was module-private).
  - `report.ts`: `ReportCost` interface (below) as the type of `ReportData.cost`; `buildReportMarkdown(data, generatedAt, t)` unchanged signature.

- [ ] **Step 1: Export the shared constants**

In `app/src/lib/analytics/cost.ts`, change the `BILLED_CATEGORIES` declaration to be exported:
```typescript
export const BILLED_CATEGORIES: ReadonlySet<DestCategory> = new Set<DestCategory>([
  'INTER_AZ', 'INTER_VPC', 'INTER_REGION',
]);
```
In `app/src/lib/analytics/cost-explorer.ts`, change the `MONTH_SECONDS` declaration to be exported (keep the value + comment):
```typescript
// 30 days in seconds — monthlyRunRate = totalUsd × (MONTH_SECONDS / windowSeconds).
export const MONTH_SECONDS = 2_592_000;
```

- [ ] **Step 2: Add i18n keys (both files)**

In `app/src/lib/i18n/translations/en.json`, add (next to the existing `report.*` / `reports.*` keys):
```json
"report.basis.title": "Cost estimate basis",
"report.basis.rate": "Inter-AZ transfer billed at ${rate}/GB per direction (≈ $0.02/GB round trip)",
"report.basis.billed": "Billed categories: INTER_AZ / INTER_VPC / INTER_REGION",
"report.basis.estimate": "Estimated from NFM byte counts — not an exact bill",
"report.basis.runRate": "Monthly run-rate",
"report.cost.window": "Window",
"report.cost.colCategory": "Category",
"report.cost.colBytes": "Bytes",
"report.cost.colUsd": "Est. USD",
"reports.downloadPdf": "Download PDF",
"reports.pdfHint": "Opens the print dialog — choose Save as PDF"
```
In `app/src/lib/i18n/translations/ko.json`, add the same keys:
```json
"report.basis.title": "비용 추정 근거",
"report.basis.rate": "AZ간 전송 ${rate}/GB(방향당) 과금 (왕복 ≈ $0.02/GB)",
"report.basis.billed": "과금 대상: INTER_AZ / INTER_VPC / INTER_REGION",
"report.basis.estimate": "NFM 바이트 수 기반 추정 — 정확한 청구서 아님",
"report.basis.runRate": "월 예상 비용(run-rate)",
"report.cost.window": "윈도우",
"report.cost.colCategory": "범주",
"report.cost.colBytes": "바이트",
"report.cost.colUsd": "추정 USD",
"reports.downloadPdf": "PDF 다운로드",
"reports.pdfHint": "인쇄 대화상자가 열립니다 — PDF로 저장을 선택하세요"
```

- [ ] **Step 3: Write the failing test (extend report.test.ts)**

In `app/src/lib/report.test.ts`, replace the `cost:` field of BOTH fixtures and add assertions. Change `full.cost`:
```typescript
  cost: {
    totalUsd: 0.005,
    monthlyRunRate: 3.6, // 0.005 × (2_592_000 / 3600) = 0.005 × 720
    windowSeconds: 3600,
    ratePerGbPerDirection: 0.01,
    billedCategories: ['INTER_AZ', 'INTER_VPC', 'INTER_REGION'],
    byCategory: [
      { category: 'INTER_AZ', bytes: 2_000_000_000, usd: 0.02 },
      { category: 'INTER_VPC', bytes: 500_000_000, usd: 0.005 },
    ],
  },
```
Change `empty.cost`:
```typescript
  cost: {
    totalUsd: 0,
    monthlyRunRate: 0,
    windowSeconds: 3600,
    ratePerGbPerDirection: 0.01,
    billedCategories: ['INTER_AZ', 'INTER_VPC', 'INTER_REGION'],
    byCategory: [],
  },
```
Add a new test inside the `describe('buildReportMarkdown', …)` block:
```typescript
  it('emits the cost-estimation basis and per-category breakdown', () => {
    const md = buildReportMarkdown(full, GENERATED_AT, t);
    expect(md).toContain('report.basis.title');
    expect(md).toContain('report.basis.rate(0.01)'); // rate param threaded through t()
    expect(md).toContain('report.basis.runRate: $3.60'); // monthly run-rate
    expect(md).toContain('INTER_AZ'); // per-category line present
    expect(md).toContain('2 GB'); // INTER_AZ bytes formatted
    expect(md).toContain('$0.02'); // INTER_AZ usd
  });
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx -w app vitest run src/lib/report.test.ts`
Expected: FAIL — `ReportCost` fields unknown to TS and the new assertions miss (basis lines not emitted).

- [ ] **Step 5: Extend `report.ts`**

In `app/src/lib/report.ts`, add the import and replace the `ReportData['cost']` type. Add near the top imports:
```typescript
import type { DestCategory } from './types';
```
Replace the old `cost: { totalUsd: number };` in `ReportData` by referencing a new interface, and define it above `ReportData`:
```typescript
export interface ReportCostCategory {
  category: DestCategory;
  bytes: number;
  usd: number;
}

export interface ReportCost {
  totalUsd: number;
  /** totalUsd scaled to 30 days: totalUsd × (MONTH_SECONDS / windowSeconds). */
  monthlyRunRate: number;
  windowSeconds: number;
  /** = AZ_TRANSFER_USD_PER_GB (per direction). */
  ratePerGbPerDirection: number;
  billedCategories: DestCategory[];
  /** Billed categories with traffic in the window, desc by usd. */
  byCategory: ReportCostCategory[];
}
```
In the `ReportData` interface change `cost: { totalUsd: number };` to `cost: ReportCost;`.

In `buildReportMarkdown`, replace the final cost block. The current tail is:
```typescript
  lines.push(
    '',
    `## ${t('report.cost')}`,
    '',
    `${t('report.costTotal')}: ${formatUsd(data.cost.totalUsd)}`,
    '',
  );
  return lines.join('\n');
```
Replace with:
```typescript
  const { cost } = data;
  lines.push(
    '',
    `## ${t('report.cost')}`,
    '',
    `_${t('report.basis.title')}_`,
    `- ${t('report.basis.rate', { rate: cost.ratePerGbPerDirection })}`,
    `- ${t('report.basis.billed')}`,
    `- ${t('report.basis.estimate')}`,
    `- ${t('report.basis.runRate')}: ${formatUsd(cost.monthlyRunRate)}`,
    '',
  );
  if (cost.byCategory.length > 0) {
    for (const c of cost.byCategory) {
      lines.push(`- ${c.category}: ${formatBytes(c.bytes)} (${formatUsd(c.usd)})`);
    }
    lines.push('');
  }
  lines.push(`${t('report.costTotal')}: ${formatUsd(cost.totalUsd)}`, '');
  return lines.join('\n');
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx -w app vitest run src/lib/report.test.ts`
Expected: PASS (existing + new test). Then `npx -w app tsc --noEmit` — expect errors in `route.ts` (cost shape) and `reports/page.tsx` will surface in later tasks; `report.ts` + test compile clean.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/analytics/cost.ts app/src/lib/analytics/cost-explorer.ts app/src/lib/report.ts app/src/lib/report.test.ts app/src/lib/i18n/translations/ko.json app/src/lib/i18n/translations/en.json
git commit -m "feat(reports): extend ReportData.cost with pricing basis + per-category breakdown"
```

---

### Task 2: Populate the extended cost fields in the API route

**Files:**
- Modify: `app/src/app/api/reports/route.ts`

**Interfaces:**
- Consumes: `ReportCost` (Task 1), `BILLED_CATEGORIES` + `AZ_TRANSFER_USD_PER_GB` (cost.ts), `MONTH_SECONDS` (cost-explorer.ts), existing `costLens(current)` (`byCategory`, `totalUsd`).
- Produces: `/api/reports` returns `ReportData` whose `cost` is a full `ReportCost`.

- [ ] **Step 1: Extend the route's cost assembly**

In `app/src/app/api/reports/route.ts`, add imports:
```typescript
import { AZ_TRANSFER_USD_PER_GB, BILLED_CATEGORIES, costLens } from '@/lib/analytics/cost';
import { MONTH_SECONDS } from '@/lib/analytics/cost-explorer';
```
(remove the old `import { costLens } from '@/lib/analytics/cost';` line — it is merged into the line above).

After `const cost = costLens(current);`, build the extended cost object:
```typescript
    const windowSeconds = 12 * 300; // getFlowsWindowPair(12) window
    const billedCategories = [...BILLED_CATEGORIES];
    const byCategory = billedCategories
      .map((category) => ({ category, ...cost.byCategory[category] }))
      .filter((c) => c.usd > 0 || c.bytes > 0)
      .sort((a, b) => b.usd - a.usd || b.bytes - a.bytes);
```
Change the `cost:` field of the `data` object from `cost: { totalUsd: cost.totalUsd },` to:
```typescript
      cost: {
        totalUsd: cost.totalUsd,
        monthlyRunRate: cost.totalUsd * (MONTH_SECONDS / windowSeconds),
        windowSeconds,
        ratePerGbPerDirection: AZ_TRANSFER_USD_PER_GB,
        billedCategories,
        byCategory,
      },
```

- [ ] **Step 2: Typecheck**

Run: `npx -w app tsc --noEmit`
Expected: `route.ts` now compiles (cost matches `ReportCost`). `reports/page.tsx` may still error if it reads the old shape — that is Task 4. If `page.tsx` errors ONLY on unrelated lines, note it; the cost field itself is now correct.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/api/reports/route.ts
git commit -m "feat(reports): API route populates pricing basis + per-category cost"
```

---

### Task 3: `ReportDocument` component

**Files:**
- Create: `app/src/components/analytics/ReportDocument.tsx`
- Test: `app/src/components/analytics/ReportDocument.test.tsx`

**Interfaces:**
- Consumes: `ReportData` (Task 1), `formatBytes`/`formatCount`/`formatMicros` (`@/lib/format`), `formatUsd` (`@/app/insights/tabs/shared`), `useLanguage` (`@/lib/i18n/LanguageContext`), `STATUS` (`@/lib/chart-tokens`).
- Produces: `default export ReportDocument({ data, generatedAt }: { data: ReportData; generatedAt: string })`.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/analytics/ReportDocument.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReportDocument from './ReportDocument';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { ReportData } from '@/lib/report';

const data: ReportData = {
  kpis: { dataTransferred: 1_500_000_000, retransmissions: 12, timeouts: 3, rtt: 900, rttP50: 1500, rttP95: 3_000_000, nhi: 0 },
  topTalkers: [
    { label: 'default/api ↔ default/web', bytes: 2_000_000_000, usd: 0.04 },
    { label: 'kube-system/dns', bytes: 500_000, usd: 0 },
  ],
  breachCount: 2,
  anomalies: [{ label: 'default/api', kind: 'retrans', severity: 'critical', detail: 'retrans 25.0/GB > 10/GB' }],
  cost: {
    totalUsd: 0.025, monthlyRunRate: 18, windowSeconds: 3600, ratePerGbPerDirection: 0.01,
    billedCategories: ['INTER_AZ', 'INTER_VPC', 'INTER_REGION'],
    byCategory: [{ category: 'INTER_AZ', bytes: 2_000_000_000, usd: 0.02 }],
  },
};

const renderDoc = (d: ReportData = data) =>
  render(<LanguageProvider><ReportDocument data={d} generatedAt="2026-07-14T00:00:00.000Z" /></LanguageProvider>);

describe('ReportDocument', () => {
  it('renders the cost-estimation basis block with the rate and billed categories', () => {
    renderDoc();
    expect(screen.getByTestId('report-cost-basis')).toBeTruthy();
    // ko default: rate string includes 0.01; INTER_AZ appears in the billed list
    expect(screen.getByText(/0\.01/)).toBeTruthy();
    expect(screen.getByTestId('report-doc')).toBeTruthy();
  });

  it('renders KPI tiles and the INTER_AZ cost-detail row', () => {
    renderDoc();
    expect(screen.getByTestId('report-kpis')).toBeTruthy();
    expect(screen.getByText('1.5 GB')).toBeTruthy(); // dataTransferred tile
    const azRow = screen.getByTestId('report-cost-row-INTER_AZ');
    expect(azRow.textContent).toContain('2 GB');
    expect(azRow.textContent).toContain('$0.02');
  });

  it('renders top-talker bars and the anomaly row', () => {
    renderDoc();
    expect(screen.getByText('default/api ↔ default/web')).toBeTruthy();
    expect(screen.getByTestId('report-talker-bar-0')).toBeTruthy(); // widest bar
    expect(screen.getByText('retrans 25.0/GB > 10/GB')).toBeTruthy();
  });

  it('shows the empty-state when there are no anomalies', () => {
    renderDoc({ ...data, anomalies: [] });
    expect(screen.getByTestId('report-anomalies-empty')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx -w app vitest run src/components/analytics/ReportDocument.test.tsx`
Expected: FAIL — cannot resolve `./ReportDocument`.

- [ ] **Step 3: Implement `ReportDocument.tsx`**

Create `app/src/components/analytics/ReportDocument.tsx`:
```tsx
'use client';

import { useLanguage } from '@/lib/i18n/LanguageContext';
import { STATUS } from '@/lib/chart-tokens';
import { formatBytes, formatCount, formatMicros } from '@/lib/format';
import { formatUsd } from '@/app/insights/tabs/shared';
import type { ReportData } from '@/lib/report';

const DASH = '—';
const fmt = (v: number | null, f: (n: number) => string) => (v == null ? DASH : f(v));

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/5 bg-surface p-3 dark:border-white/10 dark:bg-white/5">
      <div className="text-[11px] font-medium text-ink/50 dark:text-white/50">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default function ReportDocument({
  data,
  generatedAt,
}: {
  data: ReportData;
  generatedAt: string;
}) {
  const { t } = useLanguage();
  const { kpis, cost, topTalkers, anomalies } = data;
  const maxBytes = Math.max(1, ...topTalkers.map((tk) => tk.bytes));

  return (
    <div data-testid="report-doc" className="report-print-root flex flex-col gap-6">
      {/* Cover header */}
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-black/10 pb-4 dark:border-white/15">
        <h2 className="font-serif text-2xl font-semibold tracking-tight">{t('report.title')}</h2>
        <p className="font-mono text-xs text-ink/50 dark:text-white/50">
          {generatedAt} · {t('report.cost.window')} {Math.round(cost.windowSeconds / 60)}m
        </p>
      </header>

      {/* Cost estimate basis */}
      <section
        data-testid="report-cost-basis"
        className="rounded-xl border border-chartViolet/20 bg-chartViolet/[.04] p-4 text-xs leading-relaxed dark:border-chartViolet/30"
      >
        <div className="mb-2 font-semibold text-ink/80 dark:text-white/80">{t('report.basis.title')}</div>
        <ul className="flex flex-col gap-1 text-ink/60 dark:text-white/60">
          <li>{t('report.basis.rate', { rate: cost.ratePerGbPerDirection })}</li>
          <li>{t('report.basis.billed')}</li>
          <li>{t('report.basis.estimate')}</li>
          <li className="font-medium text-ink/80 dark:text-white/80">
            {t('report.basis.runRate')}: {formatUsd(cost.monthlyRunRate)}
          </li>
        </ul>
      </section>

      {/* KPI tiles */}
      <section data-testid="report-kpis" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label={t('report.kpi.dataTransferred')} value={fmt(kpis.dataTransferred, formatBytes)} />
        <Tile label={t('report.kpi.retransmissions')} value={fmt(kpis.retransmissions, formatCount)} />
        <Tile label={t('report.kpi.timeouts')} value={fmt(kpis.timeouts, formatCount)} />
        <Tile label={t('report.kpi.rtt')} value={`${fmt(kpis.rtt, formatMicros)} · p95 ${fmt(kpis.rttP95, formatMicros)}`} />
        <Tile label={t('report.kpi.nhi')} value={kpis.nhi == null ? DASH : formatCount(kpis.nhi)} />
      </section>

      {/* Cost detail */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t('report.cost')}</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-ink/50 dark:text-white/50">
              <th className="py-1 font-medium">{t('report.cost.colCategory')}</th>
              <th className="py-1 text-right font-medium">{t('report.cost.colBytes')}</th>
              <th className="py-1 text-right font-medium">{t('report.cost.colUsd')}</th>
            </tr>
          </thead>
          <tbody>
            {cost.byCategory.map((c) => (
              <tr
                key={c.category}
                data-testid={`report-cost-row-${c.category}`}
                className={`border-t border-black/5 dark:border-white/10 ${c.category === 'INTER_AZ' ? 'font-semibold' : ''}`}
              >
                <td className="py-1">{c.category}</td>
                <td className="py-1 text-right tabular-nums">{formatBytes(c.bytes)}</td>
                <td className="py-1 text-right tabular-nums">{formatUsd(c.usd)}</td>
              </tr>
            ))}
            <tr className="border-t border-black/20 font-semibold dark:border-white/25">
              <td className="py-1">{t('report.costTotal')}</td>
              <td className="py-1"></td>
              <td className="py-1 text-right tabular-nums">{formatUsd(cost.totalUsd)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Top talkers */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t('report.topTalkers')}</h3>
        {topTalkers.length === 0 ? (
          <p className="text-xs text-ink/50 dark:text-white/50">{t('report.none')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {topTalkers.map((tk, i) => (
              <li key={tk.label} className="flex items-center gap-3 text-xs">
                <span className="w-56 shrink-0 truncate" title={tk.label}>{tk.label}</span>
                <span className="relative h-3 flex-1 overflow-hidden rounded bg-black/5 dark:bg-white/10">
                  <span
                    data-testid={`report-talker-bar-${i}`}
                    className="absolute inset-y-0 left-0 rounded"
                    style={{ width: `${(tk.bytes / maxBytes) * 100}%`, backgroundColor: STATUS.ok }}
                  />
                </span>
                <span className="w-32 shrink-0 text-right tabular-nums">
                  {formatBytes(tk.bytes)} · {formatUsd(tk.usd)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Anomalies */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">
          {t('report.anomalies')} · {t('report.breaches')}: {formatCount(data.breachCount)} · {t('report.anomaliesCount', { count: anomalies.length })}
        </h3>
        {anomalies.length === 0 ? (
          <p data-testid="report-anomalies-empty" className="text-xs text-ink/50 dark:text-white/50">{t('report.none')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {anomalies.map((a) => (
              <li key={`${a.kind}:${a.label}`} className="flex items-baseline gap-2 text-xs">
                <span
                  className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink"
                  style={{ backgroundColor: a.severity === 'critical' ? STATUS.danger : STATUS.warn }}
                >
                  {a.severity}
                </span>
                <span className="font-medium">{a.label}</span>
                <span className="text-ink/60 dark:text-white/60">— {a.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx -w app vitest run src/components/analytics/ReportDocument.test.tsx`
Expected: PASS (4 tests). If `STATUS.ok` / `STATUS.danger` / `STATUS.warn` or `chartViolet` are not valid tokens, check `app/src/lib/chart-tokens.ts` / `tailwind.config.ts` and use the correct token names (they are used the same way in `AnomalyDetailPanel.tsx` and the network table) before adjusting the test.

- [ ] **Step 5: Typecheck**

Run: `npx -w app tsc --noEmit`
Expected: `ReportDocument.tsx` + test compile clean.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/analytics/ReportDocument.tsx app/src/components/analytics/ReportDocument.test.tsx
git commit -m "feat(reports): add ReportDocument styled layout with cost-basis block"
```

---

### Task 4: Wire ReportDocument + PDF button into `/reports`

**Files:**
- Modify: `app/src/app/reports/page.tsx`

**Interfaces:**
- Consumes: `ReportDocument` (Task 3), existing `buildReportMarkdown` (extended, still used for `.md`), `downloadText`/`toCsv`.

- [ ] **Step 1: Replace the preview + add the PDF button**

In `app/src/app/reports/page.tsx`:

(a) Update imports — add the `Printer` icon stays; add `ReportDocument`; `Markdown` import can be removed:
```tsx
import { Download, Printer } from 'lucide-react';
import ReportDocument from '@/components/analytics/ReportDocument';
```
Remove `import Markdown from '@/components/Markdown';`.

(b) Keep the `markdown` useMemo (still feeds the `.md` download). Add a stable generatedAt for the document that recomputes only when data changes:
```tsx
  const generatedAt = useMemo(() => new Date().toISOString(), [data]);
```

(c) Replace the Print button with a Download PDF button (in the header button row, swap the existing `window.print()` button):
```tsx
          <button
            type="button"
            onClick={() => window.print()}
            title={t('reports.pdfHint')}
            aria-label={t('reports.pdfHint')}
            className={btnCls}
          >
            <Printer size={12} strokeWidth={1.5} aria-hidden />
            {t('reports.downloadPdf')}
          </button>
```

(d) Replace the preview Widget body — swap `<Markdown>{markdown}</Markdown>` for the component:
```tsx
      <Widget title={t('reports.preview')} testId="report-preview">
        <LensState loading={firstLoad} error={error} empty={!data}>
          {data && <ReportDocument data={data} generatedAt={generatedAt} />}
        </LensState>
      </Widget>
```

- [ ] **Step 2: Run the app test suite + typecheck**

Run: `npx -w app vitest run && npx -w app tsc --noEmit`
Expected: all pass; tsc clean (page now reads the new cost shape only through ReportDocument/markdown).

- [ ] **Step 3: Commit**

```bash
git add app/src/app/reports/page.tsx
git commit -m "feat(reports): render ReportDocument + Download PDF button on /reports"
```

---

### Task 5: Print stylesheet + final verification

**Files:**
- Modify: `app/src/app/globals.css`

- [ ] **Step 1: Add the print stylesheet**

Append to `app/src/app/globals.css` a `@media print` block that isolates the report. Use the `.report-print-root` class the ReportDocument wrapper already carries:
```css
@media print {
  /* Hide app chrome so only the report prints. */
  [data-testid="sidebar"],
  [data-testid="topbar"],
  header.nav, nav,
  [data-testid="reports-page"] > div:first-child /* the action-button header row */ {
    display: none !important;
  }
  /* Reset the shell to a plain white page. */
  html, body { background: #fff !important; }
  main { padding: 0 !important; max-width: none !important; }
  /* Preserve token colors + bars in print. */
  .report-print-root, .report-print-root * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  /* Avoid breaking a section card across pages. */
  .report-print-root section, .report-print-root header { break-inside: avoid; }
  @page { margin: 14mm; }
}
```
If the sidebar/topbar selectors differ in this codebase, grep `app/src/components/layout/` for the actual class/testids (`Sidebar.tsx` uses `data-testid="sidebar"`; confirm the topbar) and adjust the selector list so the printed page shows ONLY the report + its section content.

- [ ] **Step 2: Full suite + typecheck**

Run: `npx -w app vitest run && npx -w app tsc --noEmit`
Expected: all tests pass; tsc clean.

- [ ] **Step 3: Build**

Run: `npm -w app run build`
Expected: build succeeds.

- [ ] **Step 4: Visual print-preview check**

Drive the built/preview app (or a headless Chromium with `page.emulateMedia({ media: 'print' })`) to `/reports`, screenshot, and confirm: the cost-basis block is at the top, KPI tiles + cost table (INTER_AZ emphasized) + top-talker bars + anomalies render, and in print emulation the sidebar/topbar/buttons are hidden with colors preserved. (Live login needed — verify post-deploy if not runnable locally.)

- [ ] **Step 5: Commit**

```bash
git add app/src/app/globals.css
git commit -m "feat(reports): print stylesheet isolates the report for PDF export"
```

---

## Self-Review

**1. Spec coverage:**
- `ReportData.cost` extension (totalUsd/monthlyRunRate/windowSeconds/rate/billedCategories/byCategory) → Task 1. ✓
- Shared constants (BILLED_CATEGORIES, MONTH_SECONDS export) → Task 1. ✓
- API route populates the fields → Task 2. ✓
- `ReportDocument` with cover / cost-basis block / KPI tiles / cost detail (INTER_AZ emphasis) / top-talker bars / anomalies → Task 3. ✓
- `.md` cost-basis lines match the on-screen block → Task 1 (buildReportMarkdown). ✓
- Page renders ReportDocument + Download PDF button, keeps .md/.csv → Task 4. ✓
- Print→PDF stylesheet → Task 5. ✓
- i18n ko/en → Task 1 Step 2. ✓
- Tests (report.test extension, ReportDocument.test, print visual) → Tasks 1,3,5. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code. The one runtime unknown (exact sidebar/topbar print selectors) is handled with a concrete default (`data-testid="sidebar"`, confirmed in the codebase) plus a grep-and-adjust instruction — not a placeholder.

**3. Type consistency:** `ReportCost` / `ReportCostCategory` defined in Task 1, consumed by the route (Task 2), ReportDocument (Task 3), and tests with matching field names (`monthlyRunRate`, `ratePerGbPerDirection`, `billedCategories`, `byCategory[].category/bytes/usd`). `buildReportMarkdown(data, generatedAt, t)` signature unchanged. `ReportDocument({data, generatedAt})` props match Task 4's usage. Test-ids (`report-cost-basis`, `report-kpis`, `report-cost-row-INTER_AZ`, `report-talker-bar-0`, `report-anomalies-empty`, `report-doc`) match between Task 3 impl and its test.

**Note on token names:** Task 3 uses `STATUS.ok/danger/warn` and a `chartViolet` Tailwind color the same way existing components do; Step 4 explicitly says to verify the exact token names against `chart-tokens.ts`/`tailwind.config.ts` and fix impl (not test) if they differ — flagged so the implementer confirms rather than assumes.
