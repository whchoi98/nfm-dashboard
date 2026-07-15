# Collector Hourly Rollups + 7d Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move flow aggregation from read time to write time (hourly `HFLOW#` rollup rows written by the collector), so 24h lens views load cold in ~1–2 s and the `7d` interactive range returns to the lens pages (supersedes ADR-008). Ships as v0.11.0 with a CHANGELOG release entry.

**Architecture:** Hourly rollups are ordinary `FlowEdge`-shaped items at hour grain (`pk: HFLOW#<hourBucket>#<monitor>`, same `sk`), written idempotently by a rollup step appended to the collector's 5-minute cycle (≤6 closed hours per cycle, newest first — auto-backfills the last 7 days from raw rows). The app reader (`app/src/lib/ddb.ts`) plans windows by grain: requests over 36 buckets (3h) read closed hours at hour grain plus the open hour's 5-min buckets as a live tail; pair fetches use 2H closed hours split symmetrically (no tail). Existing lenses run unchanged because hourly rows ARE `FlowEdge`s.

**Tech Stack:** TypeScript, vitest + aws-sdk-client-mock (both workspaces), esbuild collector bundle, CDK deploys (`NfmDash-Data` then `NfmDash-App`).

**Spec:** `docs/superpowers/specs/2026-07-15-hourly-rollups-design.md` (read it first).

## Global Constraints

- Hour bucket key format: `new Date(Math.floor(t/3_600_000)*3_600_000).toISOString().replace(/\.\d+Z/, 'Z')` → e.g. `2026-07-15T03:00:00Z`. The 5-min formula stays byte-identical to `recentBuckets()`/collector.
- Hourly item: full FlowEdge payload, `bucket` = hour key, **no gsi1/gsi2/gsi3 attributes**, `ttl` = now + **8 days**.
- Merge semantics: counters (`DATA_TRANSFERRED`, `RETRANSMISSIONS`, `TIMEOUTS`) SUM; `ROUND_TRIP_TIME` MEAN of present buckets; endpoint/port/traversed fields from the edge's LATEST bucket in the hour; cap **top-200 by value per (monitor, metric, category)**.
- Rollup eligibility: `hourEnd + 5 min <= now`; lookback **168 hours**; **max 6 hours per cycle, newest first**; marker `pk:'HROLL#done', sk:<hourBucket>` in the META table written AFTER the hour's items; hour with no raw data → marker only.
- Rollup failures must NEVER fail the collect cycle (catch, log, count in stats log line).
- App grain rule: `n <= 36` buckets → raw 5-min path unchanged; `n > 36` → `H = Math.round(n/12)` closed hours + open-hour tail (window) / `2H` closed hours symmetric H/H, **no tail** (pair).
- All UI strings via `t()` (ko+en); chart colors from tokens only; tests co-located; TDD (failing test first, watch it fail).
- Run commands from repo root: `npm -w collector run test`, `npx -w app vitest run`, `npx -w app tsc --noEmit`, `npm -w collector run build`, `npm -w app run build`.
- Production deploys (Tasks 13–14) require explicit user authorization naming the stack; do not run `cdk deploy` without it.

## File Structure

- Create `collector/src/rollup.ts` — pure: hour-bucket math, eligibility, merge. Test: `collector/src/rollup.test.ts`.
- Create `collector/src/rollup-store.ts` — I/O: markers, raw-hour query, HFLOW writes, `runRollupStep` orchestration. Test: `collector/src/rollup-store.test.ts`.
- Modify `collector/src/storage.ts` — extract `batchWriteAll` (reused by rollup-store; `writeCycle` behavior unchanged).
- Modify `collector/src/handler.ts` — wire `runRollupStep` with failure isolation.
- Modify `collector/src/archive-transform.test.ts` — pin that `HFLOW#` rows are NOT archived (no src change needed: the existing `pk.startsWith('FLOW#')` guard already excludes them — `'HFLOW#…'` does not start with `'FLOW#'`).
- Modify `app/src/lib/ddb.ts` (+ `ddb.test.ts`) — `windowPlan`/`windowPairPlan` (pure, exported) + grain-aware fetch paths.
- Modify `app/src/app/api/{network,analytics/efficiency,cost-explorer}/route.ts` — consume plan `buckets`/`windowSeconds`.
- Modify `app/src/lib/analytics/filters.ts` (+ test) — restore `'7d'`, `MAX_BUCKETS` 2016.
- Modify `app/src/lib/i18n/translations/{ko,en}.json` — `history.hint` copy back.
- Modify `app/src/lib/version.ts`, `app/package.json`, `CHANGELOG.md` — v0.11.0.
- Create `docs/decisions/ADR-009-hourly-rollup-tier.md`; modify ADR-008 status + docs sync set.

---

### Task 1: Collector pure time helpers (`rollup.ts`)

**Files:**
- Create: `collector/src/rollup.ts`
- Test: `collector/src/rollup.test.ts`

**Interfaces:**
- Produces: `hourBucketOf(t: number): string`, `fiveMinBucketsOfHour(hourBucket: string): string[]` (12 keys, ascending), `eligibleMissingHours(nowMs: number, done: Set<string>, lookbackHours?: number, maxPerCycle?: number): string[]` (newest-first). Consumed by Tasks 2, 4.

- [ ] **Step 1: Write the failing tests**

```typescript
// collector/src/rollup.test.ts
import { describe, it, expect } from 'vitest';
import { hourBucketOf, fiveMinBucketsOfHour, eligibleMissingHours } from './rollup.js';

describe('hourBucketOf', () => {
  it('floors to the hour in collector ISO format (no ms)', () => {
    expect(hourBucketOf(Date.parse('2026-07-15T03:47:33.123Z'))).toBe('2026-07-15T03:00:00Z');
    expect(hourBucketOf(Date.parse('2026-07-15T03:00:00.000Z'))).toBe('2026-07-15T03:00:00Z');
  });
});

describe('fiveMinBucketsOfHour', () => {
  it('returns the 12 five-minute grid keys of the hour, ascending', () => {
    const b = fiveMinBucketsOfHour('2026-07-15T03:00:00Z');
    expect(b).toHaveLength(12);
    expect(b[0]).toBe('2026-07-15T03:00:00Z');
    expect(b[1]).toBe('2026-07-15T03:05:00Z');
    expect(b[11]).toBe('2026-07-15T03:55:00Z');
  });
});

describe('eligibleMissingHours', () => {
  // At 04:03, hour 03 closed at 04:00 but 04:00+5min > now → NOT yet eligible;
  // hour 02 (closed 03:00, +5min = 03:05 <= now) IS.
  it('requires hourEnd + 5min <= now', () => {
    const now = Date.parse('2026-07-15T04:03:00Z');
    const hours = eligibleMissingHours(now, new Set());
    expect(hours[0]).toBe('2026-07-15T02:00:00Z');
    expect(hours).not.toContain('2026-07-15T03:00:00Z');
  });

  it('is newest-first, skips done hours, and caps at maxPerCycle', () => {
    const now = Date.parse('2026-07-15T04:10:00Z'); // hour 03 now eligible
    const done = new Set(['2026-07-15T02:00:00Z']);
    const hours = eligibleMissingHours(now, done, 168, 3);
    expect(hours).toEqual(['2026-07-15T03:00:00Z', '2026-07-15T01:00:00Z', '2026-07-15T00:00:00Z']);
  });

  it('looks back at most lookbackHours', () => {
    const now = Date.parse('2026-07-15T04:10:00Z');
    const hours = eligibleMissingHours(now, new Set(), 2, 10);
    expect(hours).toEqual(['2026-07-15T03:00:00Z', '2026-07-15T02:00:00Z']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx -w collector vitest run src/rollup.test.ts`
