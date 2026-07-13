# Anomaly Detail Panel + Working Deep-Links — Design

**Date:** 2026-07-13
**Status:** Approved (ready for implementation plan)
**Scope:** app-only (Next.js UI + two additive query-param reads). No collector/infra/API changes.

## Problem

The `/anomalies` page (`app/src/app/anomalies/page.tsx`) renders each detected
anomaly as a static `<li>` (`AnomalyRow`) showing a one-line `detail`. There is
no way to select an item and see its full detail or jump to the affected entity
in another view.

## Goal

Clicking an anomaly opens a right-hand slide panel (consistent with the topology
page's panel pattern) showing the anomaly's **basic** detail — the fields the
`Anomaly` object already carries, no new data fetch — plus deep-links that
actually work into the topology and network views.

## Non-Goals (YAGNI)

- **Deep detail** (per-entity prior→current time series, related top flows,
  monitor/namespace/AZ membership) — explicitly deferred; "basic" was chosen.
- A reusable generic `SlidePanel` extraction — only one consumer today.
- Reflecting the selected anomaly in the URL.
- `/flows?ns=` deep-link — the flows page ignores `?ns=` (known backlog item),
  so it is excluded from this work rather than half-wired.

## Data

No new API. The panel renders fields already on `Anomaly`
(`app/src/lib/analytics/anomalies.ts`): `key`, `label` (`ns/name`, service
granularity via `entityKey`), `kind` (`retrans`|`timeout`|`spike`), `metric`,
`value`, `baseline`, `severity`, `detail`. The overshoot factor is
`value / baseline` (same as the lens's `magnitude`).

## Components & Data Flow

- **`AnomaliesPage`** gains `selected: Anomaly | null` state. Row click sets it;
  panel close clears it. Existing polling / counts / `LensState` unchanged.
- **`AnomalyRow`** becomes selectable: a focusable control (Enter/Space activate),
  `aria-selected` when it is the current selection, a selected-highlight style.
  Its `key` (`${kind}:${metric}:${key}`) stays the React list key.
- **`AnomalyDetailPanel`** (new, `app/src/components/analytics/` alongside the
  other page widgets): fixed right-hand slide-over. Props: `anomaly: Anomaly`,
  `onClose: () => void`. Renders:
  - Header: `label` + close button (X).
  - `kind` icon+label, `severity` badge (dual-encoded: color dot + text, per the
    chart-token rule), `metric`.
  - Current vs baseline via the existing `formatValue(anomaly, v)` helper
    (lifted from the page so both the row and the panel share it), plus the
    `×N` overshoot factor.
  - `detail` string verbatim.
  - Deep-link buttons (see below).
  - Closes on: X button, Escape, outside/backdrop click. On close, focus returns
    to the row that opened it.

## Deep-Links (additive query-param support on the targets)

Both reads are additive — absent param ⇒ current behavior byte-for-byte.

- **Topology** `/topology?focus=<ns/name>`: on mount, `useSearchParams().get('focus')`
  seeds the existing canvas search (`searchQuery` + focus resolution in
  `app/src/app/topology/page.tsx`) so the node is searched and focused. Reuses
  the current search-to-node resolution; no new focus mechanism.
- **Network** `/network?ns=<namespace>`: on mount, `useSearchParams().get('ns')`
  presets the namespace facet in the FacetRail filter state
  (`app/src/app/network/page.tsx`). The panel passes only the namespace part of
  the anomaly key (`label.split('/')[0]`), since network filters at namespace
  granularity.

The panel builds hrefs with `encodeURIComponent`. Buttons are standard links
(`next/link`) so they work with middle-click / open-in-new-tab.

## Accessibility & Responsive

- Rows: keyboard-focusable, Enter/Space to open, `aria-selected`.
- Panel: `role="dialog"` + `aria-label` (entity name), Escape to close, backdrop
  click to close, focus moves into the panel on open and returns to the
  originating row on close.
- Mobile: below `sm`, the panel is a full-width overlay (rather than a narrow
  side strip); no horizontal overflow (matches the topology panel's responsive
  behavior and the repo's mobile-no-h-scroll invariant).

## i18n

All new visible strings go through `t()` and are added to BOTH
`app/src/lib/i18n/translations/{ko,en}.json`: panel field labels
(entity/metric/current/baseline/overshoot), deep-link button labels
(topology/network), and the close button `aria-label`. Existing
`anomalies.kind.*` / `anomalies.severity.*` keys are reused.

## Testing (co-located vitest, `*.test.tsx`)

- `AnomaliesPage` / `AnomalyDetailPanel`: clicking a row opens the panel;
  panel shows the entity, metric, current-vs-baseline, overshoot, severity,
  detail; deep-link hrefs are exactly `/topology?focus=<enc>` and
  `/network?ns=<enc-namespace>`; Escape and backdrop click close it.
- Topology: `focus` param seeds the search/focus on mount; absent param ⇒ no
  change (guard against a regression to the existing empty-search behavior).
- Network: `ns` param presets the namespace facet on mount; absent ⇒ unchanged.

## Files

- Edit: `app/src/app/anomalies/page.tsx` (selection state, selectable row, share `formatValue`).
- New: `app/src/components/analytics/AnomalyDetailPanel.tsx` (+ `.test.tsx`).
- Edit: `app/src/app/topology/page.tsx` (read `focus`), `app/src/app/network/page.tsx` (read `ns`).
- Edit: `app/src/lib/i18n/translations/{ko,en}.json` (new strings).
- Docs (auto-sync): `docs/reference/frontend.md` and/or `docs/reference/ui.md` note the anomaly detail panel + the new `?focus=` / `?ns=` deep-link params.
