# NFM Dashboard — 설계 문서 / Design Spec

- 날짜: 2026-07-08
- 상태: 사용자 승인 대기 (섹션별 구두 승인 완료)
- 계정/리전: `<ACCOUNT_ID>` / `ap-northeast-2`
- 작성 근거: superpowers:brainstorming 세션 (환경 조사 워크플로 wf_6ada9757-081 결과 포함)

## 1. 목적 / Purpose

AWS 운영자를 위한 **CloudWatch Network Flow Monitor(NFM) 기반 네트워크 관측 대시보드**.
계정 내 ap-northeast-2 전체 자원(EC2 47대, EKS 클러스터 4개)에 NFM을 활성화하고,
NFM 데이터를 5분 주기로 수집하여 **EKS Pod-to-Pod 통신을 상세 식별(경로 포함)**하며,
AgentCore Gateway에 연결된 MCP 도구를 사용하는 **LLM 챗봇/진단 기능**을 제공한다.

## 2. 확정된 의사결정 / Decisions

| 항목 | 결정 |
|---|---|
| IaC | AWS CDK (TypeScript) |
| 앱 토폴로지 | 단일 Next.js 풀스택 (UI + API routes) — ECS Fargate 서비스 1개 |
| 수집기 | EventBridge Scheduler(5분) → Lambda Collector |
| 저장소 | DynamoDB + TTL(7일) |
| 인증 | Cognito User Pool + Hosted UI. 초기 관리자: `admin@whchoi.net` (초기 비밀번호는 사용자 제공값을 Secrets Manager에 저장 후 배포 시 설정 — 코드/문서에 평문 금지) |
| LLM 모델 | `global.anthropic.claude-sonnet-5` (Bedrock cross-region global 프로파일) |
| AgentCore | **Runtime 미사용.** API route가 Gateway(MCP)를 SigV4로 직접 호출하는 에이전트 루프 |
| NFM 범위 | 현재 계정의 ap-northeast-2 **전체 자원** (모든 VPC의 EC2 + 모든 EKS) |
| 배포 위치 | 기존 `cc-on-bedrock-vpc`(vpc-0dfa5610180dfa628), 기존 NATGW 재사용 |
| 디자인 참조 | Figma Dashboard UI Kit (community/file/1210542873091115123) |
| 모바일 | 아이폰 웹(iOS Safari) 반응형 지원 |
| i18n | 영/한 토글 |

## 3. 환경 조사 결과 요약 / Discovered Facts

- **VPC**: `cc-on-bedrock-vpc` 10.100.0.0/16, 2AZ(2a/2b) × Public/Private/Isolated. NATGW 2개(재사용), IGW, S3/DDB Gateway 엔드포인트, `ecr.api/ecr.dkr/logs/bedrock-runtime` Interface 엔드포인트 존재. CloudFront origin-facing prefix list = `pl-22a6434b`. 동일 패턴(CF→ALB(prefix SG)→Fargate) 선례 스택 다수.
- **컴퓨트**: EC2 47대 전부 Graviton(arm64)/Linux, 전부 SSM Online. EKS 4개(v1.35×3, v1.33×1), 워커 20대, NFM add-on 미설치(사용 가능: `aws-network-flow-monitoring-agent` v1.1.4-eksbuild.1, arm64 지원). Standalone EC2 27대.
- **NFM**: ap-northeast-2 GA, 이 계정에서 완전 미설정(모니터 0/스코프 0/SLR 없음/에이전트 0). SSM Distributor 패키지 `AmazonCloudWatchNetworkFlowMonitorAgent`(v9) 및 Command 문서 `AmazonCloudWatch-NetworkFlowMonitorManageAgent` 리전에 존재.
- **AgentCore**: ap-northeast-2 정식 지원. 기존 Gateway 13개/Runtime 9개 READY (네이밍 충돌 주의: awsops-*, cconbedrock-*).
- **Bedrock**: `global.anthropic.claude-sonnet-4-5` 호출 검증 완료. `global.anthropic.claude-sonnet-5` 프로파일 ACTIVE (호출은 미검증 — 구현 초기에 스모크 테스트).
- **awsops 참조 리포**: 로컬 `/home/ec2-user/my-project/awsops` (GitHub: whchoi98/awsops). Gateway/타겟/도구/SSE/i18n 패턴의 원본.

### NFM API 핵심 제약 (설계를 규정하는 사실)

