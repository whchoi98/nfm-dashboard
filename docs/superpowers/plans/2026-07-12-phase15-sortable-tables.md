# Phase 15 — Sortable Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. The comparator/hook logic is TDD; table wiring is headless-verified. Read the target file BEFORE editing.

**Goal:** Make the dashboard's data tables click-to-sort — click a column header to toggle ascending/descending, with TYPE-AWARE comparison (string vs number vs boolean), sorting on the RAW value (never the formatted display string).

**Architecture:** One shared client-side primitive — a `useSortableRows<T>` hook + a `SortableHeader` component (with `aria-sort`) — generalizing the pattern that already exists in `FlowTable.tsx`. Columns declare `{ key, type: 'string'|'number'|'boolean', accessor }`; the hook sorts the raw rows; headers render an asc/desc affordance. Apply to the 6 static-typed tables; give the dynamic Athena History table a string/number-coercion sort mode. Ranked `Toplist` lists (`<ul>`, intentionally value-desc) are OUT of scope.

**Tech Stack:** Next.js 16, React 19, TS, vitest + @testing-library/react, Tailwind v4 SnowUI tokens, lucide icons.

## Global Constraints

- App-only. Version bump **0.9.0** at the end (version.ts + package.json + CHANGELOG [0.9.0] EN+KR + ref links; version.test passes).
- All header strings via `t()` in BOTH ko.json + en.json (reuse existing header keys — tables already `t()` their headers). chart-tokens only; no hardcoded hex. lucide for the sort arrows (already used by FlowTable).
- **Sort the RAW accessor value, NEVER the formatted display text** (e.g. sort `r.bytes`/`r.retransRate`/`r.rtt`/`r.value`, not "1.2 GB"/"38/GB"/`formatMicros(...)`). Numeric nulls sort consistently (e.g. treat null as -Infinity or last). This is the make-or-break correctness rule.
- Comparator logic (string `localeCompare`, number subtraction, boolean, null handling, direction toggle) is TDD in a co-located test.
- `useState`-held sort state — all target tables are already `'use client'` (verified), no server→client conversion.
- Preserve every table's existing data contract, testids (`toplist-latency-tail`, `widget-reliability-breaches`, `network-page`, `workload-contributors-*`, `agents-table`, FlowTable's), row-click/drill behavior (network pairs + FlowTable rows are clickable — sorting must not break the click), CSV export (FlowTable exports the current sorted view — keep it exporting the sorted view), and mobile card fallbacks (FlowTable). Default sort = each table's current pre-sort (so first render is unchanged): value/primary-metric desc.
- Mobile-safe (headers wrap / tables scroll in-container as today); light + dark. No new deps (no react-table/tanstack). Conventional commits + `Claude-Session:` trailer, NO Co-Authored-By. Serial. dev branch `dev/phase15-sortable-tables` → merge → deploy (user-authorized).
- UI change → note in `app/src/components/CLAUDE.md` (new shared table primitive).

## Table inventory (from analysis — the 6 sortable tables + history)

- `app/src/components/FlowTable.tsx` — ALREADY sortable (SortKey `value|category|metric|port`, cmp map, `SortHeader` w/ ArrowUp/Down, toggle-on-same-key). **Refactor to use the shared primitive** (the worked example). Rows = `FlowEdge`; value col is formatted via `formatMetricValue`. Has CSV export of the sorted view + mobile card list.
- `app/src/app/insights/tabs/LatencyTab.tsx:167` — `TailPath` rows: Path(string) | p50 | p95 | jitter (numbers, rendered `formatMicros`). testid `toplist-latency-tail`.
- `app/src/app/insights/tabs/ReliabilityTab.tsx:129` — `ReliabilityRow` rows: Entity(string) | retransRate | timeoutRate | bytes (numbers; rendered `.toFixed(1)` / `formatBytes`).
- `app/src/app/network/page.tsx:208` — `NetPair` rows: source(string) | dest(string) | metric-value | retransRate | rtt(number|null) (+ a Sparkline col = NOT sortable). Rows are clickable (drill) — keep.
- `app/src/app/workload/page.tsx:98` — `WiContributor` rows: category | subnet | az | vpc | region | account | remote (strings) | value(number, `formatMetricValue`). testid `workload-contributors-${metric}`.
- `app/src/app/agents/page.tsx:175` — `Coverage.standalone` rows: instanceId(string) | role(string) | tagged(boolean) | policyAttached(boolean). testid on `agents-table` Card. (Introduces the boolean comparator.)
- `app/src/app/history/page.tsx:180` — Athena results: dynamic `{columns:string[], rows:string[][]}`, all-string cells, non-i18n DB column headers, `.ui-table-dense`. Needs a coercion sort (numeric if the whole column parses as numbers, else string).

## Task sequence (serial)

