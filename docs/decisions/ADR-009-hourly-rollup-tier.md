# ADR-009: Collector-Side Hourly Rollup Tier

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Status

Accepted — 2026-07-15. Supersedes ADR-008: the 24h interactive-range cap is lifted and `7d` is restored to `TIME_RANGES` (v0.11.0).

## Context

ADR-008 capped interactive lens ranges at 24h because the lens architecture aggregates raw 5-minute rows at request time, so cost scales linearly with the window: 1h ≈ instant, 24h ≈ 38 s cold, 7d ≈ minutes (fatal — the 2026-07-15 CPU crash-loop incident). That ADR's own "Restoration path" named collector-side hourly rollups as the fix, conditional on rollups being live and backfilled — this ADR is that restoration.

## Decision

Move aggregation from read time to write time: the collector closes each hour and writes hour-grain rollup rows into the SAME table, using the SAME item shape as the existing 5-minute `FlowEdge` rows, so unmodified lens code can consume them.

1. **Key/shape**: `pk: HFLOW#<hourBucket>#<monitor>`, `sk: <metric>#<category>#<edgeHash>` — the hour-bucket formula mirrors the collector's 5-min formula at a 3,600,000 ms grain. No GSI attributes (the pod/edge time-series indexes stay 5-min-only). TTL 8 days (7d window + margin).
2. **Merge**: counters (`DATA_TRANSFERRED`, `RETRANSMISSIONS`, `TIMEOUTS`) sum exactly over the hour's twelve 5-min buckets; `ROUND_TRIP_TIME` (a gauge) is the mean of present buckets — an approximation, since NFM currently emits no RTT in prod. Each (hour, monitor, metric, category) group keeps only the top-200 edges by value after merging the hour's 12×top-100 raw lists.
3. **Hour-close job**: appended to the existing 5-minute collector cycle, isolated by try/catch so a rollup failure never fails the collect cycle. Eligibility = hour boundaries at least one cycle past close (their last 5-min bucket has landed). A `HROLL#done` marker in the meta table drives idempotent, resumable processing — up to 6 missing hours per cycle, newest first — so a fresh deploy auto-backfills the last 7 days in roughly 28 cycles (~2.3 h).
4. **App read side**: `windowPlan`/`windowPairPlan` (`app/src/lib/ddb.ts`) route requests over 36 buckets (>3h) to closed-hour HFLOW rows plus a live 5-minute tail; ≤36 buckets stay on the unchanged raw path. The pair (window-over-window) path is symmetric — closed hours only, no tail on either half — so movers/anomalies deltas aren't biased toward the current window.
5. **Archive stays raw-only**: `archive-transform`'s existing `pk.startsWith('FLOW#')` guard already excludes `HFLOW#` rows, so the Parquet archive is unaffected by this change.