Expected: FAIL — cannot resolve `./rollup.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// collector/src/rollup.ts
// Hourly rollup pure helpers. Hour keys share the collector ISO format
// (no ms) so HFLOW keys line up with the 5-min FLOW grid.
export const HOUR_MS = 3_600_000;
const FIVE_MIN_MS = 300_000;
// One full cycle past hour close, so the hour's last 5-min bucket has landed.
const CLOSE_GRACE_MS = 5 * 60_000;

const iso = (t: number) => new Date(t).toISOString().replace(/\.\d+Z/, 'Z');

export function hourBucketOf(t: number): string {
  return iso(Math.floor(t / HOUR_MS) * HOUR_MS);
}

export function fiveMinBucketsOfHour(hourBucket: string): string[] {
  const start = Date.parse(hourBucket);
  return Array.from({ length: 12 }, (_, i) => iso(start + i * FIVE_MIN_MS));
}

export function eligibleMissingHours(
  nowMs: number, done: Set<string>, lookbackHours = 168, maxPerCycle = 6,
): string[] {
  const newestEligibleStart = Math.floor((nowMs - CLOSE_GRACE_MS) / HOUR_MS) * HOUR_MS - HOUR_MS;
  const out: string[] = [];
  for (let i = 0; i < lookbackHours && out.length < maxPerCycle; i++) {
    const key = iso(newestEligibleStart - i * HOUR_MS);
    if (!done.has(key)) out.push(key);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx -w collector vitest run src/rollup.test.ts` → PASS (5 tests). Then `npm -w collector run test` → all green.

- [ ] **Step 5: Commit**

```bash
git add collector/src/rollup.ts collector/src/rollup.test.ts
git commit -m "feat(collector): hourly rollup time helpers (hour keys, eligibility)"
```

---

### Task 2: Merge logic (`mergeHourEdges`)

**Files:**
- Modify: `collector/src/rollup.ts` (append)
- Test: `collector/src/rollup.test.ts` (append)

**Interfaces:**
- Produces: `mergeHourEdges(raw: FlowEdge[], hourBucket: string, capPerGroup?: number): FlowEdge[]`. Consumed by Task 4.

- [ ] **Step 1: Write the failing tests** (append to `rollup.test.ts`)

```typescript
import { mergeHourEdges } from './rollup.js';
import type { FlowEdge } from './types.js';

const mk = (over: Partial<FlowEdge>): FlowEdge => ({
  edgeHash: 'e1', monitor: 'm1', metric: 'DATA_TRANSFERRED', category: 'INTER_AZ',
  bucket: '2026-07-15T03:00:00Z', value: 10, unit: 'Bytes',
  a: { podName: 'api-1', podNamespace: 'shop' }, b: { podName: 'db-0', podNamespace: 'shop' },
  traversedConstructs: [], ...over });

describe('mergeHourEdges', () => {
  const HOUR = '2026-07-15T03:00:00Z';

  it('sums counter values per (monitor, metric, category, edgeHash) and stamps the hour bucket', () => {
    const out = mergeHourEdges([
      mk({ bucket: '2026-07-15T03:00:00Z', value: 10 }),
      mk({ bucket: '2026-07-15T03:05:00Z', value: 32 }),
      mk({ bucket: '2026-07-15T03:05:00Z', value: 5, edgeHash: 'e2' }),
    ], HOUR);
    const e1 = out.find(e => e.edgeHash === 'e1')!;
    expect(e1.value).toBe(42);
    expect(e1.bucket).toBe(HOUR);
    expect(out.find(e => e.edgeHash === 'e2')!.value).toBe(5);
  });

  it('averages ROUND_TRIP_TIME over present buckets only', () => {
    const out = mergeHourEdges([
      mk({ metric: 'ROUND_TRIP_TIME', bucket: '2026-07-15T03:00:00Z', value: 10, unit: 'Milliseconds' }),
      mk({ metric: 'ROUND_TRIP_TIME', bucket: '2026-07-15T03:10:00Z', value: 30, unit: 'Milliseconds' }),
    ], HOUR);
    expect(out[0].value).toBe(20); // mean of 2 present buckets, NOT /12
  });

  it('carries endpoint info from the LATEST bucket of the edge', () => {
    const out = mergeHourEdges([
      mk({ bucket: '2026-07-15T03:00:00Z', a: { podName: 'api-1', podNamespace: 'shop', az: 'old' } }),
      mk({ bucket: '2026-07-15T03:55:00Z', a: { podName: 'api-1', podNamespace: 'shop', az: 'new' } }),
    ], HOUR);
    expect(out[0].a.az).toBe('new');
  });

  it('caps each (monitor, metric, category) group at capPerGroup by value', () => {
    const raw = Array.from({ length: 10 }, (_, i) => mk({ edgeHash: `e${i}`, value: i }));
    const out = mergeHourEdges(raw, HOUR, 3);
    expect(out).toHaveLength(3);
    expect(out.map(e => e.edgeHash).sort()).toEqual(['e7', 'e8', 'e9']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx -w collector vitest run src/rollup.test.ts`
Expected: FAIL — `mergeHourEdges` is not exported.

- [ ] **Step 3: Implement** (append to `rollup.ts`)

```typescript
import type { FlowEdge } from './types.js';

/**
 * Merge one hour's raw 5-min edges into hour-grain FlowEdges.
 * Counters SUM; ROUND_TRIP_TIME is the MEAN of present buckets (gauge —
 * approximation, documented in the spec); endpoint/port/traversed fields come
 * from the edge's latest bucket. Each (monitor, metric, category) group keeps
 * only the top `capPerGroup` edges by value (merge of 12 x top-100 raw lists).
 */
export function mergeHourEdges(
  raw: FlowEdge[], hourBucket: string, capPerGroup = 200,
): FlowEdge[] {
  type Acc = { edge: FlowEdge; sum: number; count: number; latestBucket: string };
  const acc = new Map<string, Acc>();
  for (const e of raw) {
    const key = `${e.monitor}|${e.metric}|${e.category}|${e.edgeHash}`;
    const cur = acc.get(key);
    if (!cur) {
      acc.set(key, { edge: e, sum: e.value, count: 1, latestBucket: e.bucket });
    } else {
      cur.sum += e.value;
      cur.count += 1;
      if (e.bucket > cur.latestBucket) { cur.edge = e; cur.latestBucket = e.bucket; }
    }
  }
  const groups = new Map<string, FlowEdge[]>();
  for (const { edge, sum, count } of acc.values()) {
    const value = edge.metric === 'ROUND_TRIP_TIME' ? sum / count : sum;
    const merged: FlowEdge = { ...edge, bucket: hourBucket, value };
    const gkey = `${edge.monitor}|${edge.metric}|${edge.category}`;
    (groups.get(gkey) ?? groups.set(gkey, []).get(gkey)!).push(merged);
  }
  const out: FlowEdge[] = [];
  for (const group of groups.values()) {
    group.sort((x, y) => y.value - x.value);
    out.push(...group.slice(0, capPerGroup));
  }
  return out;
}
```

- [ ] **Step 4: Run tests** → `npx -w collector vitest run src/rollup.test.ts` PASS; `npm -w collector run test` all green.

- [ ] **Step 5: Commit**

```bash
git add collector/src/rollup.ts collector/src/rollup.test.ts
git commit -m "feat(collector): mergeHourEdges — sum/RTT-mean/top-200 hour-grain merge"
```

