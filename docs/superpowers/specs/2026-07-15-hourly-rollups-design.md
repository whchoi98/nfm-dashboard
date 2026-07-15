# Collector Hourly Rollups — Design

**Date:** 2026-07-15
**Status:** Approved (design accepted by user)
**Scope:** collector + app + docs. No new AWS resources (reuses `nfm-dashboard-flows` + `nfm-dashboard-meta`). Version bump to **v0.11.0** with a CHANGELOG release entry (user requirement).

## Goal

Kill the cold-load cost of large interactive ranges by moving flow aggregation from read time to write time:
- **24h** lens views: ~38 s cold → ~1–2 s cold (warm stays ms via the ADR-007 cache).
- **7d** restored to the interactive lens pages (`TIME_RANGES`), reverting the ADR-008 cap. ADR-008 is marked Superseded when this ships.
- No event-loop-blocking computes → the 2026-07-15 CPU crash loop class is structurally gone.

Non-goals: 30d+ interactive ranges (stay on Athena `/history`), exact RTT percentiles at hour grain, external caches, collector schema changes to the existing 5-min rows.

## Approach (decided)

**Same-schema hourly rows.** Hourly rollups are ordinary flow items at hour grain, written by the collector; the app reader mixes "closed hours at hour grain + the open hour at 5-min grain". Existing lens functions run unchanged because hourly rows ARE `FlowEdge`s.

User-approved parameters: hourly grain only (no daily tier); closed-hour rollup + live 5-min tail; freshness of the tail identical to today.

## 1. Data model (flows table)

Hourly item, mirroring `collector/src/storage.ts` `flowItem`:

- `pk: HFLOW#<hourBucket>#<monitor>` — `hourBucket = new Date(Math.floor(t/3_600_000)*3_600_000).toISOString().replace(/\.\d+Z/,'Z')` (e.g. `2026-07-15T03:00:00Z`)
- `sk: <metric>#<category>#<edgeHash>` (unchanged shape)
- Attributes: full `FlowEdge` payload with `bucket = hourBucket`; `value` = **sum** of the hour's 5-min values for counters (`DATA_TRANSFERRED`, `RETRANSMISSIONS`, `TIMEOUTS`), **mean of present buckets** for `ROUND_TRIP_TIME` (gauge; approximation — NFM currently emits no RTT in prod, documented); `unit` carried; endpoint info (`a`/`b`/`targetPort`/`traversedConstructs`) from the edge's latest bucket in the hour.
- **No GSI attributes** (`gsi1/2/3` are 5-min-only concerns: pod recent-flows and edge series stay fine-grained).
- **Cap:** per (hour, monitor, metric, category) keep the **top-200 edges by value** after merging the hour's 12×top-100 lists. Same truncation character as the existing top-100 raw feed; documented.
- **TTL: 8 days** (7d window + margin).

Completion marker (meta table): `pk: 'HROLL#done', sk: <hourBucket>`, `ttl` 8d. One marker per hour (not per monitor — an hour is rolled up for all monitors atomically in one pass).

## 2. Collector: hour-close rollup step

Appended to the existing 5-min cycle in `collector/src/handler.ts`, isolated so a rollup failure never fails the collect cycle (try/catch + error stat):

