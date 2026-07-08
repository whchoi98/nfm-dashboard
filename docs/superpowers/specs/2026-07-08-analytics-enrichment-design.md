# NFM Dashboard — Analytics & Visual Enrichment 설계 문서 / Design Spec

- 날짜: 2026-07-08
- 상태: 사용자 승인 대기
- 대상: 이미 배포된 NFM Dashboard(https://dv4r4bnlhlpcx.cloudfront.net)의 후속 개선
- 기반 스펙: `docs/superpowers/specs/2026-07-08-nfm-dashboard-design.md`

## 1. 목적 / Purpose

배포된 대시보드가 (1) 시각적으로 단조롭고(균일 파스텔 카드, 라인/바/도넛 3종, 큰 여백, 델타·추세 없음), (2) 수집된 NFM 데이터를 얕게만 보여준다는 피드백을 해결한다. 서버 측 집계로 **비용·신뢰성·지연·의존성** 4개 분석 렌즈를 추가하고, 다양한 차트로 전 페이지를 풍성화하며, 규모(116노드)에서 읽을 수 없는 토폴로지를 **집계→드릴다운 + 인접행렬** 방식으로 교체한다.

## 2. 확정된 의사결정 / Decisions

| 항목 | 결정 |
|---|---|
| 분석 렌즈 | 비용(AZ간/VPC간 $), 신뢰성(재전송/타임아웃 핫스팟), 지연(RTT 분포/백분위), 서비스 의존성(맵+구성) — 4종 모두 |
| 디자인 강도 | 풍성화 — SnowUI 팔레트/구조 유지 + 벤토 그리드 + 차트 다양화 + KPI 델타·스파크라인 |
| 집계 위치 | **백엔드 analytics API** (서버 계산) + 순수 집계 라이브러리(TDD) |
| 토폴로지 | 집계 노드(클러스터/네임스페이스) → 클릭 드릴다운(→pod) + 인접행렬(히트맵) 토글 + 상위 엣지 랭킹 사이드 패널 |
| 인사이트 페이지 | 4렌즈 탭형 Analytics 허브로 확장 |
| footer | SnowUI CC BY 4.0 문구 제거. **표기는 `README.md`에 유지**(라이선스 준수) |
| 팔레트/i18n/모바일 | 기존 SnowUI 토큰, ko/en, 아이폰 반응형 유지 |
| 배포 | 기존 `NfmDash-App` 이미지 재빌드(불변 SHA 태그) + 재배포 |

## 3. 가용 데이터 / Available Data (집계 입력)

`app/src/lib/types.ts` 기준(collector 출력과 동일):
- **FlowEdge**: `metric`(DATA_TRANSFERRED/RETRANSMISSIONS/TIMEOUTS/ROUND_TRIP_TIME), `category`(INTRA_AZ/INTER_AZ/INTER_VPC), `value`, `unit`, `bucket`, `a`/`b`(EndpointInfo: ip/instanceId/subnetId/az/vpcId/region/podName/podNamespace/serviceName), `targetPort`, `traversedConstructs`(componentId/Type/Arn/serviceName), `snatIp`/`dnatIp`
- **시계열**: `nfm-dashboard-flows` GSI3(`EDGE#<hash>` / `<bucket>#<metric>`), 버킷 격자 5분
- **WiResult/WiRow**: `WI#latest/all` (metric/category/rows: subnet/az/vpc/remoteIdentifier/value)
- **Coverage**: `COVERAGE#latest/all` (standalone[], eksNodeCount)
- **CollectionStatus**: `STATUS#collect/latest` (stats, cycleTs)
- **CloudWatch** `AWS/NetworkFlowMonitor` 5지표(차원 `MonitorId`=ARN, HealthIndicator 포함) — 기존 `cw-metrics.ts`

주의(기존 스펙 제약 계승): RTT는 sparse할 수 있음(항상 계산되지 않음); traversedConstructs componentType 값 목록 미문서화(미지 타입은 generic 처리); WI 행에는 pod 메타데이터 없음(모니터 쿼리 결과에만 존재).

## 4. 아키텍처 / Architecture

```
브라우저 (개요/Analytics허브/토폴로지/플로우/경로/에이전트)
   │  fetch (30s 폴링)
   ▼
Next.js API routes (ECS Fargate — 기존)
   ├─ /api/analytics/{cost,reliability,latency,dependencies}   ← 신규
   ├─ /api/overview (델타+스파크라인 확장)
   └─ 기존 data routes
        │  read
        ▼
  DynamoDB (nfm-dashboard-flows/-meta) + CloudWatch
        ▲
  집계는 app/src/lib/analytics/*.ts 순수함수로 계산 (route가 조립)
```

집계는 **읽기 시점**에 수행(최근 N버킷 조회 후 in-memory 집계). collector/DynamoDB 스키마 변경 없음.

## 5. 컴포넌트/파일 구조 / File Structure

```
app/src/lib/analytics/
  ├─ cost.ts            # bytesToUsd, topCostContributors, costByCategorySeries
  ├─ reliability.ts     # ratePer(엔티티), thresholdBreaches, nhiTimeline
  ├─ latency.ts         # percentiles(p50/p90/p95), intraVsInter, slowestPaths, rttTrend
  ├─ dependencies.ts    # serviceGraph(Sankey), composition(port/ns/category), hopUsage
  ├─ aggregate.ts       # 공유 헬퍼: groupBy, entityKey(pod/service/ns/az), sum/rate
  └─ *.test.ts          # 각 순수함수 TDD
app/src/app/api/analytics/{cost,reliability,latency,dependencies}/route.ts   # 신규
app/src/app/api/overview/route.ts                                            # 확장(델타/스파크라인)
app/src/components/charts/
  ├─ Heatmap.tsx        # 신규(커스텀 그리드) — AZ×AZ, 인접행렬 겸용
  ├─ Sankey.tsx         # 신규(recharts Sankey 래핑)
  ├─ Treemap.tsx        # 신규(recharts Treemap)
  ├─ Distribution.tsx   # 신규(히스토그램/박스)
  ├─ Gauge.tsx          # 신규(반원 게이지)
  ├─ StatDelta.tsx      # 신규(값+델타+미니 스파크라인)
  └─ (기존 TimeSeries/CategoryBars/CategoryDonut 유지)
app/src/components/topology/
  ├─ AggregateGraph.tsx # 신규 — 집계 노드 + 드릴다운(React Flow 재사용)
  ├─ AdjacencyMatrix.tsx# 신규 — src×dst 히트맵(Heatmap 재사용)
  ├─ TopEdgesPanel.tsx  # 신규 — 상위 엣지 랭킹 사이드/시트
  └─ (기존 TopologyGraph.tsx는 AggregateGraph로 대체, 삭제)
app/src/app/{page,insights,flows,paths,topology,agents}/page.tsx   # 풍성화
app/src/components/layout/AppShell.tsx                              # footer 문구 제거
app/src/lib/i18n/translations/{ko,en}.json                          # 신규 키
```

### 공유 집계 인터페이스 (모든 태스크 준수)

```ts
// app/src/lib/analytics/aggregate.ts
export type EntityKind = 'pod'|'service'|'namespace'|'az'|'azpair'|'vpc';
export interface CostRow { key: string; label: string; bytes: number; usd: number; category: DestCategory; }
export interface ReliabilityRow { key: string; label: string; bytes: number;
  retransmissions: number; timeouts: number; retransRate: number; timeoutRate: number; }
export interface LatencyStats { p50: number; p90: number; p95: number; max: number; count: number; }
export interface SankeyData { nodes: { name: string }[]; links: { source: number; target: number; value: number }[]; }
export interface Series { label: string; points: { t: string; v: number }[]; }
```

집계 함수 시그니처는 각 태스크에서 위 타입을 반환/소비하며 route가 JSON으로 그대로 노출한다.

## 6. 분석 렌즈 상세 / Analytics Lenses

### 6.1 비용 (cost.ts / /api/analytics/cost)
- `bytesToUsd(bytes, category)`: INTER_AZ = 양방향 각 $0.01/GB(= $0.02/GB round-trip 근사, ap-northeast-2), INTER_VPC = 동일 요율 적용, INTRA_AZ = $0 (요율은 상수 `AZ_TRANSFER_USD_PER_GB=0.01`로 명시, 코드 주석에 근거/가정 기록)
- `topCostContributors(flows, kind='service')`: 엔티티쌍별 과금 바이트 → USD 내림차순 Top N
- `costByCategorySeries(flows)`: 버킷별 카테고리 비용 시계열
- 응답: `{ totalUsd, byCategory: Record<DestCategory,{bytes,usd}>, top: CostRow[], series: Series[] }`
- 명시 가정: NFM value가 과금 대상 바이트의 근사치라는 전제(정확 청구서 아님) — UI에 "추정치" 배지

### 6.2 신뢰성 (reliability.ts / /api/analytics/reliability)
- `ratePer(flows, kind)`: 엔티티별 **재전송/타임아웃을 전송량(GB)으로 정규화** → `retransRate = retransmissions / max(bytes/1e9, ε)`, `timeoutRate = timeouts / max(bytes/1e9, ε)` (ε로 0-division 가드; bytes=0이면 rate=0). "GB당 이벤트" 단위로 UI 표기
- `thresholdBreaches(rows, {retransRate, timeoutRate})`: 임계 초과 목록. 기본 임계 상수 `DEFAULT_RETRANS_RATE=10`, `DEFAULT_TIMEOUT_RATE=5`(GB당 이벤트, 코드 상수로 명시) — 실데이터 관찰 후 조정
- `nhiTimeline(cwHealthIndicator)`: CW HealthIndicator(Maximum) 타임라인(0/1)
- 응답: `{ hotspots: ReliabilityRow[], breaches: ReliabilityRow[], nhi: Series }`

### 6.3 지연 (latency.ts / /api/analytics/latency)
- `percentiles(rttValues)`: p50/p90/p95/max/count (RTT sparse → count 표기, 없으면 빈 상태)
- `intraVsInter(flows)`: INTRA_AZ vs INTER_AZ RTT 통계 비교
- `slowestPaths(flows, n)`: RTT 상위 엣지(pod쌍/경로) 랭킹
- `rttTrend(edgeSeriesOrBuckets)`: RTT 시계열 추이
- 응답: `{ overall: LatencyStats, intra: LatencyStats, inter: LatencyStats, slowest: {...}[], trend: Series[], distribution: {bucketMs:number,count:number}[] }`

### 6.4 서비스 의존성 (dependencies.ts / /api/analytics/dependencies)
- `serviceGraph(flows)`: pod→service 집계 후 service↔service SankeyData (라벨 없으면 ns 또는 ip 폴백)
- `composition(flows)`: targetPort Top / namespace 분포 / category 분포
- `hopUsage(flows)`: traversedConstructs componentType별 통과 횟수(미지 타입 'OTHER')
- 응답: `{ sankey: SankeyData, ports: {port,count,bytes}[], namespaces: {...}[], categories: {...}[], hops: {type,count}[] }`

## 7. Analytics 허브 (인사이트 페이지 확장)

`/insights` 페이지를 탭형 허브로 재구성. 탭: `비용 | 신뢰성 | 지연 | 의존성`(i18n). 각 탭은 해당 API를 `usePolling`으로 소비하고 벤토 그리드로 배치:
- **비용**: 총비용 StatDelta + 카테고리 트리맵 + 카테고리 비용 시계열(누적 영역) + Top 비용 기여 바
- **신뢰성**: 핫스팟 바(재전송/타임아웃 율) + 임계 초과 테이블 + NHI 타임라인(스텝) + AZ×AZ 히트맵(재전송)
- **지연**: p50/p90/p95 StatDelta 3개 + RTT 분포 히스토그램 + AZ내부 vs AZ간 비교 바 + 느린 경로 랭킹 + RTT 추이
- **의존성**: 서비스 Sankey + 포트 Top 바 + 네임스페이스 트리맵 + 경로 홉 도넛
- 데이터 없음/수집 준비 중 상태 각 차트에 처리. 나브 라벨은 기존 "인사이트/Insights" 유지.

## 8. 토폴로지 재설계

기존 플랫 React Flow(116노드 hairball) 제거. 신규:
- **AggregateGraph**(기본): 노드 = 집계 단위(기본 namespace, 토글로 cluster), 엣지 = 집계 트래픽(두께=log(bytes), 색=카테고리). 노드 클릭 → 해당 그룹 확장(namespace→그 안의 pod). React Flow 유지하되 노드 수를 5~15개로 제한, dagre 레이아웃이 캔버스를 채우도록 rank 방향/간격 조정. 미니맵 활성.
- **AdjacencyMatrix**(토글): src×dst 그리드(엔티티=집계 단위), 셀 색=선택 메트릭(전송량/재전송/RTT 전환). 셀 클릭 → 상세 패널. 수백 엔티티도 스크롤 그리드로 표현.
- **TopEdgesPanel**(사이드, 모바일=하단 시트): 현재 뷰의 상위 엣지 랭킹(메트릭 정렬), 항목 클릭 → `/paths?edge=<hash>` 링크. 선택 요약 표시.
- 필터(클러스터/네임스페이스/카테고리) 유지. 뷰 전환 토글(그래프↔매트릭스)을 상단에 배치.

## 9. 기존 페이지 풍성화

- **개요**: KPI 4개 → `StatDelta`(값 + 직전 창 대비 ▲/▼% + 미니 스파크라인). RTT는 p50/p95 표기(진짜 null만 "—"). 추가 카드: 상위 talker(비용 렌즈 Top 재사용), 이상 징후 요약(신뢰성 breaches 카운트 + 링크). 벤토로 하단 여백 제거.
- **플로우**: 테이블 위 집계 스트립 — Top-N 바(전송량) + 카테고리 도넛 + 시간대 스파크바. 테이블/필터 유지.
- **경로**: pod쌍 미선택 시 기본 콘텐츠 — 인기 경로(트래픽 상위 엣지), 최근 조회(sessionStorage), 전체 RTT 분포(Distribution), 경로 홉 구성(hopUsage).
- **에이전트**: 커버리지 게이지(EKS/standalone 정책 부착률) + 수집 사이클 스파크라인. 테이블 유지, 하단 여백 축소.
- **공통**: AppShell footer의 "디자인: SnowUI (CC BY 4.0)" 문구/링크 제거. 다크모드 KPI 파스텔 배경 대비 수정(다크 전용 톤).

## 10. 에러 처리 · 테스트 / Errors & Testing

- API route: 기존 패턴(`force-dynamic`, try/catch → 500 `{error:'internal error'}` + `console.error`). 데이터 없음은 200 + 빈 구조.
- 집계 순수함수 TDD: bytesToUsd(경계/카테고리), percentiles(sparse/단일/빈), rate 0-division, sankey 인덱스 매핑, delta 계산.
- 차트 컴포넌트: 렌더 + 빈 상태 테스트(가능 범위).
- 배포 후 headless 스모크: 개요 델타 표시, 4개 렌즈 탭 각 렌더(0 콘솔 에러), 토폴로지 그래프↔매트릭스 토글, 아이폰 뷰포트 가로스크롤 없음.
- 회귀: 기존 80 테스트 그린 유지.

## 11. 배포 / Deployment

앱 코드 변경만 → 새 SHA 태그로 이미지 빌드/푸시(ECR IMMUTABLE) → `NfmDash-App` 재배포(`-c imageTag=<sha>`). 인프라 스택(Data/Onboarding/AgentCore/Ops) 변경 없음. Task Role 권한 변경 없음(analytics는 기존 DDB/CW 권한으로 충족).

## 12. 범위 외 / Out of Scope

- collector/DynamoDB 스키마 변경(집계는 읽기 시점)
- 새 인프라 스택, 새 IAM 권한
- 정확한 AWS 청구서 연동(비용은 NFM 바이트 기반 추정치)
- 멀티 계정/리전
- 대담한 비주얼 오버홀(사이드바/헤더 재설계는 하지 않음 — 풍성화 범위)

## 13. 리스크 & 완화 / Risks

| 리스크 | 완화 |
|---|---|
| 최근 N버킷 집계가 무거움/느림 | 기본 창 축소(예: 최근 12버킷=1h), 응답 캐시, 상위 N 제한, 로그로 소요 기록 |
| RTT sparse → 지연 렌즈 빈약 | count/빈 상태 명시, 분포는 있는 값만, "데이터 부족" 안내 |
| Sankey/Heatmap 대량 노드 렌더 성능 | 집계 단위 기본 namespace(수십 개), Top-N 트림, 매트릭스는 가상 스크롤 아닌 CSS 그리드 + 상한 |
| 비용 추정 오해 | UI "추정치" 배지 + 요율 상수/가정 문서화 |
| footer 제거로 CC BY 위반 우려 | README에 attribution 유지(라이선스 "reasonable manner" 충족) |
| 토폴로지 교체가 기존 /paths 링크와 어긋남 | TopEdgesPanel/매트릭스 셀 → `/paths?edge=<hash>` 계약 유지 |

## 14. 참조 / References

- 기반: `docs/superpowers/specs/2026-07-08-nfm-dashboard-design.md`
- 현재 디자인 캡처: `docs/design-refs/current-*.png`
- 데이터 타입: `app/src/lib/types.ts`
- NFM 카테고리/메트릭 근거: 기반 스펙 3절