- **Pod 식별은 `GetQueryResultsMonitorTopContributors` 결과의 `kubernetesMetadata`로만 가능**
  (local/remote 각각 PodName, PodNamespace, ServiceName — 총 6필드). 결과 행에 클러스터명 필드는 **없음** → 클러스터 식별은 모니터의 `localResources`에 `AWS::EKS::Cluster` ARN을 지정하는 것으로 해결(= 클러스터별 모니터 필수).
- **경로 데이터**: hop-by-hop traceroute는 없음. flow-tuple 단위로 `traversedConstructs[]`(componentId/componentType/componentArn/serviceName) + 양단 subnet/AZ/VPC/instance(ID+ARN) + `snatIp`/`dnatIp`/`targetPort` 제공. 이 데이터로 경로를 재구성한다.
- **쿼리 워크플로**: 비동기 `StartQuery*` → `GetQueryStatus*`(QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELED) → `GetQueryResults*`(limit 1~500, nextToken). TPS 쿼터 미공개 → 백오프 필수.
- **metricName**: 모니터 쿼리 = `DATA_TRANSFERRED | RETRANSMISSIONS | TIMEOUTS | ROUND_TRIP_TIME`(4종). Workload Insights = RTT 제외 3종.
- **destinationCategory**: `INTRA_AZ | INTER_AZ | INTER_VPC | UNCLASSIFIED | AMAZON_S3 | AMAZON_DYNAMODB | INTER_REGION`(7종).
- **쿼터**: Scope 1/계정/리전(고정), 모니터 20(조정 가능), 모니터당 local/remote 리소스 각 25(고정).
- **지연**: 에이전트 발행 주기 ~30초, 설치 후 최초 데이터까지 ~20분.
- **CW 메트릭**: `AWS/NetworkFlowMonitor` 네임스페이스, 차원 `MeasurementSource, MonitorName`, 지표 5종(DataTransferred, Retransmissions, Timeouts, RoundTripTime, HealthIndicator).
- EKS 메타데이터 제약: 타 클러스터의 remote pod는 미해석, control plane 소유 pod는 이름 비노출, `ExternalTrafficPolicy: Cluster`의 NodePort/LB instance mode는 노드 IP로 보고됨.

## 4. 전체 아키텍처 / Architecture

```
사용자 (데스크톱/아이폰)
   │ HTTPS
   ▼
CloudFront ── Cognito JWT(httpOnly 쿠키) 는 앱(Next.js middleware)에서 검증
   │ X-Origin-Verify 커스텀 헤더
   │ origin-facing prefix list pl-22a6434b 만 ALB SG 허용
   ▼
ALB (internet-facing, Public1/2)
   ▼ :3000 (앱 SG는 ALB SG에서만 ingress)
ECS Fargate (arm64, Private1/2, 기존 NATGW/VPCe 사용)
 └─ Next.js 15 풀스택
     ├─ UI 7페이지 + FloatingChat/챗팝업 + i18n(en/ko)
     └─ API routes
         ├─ /api/overview /flows /topology /paths /insights /agents  ← DynamoDB·CW 조회
         ├─ /api/ai        ← 에이전트 루프: ConverseStream + nfm-gateway(MCP, SigV4)
         ├─ /api/diagnose  ← DDB 컨텍스트 주입 + ConverseStream (토큰 스트리밍, regenerate)
         └─ /api/nfm/refresh ← Collector Lambda 수동 invoke

EventBridge Scheduler(5분) ─▶ Collector Lambda ─▶ NFM API (Start→Poll→Get) ─▶ 정규화 ─▶ DynamoDB
                                   └─ 신규 EC2 자동 온보딩(태깅) · 토폴로지 스냅샷 집계

AgentCore Gateway `nfm-gateway` (MCP, SigV4)
 ├─ network-mcp-target → Lambda nfm-network-mcp (awsops network_mcp.py 15도구 + reachability)
 ├─ nfm-mcp-target     → Lambda nfm-flowmonitor-mcp (NFM API 조회 도구)
 └─ ddb-mcp-target     → Lambda nfm-ddb-mcp (적재 데이터 조회 도구)

NFM 에이전트: EKS add-on ×4 (DaemonSet/eBPF) + SSM Distributor ×27대(standalone)
NFM 모니터: nfm-eks-<cluster> ×4 + nfm-vpc-all ×1, Scope ×1(Workload Insights)
```

## 5. 리포 구조 / Repository Layout

