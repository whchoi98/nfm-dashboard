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
| AWS 콘솔 파리티 | 카테고리 7종 확대(collector 변경), per-monitor "모니터" 페이지(Overview+Historical explorer), hop-by-hop 경로, 집계 의미 정렬, NHI 밴드, CloudWatch 딥링크 — 상세 §15 |
| 배포 | 앱 재빌드(불변 SHA 태그) + `NfmDash-App` 재배포. **카테고리 확대는 collector 재빌드 + `NfmDash-Data` 재배포 포함**(확장 카테고리 데이터 유입에 최대 15분) |

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
app/src/app/monitors/page.tsx                                       # 신규(모니터 목록)
app/src/app/monitors/[name]/page.tsx                                # 신규(모니터 상세: Overview+Historical explorer 탭)
app/src/app/api/monitors/route.ts, app/src/app/api/monitors/[name]/route.ts  # 신규
app/src/components/HopPath.tsx                                       # 신규(hop-by-hop 경로, PathView와 공유)
app/src/components/layout/{Sidebar,MobileTabs}.tsx                  # 나브에 "모니터" 추가
app/src/components/layout/AppShell.tsx                              # footer 문구 제거
collector/src/handler.ts                                            # 카테고리 7종 + 로테이션(§15.1)
collector/src/types.ts + app/src/lib/types.ts                       # DestCategory 7종 확대
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

## 8. 토폴로지 재설계 (AWS Network path 미학 채택)

기존 플랫 React Flow(116노드 hairball) 제거. AWS 콘솔의 **Network path** 시각화(`screenshots/nfm06.png`) — 리소스 타입별 색상 원형 아이콘을 좌→우로 잇는 깔끔한 경로/티어 형태 — 를 기준으로 삼는다. 사용자 관점에서 "털뭉치 그래프"가 아니라 **아이콘 기반 티어드 플로우 맵**을 기본 전체 뷰로 제공한다.

- **TierFlowMap**(기본 전체 뷰): 좌→우 티어 레인으로 배치 — `[Pod/Service]` → `[Node(EC2)/ENI]` → `[Subnet/AZ]` → `[VPC/VPC endpoint/TGW]` → `[Remote: 다른 pod/service · S3/DynamoDB · Region · Internet]`. 각 노드는 §8.1 아이콘 시스템(AWS 리소스 아이콘 풍) + 라벨 + ID 링크. 집계 단위(기본 namespace/service, 토글로 cluster/pod)로 노드 수를 제한하고, 노드 간 **플로우 리본**(두께=log(bytes), 색=카테고리)으로 연결. 클릭 → 드릴다운(cluster→namespace→service→pod)하되 항상 티어 레인 구조 유지(캔버스 균등 활용, 세로 뭉침 없음). React Flow(커스텀 노드/레이아웃) 사용, 미니맵 활성.
- **NetworkPathStepper**(엣지/플로우 선택 시): 선택한 통신을 AWS `nfm06` 스타일 **수평 hop 스텝퍼**로 표시(§15.3의 `HopPath` 공유). 티어 맵 하단 패널 또는 우측 패널에 렌더.
- **AdjacencyMatrix**(분석 토글): src×dst 그리드(엔티티=집계 단위), 셀 색=선택 메트릭(전송량/재전송/RTT 전환). 셀 클릭 → 해당 쌍의 NetworkPathStepper. 핫스팟 즉시 식별.
- **TopEdgesPanel**(사이드, 모바일=하단 시트): 현재 뷰 상위 엣지 랭킹(메트릭 정렬), 클릭 → NetworkPathStepper / `/paths?edge=<hash>`.
- 필터(클러스터/네임스페이스/카테고리) 유지. 상단에 뷰 전환 토글(티어 맵 ↔ 매트릭스).

