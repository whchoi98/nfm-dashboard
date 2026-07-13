# Anomaly Detail Panel + Working Deep-Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking an item on `/anomalies` opens a right-hand slide panel with the anomaly's basic detail plus deep-links that actually focus the affected entity in the topology and network views.

**Architecture:** App-only. A new presentational `AnomalyDetailPanel` renders fields already on the `Anomaly` object (no new fetch). `/anomalies` gains selection state and makes each row selectable. Two target pages gain additive `useSearchParams` reads — `/topology?focus=<ns/name>` seeds the existing canvas search/focus, `/network?ns=<namespace>` presets the namespace facet — each wrapped in `<Suspense>` per Next.js's requirement for `useSearchParams`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4 (SnowUI tokens), vitest + @testing-library/react (jsdom).

## Global Constraints

- All visible UI strings go through `t()` and are added to BOTH `app/src/lib/i18n/translations/ko.json` and `en.json` — no hardcoded UI strings.
- Colors only from `app/src/lib/chart-tokens.ts` (`STATUS`) — never hardcode hex. Severity is dual-encoded (color dot + text label).
- Tests co-located as `*.test.ts`/`*.test.tsx`; run `npx -w app vitest run` and `npx -w app tsc --noEmit` from the repo root.
- Deep-link reads are additive: with the param absent, the target page renders byte-for-byte as today.
- `entityKey('service')` format is `namespace/name` (e.g. `ecommerce/cart-svc`); `label` on an `Anomaly` equals this key.
- No new API routes, no collector/infra changes. `/flows?ns=` is out of scope (flows ignores `?ns=`).

---

### Task 1: `AnomalyDetailPanel` component + shared value formatter

**Files:**
- Modify: `app/src/lib/analytics/anomalies.ts` (add `formatAnomalyValue`)
- Create: `app/src/components/analytics/AnomalyDetailPanel.tsx`
- Test: `app/src/components/analytics/AnomalyDetailPanel.test.tsx`
- Modify: `app/src/lib/i18n/translations/ko.json`, `app/src/lib/i18n/translations/en.json`

**Interfaces:**
- Consumes: `Anomaly` (`app/src/lib/analytics/anomalies.ts`), `formatMetricValue` (`app/src/lib/format.ts`), `STATUS` (`app/src/lib/chart-tokens.ts`), `useLanguage` (`app/src/lib/i18n/LanguageContext`).
- Produces:
  - `formatAnomalyValue(a: Anomaly, v: number): string` (in `anomalies.ts`).
  - `AnomalyDetailPanel({ anomaly, onClose }: { anomaly: Anomaly; onClose: () => void })` default export.

- [ ] **Step 1: Add the shared formatter to `anomalies.ts`**

At the top of `app/src/lib/analytics/anomalies.ts`, add the import and the exported helper (moves the logic currently living privately in the page):

```typescript
import { formatMetricValue } from '../format';
```

Add near the other exports (after the `Anomaly` interface):

```typescript
/** Threshold kinds carry events/GB rates; spikes carry raw metric totals. */
export function formatAnomalyValue(a: Anomaly, v: number): string {
  return a.kind === 'spike' ? formatMetricValue(a.metric, v) : `${v.toFixed(1)}/GB`;
}
```

- [ ] **Step 2: Add i18n keys (both files)**

In `app/src/lib/i18n/translations/en.json` add (next to the existing `anomalies.*` keys):

```json
"anomalies.detail.title": "Anomaly detail",
"anomalies.detail.metric": "Metric",
"anomalies.detail.current": "Current",
"anomalies.detail.baseline": "Baseline",
"anomalies.detail.overshoot": "Overshoot",
"anomalies.detail.close": "Close detail panel",
"anomalies.detail.openTopology": "View in topology",
"anomalies.detail.openNetwork": "View in network"
```

In `app/src/lib/i18n/translations/ko.json` add the same keys:

```json
"anomalies.detail.title": "이상 징후 상세",
"anomalies.detail.metric": "지표",
"anomalies.detail.current": "현재값",
"anomalies.detail.baseline": "기준값",
"anomalies.detail.overshoot": "초과 배수",
"anomalies.detail.close": "상세 패널 닫기",
"anomalies.detail.openTopology": "토폴로지에서 보기",
"anomalies.detail.openNetwork": "네트워크에서 보기"
```

- [ ] **Step 3: Write the failing test**