Alternatives considered: a separate rollup table (rejected — doubles the write path and access-pattern surface for no benefit, since the existing item shape already generalizes to hour grain); daily-grain rollups (rejected as a non-goal — hourly is sufficient for the 24h/7d ranges in scope, and anything beyond 7d is already served by the Athena cold tier); offloading the raw aggregation to `worker_threads` instead of moving it to write time (already rejected in ADR-008, and it still doesn't fix cost — moving the same O(window) work off the event loop still leaves multi-hundred-MB reads and minutes-long computes for the first cold viewer).

## Consequences

- 24h and 7d cold loads drop to roughly 180 and 840 DynamoDB queries respectively (from ~1,440 and ~10,000+), landing at ~1–2 s cold; warm reads are unaffected (still served by the ADR-007 in-process cache).
- `7d` returns to `TIME_RANGES` on the interactive lens pages (v0.11.0); the target-group `unhealthyThresholdCount: 5` health-check tolerance from ADR-008 stays in place as defense in depth.
- Accuracy contract: counter sums are exact over the stored (already top-100-truncated) 5-min inputs, with the hourly top-200 cap adding a second, bounded truncation of the merged tail — rates are unaffected in practice, but totals can undercount long tails, the same kind of approximation today's 5-min top-100 truncation already carries. RTT at hour grain is a mean, not a distribution — no p95 across hourly windows; latency-percentile widgets over hourly ranges are treated as approximations.
- Storage cost is negligible: rollup rows are capped at 200 per (hour, monitor, metric, category) and TTL out after 8 days — an order of magnitude smaller footprint than the raw 5-min feed they summarize. The archive pipeline is untouched, so it stays raw-only.
- Missing rollup rows (mid-backfill, or if the collector is down) degrade the same way the 7-day TTL edge already does today — closed hours simply return what exists, with no fallback to a raw 5-min fan-out for large ranges (that fallback would resurrect the ADR-008 crash-loop path).

---

<a id="korean"></a>

# 한국어

## Status

승인됨 — 2026-07-15. ADR-008을 대체(supersede) — 인터랙티브 lens 범위 24h 상한을 해제하고 `TIME_RANGES`에 `7d`를 복원합니다(v0.11.0).

## Context

ADR-008은 lens 아키텍처가 조회 시점에 원시 5분 행을 집계하기 때문에 인터랙티브 lens 범위를 24h로 제한했습니다: 비용이 윈도우에 정비례합니다 — 1h ≈ 즉시, 24h ≈ 콜드 38초, 7d ≈ 수 분(치명적 — 2026-07-15 CPU 크래시 루프 인시던트). 해당 ADR의 "복원 경로"는 이미 수집기 측 시간별 rollup을 해법으로 지목했으며, rollup이 가동·백필된 뒤에만 조건부로 유효했습니다 — 이 ADR이 바로 그 복원입니다.

## Decision

집계를 조회 시점에서 쓰기 시점으로 이동합니다: 수집기가 매 시간을 마감하고, 기존 5분 `FlowEdge` row와 동일한 테이블·동일한 아이템 형태로 시간 단위 rollup row를 기록하여, 수정되지 않은 lens 코드가 그대로 소비할 수 있게 합니다.

1. **키/형태**: `pk: HFLOW#<hourBucket>#<monitor>`, `sk: <metric>#<category>#<edgeHash>` — 시간 버킷 공식은 수집기의 5분 공식을 3,600,000ms 그레인으로 그대로 반영합니다. GSI 속성 없음(pod/edge 시계열 인덱스는 5분 전용으로 유지). TTL 8일(7일 윈도우 + 여유).
2. **병합**: 카운터(`DATA_TRANSFERRED`, `RETRANSMISSIONS`, `TIMEOUTS`)는 해당 시간의 12개 5분 버킷에 대해 정확히 합산되고, `ROUND_TRIP_TIME`(게이지)은 존재하는 버킷의 평균입니다 — 근사치이며, NFM은 현재 프로덕션에서 RTT를 방출하지 않습니다. (시간, 모니터, 메트릭, 카테고리)별 그룹은 12×top-100 원시 리스트를 병합한 뒤 값 기준 top-200 edge만 유지합니다.
3. **시간 마감(hour-close) 작업**: 기존 5분 수집기 사이클에 덧붙이며, try/catch로 격리되어 rollup 실패가 수집 사이클 자체를 실패시키지 않습니다. 대상 시간 = 마감 후 최소 한 사이클이 지난 시간 경계(해당 시간의 마지막 5분 버킷이 이미 적재됨). meta 테이블의 `HROLL#done` 마커가 idempotent하고 재개 가능한 처리를 주도합니다 — 사이클당 최대 6개 누락 시간을 최신순으로 처리하여, 신규 배포 시 최근 7일이 약 28사이클(~2.3시간)에 자동 백필됩니다.
4. **앱 읽기 측**: `windowPlan`/`windowPairPlan`(`app/src/lib/ddb.ts`)이 36버킷(3시간) 초과 요청을 마감된 시간 HFLOW row + 실시간 5분 tail로 라우팅하고, 36버킷 이하는 기존 원시 경로를 그대로 유지합니다. pair(윈도우 대비) 경로는 대칭적입니다 — 마감된 시간만 사용, 양쪽 절반 모두 tail 없음 — 그래서 movers/anomalies 델타가 현재 윈도우 쪽으로 편향되지 않습니다.
5. **아카이브는 raw-only 유지**: `archive-transform`의 기존 `pk.startsWith('FLOW#')` 가드가 이미 `HFLOW#` row를 제외하므로, 이 변경으로 Parquet 아카이브는 영향받지 않습니다.

검토한 대안: 별도 rollup 테이블(기각 — 기존 아이템 형태가 이미 시간 그레인으로 일반화되므로, 이점 없이 쓰기 경로와 접근 패턴 표면을 두 배로 늘림); 일 단위(daily) rollup(비목표로 기각 — 시간 단위가 범위 내 24h/7d에 충분하며, 7d를 넘는 범위는 어차피 Athena 콜드 티어가 담당); 쓰기 시점 rollup 대신 원시 집계를 `worker_threads`로 오프로드(ADR-008에서 이미 기각됨, 비용 자체를 해결하지 못함 — 동일한 O(window) 작업을 이벤트 루프 밖으로 옮겨도 첫 콜드 조회자에게는 여전히 수백 MB 읽기·수 분 계산이 남음).

## Consequences

- 24h/7d 콜드 로드가 DynamoDB 쿼리 약 180회/840회로 감소(기존 ~1,440회/~10,000회+)하여 콜드 ~1–2초에 도달; warm 읽기는 영향 없음(여전히 ADR-007 인프로세스 캐시가 서빙).
- 인터랙티브 lens 페이지의 `TIME_RANGES`에 `7d`가 복원됨(v0.11.0); ADR-008의 타깃 그룹 `unhealthyThresholdCount: 5` 헬스체크 유예는 심층 방어로 그대로 유지됩니다.
- 정확도 계약: 카운터 합산은 저장된(이미 top-100으로 절단된) 5분 입력에 대해 정확하며, 시간 단위 top-200 상한이 병합된 tail에 두 번째의 유계(bounded) 절단을 추가합니다 — rate는 실질적으로 영향받지 않지만 total은 롱테일을 과소 집계할 수 있으며, 이는 오늘의 5분 top-100 절단이 이미 가질 수 있는 것과 같은 종류의 근사입니다. 시간 그레인의 RTT는 분포가 아닌 평균입니다 — 시간 단위 윈도우 전체의 p95는 없으며, 시간 단위 범위의 지연 백분위 위젯은 근사치로 취급됩니다.
- 저장 비용은 무시할 수준: rollup row는 (시간, 모니터, 메트릭, 카테고리)당 200개로 상한되고 8일 후 TTL로 소멸하여, 이를 요약하는 원시 5분 피드보다 자릿수 단위로 작은 용량입니다. 아카이브 파이프라인은 영향받지 않으므로 raw-only로 유지됩니다.
- rollup row가 없는 경우(백필 진행 중 또는 수집기 다운)는 오늘의 7일 TTL 경계와 동일한 방식으로 열화합니다 — 마감된 시간은 존재하는 데이터만 반환하며, 큰 범위에 대한 원시 5분 fan-out으로의 폴백은 없습니다(그 폴백은 ADR-008의 크래시 루프 경로를 되살릴 것입니다).