### 8.1 리소스 아이콘 시스템 (공유)
AWS 아이콘 풍의 색상 원형 아이콘 세트를 `app/src/components/topology/ResourceIcon.tsx`로 정의. lucide-react 아이콘 + 토큰 색으로 근사(외부 AWS 아이콘 에셋 미사용 — CSP/라이선스 안전). 타입별:
- **EKS**: `Pod`, `Namespace`, `Service`, `Cluster` (EKS 전용 — 스크린샷엔 없지만 요구사항으로 추가, 컨테이너/육각형 계열 아이콘 + 구분색)
- **컴퓨트/네트워크**: `EC2 instance`, `Network interface(ENI)`, `Subnet`, `AvailabilityZone`, `VPC`, `VPC endpoint`, `TransitGateway`
- **AWS 서비스/원격**: `AWS service`(S3/DynamoDB/CloudWatch Logs 등), `Region`, `Internet`, `Unclassified`
- 각 아이콘 = 원형 테두리 + 리소스 색, 하단에 ID(외부링크 아이콘 포함 클릭) + 컨텍스트(리전/AZ). `traversedConstructs.componentType` → 아이콘 매핑(미지 타입 generic). EKS 노드는 `EndpointInfo.podName/podNamespace/serviceName/cluster`에서 판별.

## 9. 기존 페이지 풍성화

- **개요**: KPI 4개 → `StatDelta`(값 + 직전 창 대비 ▲/▼% + 미니 스파크라인), 집계 의미는 §15.4 정렬(전송량 평균/재전송·타임아웃 합/RTT 최소). RTT는 최소+p50/p95 병기(진짜 null만 "—"). 추가 카드: 상위 talker(비용 렌즈 Top 재사용), 이상 징후 요약(신뢰성 breaches 카운트 + 링크), 전체 NHI 상태. 벤토로 하단 여백 제거.
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

## 15. AWS NFM 콘솔 파리티 (스크린샷 분석 반영)

`screenshots/nfm01~04.png`(AWS Network Flow Monitor 콘솔) 분석 결과를 아래와 같이 반영한다.

### 15.1 카테고리 커버리지 확대 (collector 변경)
- 현재 collector는 monitor 쿼리 카테고리 3종만 사용. **API 지원 7종으로 확대**: `INTRA_AZ, INTER_AZ, INTER_VPC, UNCLASSIFIED, AMAZON_S3, AMAZON_DYNAMODB, INTER_REGION` (기반 스펙 3절의 destinationCategory enum). → S3/DynamoDB/리전간/미분류 트래픽이 비용·의존성 렌즈에 편입.
- **쿼리량/스로틀 완화**: 5 monitor × 4 metric × 7 category = 140 쿼리/사이클(기존 60). Lambda 270s 내 유지 위해 (a) monitor 쿼리 status-poll cap을 60→30으로 축소, (b) **카테고리 로테이션** — 코어 3종은 매 사이클, 확장 4종은 3사이클마다 1회 수집(`process.env.EXTENDED_CATEGORY_EVERY=3`, 사이클 카운터는 `NfmMeta`의 `STATUS#collect/latest`에 누적). 확장 카테고리 데이터는 최대 15분 신선도 — UI에 "확장 카테고리는 ~15분 주기" 주석.
- UI 카테고리 표기/필터는 **NHI 기여 vs 비-NHI** 2그룹으로 시각 구분(AWS 방식). API 미지원 콘솔 전용 카테고리(Internet/TGW/Local Zone/AWS Service)는 수집 불가 → UI에 표시하지 않음(과장 금지).
- `DestCategory` 타입/`aggregate.ts`/차트 카테고리 색 매핑을 7종으로 확장. 기존 3종 소비처는 그대로 동작(추가 값만).

### 15.2 신규 "모니터" 페이지 (per-monitor, AWS Overview + Historical explorer 파리티)
- 나브에 **모니터/Monitors** 추가. 모니터 목록(이름·Status·NHI 배지·최근 전송량 스파크라인) → 선택 시 상세.
- **모니터 상세 = 탭 2개**:
  - **개요(Overview)**: NHI 상태 카드(Healthy/Degraded, CW HealthIndicator) + **Traffic summary 4타일**(Data transferred=평균, Retransmissions=합, Retransmission timeouts=합, RTT=최소 — §15.4) + **NHI 타임라인 밴드** + 데이터 전송 추이 라인 + "CloudWatch에서 보기" 딥링크(§15.5)
  - **히스토리 탐색(Historical explorer)**: 메트릭별 플로우 테이블(전송량/재전송/타임아웃/RTT), 컬럼 = Category, Local/Remote IP·instance·subnet·VPC·Region·AZ, 값. 검색·정렬·페이지네이션. **행 클릭 → hop 경로 패널(§15.3)**.