Create `app/src/components/analytics/AnomalyDetailPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AnomalyDetailPanel from './AnomalyDetailPanel';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { Anomaly } from '@/lib/analytics/anomalies';

const retrans: Anomaly = {
  key: 'ecommerce/cart-svc', label: 'ecommerce/cart-svc', kind: 'retrans',
  metric: 'RETRANSMISSIONS', value: 12.3, baseline: 10, severity: 'critical',
  detail: 'retrans 12.3/GB > 10/GB',
};

const renderPanel = (anomaly: Anomaly, onClose = vi.fn()) => {
  render(
    <LanguageProvider>
      <AnomalyDetailPanel anomaly={anomaly} onClose={onClose} />
    </LanguageProvider>,
  );
  return onClose;
};

describe('AnomalyDetailPanel', () => {
  it('renders the entity, metric, current-vs-baseline, overshoot and detail', () => {
    renderPanel(retrans);
    expect(screen.getByTestId('anomaly-detail')).toBeInTheDocument();
    expect(screen.getByText('ecommerce/cart-svc')).toBeInTheDocument();
    expect(screen.getByText('RETRANSMISSIONS')).toBeInTheDocument();
    expect(screen.getByText('12.3/GB')).toBeInTheDocument(); // current
    expect(screen.getByText('10.0/GB')).toBeInTheDocument(); // baseline
    expect(screen.getByText('×1.2')).toBeInTheDocument();    // overshoot value/baseline
    expect(screen.getByText('retrans 12.3/GB > 10/GB')).toBeInTheDocument();
  });

  it('builds deep-link hrefs to topology (focus) and network (namespace)', () => {
    renderPanel(retrans);
    expect(screen.getByTestId('anomaly-link-topology')).toHaveAttribute(
      'href', '/topology?focus=ecommerce%2Fcart-svc');
    expect(screen.getByTestId('anomaly-link-network')).toHaveAttribute(
      'href', '/network?ns=ecommerce');
  });

  it('calls onClose on the close button and on Escape', () => {
    const onClose = renderPanel(retrans);
    fireEvent.click(screen.getByTestId('anomaly-detail-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx -w app vitest run src/components/analytics/AnomalyDetailPanel.test.tsx`
Expected: FAIL — cannot resolve `./AnomalyDetailPanel`.

- [ ] **Step 5: Implement `AnomalyDetailPanel`**