---

### Task 3: Extract `batchWriteAll` in `storage.ts` (DRY for Task 4)

**Files:**
- Modify: `collector/src/storage.ts`
- Test: `collector/src/storage.test.ts` (existing tests must stay green; add one)

**Interfaces:**
- Produces: `batchWriteAll(ddb: DynamoDBDocumentClient, table: string, items: Record<string, unknown>[]): Promise<void>` — 25-item batches, retries UnprocessedItems ×3 with backoff, logs+drops leftovers (verbatim current `writeCycle` behavior). Consumed by Task 4.

- [ ] **Step 1: Add a failing test** (append to `storage.test.ts`)

```typescript
import { batchWriteAll } from './storage.js';
import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

it('batchWriteAll chunks into 25-item batches', async () => {
  ddbMock.reset();
  ddbMock.on(BatchWriteCommand).resolves({ UnprocessedItems: {} });
  const items = Array.from({ length: 30 }, (_, i) => ({ pk: `p${i}`, sk: 's' }));
  await batchWriteAll(ddbMock as never, 'flows-table', items);
  const calls = ddbMock.commandCalls(BatchWriteCommand);
  expect(calls).toHaveLength(2);
  expect(calls[0].args[0].input.RequestItems!['flows-table']).toHaveLength(25);
  expect(calls[1].args[0].input.RequestItems!['flows-table']).toHaveLength(5);
});
```

(Adapt the mock handle name to the file's existing `mockClient(DynamoDBDocumentClient)` variable; pass the real `DynamoDBDocumentClient.from(...)` instance the existing tests use if that is the established pattern.)

- [ ] **Step 2: Run to verify failure** — `npx -w collector vitest run src/storage.test.ts` → FAIL (`batchWriteAll` not exported).

- [ ] **Step 3: Implement** — in `storage.ts`, extract the loop body of `writeCycle` (lines 55–68) verbatim:

```typescript
export async function batchWriteAll(ddb: DynamoDBDocumentClient, table: string,
    rawItems: Record<string, unknown>[]): Promise<void> {
  const items = rawItems.map(item => ({ PutRequest: { Item: item } }));
  for (let i = 0; i < items.length; i += 25) {
    let pending = items.slice(i, i + 25);
    for (let attempt = 0; pending.length > 0; attempt++) {
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: pending } }));
      pending = (res.UnprocessedItems?.[table] ?? []) as typeof pending;
      if (pending.length === 0) break;
      if (attempt >= 3) {
        console.error(JSON.stringify({ level: 'error', msg: 'unprocessed items dropped', count: pending.length }));
        break;
      }
      await new Promise(r => setTimeout(r, 200 * 2 ** attempt));
    }
  }
}
```

Then replace the inline loop in `writeCycle` with:

```typescript
  const ttl = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  await batchWriteAll(ddb, tables.flows, payload.edges.map(e => flowItem(e, ttl)));
```

(Delete the now-unused local `items` mapping and the old loop; keep everything after it unchanged.)

- [ ] **Step 4: Run** `npm -w collector run test` → ALL green (existing `writeCycle` tests prove behavior preserved).

- [ ] **Step 5: Commit**

```bash
git add collector/src/storage.ts collector/src/storage.test.ts
git commit -m "refactor(collector): extract batchWriteAll from writeCycle (reused by rollup)"
```

---

### Task 4: Rollup I/O + orchestration (`rollup-store.ts`)

**Files:**
- Create: `collector/src/rollup-store.ts`
- Test: `collector/src/rollup-store.test.ts`

**Interfaces:**
- Consumes: `hourBucketOf`, `fiveMinBucketsOfHour`, `eligibleMissingHours`, `mergeHourEdges` (Tasks 1–2), `batchWriteAll` (Task 3).
- Produces: `hflowItem(e: FlowEdge, ttlEpoch: number): Record<string, unknown>`, `runRollupStep(opts: { ddb: DynamoDBDocumentClient; tables: { flows: string; meta: string }; monitors: string[]; nowMs: number }): Promise<{ hoursDone: string[] }>`. Consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

```typescript
// collector/src/rollup-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { hflowItem, runRollupStep } from './rollup-store.js';
import type { FlowEdge } from './types.js';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tables = { flows: 'flows-t', meta: 'meta-t' };
beforeEach(() => ddbMock.reset());

const edge = (over: Partial<FlowEdge>): FlowEdge => ({
  edgeHash: 'e1', monitor: 'm1', metric: 'DATA_TRANSFERRED', category: 'INTER_AZ',
  bucket: '2026-07-15T02:00:00Z', value: 7, unit: 'Bytes',
  a: {}, b: {}, traversedConstructs: [], ...over });

it('hflowItem writes HFLOW keys with NO gsi attributes', () => {
  const item = hflowItem(edge({ bucket: '2026-07-15T02:00:00Z',
    a: { podName: 'api-1', podNamespace: 'shop' } }), 123);
  expect(item.pk).toBe('HFLOW#2026-07-15T02:00:00Z#m1');
  expect(item.sk).toBe('DATA_TRANSFERRED#INTER_AZ#e1');
  expect(item.ttl).toBe(123);
  expect(item.gsi1pk).toBeUndefined();
  expect(item.gsi2pk).toBeUndefined();
  expect(item.gsi3pk).toBeUndefined();
});

describe('runRollupStep', () => {
  // now = 04:10 → newest eligible hour is 03:00; markers say 02:00 is done.
  const nowMs = Date.parse('2026-07-15T04:10:00Z');

  it('rolls up the newest missing eligible hour: 12 buckets x monitors queried, HFLOW + marker written', async () => {
    ddbMock.on(QueryCommand, { TableName: tables.meta }).resolves({
      Items: Array.from({ length: 166 }, (_, i) => // every eligible hour except 03:00 done
        ({ pk: 'HROLL#done', sk: new Date(Date.parse('2026-07-15T03:00:00Z') - (i + 1) * 3_600_000)
          .toISOString().replace(/\.\d+Z/, 'Z') })) });
    ddbMock.on(QueryCommand, { TableName: tables.flows }).callsFake((input) => {
      const pk = input.ExpressionAttributeValues[':pk'] as string;
      return { Items: [edge({ bucket: pk.split('#')[1], value: 2 })] };
    });
    ddbMock.on(BatchWriteCommand).resolves({ UnprocessedItems: {} });
    ddbMock.on(PutCommand).resolves({});

    const res = await runRollupStep({ ddb, tables, monitors: ['m1', 'm2'], nowMs });

    expect(res.hoursDone).toEqual(['2026-07-15T03:00:00Z']);
    const flowQueries = ddbMock.commandCalls(QueryCommand)
      .filter(c => c.args[0].input.TableName === tables.flows);
    expect(flowQueries).toHaveLength(24); // 12 buckets x 2 monitors
    const batch = ddbMock.commandCalls(BatchWriteCommand)[0].args[0].input;
    const written = batch.RequestItems!['flows-t'].map((r: any) => r.PutRequest.Item);
    // one merged edge per monitor (12 buckets x value 2 = 24), hour-stamped:
    expect(written).toHaveLength(2);
    expect(written[0].pk).toMatch(/^HFLOW#2026-07-15T03:00:00Z#/);
    expect(written[0].value).toBe(24);
    const marker = ddbMock.commandCalls(PutCommand).find(c =>
      c.args[0].input.Item!.pk === 'HROLL#done')!.args[0].input.Item!;
    expect(marker.sk).toBe('2026-07-15T03:00:00Z');
    expect(typeof marker.ttl).toBe('number');
  });

  it('writes marker only (no BatchWrite) for an hour with no raw data', async () => {
    ddbMock.on(QueryCommand, { TableName: tables.meta }).resolves({ Items: [] });
    ddbMock.on(QueryCommand, { TableName: tables.flows }).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});
    const res = await runRollupStep({ ddb, tables, monitors: ['m1'], nowMs });
    expect(res.hoursDone).toHaveLength(6); // maxPerCycle empty hours, marker-only
    expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(6);
  });

  it('paginates the raw-hour query (LastEvaluatedKey)', async () => {
    ddbMock.on(QueryCommand, { TableName: tables.meta }).resolves({
      Items: Array.from({ length: 167 }, (_, i) =>
        ({ pk: 'HROLL#done', sk: new Date(Date.parse('2026-07-15T03:00:00Z') - (i + 1) * 3_600_000)
          .toISOString().replace(/\.\d+Z/, 'Z') })) });
    let first = true;
    ddbMock.on(QueryCommand, { TableName: tables.flows }).callsFake((input) => {
      if (input.ExpressionAttributeValues[':pk'].endsWith('T03:00:00Z#m1') && first) {
        first = false;
        return { Items: [edge({ value: 1 })], LastEvaluatedKey: { pk: 'x', sk: 'y' } };
      }
      return { Items: [] };
    });
    ddbMock.on(BatchWriteCommand).resolves({ UnprocessedItems: {} });
    ddbMock.on(PutCommand).resolves({});
    await runRollupStep({ ddb, tables, monitors: ['m1'], nowMs });
    const flowQueries = ddbMock.commandCalls(QueryCommand)
      .filter(c => c.args[0].input.TableName === tables.flows);
    expect(flowQueries).toHaveLength(13); // 12 buckets + 1 continuation page
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx -w collector vitest run src/rollup-store.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```typescript
// collector/src/rollup-store.ts
// Hour-close rollup I/O: read markers, read one hour's raw 5-min rows,
// write hour-grain HFLOW items + a completion marker. Idempotent — raw
// inputs are immutable, so re-running an hour rewrites identical items.
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { batchWriteAll } from './storage.js';
import { eligibleMissingHours, fiveMinBucketsOfHour, mergeHourEdges } from './rollup.js';
import type { FlowEdge } from './types.js';

const ROLLUP_TTL_SECONDS = 8 * 24 * 3600; // 7d window + margin
const RAW_QUERY_CONCURRENCY = 8;

/** HFLOW item: FlowEdge payload at hour grain. NO gsi attrs — the pod/edge
 *  indexes stay 5-min-only concerns. */
export function hflowItem(e: FlowEdge, ttlEpoch: number): Record<string, unknown> {
  return { ...e,
    pk: `HFLOW#${e.bucket}#${e.monitor}`, sk: `${e.metric}#${e.category}#${e.edgeHash}`,
    ttl: ttlEpoch };
}

async function listDoneHours(ddb: DynamoDBDocumentClient, metaTable: string): Promise<Set<string>> {
  const done = new Set<string>();
  let key: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(new QueryCommand({ TableName: metaTable,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': 'HROLL#done' },
      ExclusiveStartKey: key }));
    for (const item of res.Items ?? []) done.add((item as { sk: string }).sk);
    key = res.LastEvaluatedKey;
  } while (key);
  return done;
}