```
nfm-dashboard/
├─ infra/            # CDK 앱 (TypeScript)
│  ├─ bin/           # 엔트리 (스택 조립)
│  └─ lib/
│     ├─ data-stack.ts           # DynamoDB, Collector Lambda, Scheduler
│     ├─ nfm-onboarding-stack.ts # Scope/모니터/EKS add-on/SSM Association/IAM
│     ├─ agentcore-stack.ts      # 도구 Lambda 3개 + Gateway/타겟 (Custom Resource)
│     └─ app-stack.ts            # ECR, ECS Fargate, ALB, SG, CloudFront, Cognito
├─ app/              # Next.js 15 (UI + API routes)
├─ collector/        # Collector Lambda (TypeScript)
├─ tools/            # Gateway Lambda MCP 도구 (Python — awsops 계약 준용)
│  ├─ network_mcp.py         # awsops에서 이식 + reachability 통합
│  ├─ nfm_mcp.py             # 신규
│  ├─ ddb_mcp.py             # 신규
│  └─ create_gateway.py      # Gateway+타겟 생성 (awsops create_targets.py 패턴)
├─ docs/superpowers/specs/   # 본 문서
└─ scripts/          # 배포 보조 (이미지 빌드/푸시, 스모크 테스트)
```

## 6. 인프라 상세 (섹션 1 — 승인됨)

- **VPC/네트워크**: `Vpc.fromLookup`으로 기존 VPC import. 신규 NATGW/VPC 엔드포인트 생성 없음.
- **ALB**: internet-facing, Public1/2. ALB SG ingress = `pl-22a6434b`:80 만. HTTP→HTTPS는 CloudFront가 담당(Origin은 HTTP:80).
- **ECS**: Fargate, `RuntimePlatform { cpuArchitecture: ARM64 }` (빌드 호스트도 arm64), desiredCount 1 (+ CPU 기반 오토스케일 옵션), Private1/2 배치, awsvpc SG는 ALB SG에서 3000만 허용. 컨테이너 이미지는 Next.js standalone output.
- **CloudFront**: ALB origin + `X-Origin-Verify: <랜덤 시크릿>` 커스텀 헤더(Next.js middleware에서 검증해 ALB 직접 접근 차단). 캐시 정책: 정적 자산 캐시, `/api/*` 비캐시 + SSE 지원(no buffering). HTTPS 기본 도메인(*.cloudfront.net).
- **Cognito**: User Pool + App Client + Hosted UI 도메인. Authorization Code Flow. 초기 관리자 `admin@whchoi.net` — CDK Custom Resource가 `AdminCreateUser` + `AdminSetUserPassword(permanent)` 수행, 비밀번호는 Secrets Manager 시크릿에서 읽음(배포 전 1회 수동/스크립트 저장).
- **앱 인증 흐름**: 미인증 → `/login` → Cognito Hosted UI redirect → `/api/auth/callback`(code→token 교환) → httpOnly 쿠키(ID/Access/Refresh) → Next.js middleware가 `aws-jwt-verify`로 전 경로 검증(`/login`, `/api/auth/*`, 정적 자산 제외).
- **IAM (ECS Task Role)**: `bedrock:InvokeModelWithResponseStream`(global 프로파일 + 기반 모델), `bedrock-agentcore:InvokeGateway`(nfm-gateway), DynamoDB R/W(두 테이블), `lambda:InvokeFunction`(Collector), `cloudwatch:GetMetricData`(AWS/NetworkFlowMonitor). NFM API 직접 호출 권한은 불필요(NFM 조회는 Collector와 nfm-mcp Lambda가 담당 — 최소 권한).

## 7. NFM 온보딩 상세 (섹션 2 — 승인됨)

- **Scope**: 계정/리전당 1개 생성(targetType=ACCOUNT, 자기 계정) → Workload Insights 활성화. SLR 자동 생성됨.
- **EKS 4개 클러스터** (Custom Resource 순차):
  1. `eks-pod-identity-agent` add-on 설치(미설치 시)
  2. NFM 에이전트용 IAM Role 생성 — trust: `pods.eks.amazonaws.com`, 정책: `CloudWatchNetworkFlowMonitorAgentPublishPolicy`
  3. Pod Identity Association: namespace `amazon-network-flow-monitor`, SA `aws-network-flow-monitor-agent-service-account`
  4. `aws-network-flow-monitoring-agent` add-on 설치(v1.1.4-eksbuild.1)