Create `app/src/components/analytics/AnomalyDetailPanel.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Clock, Repeat, TrendingUp, X, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { STATUS } from '@/lib/chart-tokens';
import { formatAnomalyValue, type Anomaly, type AnomalyKind, type AnomalySeverity } from '@/lib/analytics/anomalies';

const SEVERITY_COLOR: Record<AnomalySeverity, string> = {
  critical: STATUS.danger,
  warn: STATUS.warn,
};
const KIND_ICON: Record<AnomalyKind, LucideIcon> = {
  retrans: Repeat,
  timeout: Clock,
  spike: TrendingUp,
};

export default function AnomalyDetailPanel({
  anomaly,
  onClose,
}: {
  anomaly: Anomaly;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const Icon = KIND_ICON[anomaly.kind];
  const namespace = anomaly.label.split('/')[0];
  const overshoot = anomaly.value / Math.max(anomaly.baseline, 1e-9);

  // Escape closes the panel (dialog convention).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop — click to close. */}
      <div
        className="fixed inset-0 z-40 bg-black/20 dark:bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label={anomaly.label}
        data-testid="anomaly-detail"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col gap-4 overflow-y-auto bg-surface p-5 shadow-xl dark:bg-ink sm:w-96"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon size={18} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink/60 dark:text-white/60" />
            <h2 className="truncate text-base font-semibold" title={anomaly.label}>
              {anomaly.label}
            </h2>
          </div>
          <button
            type="button"
            data-testid="anomaly-detail-close"
            aria-label={t('anomalies.detail.close')}
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-ink/50 hover:bg-black/5 hover:text-ink dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/70 dark:bg-white/10 dark:text-white/70">
            {t(`anomalies.kind.${anomaly.kind}`)}
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SEVERITY_COLOR[anomaly.severity] }} aria-hidden />
            {t(`anomalies.severity.${anomaly.severity}`)}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <dt className="text-ink/50 dark:text-white/50">{t('anomalies.detail.metric')}</dt>
          <dd className="text-right font-medium">{anomaly.metric}</dd>
          <dt className="text-ink/50 dark:text-white/50">{t('anomalies.detail.current')}</dt>
          <dd className="text-right font-semibold tabular-nums">{formatAnomalyValue(anomaly, anomaly.value)}</dd>
          <dt className="text-ink/50 dark:text-white/50">{t('anomalies.detail.baseline')}</dt>
          <dd className="text-right tabular-nums">{formatAnomalyValue(anomaly, anomaly.baseline)}</dd>
          <dt className="text-ink/50 dark:text-white/50">{t('anomalies.detail.overshoot')}</dt>
          <dd className="text-right font-semibold tabular-nums">×{overshoot.toFixed(1)}</dd>
        </dl>

        <p className="rounded-lg bg-black/5 px-3 py-2 text-xs text-ink/70 dark:bg-white/5 dark:text-white/70">
          {anomaly.detail}
        </p>

        <div className="mt-auto flex flex-col gap-2">
          <Link
            href={`/topology?focus=${encodeURIComponent(anomaly.label)}`}
            data-testid="anomaly-link-topology"
            className="rounded-lg bg-ink px-3 py-2 text-center text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-ink"
          >
            {t('anomalies.detail.openTopology')}
          </Link>
          <Link
            href={`/network?ns=${encodeURIComponent(namespace)}`}
            data-testid="anomaly-link-network"
            className="rounded-lg border border-black/10 px-3 py-2 text-center text-sm font-medium hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
          >
            {t('anomalies.detail.openNetwork')}
          </Link>
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx -w app vitest run src/components/analytics/AnomalyDetailPanel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck**

Run: `npx -w app tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add app/src/components/analytics/AnomalyDetailPanel.tsx app/src/components/analytics/AnomalyDetailPanel.test.tsx app/src/lib/analytics/anomalies.ts app/src/lib/i18n/translations/ko.json app/src/lib/i18n/translations/en.json
git commit -m "feat(anomalies): add AnomalyDetailPanel with entity detail + deep-links"
```

---

### Task 2: Wire selection into `/anomalies` (selectable rows + panel)

**Files:**
- Modify: `app/src/app/anomalies/page.tsx`
- Test: `app/src/app/anomalies/page.test.tsx`

**Interfaces:**
- Consumes: `AnomalyDetailPanel` (Task 1), `formatAnomalyValue` (Task 1).
- Produces: none (leaf page).

- [ ] **Step 1: Write the failing test**

Create `app/src/app/anomalies/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AnomaliesPage from './page';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { Anomaly } from '@/lib/analytics/anomalies';

const anomalies: Anomaly[] = [
  { key: 'ecommerce/cart-svc', label: 'ecommerce/cart-svc', kind: 'retrans',
    metric: 'RETRANSMISSIONS', value: 12.3, baseline: 10, severity: 'critical',
    detail: 'retrans 12.3/GB > 10/GB' },
];

// usePolling is the page's only data source — stub it to a loaded state.
vi.mock('@/lib/use-polling', () => ({
  usePolling: () => ({ data: { anomalies }, error: null, loading: false }),
}));
// Settings hook provides thresholds/σ read into the query string.
vi.mock('@/lib/settings', () => ({
  useSettings: () => ({ settings: { defaultRange: '1h', retransThreshold: 10, timeoutThreshold: 5, anomalySigma: 3 } }),
}));

const renderPage = () =>
  render(<LanguageProvider><AnomaliesPage /></LanguageProvider>);