- 데이터: 기존 `/api/flows?monitor=` + 모니터별 CW 지표. 신규 `/api/monitors`(목록+요약), `/api/monitors/[name]`(상세 요약) route.

### 15.3 Hop-by-hop 경로 = NetworkPathStepper (AWS nfm06 디자인 채택)
- AWS 콘솔(`screenshots/nfm06.png`)의 "Network path" 수평 스텝퍼를 그대로 참조: 리소스 타입별 **색상 원형 아이콘**(§8.1 `ResourceIcon`)을 수평 커넥터로 잇고, 각 노드 하단에 **ID(외부링크 아이콘 포함 클릭)** + 컨텍스트(리전/AZ). 제목은 메트릭 스코프 표기(예: "네트워크 경로 (재전송 타임아웃)").
- 홉 구성: `[출발 pod/service/instance]` → traversedConstructs 순서(ENI/subnet/VPC endpoint/TGW/…) → `[도착 pod/service · AWS service · Region · Internet]`. 데이터원 = `FlowEdge.traversedConstructs`(componentId/Type/Arn/serviceName) + 양단 `EndpointInfo`(pod/ns/service/cluster/instance/subnet/az/vpc) + snat/dnat/port(커넥터 툴팁).
- **EKS 노드 타입 포함**: 출발/도착이 pod이면 Pod 아이콘 + `namespace/pod` 라벨, service 있으면 Service 홉, cluster는 배지로 표기(요구사항). 스크린샷의 EC2/ENI/VPC endpoint/AWS service 타입에 EKS Pod·Namespace·Service·Cluster를 확장.
- 컴포넌트 `app/src/components/HopPath.tsx`(=NetworkPathStepper) 하나로 (a) 경로 페이지, (b) 플로우 테이블 행 드로어, (c) 모니터 Historical explorer 행, (d) 토폴로지 엣지/매트릭스 셀 선택에서 **공통** 사용. componentType 미지 값 generic 홉. 모바일=가로 스크롤 또는 세로 스텝.

### 15.4 집계 의미 정렬 (AWS 동일)
- Traffic summary 타일 집계: **Data transferred = 평균**(average per period), **Retransmissions = 합**, **Retransmission timeouts = 합**, **Round-trip time = 최소**(best-case latency). 지연 렌즈는 여기에 더해 p50/p90/p95(§6.3) 병기.
- 개요 페이지 KPI도 동일 의미 채택(현재 단순 합산과 다를 수 있으므로 정렬).

### 15.5 CloudWatch 딥링크
- 모니터 개요와 개요 페이지의 지표 카드에 "CloudWatch에서 보기"(metrics 콘솔 URL) + 선택적 "알람 만들기"(CloudWatch 알람 생성 URL) 링크. URL은 namespace `AWS/NetworkFlowMonitor` + 차원 `MonitorId`로 구성(리전 하드코딩 ap-northeast-2).

### 15.6 Category 1급 필터/컬럼
- 플로우 페이지·모니터 히스토리 탐색·인사이트 허브의 필터에 7종 카테고리(그룹화) 노출, 테이블에 Category 컬럼 표시. 카테고리별 색은 §5 차트 팔레트와 공유.

### 15.7 반영하지 않는 것 (근거)
- 조직/설정·에이전트 설치 마법사(nfm03 상단): 우리 대시보드 범위 아님(에이전트 온보딩은 인프라 스택이 담당).
- 콘솔 전용 카테고리(Internet/TGW/Local Zone/AWS Service): 쿼리 API 미지원 → 수집 불가, 표시 안 함.

## 16. Datadog 스타일 화면 구성 / Datadog-style Composition