async function queryPartition(ddb: DynamoDBDocumentClient, flowsTable: string,
    pk: string): Promise<FlowEdge[]> {
  const items: FlowEdge[] = [];
  let key: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(new QueryCommand({ TableName: flowsTable,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ExclusiveStartKey: key }));
    items.push(...((res.Items ?? []) as FlowEdge[]));
    key = res.LastEvaluatedKey;
  } while (key);
  return items;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]); }
  }));
  return results;
}

export async function runRollupStep(opts: {
  ddb: DynamoDBDocumentClient; tables: { flows: string; meta: string };
  monitors: string[]; nowMs: number;
}): Promise<{ hoursDone: string[] }> {
  const { ddb, tables, monitors, nowMs } = opts;
  const done = await listDoneHours(ddb, tables.meta);
  const hours = eligibleMissingHours(nowMs, done);
  const ttl = Math.floor(nowMs / 1000) + ROLLUP_TTL_SECONDS;
  const hoursDone: string[] = [];
  for (const hour of hours) {
    const partitions = fiveMinBucketsOfHour(hour)
      .flatMap(b => monitors.map(m => `FLOW#${b}#${m}`));
    const raw = (await mapPool(partitions, RAW_QUERY_CONCURRENCY,
      pk => queryPartition(ddb, tables.flows, pk))).flat();
    const merged = mergeHourEdges(raw, hour);
    if (merged.length > 0) {
      await batchWriteAll(ddb, tables.flows, merged.map(e => hflowItem(e, ttl)));
    }
    // Marker LAST: a crash mid-hour leaves no marker, so the hour is retried.
    await ddb.send(new PutCommand({ TableName: tables.meta,
      Item: { pk: 'HROLL#done', sk: hour, ttl } }));
    hoursDone.push(hour);
  }
  return { hoursDone };
}
```

- [ ] **Step 4: Run tests** — `npx -w collector vitest run src/rollup-store.test.ts` → PASS; `npm -w collector run test` all green.

- [ ] **Step 5: Commit**

```bash
git add collector/src/rollup-store.ts collector/src/rollup-store.test.ts
git commit -m "feat(collector): hour-close rollup step — HFLOW writes, markers, auto-backfill"
```

---

### Task 5: Handler wiring + archive-exclusion pin

**Files:**
- Modify: `collector/src/handler.ts`
- Test: `collector/src/archive-transform.test.ts` (append one test; NO src change — `flattenFlowImage` already requires `pk.startsWith('FLOW#')` and `'HFLOW#…'` fails that check)

**Interfaces:**
- Consumes: `runRollupStep` (Task 4).

- [ ] **Step 1: Add the archive-exclusion pin test** (append to `archive-transform.test.ts`, matching its existing marshalled-image test style)

```typescript
import { marshall } from '@aws-sdk/util-dynamodb';

it('excludes HFLOW hourly rollup rows from the Parquet archive', () => {
  const image = marshall({ pk: 'HFLOW#2026-07-15T03:00:00Z#m1',
    sk: 'DATA_TRANSFERRED#INTER_AZ#e1', edgeHash: 'e1', monitor: 'm1',
    metric: 'DATA_TRANSFERRED', category: 'INTER_AZ',
    bucket: '2026-07-15T03:00:00Z', value: 1, unit: 'Bytes' });
  expect(flattenFlowImage(image as never)).toBeNull();
});
```

- [ ] **Step 2: Run it** — `npx -w collector vitest run src/archive-transform.test.ts` → PASS immediately (regression pin for existing behavior; that is the point — the archive stays raw-only by construction).

- [ ] **Step 3: Wire the handler.** In `collector/src/handler.ts`, add the import and insert the rollup step AFTER the DNS block and BEFORE the final `console.log('cycle done')`:

```typescript
import { runRollupStep } from './rollup-store.js';
```

```typescript
  // Hour-close rollup (spec 2026-07-15-hourly-rollups): idempotent, <=6 hours
  // per cycle newest-first, auto-backfills from raw rows still inside the 7d
  // TTL. MUST NOT fail the collect cycle.
  const rollup = await runRollupStep({ ddb,
    tables: { flows: process.env.TABLE_FLOWS!, meta: process.env.TABLE_META! },
    monitors: monitorPairs.map(([m]) => m), nowMs: now.getTime() })
    .catch(err => { console.error('rollup failed', err); return { hoursDone: [] as string[] }; });
  console.log(JSON.stringify({ level: 'info', msg: 'cycle done', stats,
    edges: edges.length, rollupHours: rollup.hoursDone.length }));
  return { ok: true, stats };