describe('AnomaliesPage selection', () => {
  it('opens the detail panel when a row is activated, and closes on Escape', async () => {
    renderPage();
    expect(screen.queryByTestId('anomaly-detail')).toBeNull();
    fireEvent.click(screen.getByTestId('anomaly-row-ecommerce/cart-svc'));
    expect(await screen.findByTestId('anomaly-detail')).toBeInTheDocument();
    expect(screen.getByTestId('anomaly-link-topology')).toHaveAttribute(
      'href', '/topology?focus=ecommerce%2Fcart-svc');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('anomaly-detail')).toBeNull());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx -w app vitest run src/app/anomalies/page.test.tsx`
Expected: FAIL — no element `anomaly-row-ecommerce/cart-svc` (rows are not yet selectable/test-id'd).

- [ ] **Step 3: Refactor the page — selection state, selectable row, panel**

In `app/src/app/anomalies/page.tsx`:

(a) Add imports (React state + the panel), and drop the now-shared formatter:

```tsx
import { useState } from 'react';
```
Add to the existing imports:
```tsx
import AnomalyDetailPanel from '@/components/analytics/AnomalyDetailPanel';
import { formatAnomalyValue } from '@/lib/analytics/anomalies';
```
Delete the local `formatValue` function (lines ~38-41) and replace its two call sites in `AnomalyRow` with `formatAnomalyValue`.

(b) Make `AnomalyRow` selectable — change its signature and root element:

```tsx
function AnomalyRow({
  anomaly,
  onSelect,
  selected,
}: {
  anomaly: Anomaly;
  onSelect: () => void;
  selected: boolean;
}) {
  const { t } = useLanguage();
  const Icon = KIND_ICON[anomaly.kind];
  return (
    <li>
      <button
        type="button"
        data-testid={`anomaly-row-${anomaly.key}`}
        onClick={onSelect}
        aria-pressed={selected}
        className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
          selected ? 'bg-black/10 dark:bg-white/10' : 'bg-black/5 hover:bg-black/[.08] dark:bg-white/5 dark:hover:bg-white/[.08]'
        }`}
      >
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: SEVERITY_COLOR[anomaly.severity] }}
          aria-hidden
        />
        <Icon size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink/60 dark:text-white/60" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="truncate text-sm font-medium" title={anomaly.label}>{anomaly.label}</p>
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/70 dark:bg-white/10 dark:text-white/70">
              {t(`anomalies.kind.${anomaly.kind}`)}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/50 dark:text-white/50">
              {t(`anomalies.severity.${anomaly.severity}`)}
            </span>
          </div>
          <p className="truncate text-xs text-ink/60 dark:text-white/60" title={anomaly.detail}>{anomaly.detail}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums">{formatAnomalyValue(anomaly, anomaly.value)}</p>
          <p className="text-[11px] tabular-nums text-ink/50 dark:text-white/50">
            {t('anomalies.vsBaseline', { baseline: formatAnomalyValue(anomaly, anomaly.baseline) })}
          </p>
        </div>
      </button>
    </li>
  );
}
```

(c) In `AnomaliesPage`, add selection state and render the panel. Add after the `anomalies` derivation:

```tsx
  const [selected, setSelected] = useState<Anomaly | null>(null);
```
Replace the `<ul>` map so it passes selection props (key stays the composite id):
```tsx
          <ul className="flex flex-col gap-2">
            {anomalies.map((a) => {
              const id = `${a.kind}:${a.metric}:${a.key}`;
              return (
                <AnomalyRow
                  key={id}
                  anomaly={a}
                  selected={selected != null && `${selected.kind}:${selected.metric}:${selected.key}` === id}
                  onSelect={() => setSelected(a)}
                />
              );
            })}
          </ul>
```
Add the panel just before the final closing `</div>` of the returned tree:
```tsx
      {selected && (
        <AnomalyDetailPanel anomaly={selected} onClose={() => setSelected(null)} />
      )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx -w app vitest run src/app/anomalies/page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + full app suite (no regressions)**

Run: `npx -w app tsc --noEmit && npx -w app vitest run`
Expected: tsc clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/app/anomalies/page.tsx app/src/app/anomalies/page.test.tsx
git commit -m "feat(anomalies): open detail panel on row selection"
```

---

### Task 3: Topology `?focus=` deep-link

**Files:**
- Modify: `app/src/app/topology/page.tsx`
- Test: `app/src/app/topology/focus-param.test.tsx`

**Interfaces:**
- Consumes: existing `searchQuery`/`tagNodes`/`setFocusId` machinery in the page.
- Produces: `/topology?focus=<id-or-label>` focuses the matching node once the topology data loads.

**Note on structure:** `useSearchParams()` requires a `<Suspense>` boundary. The page is one large client component, so wrap its default export: rename the current `export default function TopologyPage()` to `function TopologyPageInner()` and add a thin default export that wraps it in `<Suspense>`.

- [ ] **Step 1: Write the failing test**

Create `app/src/app/topology/focus-param.test.tsx`. It tests the pure resolution rule the effect will use, so it does not need to mount the whole graph:

```tsx
import { describe, it, expect } from 'vitest';
import { resolveFocusNode } from './focus-param';

const nodes = [
  { id: 'ecommerce/cart-svc', label: 'cart-svc' },
  { id: 'ecommerce/api-gw', label: 'api-gw' },
];

describe('resolveFocusNode', () => {
  it('matches by exact id (case-insensitive)', () => {
    expect(resolveFocusNode(nodes, 'ecommerce/cart-svc')?.id).toBe('ecommerce/cart-svc');
    expect(resolveFocusNode(nodes, 'ECOMMERCE/CART-SVC')?.id).toBe('ecommerce/cart-svc');
  });
  it('falls back to label substring', () => {
    expect(resolveFocusNode(nodes, 'api')?.id).toBe('ecommerce/api-gw');
  });
  it('returns null for empty or no match', () => {
    expect(resolveFocusNode(nodes, '')).toBeNull();
    expect(resolveFocusNode(nodes, 'nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx -w app vitest run src/app/topology/focus-param.test.tsx`
Expected: FAIL — cannot resolve `./focus-param`.

- [ ] **Step 3: Extract the resolver**

Create `app/src/app/topology/focus-param.ts` (a pure helper that mirrors the page's existing exact-then-substring search rule so both share one definition):

```typescript
/** Resolve a focus query (id or label, case-insensitive; exact id/label
 *  preferred over substring) to a node, or null. Mirrors the canvas search. */
export function resolveFocusNode<T extends { id: string; label: string }>(
  nodes: T[],
  query: string,
): T | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const exact = nodes.find((n) => n.id.toLowerCase() === q || n.label.toLowerCase() === q);
  if (exact) return exact;
  return nodes.find((n) => n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q)) ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx -w app vitest run src/app/topology/focus-param.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Use the resolver in the page + read `focus`**

In `app/src/app/topology/page.tsx`:

(a) Add imports:
```tsx
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { resolveFocusNode } from './focus-param';
```

(b) Refactor `handleSearchSubmit` to reuse the resolver (replace the inline exact/substring lookup with `resolveFocusNode(tagNodes, searchQuery)`), keeping the existing "clear tag selection if the match is filtered out, then setFocusId" behavior.

(c) Add a one-shot effect that focuses the `focus` param once the nodes are available. Place it just after the `searchQuery` state:
```tsx
  const searchParams = useSearchParams();
  const focusParam = searchParams.get('focus');
  const [focusParamDone, setFocusParamDone] = useState(false);
  useEffect(() => {
    if (focusParamDone || !focusParam || tagNodes.length === 0) return;
    const match = resolveFocusNode(tagNodes, focusParam);
    if (match) {
      setSelectedIds(null); // ensure the node isn't hidden by an active tag filter
      setFocusId(match.id);
    }
    setFocusParamDone(true); // one-shot: don't fight later user interaction
  }, [focusParam, focusParamDone, tagNodes]);
```

(d) Wrap the default export in Suspense:
```tsx
function TopologyPageInner() {
  // ...existing component body (renamed from TopologyPage)...
}

export default function TopologyPage() {
  return (
    <Suspense>
      <TopologyPageInner />
    </Suspense>
  );
}
```

- [ ] **Step 6: Verify no regression + typecheck**

Run: `npx -w app vitest run && npx -w app tsc --noEmit`
Expected: all pass; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/topology/page.tsx app/src/app/topology/focus-param.ts app/src/app/topology/focus-param.test.tsx
git commit -m "feat(topology): focus a node from the ?focus= deep-link param"
```

---

### Task 4: Network `?ns=` deep-link

**Files:**
- Modify: `app/src/app/network/page.tsx`
- Test: `app/src/app/network/ns-param.test.tsx`

**Interfaces:**
- Consumes: existing `facetSel` state (`{ namespace, category }`).
- Produces: `/network?ns=<namespace>` presets the namespace facet on first render.

**Note on structure:** same Suspense requirement as Task 3 — wrap the default export; read `ns` inside the inner component and use it as the `facetSel` initial value.

- [ ] **Step 1: Write the failing test**

Create `app/src/app/network/ns-param.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { initialFacetSel } from './ns-param';

describe('initialFacetSel', () => {
  it('presets the namespace facet from the ns param', () => {
    expect(initialFacetSel('ecommerce')).toEqual({ namespace: 'ecommerce', category: 'all' });
  });
  it('defaults to all when ns is absent or empty', () => {
    expect(initialFacetSel(null)).toEqual({ namespace: 'all', category: 'all' });
    expect(initialFacetSel('')).toEqual({ namespace: 'all', category: 'all' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx -w app vitest run src/app/network/ns-param.test.tsx`
Expected: FAIL — cannot resolve `./ns-param`.

- [ ] **Step 3: Add the pure initializer**

Create `app/src/app/network/ns-param.ts`:

```typescript
/** Initial FacetRail selection, seeded from the ?ns= deep-link param. */
export function initialFacetSel(ns: string | null): { namespace: string; category: string } {
  return { namespace: ns && ns.length > 0 ? ns : 'all', category: 'all' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx -w app vitest run src/app/network/ns-param.test.tsx`
Expected: PASS.

- [ ] **Step 5: Use it in the page + wrap in Suspense**

In `app/src/app/network/page.tsx`:

(a) Add imports:
```tsx
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { initialFacetSel } from './ns-param';
```

(b) Replace the `facetSel` initializer to seed from `ns`:
```tsx
  const searchParams = useSearchParams();
  const [facetSel, setFacetSel] = useState<Record<string, string>>(
    () => initialFacetSel(searchParams.get('ns')),
  );
```

(c) Rename the current `export default function NetworkPage()` to `function NetworkPageInner()` and add:
```tsx
export default function NetworkPage() {
  return (
    <Suspense>
      <NetworkPageInner />
    </Suspense>
  );
}
```

- [ ] **Step 6: Verify no regression + typecheck**

Run: `npx -w app vitest run && npx -w app tsc --noEmit`
Expected: all pass; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/network/page.tsx app/src/app/network/ns-param.ts app/src/app/network/ns-param.test.tsx
git commit -m "feat(network): preset namespace facet from the ?ns= deep-link param"
```

---

### Task 5: Docs sync + final verification

**Files:**
- Modify: `docs/reference/frontend.md`, `docs/reference/ui.md`

- [ ] **Step 1: Update the reference docs**

In `docs/reference/ui.md`, add a line noting the `AnomalyDetailPanel` (right-hand slide-over on `/anomalies`, opened by selecting a row; renders basic anomaly detail + topology/network deep-links; `role=dialog`, Escape/backdrop close).

In `docs/reference/frontend.md`, add a line noting the additive deep-link params: `/topology?focus=<ns/name>` focuses a node, `/network?ns=<namespace>` presets the namespace facet — both no-ops when absent.

- [ ] **Step 2: Full suite + typecheck**

Run: `npx -w app vitest run && npx -w app tsc --noEmit`
Expected: all tests pass; tsc clean.

- [ ] **Step 3: Build (catches Suspense/prerender issues the unit tests can't)**

Run: `npm -w app run build`
Expected: build succeeds — in particular `/topology` and `/network` compile without the `useSearchParams() should be wrapped in a suspense boundary` error.

- [ ] **Step 4: Commit**

```bash
git add docs/reference/frontend.md docs/reference/ui.md
git commit -m "docs: note anomaly detail panel + topology/network deep-link params"
```

---

## Self-Review

**1. Spec coverage:**
- Right-hand slide panel, basic detail, no new fetch → Task 1. ✓
- Selectable rows + selection state + focus/close behavior → Task 2. ✓
- Working deep-links (topology focus, network ns) → Tasks 3 & 4. ✓
- Accessibility (role=dialog, Escape, backdrop, aria) → Task 1 panel + Task 2 row `aria-pressed`. ✓
- Responsive full-width overlay on mobile → panel `w-full max-w-sm sm:w-96`. ✓
- i18n ko/en → Task 1 Step 2. ✓
- Tests (panel fields, deep-link hrefs, Escape close, focus param, ns param) → Tasks 1-4. ✓
- Docs auto-sync → Task 5. ✓
- `/flows?ns=` excluded → not linked anywhere. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**3. Type consistency:** `formatAnomalyValue(a, v)` defined in Task 1, consumed in Tasks 1-2 with the same signature. `AnomalyDetailPanel({anomaly,onClose})` defined Task 1, used Task 2 with matching props. `resolveFocusNode(nodes, query)` and `initialFacetSel(ns)` defined and consumed consistently. Row test-id `anomaly-row-${a.key}` matches between Task 2 impl and its test. ✓

**Note on focus return (spec: "focus returns to the originating row on close"):** Task 2 keeps it simple (selection state + `aria-pressed`), and Escape/backdrop close. Explicit focus-return-to-row is a nice-to-have not covered by an automated test here; if desired during review, add a `ref` to the last-activated row and `.focus()` it in the panel's `onClose`. Flagged so the reviewer can decide — not silently dropped.