1. **Eligible hours** = hour boundaries with `hourEnd + 5 min ≤ now` (one full cycle past close, so the hour's last 5-min bucket has landed) within the last 168 hours.
2. Query `HROLL#done` markers (single Query) → missing hours; take up to **6 per cycle, newest first** (recent ranges heal first).
3. Per hour: read the hour's 12 bucket partitions × monitors (reuses the app-equivalent query pattern collector-side), merge per (monitor, metric, category, edgeHash) — sum/mean per §1 — apply top-200 cap, BatchWrite `HFLOW` items + the marker.
4. Hour with no raw data → write marker only.

Properties: **idempotent** (raw inputs immutable; rewriting an hour produces identical items), **auto-backfilling** (on first deploy the last 7 days of raw rows still exist → full backfill completes in ~168/6 ≈ 28 cycles ≈ 2.3 h; hours whose raw data already TTL'd get marker-only), bounded (≤ 6 h × 12 buckets × monitors ≈ 360 queries/cycle — same order as one 24h app fetch; verify Lambda timeout/memory headroom in the plan).

## 3. App read layer (`app/src/lib/ddb.ts`)

- **Grain rule:** `getFlowsWindow(n)` / `getFlowsWindowPair(n)` with **n > 36** (over 3h) use the hourly path; `n ≤ 36` unchanged (raw 5-min). 15m/1h/3h therefore keep today's exact behavior.
- **Hourly path window:** quantize the request to `H = round(n/12)` closed hours (newest closed hour backwards) + the open hour's 5-min buckets as the live tail. Pair fetch: one clock read, `2H` closed hours split in half + tail on the current half only.
- **Effective-window metadata:** the reader exposes `{ buckets: string[], windowSeconds: number }` for what it actually fetched (hour keys + 5-min tail keys). Routes that scale by window (efficiency, cost-explorer, network) and the bucket-string-keyed sparklines (`/api/network`) switch from `recentBuckets(n)` / `buckets*300` to this metadata — a plan task audits every lens for bucket-string or window-seconds dependencies.
- Fan-out drops from ~1,440 queries (24h) to ~180 and from ~10,000+ (7d) to ~840; the shared mapPool/socket agent and the ADR-007 version cache (`w:`/`p:`/`r:` keys) apply unchanged.
- Missing rollup rows (backfill in progress / collector down): closed hours simply return what exists — lenses render partial data, same degradation mode as today's TTL edge. No fallback to raw 5-min fan-out for large ranges (that would resurrect the crash-loop path).

## 4. UI restore + rollout sequencing

1. **Deploy `NfmDash-Data`** (collector rollup step). Verify: markers accumulate, HFLOW rows land, backfill completes (~2.3 h).
2. **Deploy `NfmDash-App`**: restore `'7d'` to `TimeRange`/`TIME_RANGES` (`rangeToBuckets` 2016), `MAX_BUCKETS` back to 2016, grain-aware reader, `history.hint` copy back to "vs the live dashboard"; `unhealthyThresholdCount: 5` stays (defense in depth).
3. **v0.11.0**: `APP_VERSION` + `app/package.json`; CHANGELOG moves `[Unreleased]` into a `[0.11.0]` release entry (EN+KO) adding the rollup/7d-restore items.
4. ADR-008 → Status: Superseded by rollups (this spec); new **ADR-009** documents the hourly rollup tier.
5. Docs auto-sync: `docs/reference/data.md` (HFLOW rows, marker, grain rule), `collector/CLAUDE.md`, `app/src/lib/CLAUDE.md`, `docs/architecture.md` (storage layer), README feature bullet.

## 5. Accuracy contract (documented in data.md)

- Counters are exact sums of the stored 5-min inputs; the inputs were already top-100-per-bucket truncated, and the hourly top-200 cap adds bounded truncation of the merged tail. Rates (retrans/GB etc.) are unaffected in practice; totals can undercount long tails — identical in kind to today.
- RTT at hour grain is a mean, not a distribution (no p95 across hours). Latency percentile widgets over hourly windows are labeled/treated as approximations. (Prod currently has zero RTT samples.)
- Hourly-window charts render at hour resolution with a finer live tail — intended (Datadog-style coarser rollups for longer ranges).

## 6. Testing

- **Collector (TDD):** merge math (sum/mean/top-200/endpoint carry), hour-bucket formula, eligibility (`hourEnd+5min`), marker idempotency (re-run → identical writes), backfill selection (newest-first, ≤6, marker-only for empty hours), failure isolation (rollup throw → cycle still succeeds, stat recorded).
- **App (TDD):** grain threshold (36 boundary), hour quantization + tail composition, pair split single clock read, effective-window metadata, HFLOW key construction, cache-key stability, lens bucket-dependency audit fixes.
- **Live verification:** backfill completion check; 7d cold ≤ ~5 s with `/api/health` responsive throughout; warm ms; smoke 3/3; ECS CPU stays sane during a 7d load.

## Risks / notes

- Collector cycle grows by the rollup step — bounded to 6 hours/cycle; if a cycle dies mid-rollup, markers ensure only completed hours are skipped (marker written after the hour's items).
- Two grains in one table partition namespace (`FLOW#` vs `HFLOW#`) — key prefixes keep them disjoint; the archive pipeline (DDB Stream → Firehose) filters/handles HFLOW rows explicitly (plan task: exclude `HFLOW#` from `archive-transform` so the Parquet archive stays raw-only).
- `?buckets` values between 37 and 2016 that aren't range-picker values get hour-quantized — documented in api.md (parseLensParams contract).