- **Standalone EC2 27대**:
  - 배포 시 스크립트/Custom Resource가 "EKS 태그(`kubernetes.io/cluster/*`) 없는 실행 중 인스턴스"에 `NfmAgent=managed` 태그 부여 + 해당 인스턴스 프로파일 롤에 `CloudWatchNetworkFlowMonitorAgentPublishPolicy` attach
  - SSM State Manager Association: 타겟 `tag:NfmAgent=managed` → `AWS-ConfigureAWSPackage`(Install `AmazonCloudWatchNetworkFlowMonitorAgent`), 스케줄 rate(1 day)로 신규 태깅 인스턴스 자동 커버
- **신규 EC2 자동 온보딩**: Collector Lambda가 매 사이클 미태깅 standalone 인스턴스 감지 → 태깅 + 롤 정책 attach → Association이 설치. (EKS 워커는 add-on DaemonSet이 담당하므로 **호스트 에이전트 설치 제외** — 이중 보고 방지)
- **모니터 5개**: `nfm-eks-<cluster>` ×4 (localResources=[EKS Cluster ARN], remote 비움=리전 전체) + `nfm-vpc-all` ×1 (localResources=[계정 내 VPC 6개]). Scope ARN 참조.
- **초기 지연 안내**: 설치 후 ~20분간 대시보드에 "수집 준비 중" 배지.

## 8. 수집 파이프라인 & 데이터 모델 (섹션 3 — 승인됨)

### Collector Lambda (TypeScript, timeout 270초, 메모리 512MB)

1. **쿼리 매트릭스**: 모니터 5 × metric 4 × category 3(INTRA_AZ/INTER_AZ/INTER_VPC) = 60 쿼리/사이클 + Workload Insights(3 metric × 주요 category). 동시성 5 제한, ThrottlingException 지수 백오프(+지터), 사이클 내 미완료 쿼리는 Stop 후 다음 사이클.
2. **시간 창**: `[now-7m, now-2m]` (집계 지연 감안). limit=500.
3. **정규화 → FlowEdge**: 행마다 `edgeHash = hash(sort(localKey, remoteKey) + targetPort)` (localKey = pod ns/name 또는 instanceId 또는 IP 우선순위). 양방향 관측 중복 제거. kubernetesMetadata·양단 subnet/AZ/VPC/instance·snatIp/dnatIp/targetPort·traversedConstructs·metric값·unit 보존.
4. **토폴로지 스냅샷**: 노드(pod/node/service/vpc 계층) + 엣지(메트릭 합산) 그래프 JSON을 사전 집계해 `NfmMeta`에 저장(프론트 즉시 렌더용).
5. **수집 상태 기록**: 사이클별 성공/실패/스로틀 카운트, 모니터·에이전트 커버리지 갱신.

### DynamoDB

- **`NfmFlows`** (TTL 7일):
  - PK `FLOW#<5분버킷ISO>#<monitor>` / SK `<metric>#<category>#<edgeHash>`
  - GSI1: PK `POD#<ns>/<pod>` / SK `<ts>` — 파드 기준 조회
  - GSI2: PK `EDGE#<edgeHash>` / SK `<ts>` — 엣지 시계열
- **`NfmMeta`**: 모니터 인벤토리, 수집 사이클 상태, 최신 토폴로지 스냅샷(`TOPO#latest` + 히스토리 소량), 에이전트 커버리지(`COVERAGE#ec2|eks`).

### API Routes (모두 Cognito 검증, GET은 DynamoDB/CW만 조회)

`/api/overview` `/api/flows` `/api/topology` `/api/paths` `/api/insights` `/api/agents` `/api/ai`(SSE) `/api/diagnose`(SSE) `/api/nfm/refresh`(POST) `/api/auth/*`

## 9. AgentCore Gateway & AI (섹션 4 — 승인됨, awsops 로컬 구조 준용)

- **Gateway 생성**: awsops `scripts/06b-setup-agentcore-gateway.sh` 패턴. `create-gateway --protocol-type MCP`, 클라이언트는 SigV4(IAM). 이름 `nfm-gateway`(기존 13개와 충돌 없음).
- **타겟 생성**: awsops `agent/lambda/create_targets.py` 패턴 — boto3 `create_gateway_target`, `targetConfiguration.mcp.lambda.toolSchema.inlinePayload`, `credentialProviderConfigurations=[{credentialProviderType:'GATEWAY_IAM_ROLE'}]`, EXISTS 체크 멱등. CDK Custom Resource로 실행(또는 배포 스크립트).
- **Lambda 핸들러 계약**: `params["tool_name"]` 디스패치 + `ok()/err()` 헬퍼 + Gateway invoke 리소스 정책. 단일 계정(크로스어카운트 `target_account_id` 미사용).

