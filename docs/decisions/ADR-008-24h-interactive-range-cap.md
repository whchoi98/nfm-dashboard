# ADR-008: Interactive Lens Ranges Capped at 24h Until Collector Rollups

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Status

Accepted — 2026-07-15. Shipped and deployed as image `6af919b` (task def rev 27). Marked provisional: the cap is lifted when collector pre-aggregated hourly rollups land.

## Context

The 2026-07-15 incident: opening a 7d (2016-bucket) lens view cold ran minutes of synchronous fetch+aggregation on the 1-vCPU task (DynamoDB reads spiked from ~7k to ~264k RCU per 5 minutes), blocking the Node event loop. ALB health checks (15s interval × 2 failures = 30s) timed out and ECS replaced the task; the in-process version cache (ADR-007) died with it, and browser polling immediately re-triggered the same cold compute on the replacement — a crash loop the cache cannot break, because the computation never survives long enough to be cached. Even `/login` took 78 s during the peg.

The lens architecture aggregates raw 5-minute rows at request time, so cost scales linearly with the window: 1h ≈ instant, 24h ≈ 38 s cold, 7d ≈ minutes (fatal). The Athena-backed `/history` page already serves arbitrary long ranges from the S3 Parquet archive.

## Decision

1. Cap interactive lens ranges at 24h: remove `'7d'` from `TimeRange`/`TIME_RANGES` and clamp `MAX_BUCKETS` from 2016 to 288 server-side (legacy `?buckets=2016` requests clamp; a persisted 7d default range falls back to 1h). 7d+ analysis is served by `/history`.
2. Raise the ALB target group `unhealthyThresholdCount` from 2 to 5 (75 s of blocked event loop before replacement), so the surviving worst case — a 24h cold compute (~38 s) — can never crash-loop the task.

Alternatives considered: keeping 7d behind `worker_threads` offload (protects the event loop but first loads stay minutes-long, and moving multi-hundred-MB arrays across threads is costly) and health-check tolerance alone (leaves minutes-long full-menu degradation and still dies past 75 s). Both rejected for the incident timeframe.

## Consequences

- The lens pages lose the 7d option shipped in v0.7.0; capability moves to `/history` (Athena, on-demand billed queries).
- 24h cold loads (~38 s, first viewer per version roll) remain — acceptable under the 75 s health tolerance, but still the top UX gap.
- Restoration path (planned): collector-side hourly rollups (same item shape at hour grain) make 24h/7d reads ~180/~840 queries instead of ~1,440/~10,000, removing the cold cost; `'7d'` returns to `TIME_RANGES` only after rollups are live and backfilled.

---

<a id="korean"></a>

# 한국어

## Status

승인됨 — 2026-07-15. 이미지 `6af919b`(태스크 정의 rev 27)로 배포 완료. 잠정 조치: 수집기 시간별 사전 집계(rollup) 도입 시 상한 해제.

## Context

2026-07-15 인시던트: 7d(2016버킷) lens 뷰의 콜드 조회가 1 vCPU 태스크에서 수 분간 동기 fetch+집계를 실행 (DynamoDB 읽기가 5분당 ~7천 → ~26만 RCU로 급증), Node 이벤트 루프를 블록했습니다. ALB 헬스체크(15초 간격 × 2회 = 30초)가 타임아웃되어 ECS가 태스크를 교체했고, 인프로세스 버전 캐시(ADR-007)가 함께 소실되어 브라우저 폴링이 교체 태스크에 동일한 콜드 계산을 즉시 재유발 — 계산이 캐시에 남을 만큼 오래 살아남지 못해 캐시로는 끊을 수 없는 크래시 루프가 됐습니다. 피크 동안 `/login`조차 78초가 걸렸습니다.

lens 아키텍처는 조회 시점에 원시 5분 행을 집계하므로 비용이 윈도우에 정비례합니다: 1h ≈ 즉시, 24h ≈ 콜드 38초, 7d ≈ 수 분(치명적). Athena 기반 `/history` 페이지가 이미 S3 Parquet 아카이브에서 임의의 장기 범위를 담당합니다.

## Decision

1. 인터랙티브 lens 범위를 24h로 상한: `TimeRange`/`TIME_RANGES`에서 `'7d'` 제거, `MAX_BUCKETS`를 2016에서 288로 서버측 클램프 (레거시 `?buckets=2016` 요청은 클램프, 저장된 7d 기본 범위는 1h로 폴백). 7d+ 분석은 `/history`가 담당.
2. ALB 타깃 그룹 `unhealthyThresholdCount`를 2에서 5로 상향 (이벤트 루프 블록 75초까지 유예) — 잔존 최악 케이스인 24h 콜드 계산(~38초)이 태스크를 크래시 루프에 빠뜨릴 수 없도록 조치.

검토한 대안: `worker_threads` 오프로드로 7d 유지(이벤트 루프는 보호되지만 첫 로드는 여전히 수 분, 수백 MB 배열의 스레드 간 이동 비용 큼), 헬스체크 완화 단독(전 메뉴 분 단위 열화가 남고 75초 초과 시 여전히 사살). 둘 다 인시던트 시간 범위에서 기각.

## Consequences

- v0.7.0에서 출시된 lens 페이지의 7d 옵션 제거; 해당 기능은 `/history`(Athena, 실행 시 과금되는 온디맨드 쿼리)로 이동.
- 24h 콜드 로드(~38초, 버전 롤당 첫 조회자)는 잔존 — 75초 헬스 유예 내에서 수용 가능하나 최우선 UX 격차.
- 복원 경로(계획됨): 수집기 시간별 rollup(시간 그레인의 동일 아이템 스키마)으로 24h/7d 읽기를 ~1,440/~10,000 쿼리에서 ~180/~840으로 축소해 콜드 비용 제거; rollup 가동·백필 후에만 `'7d'`를 `TIME_RANGES`에 복원.