```

(Replace the existing final `console.log` line — the only change to it is the added `rollupHours` field.)

- [ ] **Step 4: Verify** — `npm -w collector run test` all green; `npm -w collector run build` succeeds (both bundles).

- [ ] **Step 5: Commit**

```bash
git add collector/src/handler.ts collector/src/archive-transform.test.ts
git commit -m "feat(collector): wire hour-close rollup into the cycle (failure-isolated); pin HFLOW archive exclusion"
```

Note: collector Lambda sizing is already sufficient (`infra/lib/data-stack.ts`: 512 MB / 270 s timeout; the rollup step adds ≤ 6h × 12 buckets × monitors ≈ 360 queries). No infra change in this task.

---

### Task 6: App window planning (`windowPlan` / `windowPairPlan`, pure)

**Files:**
- Modify: `app/src/lib/ddb.ts` (add exports; no behavior change yet)
- Test: `app/src/lib/ddb.test.ts` (append; NOTE the file's convention — every fake-timer test pins a time in a LATER 5-min bucket than all earlier tests', monotonic with file order; place these tests at the END of the file and use times from `2026-07-09T02:00:00Z` onward)

**Interfaces:**
- Produces (consumed by Tasks 7–8):

```typescript
export type WindowPart = { grain: 'raw' | 'hourly'; bucket: string };
export interface WindowPlan { parts: WindowPart[]; buckets: string[]; windowSeconds: number }
export function windowPlan(n: number, now?: number): WindowPlan
export function windowPairPlan(n: number, now?: number):
  { current: WindowPart[]; prior: WindowPart[]; windowSeconds: number }
export const GRAIN_SWITCH_BUCKETS = 36; // > 3h reads hour grain
```

`buckets` = the actual bucket keys fetched, newest first (tail 5-min keys, then hour keys) — routes use it for bucket-keyed series; `windowSeconds` = the effective covered span.

- [ ] **Step 1: Write the failing tests** (append to `ddb.test.ts`; import `windowPlan, windowPairPlan` in the top import)

```typescript
describe('windowPlan / windowPairPlan', () => {
  it('n <= 36 stays raw and matches recentBuckets exactly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T02:00:00.000Z'));
    const plan = windowPlan(12);
    expect(plan.parts.every(p => p.grain === 'raw')).toBe(true);
    expect(plan.buckets).toEqual(recentBuckets(12));
    expect(plan.windowSeconds).toBe(12 * 300);
  });

  it('n > 36 quantizes to H=round(n/12) closed hours plus the open-hour 5-min tail', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T02:17:33.000Z')); // open hour 02:00, tail = 02:00..02:15
    const plan = windowPlan(288); // 24h -> H=24
    const raw = plan.parts.filter(p => p.grain === 'raw');
    const hourly = plan.parts.filter(p => p.grain === 'hourly');
    expect(raw.map(p => p.bucket)).toEqual(
      ['2026-07-09T02:15:00Z', '2026-07-09T02:10:00Z', '2026-07-09T02:05:00Z', '2026-07-09T02:00:00Z']);
    expect(hourly).toHaveLength(24);
    expect(hourly[0].bucket).toBe('2026-07-09T01:00:00Z'); // newest CLOSED hour
    expect(hourly[23].bucket).toBe('2026-07-08T02:00:00Z');
    expect(plan.buckets).toEqual(plan.parts.map(p => p.bucket)); // newest-first, tail then hours
    expect(plan.windowSeconds).toBe(24 * 3600 + 4 * 300);
  });

  it('7d (2016) plans 168 closed hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T03:02:00.000Z'));
    const plan = windowPlan(2016);
    expect(plan.parts.filter(p => p.grain === 'hourly')).toHaveLength(168);
  });

  it('pair plan over 36 buckets is symmetric closed hours with NO tail', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T03:20:00.000Z')); // open hour 03:00
    const pair = windowPairPlan(288); // H=24 per half
    expect(pair.current).toHaveLength(24);
    expect(pair.prior).toHaveLength(24);
    expect(pair.current.every(p => p.grain === 'hourly')).toBe(true);
    expect(pair.current[0].bucket).toBe('2026-07-09T02:00:00Z'); // newest closed hour
    expect(pair.prior[0].bucket).toBe('2026-07-08T02:00:00Z');   // continues where current ends
    expect(pair.windowSeconds).toBe(24 * 3600);
  });

  it('pair plan at or under 36 buckets keeps the raw split', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T04:00:00.000Z'));
    const pair = windowPairPlan(6);
    expect(pair.current.every(p => p.grain === 'raw')).toBe(true);
    expect(pair.current.map(p => p.bucket)).toEqual(recentBuckets(12).slice(0, 6));
    expect(pair.prior.map(p => p.bucket)).toEqual(recentBuckets(12).slice(6));
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx -w app vitest run src/lib/ddb.test.ts` → FAIL (`windowPlan` not exported).

- [ ] **Step 3: Implement** — in `ddb.ts`, directly below `recentBuckets`:

```typescript
export type WindowPart = { grain: 'raw' | 'hourly'; bucket: string };
export interface WindowPlan { parts: WindowPart[]; buckets: string[]; windowSeconds: number }

// Requests over 3h read hour-grain HFLOW rollups (closed hours) plus the open
// hour's 5-min buckets as a live tail; smaller requests stay raw (unchanged).
export const GRAIN_SWITCH_BUCKETS = 36;
const HOUR_MS = 3_600_000;
const isoNoMs = (t: number) => new Date(t).toISOString().replace(/\.\d+Z/, 'Z');

/** Closed-hour keys newest-first: [openHourStart - 1h, …, openHourStart - H h]. */
function closedHourBuckets(hoursBack: number, openHourStartMs: number): string[] {
  return Array.from({ length: hoursBack },
    (_, i) => isoNoMs(openHourStartMs - (i + 1) * HOUR_MS));
}

export function windowPlan(n: number, now = Date.now()): WindowPlan {
  if (n <= GRAIN_SWITCH_BUCKETS) {
    const buckets = recentBuckets(n);
    return { parts: buckets.map(b => ({ grain: 'raw' as const, bucket: b })),
      buckets, windowSeconds: n * 300 };
  }
  const H = Math.round(n / 12);
  const openHourStart = Math.floor(now / HOUR_MS) * HOUR_MS;
  const tailCount = Math.floor((Math.floor(now / 300_000) * 300_000 - openHourStart) / 300_000) + 1;
  const tail = recentBuckets(tailCount);
  const hours = closedHourBuckets(H, openHourStart);
  const parts: WindowPart[] = [
    ...tail.map(b => ({ grain: 'raw' as const, bucket: b })),
    ...hours.map(b => ({ grain: 'hourly' as const, bucket: b }))];
  return { parts, buckets: parts.map(p => p.bucket),
    windowSeconds: H * 3600 + tailCount * 300 };
}

/**
 * Pair plan: 2H CLOSED hours split symmetrically H/H — no tail on either half.
 * An asymmetric tail would bias every window-over-window delta (movers,
 * anomalies) toward the current window; the pair path trades <=1h of
 * freshness for symmetry (spec 2026-07-15-hourly-rollups).
 */
export function windowPairPlan(n: number, now = Date.now()):
    { current: WindowPart[]; prior: WindowPart[]; windowSeconds: number } {
  if (n <= GRAIN_SWITCH_BUCKETS) {
    const buckets = recentBuckets(2 * n);
    const part = (b: string): WindowPart => ({ grain: 'raw', bucket: b });
    return { current: buckets.slice(0, n).map(part), prior: buckets.slice(n).map(part),
      windowSeconds: n * 300 };
  }
  const H = Math.round(n / 12);
  const openHourStart = Math.floor(now / HOUR_MS) * HOUR_MS;
  const hours = closedHourBuckets(2 * H, openHourStart);
  const part = (b: string): WindowPart => ({ grain: 'hourly', bucket: b });
  return { current: hours.slice(0, H).map(part), prior: hours.slice(H).map(part),
    windowSeconds: H * 3600 };
}
```

- [ ] **Step 4: Run** — the new describe passes; full `npx -w app vitest run` green; `npx -w app tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ddb.ts app/src/lib/ddb.test.ts
git commit -m "feat(app): grain-aware window planning (windowPlan/windowPairPlan)"
```

---

### Task 7: Grain-aware fetch paths in `ddb.ts`

**Files:**
- Modify: `app/src/lib/ddb.ts`
- Test: `app/src/lib/ddb.test.ts` (append AFTER Task 6's tests; keep fake times monotonically increasing — use `2026-07-09T05:00:00Z` onward)

**Interfaces:**
- Consumes: `windowPlan`/`windowPairPlan` (Task 6), existing `mapPool`, `queryAll`, `monitorNames`, `cachedFetch`.
- Produces: `getFlowsWindow(n)` / `getFlowsWindowPair(n)` transparently serve hour-grain data for `n > 36`. Route-visible signatures unchanged.

- [ ] **Step 1: Write the failing tests** (append)

```typescript
describe('grain-aware window fetch', () => {
  const prevMonitors = process.env.MONITORS;
  beforeEach(() => { process.env.MONITORS = 'nfm-eks-demo=eks-demo'; });
  afterEach(() => {
    if (prevMonitors === undefined) delete process.env.MONITORS;
    else process.env.MONITORS = prevMonitors;
  });

  it('n > 36 queries HFLOW partitions for closed hours and FLOW for the tail', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T05:07:00.000Z')); // tail = 05:05, 05:00
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await getFlowsWindow(288);

    const pks = ddbMock.commandCalls(QueryCommand)
      .map(c => (c.args[0].input.ExpressionAttributeValues ?? {})[':pk'] as string)
      .filter(pk => pk?.startsWith('FLOW#') || pk?.startsWith('HFLOW#'));
    const hflow = pks.filter(pk => pk.startsWith('HFLOW#'));
    const flow = pks.filter(pk => pk.startsWith('FLOW#'));
    expect(hflow).toHaveLength(24); // 24 closed hours x 1 monitor
    expect(hflow).toContain('HFLOW#2026-07-09T04:00:00Z#nfm-eks-demo');
    expect(flow).toHaveLength(2);   // 05:05 + 05:00 tail
    expect(flow).toContain('FLOW#2026-07-09T05:05:00Z#nfm-eks-demo');
  });

  it('n <= 36 keeps today\'s raw path byte-identical', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T06:00:00.000Z'));
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await getFlowsWindow(12);
    const pks = ddbMock.commandCalls(QueryCommand)
      .map(c => (c.args[0].input.ExpressionAttributeValues ?? {})[':pk'] as string)
      .filter(pk => pk?.startsWith('FLOW#'));
    expect(pks).toHaveLength(12);
  });

  it('pair with n > 36 fetches 2H closed hours, split symmetrically, no tail', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T07:03:00.000Z'));
    ddbMock.on(QueryCommand).callsFake((input) => {
      const pk = (input.ExpressionAttributeValues ?? {})[':pk'] as string;
      if (!pk?.startsWith('HFLOW#')) return { Items: [] };
      return { Items: [{ edgeHash: `e-${pk}`, bucket: pk.split('#')[1],
        monitor: 'nfm-eks-demo', value: 1 }] };
    });

    const { current, prior } = await getFlowsWindowPair(288);

    expect(current).toHaveLength(24);
    expect(prior).toHaveLength(24);
    expect(current[0].bucket).toBe('2026-07-09T06:00:00Z'); // newest closed hour
    const pks = ddbMock.commandCalls(QueryCommand)
      .map(c => (c.args[0].input.ExpressionAttributeValues ?? {})[':pk'] as string);
    expect(pks.filter(pk => pk?.startsWith('FLOW#'))).toHaveLength(0); // no tail
  });
});
```

- [ ] **Step 2: Run to verify failure** — first test fails (only `FLOW#` pks issued, 292 of them).