| 타겟 | Lambda | 도구 |
|---|---|---|
| `network-mcp-target` | `nfm-network-mcp` | awsops network_mcp.py 15도구 이식: get_path_trace_methodology, find_ip_address, get_eni_details, list_vpcs, get_vpc_network_details, get_vpc_flow_logs, describe_network, list_transit_gateways, get_tgw_details, get_tgw_routes, get_all_tgw_routes, list_tgw_peerings, list_vpn_connections, list_network_firewalls, get_firewall_rules + analyze_reachability(reachability.py) |
| `nfm-mcp-target` | `nfm-flowmonitor-mcp` | list_nfm_monitors, query_top_contributors(monitor/metric/category/시간범위 — 내부에서 Start→Poll→Get 수행), get_workload_insights, get_agent_coverage, get_network_health(CW NHI/메트릭) |
| `ddb-mcp-target` | `nfm-ddb-mcp` | query_pod_flows, query_flow_edges, get_topology_snapshot, get_top_talkers, find_flow_path, get_collection_status |

- **`/api/ai` 에이전트 루프** (Runtime 미사용):
  1. Gateway `tools/list`(JSON-RPC over HTTPS POST, SigV4 서명 — TS로 awsops `streamable_http_sigv4.py` 상응 구현, 결과 캐시 5분)
  2. MCP 도구 → Bedrock `toolConfig` 변환 → `ConverseStreamCommand`(`global.anthropic.claude-sonnet-5`)
  3. `contentBlockDelta` → **즉시 SSE `chunk`** (진짜 토큰 스트리밍) / `toolUse` 정지 → SSE `status`(도구명 표시) → Gateway `tools/call` → `toolResult` 주입 → 2로 루프(최대 8회)
  4. SSE `done`(사용 도구, 토큰 수, 응답 시간) / 오류 시 `error`
  - SSE 이벤트 규약(awsops 준용): `status | chunk | done | error`, 15초 keepalive(CloudFront 타임아웃 방지), `simulateStreaming()`(50자/15ms)은 비스트리밍 폴백 유틸로 유지.
  - Gateway 장애 시 도구 없는 Bedrock 직접 응답 폴백.
- **`/api/diagnose` (LLM 진단 탭)**: DynamoDB에서 최신 토폴로지 + 이상 플로우(재전송·타임아웃 상위 20개 엣지) 컨텍스트 구성 → 시스템 프롬프트 주입 → `ConverseStreamCommand` 토큰 단위 SSE. **regenerate** 동일 경로. 도구 미사용(순수 분석)으로 응답 즉시성 확보.

## 10. Frontend (섹션 5 — 승인됨)

- **스택**: Next.js 15 App Router, Tailwind CSS, standalone output, arm64. `react-markdown` v10 + `remark-gfm`.
- **디자인**: Figma Dashboard UI Kit(사이드바+카드+차트 어드민) 참조, light/dark. 구현 시 frontend-design·dataviz 스킬 적용.
- **반응형(아이폰)**: 모바일 우선. 사이드바→햄버거+하단 탭, 테이블→카드 리스트, 그래프 터치 줌/팬, `safe-area-inset`, 44px 터치 타겟, `viewport-fit=cover`.
- **페이지**: `/`(KPI+상태) · `/topology`(React Flow Pod-to-Pod 그래프, 필터, 엣지→경로 패널) · `/flows`(테이블+drawer) · `/paths`(pod쌍 경로: 양단 pod→노드→서브넷→AZ→VPC + traversedConstructs + SNAT/DNAT) · `/insights`(Workload Insights 시계열) · `/diagnose`(SSE 진단+regenerate) · `/agents`(커버리지)
- **FloatingChat**: 우하단 플로팅 버튼 → 인라인 패널(SSE 소비: fetch+getReader 수동 파싱 — POST body 필요로 EventSource 미사용, awsops 패턴).
- **챗 팝업 분기**(`/chat-popup` 공용 라우트):
  - Chrome 데스크톱 → **iframe modal** (Site Engagement Score 낮으면 popup이 tab으로 열리는 문제 우회)
  - Firefox 등 데스크톱 → **`window.open` + features** (팝업 보장)
  - 모바일(iOS Safari 포함) → **풀스크린 시트 모달** (모바일 popup 신뢰 불가)
  - UA 감지 유틸로 분기, 실패 시 iframe modal 폴백.