기존 "풍성화(SnowUI 유지)" 결정 위에, **Datadog 대시보드식 조밀·다위젯 구성**을 채택해 인사이트 밀도를 높인다. SnowUI 토큰/카드 룩은 base로 유지하되 레이아웃/상호작용/위젯 밀도를 Datadog 방식으로 구성한다(팔레트 전면 교체 아님, 다계열용 강조색만 확장).

### 16.1 글로벌 필터 바 (Datadog template variables 풍)
- Analytics 허브·모니터·플로우·토폴로지 상단에 **고정 필터 바**: `시간범위(15m/1h/3h/24h) · 클러스터 · 네임스페이스 · 카테고리(7종 그룹) · 메트릭`. 선택은 URL 쿼리 + `sessionStorage`에 유지되고 페이지 내 **모든 위젯에 동시 적용**(Datadog `$var` 개념). `app/src/components/analytics/FilterBar.tsx` + `useAnalyticsFilters` 훅.

### 16.2 조밀한 위젯 그리드 (Timeboard 풍)
- 벤토 그리드를 Datadog **timeboard**처럼 다수의 소형 위젯 행으로 구성: `query-value 타일`(큰 숫자 + 스파크라인 + 조건부 색) 행 → `timeseries` 행 → `toplist`(랭크 바) + `heatmap`/`distribution` 행. 위젯 수를 늘려 여백 제거.
- **위젯 공통 chrome**: 제목 + 우상단 옵션 메뉴(메트릭/집계 전환, CloudWatch 딥링크) + 범례. `app/src/components/analytics/Widget.tsx` 래퍼로 통일.

### 16.3 시계열 동기화 크로스헤어
- 한 화면의 모든 `timeseries` 위젯이 **hover 시 동일 시각에 크로스헤어/툴팁 동기화**(Datadog 특유의 시간축 정렬). 공유 hover 상태 컨텍스트 `HoverSyncContext`로 recharts `activeTooltip`을 브로드캐스트.

### 16.4 조건부 색 & 임계 (status coloring)
- query-value 타일과 toplist 항목에 **임계 기반 색상**(정상=mint, 주의=amber, 위험=red — 토큰 확장색). 예: 신뢰성 율 임계(§6.2), NHI Degraded, 비용 상위 등. 색+아이콘 이중부호화(접근성).

### 16.5 Toplist / Hostmap 위젯
- **Toplist**(랭크 바 리스트: 상위 talker/비용/느린 경로) 1급 위젯 `Toplist.tsx`.
- **엔티티 맵**(Datadog hostmap 근사): 노드/네임스페이스를 타일 그리드로 배치하고 색=선택 메트릭(전송량/재전송/RTT) — §5 `Heatmap`/`Treemap` 재사용, 에이전트/토폴로지 요약에 활용.

### 16.6 팔레트 확장 (다계열 밀도용)
- 다계열 차트가 늘어나므로 SnowUI 액센트에 **카테고리 순서색 8종**(기존 accentBlue/Lav/Mint/chartBlue/Violet/Sky + 2 추가)과 status 3색(mint/amber/red)을 `chart-tokens.ts`에 정의. 라이트/다크 모두 CVD-안전(dataviz validator 통과 필수). Datadog식 다크 우선 대비를 위해 다크 배경 대비 강조를 보정.

### 16.7 적용 범위
- **인사이트 허브(4렌즈)**: 각 탭을 17.2 timeboard 그리드 + 17.1 필터 바 + 17.3 동기화로 구성 — 이 요구("더 풍부한 인사이트")의 핵심.
- **개요·모니터 개요**: query-value 타일 행 + 동기화 timeseries + toplist로 재구성.
- **플로우·토폴로지·에이전트**: 필터 바 공유 + toplist/heatmap 위젯 추가.

## 17. 참조 / References

- 기반: `docs/superpowers/specs/2026-07-08-nfm-dashboard-design.md`
- 현재 디자인 캡처: `docs/design-refs/current-*.png`
- AWS NFM 콘솔 캡처: `screenshots/nfm01~04.png`
- 데이터 타입: `app/src/lib/types.ts`
- NFM 카테고리/메트릭 근거: 기반 스펙 3절