| # | Task | Deliverable |
|---|---|---|
| 1 | Shared sort primitive + FlowTable refactor | `useSortableRows` + `SortableHeader` (TDD comparators) + FlowTable uses it (behavior-identical) |
| 2 | Apply to 5 typed tables | Latency tail, Reliability breaches, network pairs, workload contributors, agents |
| 3 | History table coercion sort | column-type sniffing (numeric vs string) sort on the string matrix |
| 4 | Finalize | review + v0.9.0 + deploy + prod smoke |

---

## Task 1: Shared sort primitive + FlowTable refactor

**Files:** Create `app/src/lib/use-sortable.ts` (hook + comparators) + `app/src/lib/use-sortable.test.ts`; Create `app/src/components/SortableHeader.tsx`; Modify `app/src/components/FlowTable.tsx`; `app/src/components/CLAUDE.md`.

**Interfaces:**
```ts
export type SortType = 'string' | 'number' | 'boolean';
export interface SortColumn<T> { key: string; type: SortType; accessor: (row: T) => string | number | boolean | null | undefined; }
export interface SortState { key: string | null; dir: 'asc' | 'desc'; }
// Pure comparator — exported + TDD'd:
export function compareBy<T>(col: SortColumn<T>, dir: 'asc'|'desc'): (a: T, b: T) => number;
// Hook: returns the sorted rows + current state + a toggle handler.
export function useSortableRows<T>(rows: T[], columns: SortColumn<T>[], initial?: SortState):
  { sorted: T[]; sort: SortState; onSort: (key: string) => void };
```
Rules: `compareBy` — number: numeric subtract with null/undefined→last (or -Infinity, be consistent + tested); string: `localeCompare` (locale-aware, case-insensitive-ish via `{sensitivity:'base'}`); boolean: false<true; `dir==='desc'` negates. `onSort(key)`: same key → toggle dir; new key → set key + `dir='desc'` (matches FlowTable's toggle semantics + default-desc). `useSortableRows` returns a NEW sorted array (stable-sort; do not mutate `rows`); when `sort.key` is null, returns `rows` as-is (preserves caller pre-sort).

- [ ] Step 1: TDD `compareBy` — number asc/desc (incl. null→last both directions), string localeCompare (asc/desc, case), boolean (false<true); and `useSortableRows` toggle semantics (same-key toggles, new-key→desc, null-key passthrough, does not mutate input). Use RTL/renderHook for the hook or test the reducer purely.
- [ ] Step 2: FAIL → implement → PASS.
- [ ] Step 3: `SortableHeader.tsx` — a `<th>`-content button: `{label}` + an ArrowUp/ArrowDown (lucide) shown only when this column is the active sort; `aria-sort={active ? (dir==='asc'?'ascending':'descending') : 'none'}` on the `<th>`; token styling matching FlowTable's `headCls`. Props `{ label, columnKey, sort, onSort, align?: 'left'|'right' }`. testid `sort-header-<columnKey>`.
- [ ] Step 4: Refactor `FlowTable.tsx` to use `useSortableRows` + `SortableHeader` (columns: colA/colB now ALSO sortable as strings, category/metric string, port number, value number — accessors on raw `FlowEdge` fields; value accessor = `f.value` not the formatted string). Preserve: default value-desc, CSV export of `sorted`, mobile card list rendering `sorted`, row semantics. Confirm behavior identical to before for the pre-existing sortable columns.
- [ ] Step 5: i18n — colA/colB header keys if newly sortable (reuse existing `flow.colA/colB` if present). `vitest`/tsc/build. Headless: FlowTable sorts each column asc/desc, arrows + aria-sort update, CSV still exports sorted view. Commit `feat(app): shared useSortableRows hook + SortableHeader; FlowTable uses them`.

---

## Task 2: Apply sortable headers to the 5 typed tables

**Files:** Modify `LatencyTab.tsx`, `ReliabilityTab.tsx`, `network/page.tsx`, `workload/page.tsx`, `agents/page.tsx`; i18n only if a header lacks a key.

For EACH table: define `SortColumn<RowType>[]` with correct `type` + raw `accessor`, wrap the rows in `useSortableRows` (initial = the table's current pre-sort: e.g. reliability `{key:'retransRate',dir:'desc'}`, latency `{key:'p95',dir:'desc'}`, network `{key:<metric>,dir:'desc'}`, workload `{key:'value',dir:'desc'}`, agents `{key:'instanceId',dir:'asc'}`), replace the plain `<th>`s with `SortableHeader`, and render `sorted` instead of the raw array. Keep the Sparkline / non-data columns NON-sortable (plain `<th>`). Keep network-pair row-click drill + workload text-filter (`filtered`) — sort AFTER filter.

- [ ] Step 1: LatencyTab tail-paths — columns Path(string)/p50/p95/jitter(number, accessors `r.label`/`r.p50`/`r.p95`/`r.jitter`); initial p95 desc. Headless: sort by jitter asc/desc works (raw numeric, not `formatMicros` text).
- [ ] Step 2: ReliabilityTab breaches — Entity(string)/retransRate/timeoutRate/bytes(number); initial retransRate desc. (Sort `r.bytes` raw, not "1.2 GB".)
- [ ] Step 3: network pairs — source/dest(string)/metric-value/retransRate/rtt(number, rtt null→last); initial current-metric desc; Sparkline col not sortable; preserve row drill-click.
- [ ] Step 4: workload contributors — value(number)/the string columns; initial value desc; sort applied to the post-text-filter `filtered` rows.
- [ ] Step 5: agents — instanceId/role(string)/tagged/policyAttached(boolean); initial instanceId asc. (Exercises the boolean comparator.)
- [ ] Step 6 (each): `vitest`/tsc/build green; headless each table sorts type-correctly asc/desc with arrows+aria-sort; existing testids/row-click/drill intact; light+dark; mobile no-h-scroll. Commit per logical group, e.g. `feat(app): sortable headers on latency/reliability/network/workload/agents tables`.

---

## Task 3: History table coercion sort

**Files:** Modify `app/src/app/history/page.tsx`.

The Athena results are `{ columns: string[]; rows: string[][] }` — all-string cells, dynamic columns. Add a client sort: on header click, determine the column's type by SNIFFING (if every non-empty cell in that column parses as a finite number → numeric sort via `Number(cell)`; else string `localeCompare`); toggle asc/desc; sort the `rows` array by that column index; `aria-sort` on the header. Reuse `SortableHeader` (or an index-based variant) + the comparator direction logic. Default = unsorted (as returned by Athena, i.e. `bucket DESC` from the query). Empty cells sort last.

- [ ] Step 1: extract/reuse a small `sniffColumnType(cells: string[]): 'number'|'string'` + sort the string matrix by column index with the shared direction toggle. If `sniffColumnType` is pure, TDD it (all-numeric → number, mixed/any-non-numeric → string, empty cells ignored).
- [ ] Step 2: wire header click → sort `rows` by index; `aria-sort`; toggle. Keep `.ui-table-dense`, the scanned-bytes caption, and the graceful empty/error states.
- [ ] Step 3: `vitest`/tsc/build; headless (if Athena reachable, else assert headers become clickable + sort a static fixture). Commit `feat(app): sortable history results table (numeric/string column sniffing)`.

---

## Task 4: Finalize — review + v0.9.0 + deploy

- [ ] Step 1: Full `vitest` + `tsc` + `build` green. Confirm every table sorts, defaults unchanged (first render identical), no regressed testids/row-click/CSV/mobile.
- [ ] Step 2: Final whole-branch adversarial review (strongest model): comparator correctness (number null handling both directions, string localeCompare, boolean, direction toggle, no input mutation, stable sort); **RAW-value sorting everywhere (never the formatted string) — the make-or-break**; default-sort preserved per table (first render unchanged); FlowTable CSV exports the sorted view + mobile list intact; network row-drill + workload filter compose with sort; history coercion correct + empty-cell handling; aria-sort correct; i18n ko+en parity; tokens only; mobile. Fix Critical/Important.
- [ ] Step 3: Version bump **0.9.0** (version.ts + package.json + CHANGELOG [0.9.0] EN+KR: Added = sortable tables (type-aware asc/desc) across flows/latency/reliability/network/workload/agents/history; + ref links). version.test passes.
- [ ] Step 4: Commit `chore(release): v0.9.0 — sortable data tables (type-aware asc/desc)`. Merge `--no-ff` to main.
- [ ] Step 5: Deploy (USER-AUTHORIZED). `bash scripts/build-push.sh <sha>` → `cd infra && npx cdk deploy NfmDash-App --require-approval never -c imageTag=<sha>`. Verify stack UPDATE_COMPLETE, ECS rollout COMPLETED + tag, ALB healthy, CloudFront /login 200 + /→302.
- [ ] Step 6: Prod smoke: `bash scripts/smoke.sh` (3/3) + authenticated headless — sort a numeric column (e.g. reliability retransRate) desc→asc and a string column, confirm order flips + arrows/aria-sort; FlowTable + a couple tabs; light+dark, mobile.

---

## Phase 15 self-review checklist
- [ ] Shared `useSortableRows` + `SortableHeader` (type-aware string/number/boolean, asc/desc toggle, aria-sort) — comparator TDD'd.
- [ ] Applied to all 6 static tables + history coercion; Toplist ranked lists intentionally excluded.
- [ ] Sort keys off RAW accessor values (not formatted display); nulls consistent; default sort per table preserves current first render.
- [ ] FlowTable CSV/mobile + network row-drill + workload filter unregressed; no changed testids; i18n ko+en; tokens only; mobile.
- [ ] v0.9.0 synced; suite + build green; final review clean; deployed + prod smoke — Task 4.