- [ ] **Step 3: Implement.** In `ddb.ts`:

(a) Generalize the partition query — replace `queryFlowsByBucket`'s body with a shared helper and keep the exported signature working:

```typescript
async function queryPart(part: WindowPart, monitors: string[]): Promise<FlowEdge[]> {
  const prefix = part.grain === 'hourly' ? 'HFLOW' : 'FLOW';
  const results = await Promise.all(monitors.map(m => queryAll({
    TableName: TABLE_FLOWS,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': `${prefix}#${part.bucket}#${m}` } })));
  return results.flat();
}

/** Flows in one 5-min bucket; all monitors when `monitor` is omitted. */
export async function queryFlowsByBucket(bucket: string, monitor?: string): Promise<FlowEdge[]> {
  const monitors = monitor ? [monitor] : await monitorNames();
  return queryPart({ grain: 'raw', bucket }, monitors);
}
```

(b) Rewrite `fetchFlowsWindow` and the pair fetch body to run plans through ONE mapPool:

```typescript
async function fetchParts(parts: WindowPart[]): Promise<FlowEdge[][]> {
  const monitors = await monitorNames();
  return mapPool(parts, BUCKET_QUERY_CONCURRENCY, (p) => queryPart(p, monitors));
}

async function fetchFlowsWindow(n: number): Promise<FlowEdge[]> {
  return (await fetchParts(windowPlan(n).parts)).flat();
}
```

and in `getFlowsWindowPair`'s cached compute:

```typescript
  return cachedFetch(`p:${n}`, async () => {
    const plan = windowPairPlan(n);
    const perPart = await fetchParts([...plan.current, ...plan.prior]);
    return { current: perPart.slice(0, plan.current.length).flat(),
      prior: perPart.slice(plan.current.length).flat() };
  });
```

(Delete the old `recentBuckets(2 * n)` body; the single-mapPool budget and the version cache keys `w:`/`p:` are unchanged. `windowPlan` is deterministic within a 5-min bucket, so a cached entry's plan always matches a same-version re-computation.)

- [ ] **Step 4: Run** — new tests pass; ENTIRE `ddb.test.ts` suite must stay green (the existing dedup/cache/pool tests all use n <= 36 paths or pair(6/60) — the `shares one concurrency budget` test (n=60 > 36!) now plans 2×5 closed hours = 10 hourly parts, still `maxInFlight <= 40`: verify it passes; if its intent-comment needs updating to mention hour parts, update the comment only). Full app suite + `npx -w app tsc --noEmit` green.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ddb.ts app/src/lib/ddb.test.ts
git commit -m "feat(app): hour-grain window/pair fetch paths (HFLOW + live 5-min tail)"
```

---

### Task 8: Route updates — plan-derived `buckets` / `windowSeconds`

