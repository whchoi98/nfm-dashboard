# ADR-007: In-Process Version-Aligned Caching over ElastiCache

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Status

Accepted — 2026-07-14. Shipped and deployed as image `37736cf` (task def rev 26).

## Context

The 2026-07-14 OOM incident exposed that every lens request re-fetched and re-aggregated raw flow windows from DynamoDB (bucket-per-5-min × monitors fan-out). After the immediate hotfix (`5f344e8`: 512-socket agent, 4 GiB task, 10s settle-based TTL cache), menus were stable but repeat loads and 30s polling still paid the full fetch+compute cost whenever the 10s TTL lapsed. Adding ElastiCache Serverless (Valkey) was evaluated: ap-northeast-2 pricing is $0.101/GB-hour storage + $0.0027 per million ECPUs (~$8–10/month minimum at this traffic).

Key topology facts: the app runs as a SINGLE ECS task; the underlying data changes only when the collector writes a cycle (~every 5 minutes); responses are identical across users (auth is at the perimeter).

## Decision

Cache in-process, keyed to a data VERSION, instead of adding an external cache:

- Version = latest collector `cycleTs` (probed from `STATUS#collect`, memoized 15s, sticky on probe failure) + the current 5-minute bucket boundary.
- Raw windows (`getFlowsWindow`/`getFlowsWindowPair`) and computed lens responses (`cachedLens` on the 8 pure flow-lens routes) share one versioned map with in-flight dedup; pending fetches are never swept (a slow fetch keeps absorbing callers); every drop path clears the idle timer; 200-entry cap.
- Routes mixing CloudWatch alarms/metrics or user-specific data are never response-cached.

ElastiCache was declined because, for a single task, a network cache is strictly slower than an in-process map on hits, cannot help the first (cold) computation at all, and its real benefits — cross-task sharing and surviving restarts — do not apply to this topology. Re-evaluate if the service scales past one task.

## Consequences

- Polling and repeat navigation serve from memory between collector cycles (measured: `/api/network?buckets=72` 4.5 s → 0.02 s; `/api/anomalies?buckets=288` 40 s → 0.13 s warm); new data appears within ~15 s of a cycle write.
- Invalidation is synchronized at version rolls: the first request per key after each roll pays the full cold cost. This surfaced the next day as the CPU crash loop (ADR-008) when the cold cost itself was minutes long.
- The cache dies with the task — deploys and replacements start cold. This is accepted for a single-task dashboard; an external cache (or DynamoDB-persisted aggregates) is the revisit path when scaling out.

---

<a id="korean"></a>

# 한국어

## Status

승인됨 — 2026-07-14. 이미지 `37736cf`(태스크 정의 rev 26)로 배포 완료.

## Context

2026-07-14 OOM 인시던트로 모든 lens 요청이 DynamoDB에서 원시 flow 윈도우를 매번 재조회·재집계(5분 버킷 × 모니터 fan-out)하는 구조가 드러났습니다. 긴급 수정(`5f344e8`: 512소켓 agent, 4 GiB 태스크, 10초 settle 기준 TTL 캐시) 후 메뉴는 안정화됐지만, 10초 TTL이 지나면 반복 조회와 30초 폴링이 여전히 전체 fetch+계산 비용을 지불했습니다. ElastiCache Serverless(Valkey) 추가를 검토: ap-northeast-2 요금은 스토리지 $0.101/GB-시간 + ECPU 백만 건당 $0.0027 (이 트래픽에서는 월 최소 ~$8–10).

핵심 토폴로지 사실: 앱은 **단일** ECS 태스크로 실행되고, 데이터는 수집기가 사이클을 기록할 때(~5분마다)만 변하며, 응답은 사용자 간 동일합니다(인증은 경계에서 처리).

## Decision

외부 캐시 추가 대신, 데이터 **버전**에 정렬된 인프로세스 캐시를 사용합니다:

- 버전 = 최신 수집기 `cycleTs`(`STATUS#collect` 프로브, 15초 메모, 프로브 실패 시 마지막 성공값 유지) + 현재 5분 버킷 경계.
- 원시 윈도우(`getFlowsWindow`/`getFlowsWindowPair`)와 계산된 lens 응답(순수 flow-lens 라우트 8개의 `cachedLens`)이 in-flight dedup을 갖춘 단일 버전 맵을 공유. 진행 중인 fetch는 절대 sweep되지 않고(느린 fetch가 caller를 계속 흡수), 모든 삭제 경로가 유휴 타이머를 해제하며, 200 엔트리 상한 적용.
- CloudWatch 알람/메트릭 또는 사용자별 데이터가 섞인 라우트는 응답 캐시 대상에서 제외.

ElastiCache 미채택 사유: 단일 태스크에서는 네트워크 캐시가 히트 시 인프로세스 맵보다 항상 느리고, 첫(콜드) 계산에는 전혀 도움이 되지 않으며, 실질 이점(태스크 간 공유, 재시작 후 유지)이 이 토폴로지에 적용되지 않습니다. 태스크가 2개 이상으로 확장되면 재검토합니다.

## Consequences

- 수집기 사이클 사이의 폴링·반복 탐색은 메모리에서 응답 (실측: `/api/network?buckets=72` 4.5초 → 0.02초; `/api/anomalies?buckets=288` 40초 → 0.13초 warm); 새 데이터는 사이클 기록 후 ~15초 내 반영.
- 무효화가 버전 롤 시점에 동기화됨: 롤 이후 키별 첫 요청은 전체 콜드 비용을 지불. 콜드 비용 자체가 분 단위였던 다음 날 CPU 크래시 루프(ADR-008)로 표면화.
- 캐시는 태스크와 함께 소멸 — 배포·교체 직후는 콜드 시작. 단일 태스크 대시보드에서는 수용; 스케일아웃 시 외부 캐시(또는 DynamoDB 영속 집계)를 재검토 경로로 둡니다.