- **i18n**: LanguageContext + `translations/{ko,en}.json`(flat key), `t(key, params)`, localStorage 저장, SSE `status` 메시지도 `lang` 파라미터로 이중언어.

## 11. 에러 처리 · 테스트 · 운영 (섹션 6 — 승인됨)

- **Collector**: 쿼리별 독립 실패 허용(부분 성공 저장), 백오프, 상태를 NfmMeta 기록 → UI 노출, 연속 실패 CloudWatch 알람.
- **SSE**: 표준 `error` 이벤트, 타임아웃/재시도, Bedrock 폴백.
- **테스트**: 유닛(정규화/edgeHash/중복제거/SigV4 서명/MCP 변환), API route 통합, 배포 후 Playwright 스모크(로그인→대시보드→챗 SSE→모바일 뷰포트).
- **운영**: 구조화 로그, CW 대시보드(수집 성공률/NHI/API 지연), 알람(Collector 실패, ECS 비정상, ALB 5xx).

## 12. 배포 순서 / Deployment Order

1. Secrets Manager에 Cognito 초기 비밀번호 저장 (스크립트)
2. `DataStack` (DynamoDB, Collector, Scheduler)
3. `NfmOnboardingStack` (Scope→모니터→EKS add-on→SSM Association→태깅/IAM) — **에이전트 데이터 ~20분 후 유입**
4. `AgentCoreStack` (도구 Lambda → Gateway → 타겟)
5. 이미지 빌드/푸시(arm64) → `AppStack` (ECR/ECS/ALB/CloudFront/Cognito)
6. 스모크 테스트 (로그인, 수집 확인, 챗/진단 SSE, 아이폰 뷰포트)

## 13. 범위 외 / Out of Scope

- 멀티 리전/멀티 계정 (Scope는 단일 계정 구성)
- AgentCore Runtime/Memory/Code Interpreter
- 커스텀 도메인/Route53 (CloudFront 기본 도메인 사용)
- Windows/x86 EC2 (현재 계정에 없음 — 전부 arm64 Linux)

## 14. 리스크 & 완화 / Risks

| 리스크 | 완화 |
|---|---|
| NFM TPS 쿼터 미공개 → 스로틀 | 동시성 5 제한 + 지수 백오프 + 부분 성공 허용, 필요 시 category 축소 |
| 60쿼리/사이클이 Lambda 시간 초과 | timeout 270s + 미완료 쿼리 Stop, 다음 사이클 이월. 지속 시 category/metric 우선순위 축소 |
| `global.anthropic.claude-sonnet-5` 미검증 | 구현 초기 스모크 테스트, 실패 시 `global.anthropic.claude-sonnet-4-5`(검증됨) 폴백 상수 |
| Gateway create-gateway CFN 미지원 | Custom Resource(boto3) — awsops 검증 패턴 |
| CloudFront와 SSE 버퍼링 | `text/event-stream` + no-cache + 15s keepalive (awsops에서 검증) |
| EKS add-on과 호스트 에이전트 이중 설치 | EKS 태그 기반 제외 + Collector 온보딩 로직에서 EKS 워커 스킵 |
| traversedConstructs componentType 값 미문서화 | 실데이터 관찰 후 렌더링 매핑 보강(미지 타입은 generic 노드로 표시) |

## 15. 참조 / References

- NFM API: https://docs.aws.amazon.com/networkflowmonitor/2.0/APIReference/API_Operations.html
- KubernetesMetadata: https://docs.aws.amazon.com/networkflowmonitor/2.0/APIReference/API_KubernetesMetadata.html
- EKS 메타데이터 시나리오: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-NetworkFlowMonitor-work-with-eks.performance-metadata.html
- EKS add-on 설치: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-NetworkFlowMonitor-agents-kubernetes-eks.html
- CW 메트릭: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-NetworkFlowMonitor-cw-metrics.html
- awsops 참조: 로컬 `/home/ec2-user/my-project/awsops` (scripts/06b, agent/lambda/create_targets.py, network_mcp.py, src/app/api/ai/route.ts, src/lib/i18n)
- Figma: https://www.figma.com/community/file/1210542873091115123/dashboard-ui-kit-dashboard-free-admin-dashboard