**Files:**
- Modify: `app/src/app/api/network/route.ts`
- Modify: `app/src/app/api/analytics/efficiency/route.ts`
- Modify: `app/src/app/api/cost-explorer/route.ts`
- Test: `app/src/lib/ddb.test.ts` already covers `windowPlan`; add NO new route tests (routes have none by convention — logic stays in lib). Audit step below is the safety net.

**Interfaces:**
- Consumes: `windowPlan` (Task 6).

- [ ] **Step 1: Audit lenses for bucket-string / window-seconds dependencies**

Run: `grep -rn "windowSeconds\|buckets:" app/src/app/api --include="route.ts" | grep -v test`
Expected consumers: `network` (passes `buckets: recentBuckets(buckets)` for sparklines AND `windowSeconds`), `analytics/efficiency` (`windowSeconds`), `cost-explorer` (`windowSeconds`), `reports` (`windowSeconds = 12 * 300` — pair(12) is raw-grain, UNCHANGED). Also run `grep -rn "\.bucket\b" app/src/lib/analytics/*.ts | grep -v test` and confirm every lens groups by `row.bucket` VALUES (grain-agnostic) rather than assuming 5-min spacing — `network-analytics.ts` sparklines key by the provided `buckets` list (fixed by this task); `overview-metrics.ts`/`reliability.ts` operate on <=36-bucket windows (raw, unchanged). Record any additional consumer found and apply the same fix pattern.

- [ ] **Step 2: Update `network/route.ts`**

Replace the lens call block:

```typescript
    const data = await cachedLens(lensCacheKey('network', req.url), async () => {
      const plan = windowPlan(buckets);
      const flows = applyFlowFilters(await getFlowsWindow(buckets), { namespace, category });
      return networkAnalyticsLens(flows, {
        sourceScope,
        destScope,
        metric,
        windowSeconds: plan.windowSeconds,
        buckets: plan.buckets,
      });
    });
```

and change the ddb import line to `import { cachedLens, getFlowsWindow, lensCacheKey, windowPlan } from '@/lib/ddb';` (drop `recentBuckets` if now unused in the file).

- [ ] **Step 3: Update `analytics/efficiency/route.ts` and `cost-explorer/route.ts`**

In both, add `windowPlan` to the `@/lib/ddb` import and replace `windowSeconds: buckets * 300` with `windowSeconds: windowPlan(buckets).windowSeconds` inside the cached compute. (For `n <= 36` the value is identical — `n * 300`.)

- [ ] **Step 4: Run** — `npx -w app vitest run` all green; `npx -w app tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/network/route.ts app/src/app/api/analytics/efficiency/route.ts app/src/app/api/cost-explorer/route.ts
git commit -m "feat(app): sparkline buckets + run-rate windowSeconds from the grain-aware window plan"
```

---

### Task 9: Restore the 7d interactive range

**Files:**
- Modify: `app/src/lib/analytics/filters.ts`
- Modify: `app/src/lib/analytics/filters.test.ts`
- Modify: `app/src/lib/i18n/translations/ko.json`, `app/src/lib/i18n/translations/en.json` (`history.hint`)

- [ ] **Step 1: Rewrite the range tests (failing first).** In `filters.test.ts`:

Replace the `TIME_RANGES` describe body with:

```typescript
  it('offers 7d again, backed by hourly rollups (spec 2026-07-15-hourly-rollups)', () => {
    expect(TIME_RANGES).toEqual(['15m', '1h', '3h', '24h', '7d']);
  });
```

Add back to the `rangeToBuckets` describe:

```typescript
  it('maps 7d to 2016 buckets', () => {
    expect(rangeToBuckets('7d')).toBe(2016);
  });
```

Update the clamp tests: `floors and clamps valid values into [1, 2016]` (`?buckets=9999` → `2016`); `parseLensParams` test names/values back to the 2016 ceiling (`?buckets=5000` → 2016; `accepts exactly 2016 … unchanged`).

- [ ] **Step 2: Run to verify failure** — `npx -w app vitest run src/lib/analytics/filters.test.ts` → 4 FAIL.

- [ ] **Step 3: Implement.** In `filters.ts`:

```typescript
// 7d is served by hour-grain HFLOW rollups + a live 5-min tail (~840 queries,
// no event-loop-blocking compute) — see docs/superpowers/specs/
// 2026-07-15-hourly-rollups-design.md; ADR-008's 24h cap is superseded.
export type TimeRange = '15m' | '1h' | '3h' | '24h' | '7d';
export const TIME_RANGES: TimeRange[] = ['15m', '1h', '3h', '24h', '7d'];
```

`rangeToBuckets` gains back `case '7d': return 2016;`. `MAX_BUCKETS` → `2016` with the doc comment `/** Widest flows window a lens route will fetch: 7 days (hour-grain via rollups over 36 buckets). */`, and the `parseBuckets` JSDoc back to `[1, 2016]`.

- [ ] **Step 4: Update `history.hint`** in both locales — replace `(24h max range)` phrasing:

- `en.json`: `"History queries the S3 archive (Athena, retained up to ~2 years) — unlike the live dashboard (7-day hot window), it accepts arbitrary date ranges, and each run is an on-demand, billed query."`
- `ko.json`: `"히스토리는 S3 아카이브(Athena, 최대 약 2년 보관)를 조회합니다 — 라이브 대시보드(최근 7일 핫 윈도우)와 달리 임의의 날짜 범위를 조회할 수 있으며, 실행 시 과금되는 온디맨드 쿼리입니다."`

- [ ] **Step 5: Run** — full `npx -w app vitest run` + `npx -w app tsc --noEmit` + `npm -w app run build` green.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/analytics/filters.ts app/src/lib/analytics/filters.test.ts app/src/lib/i18n/translations/ko.json app/src/lib/i18n/translations/en.json
git commit -m "feat(app): restore the 7d interactive range on hourly rollups (lifts the ADR-008 cap)"
```

---

### Task 10: v0.11.0 version + CHANGELOG release entry

**Files:**
- Modify: `app/src/lib/version.ts` (`APP_VERSION = '0.11.0'`)
- Modify: `app/package.json` (`"version": "0.11.0"` — `version.test.ts` asserts the two stay in sync)
- Modify: `CHANGELOG.md` (both language sections)

- [ ] **Step 1: Bump versions** in `version.ts` and `app/package.json`; run `npx -w app vitest run src/lib/version.test.ts` → PASS.

- [ ] **Step 2: Cut the release in `CHANGELOG.md`** — in BOTH the English and Korean sections, identically structured:
  1. Rename the current `## [Unreleased]` heading to `## [0.11.0] - <deploy date>` and add a fresh empty `## [Unreleased]` above it.
  2. Prepend to the release's `### Added` (EN, with the KO 명사형 equivalent in the KO section):
     - `Hourly rollup tier: the collector writes hour-grain HFLOW rows (same item shape, counters summed, RTT averaged, top-200 per monitor/metric/category, 8-day TTL) after each closed hour, auto-backfilling the last 7 days on first deploy; lens reads over 3h use closed-hour rollups plus a live 5-minute tail, cutting a cold 24h read from ~1,440 to ~180 queries and 7d to ~840 (ADR-009).`
     - `Restore the 7d interactive range on the lens pages, superseding the 24h cap (ADR-008).`
  3. Update the reference links at the bottom of BOTH sections: `[Unreleased]: …/compare/v0.11.0...HEAD` and add `[0.11.0]: …/compare/v0.10.0...v0.11.0`.

- [ ] **Step 3: Verify bilingual sync** — both sections have identical version lists and category structure; no emojis; ISO date.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/version.ts app/package.json CHANGELOG.md
git commit -m "chore(release): v0.11.0 — hourly rollups + 7d restore (CHANGELOG EN+KO)"
```

---

### Task 11: ADR-009 + docs sync

**Files:**
- Create: `docs/decisions/ADR-009-hourly-rollup-tier.md` (bilingual, same template as ADR-007/008: Status / Context / Decision / Consequences; Status `Accepted — 2026-07-15`. Content: read-time aggregation cost scaled with window (24h ~38 s cold, 7d fatal — ADR-008); decision = write-time hour-grain rollups in the same table/item shape (HFLOW#, no GSI attrs, top-200 cap, TTL 8d, marker-driven idempotent hour-close job, 7d auto-backfill); consequences = 24h/7d cold in ~1–2 s, 7d restored, accuracy contract (sum exact on top-100 inputs, RTT mean approximation), archive stays raw-only, rollup rows ≈ negligible storage cost.)
- Modify: `docs/decisions/ADR-008-24h-interactive-range-cap.md` — Status line in BOTH languages → `Superseded by ADR-009 (hourly rollups) — 2026-07-15; the cap shipped 6af919b and was lifted in v0.11.0.`
- Modify: `docs/reference/data.md` — add an HFLOW row to the components table: hour-grain rollup rows `HFLOW#<hour>#<monitor>` written by the collector hour-close step (marker `HROLL#done` in meta), read by `windowPlan` for >3h windows.
- Modify: `collector/CLAUDE.md` — Key Files: add `src/rollup.ts` / `src/rollup-store.ts` lines; Rules: note the hour-bucket formula and that HFLOW rows are excluded from the archive stream by the `FLOW#` prefix guard.
- Modify: `app/src/lib/CLAUDE.md` — extend the `ddb.ts` bullet: grain-aware `windowPlan`/`windowPairPlan` (>36 buckets → HFLOW closed hours + 5-min tail; pair symmetric, no tail).
- Modify: `docs/reference/api.md` — Key Decisions: replace the 24h-cap bullet with the [1, 2016] clamp + hour-quantization contract for `?buckets` > 36.
- Modify: `docs/architecture.md` — Storage layer sentence (EN+KO): flows table now carries a second, hour-grain rollup tier (HFLOW, 8d TTL) written by the collector; Query sentence: ranges over 3h read hour grain (ADR-009 supersedes the ADR-008 cap).
- Modify: `README.md` — the Task-8 feature bullet (EN+KO): 15m–7d interactive ranges on hourly rollups + cache; History for beyond-7d.
- Modify: `docs/runbooks/incident-response.md` — in the CPU-crash-loop paragraphs (EN+KO), append: `Interactive 7d was restored in v0.11.0 on hourly rollups (ADR-009).`

- [ ] **Step 1: Write all edits above** (bilingual docs updated in BOTH sections, style guide rules apply — no emojis, both languages identical in structure).
- [ ] **Step 2: Verify** — `grep -rn "24h" README.md docs/architecture.md docs/reference/api.md | grep -i "cap\|상한"` returns only historical/ADR references, not current-behavior claims.
- [ ] **Step 3: Commit**

```bash
git add docs/decisions/ docs/reference/ docs/architecture.md README.md collector/CLAUDE.md app/src/lib/CLAUDE.md docs/runbooks/incident-response.md
git commit -m "docs: ADR-009 hourly rollup tier; ADR-008 superseded; sync data/api/architecture/README/runbook"
```

---

### Task 12: Full verification + adversarial review gate

- [ ] **Step 1: Full suites** — `npm -w collector run test`, `npx -w app vitest run`, `npx -w app tsc --noEmit`, `cd infra && npx vitest run` (unchanged but must stay green), `npm -w collector run build`, `npm -w app run build`. ALL green.
- [ ] **Step 2: Adversarial review** — run the session's 3-lens review Workflow over `git diff main...HEAD` (correctness/concurrency, data-accuracy/grain-semantics, regression/contract lenses; verify-then-fix loop as in the 2026-07-14/15 sessions). Fix any CONFIRMED finding with the same TDD cycle before proceeding.
- [ ] **Step 3: Merge** — merge the feature branch to `main` (no-ff), push after the standard pre-push secret scan of the range.

---

### Task 13: Deploy `NfmDash-Data` + backfill verification

REQUIRES explicit user authorization naming `NfmDash-Data`.

- [ ] **Step 1:** `npm -w collector run build && cd infra && npx cdk deploy NfmDash-Data --require-approval never -c imageTag=unused`
- [ ] **Step 2: Watch the rollup start** (next 5-min cycle):

```bash
aws logs tail /aws/lambda/nfm-dashboard-collector --since 15m --format short | grep -E "rollupHours|rollup failed"
```

Expected: `"rollupHours":6` per cycle (backfill), no `rollup failed`.

- [ ] **Step 3: Verify HFLOW rows + markers accumulate**

```bash
aws dynamodb query --table-name nfm-dashboard-meta \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk":{"S":"HROLL#done"}}' \
  --select COUNT --region ap-northeast-2
```

Expected: count grows by ~6 per 5-min cycle toward ~168 (≈ 2.3 h). Spot-check one hour's rows exist with an `HFLOW#<hour>#<monitor>` Query on `nfm-dashboard-flows`.

- [ ] **Step 4: Wait for backfill completion** (count ≥ 160) before Task 14. Collector error alarm must stay OK.

---

### Task 14: Deploy `NfmDash-App` + live verification

REQUIRES explicit user authorization naming `NfmDash-App`.

- [ ] **Step 1:** `bash scripts/build-push.sh <merge-sha>` then `cd infra && npx cdk deploy NfmDash-App --require-approval never -c imageTag=<merge-sha>`.
- [ ] **Step 2: Live checks** (with the smoke session cookie, as in prior sessions):
  - `GET /api/anomalies?buckets=2016` cold: **≤ ~5 s**, HTTP 200; `/api/health` stays < 100 ms DURING it (no event-loop starvation).
  - Repeat within the same cycle: ≤ ~0.2 s (cache).
  - `GET /api/network?buckets=2016`: 200, sparkline buckets are hour keys + 5-min tail.
  - UI: lens range pickers show `7d`; sidebar shows `v0.11.0`; `bash scripts/smoke.sh` 3/3.
  - `aws logs tail` app log group: no socket-capacity warnings; ECS CPU max < 80% during the 7d cold load.
- [ ] **Step 3:** Update the assistant memory file with the deploy record (prod tag, rev, verification results).

## Self-Review (performed at plan-writing time)

- Spec coverage: §1 → Tasks 2/4 (item shape, cap, TTL, marker); §2 → Tasks 1/4/5 (eligibility, 6/cycle, backfill, isolation); §3 → Tasks 6/7/8 (grain rule, symmetric pair per the amended spec, effective-window metadata); §4 → Tasks 9/10/13/14 (restore, sequencing, v0.11.0); §5 → Task 11 (accuracy contract in ADR-009/data.md); §6 → per-task test steps + Task 12; risk notes → Task 5 (archive pin, Lambda sizing note), Task 8 audit (bucket-string dependencies).
- Placeholder scan: none — every code step carries full code; Task 11 doc edits specify exact content requirements per file.
- Type consistency: `WindowPart`/`WindowPlan` (Task 6) are the exact types consumed in Tasks 7–8; `runRollupStep` opts shape identical between Tasks 4 and 5; `hflowItem`/`batchWriteAll` signatures match their call sites.
