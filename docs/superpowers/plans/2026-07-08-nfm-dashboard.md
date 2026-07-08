# NFM Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계정(<ACCOUNT_ID>, ap-northeast-2) 전체에 NFM을 활성화하고, 5분 주기로 수집한 Pod-to-Pod 플로우(경로 포함)를 SnowUI 스타일 Next.js 대시보드로 시각화하며, AgentCore Gateway(MCP) 도구를 사용하는 스트리밍 챗봇/진단을 제공한다.

**Architecture:** 단일 Next.js 15 풀스택(ECS Fargate/arm64, CF→ALB→Fargate) + EventBridge(5분)→Lambda Collector→DynamoDB(TTL 7일) + AgentCore Gateway `nfm-gateway`(Lambda MCP 타겟 3개, Runtime 미사용 — API route가 SigV4로 직접 호출하는 ConverseStream 에이전트 루프). 스펙: `docs/superpowers/specs/2026-07-08-nfm-dashboard-design.md`

**Tech Stack:** CDK(TypeScript), Next.js 15(App Router)+Tailwind, React Flow, react-markdown v10+remark-gfm, aws-jwt-verify, @aws-sdk v3(bedrock-runtime/dynamodb/networkflowmonitor), Python 3.13 Lambda(MCP 도구, boto3), vitest, pytest, Playwright.

## Global Constraints

- 리전 `ap-northeast-2`, 계정 `<ACCOUNT_ID>`. VPC는 기존 `cc-on-bedrock-vpc`(`vpc-0dfa5610180dfa628`) import — NATGW/VPC 엔드포인트 신규 생성 금지.
- 모든 컨테이너/Lambda 아키텍처 = **arm64**.
- LLM 모델 ID: `global.anthropic.claude-sonnet-5` (폴백 상수 `global.anthropic.claude-sonnet-4-5-20250929-v1:0`).
- CloudFront origin-facing prefix list = `pl-22a6434b`. ALB SG ingress는 이것만.
- Cognito 초기 관리자 `admin@whchoi.net` — 비밀번호는 Secrets Manager `nfm-dashboard/cognito-admin`에서만 읽음. **평문을 코드/커밋에 넣지 말 것.**
- NFM 쿼리 비동기(Start→Status→Get), 동시성 5, ThrottlingException 지수 백오프. metricName 4종(모니터)/3종(WI), destinationCategory는 INTRA_AZ/INTER_AZ/INTER_VPC만 수집.
- DynamoDB TTL 7일(`NfmFlows`). 리소스 명명 접두사 `nfm-dashboard-` (기존 awsops-*, cconbedrock-*와 충돌 금지).
- i18n: 모든 UI 문자열은 `t(key)` 경유 (ko/en). SnowUI 토큰: 카드 radius 16px, 서피스 `#F7F9FB`, 텍스트 `#1C1C1C`, 액센트 `#E3F5FF/#E5ECF6/#BAEDBD/#A8C5DA/#95A4FC`. footer에 SnowUI CC BY 4.0 attribution.
- awsops 참조 원본: `/home/ec2-user/my-project/awsops` (읽기 전용 — 수정 금지).
- 커밋 메시지는 conventional commits (`feat:`, `test:`, `infra:`, `docs:`).

## File Structure (전체 맵)

```
nfm-dashboard/
├─ package.json                # npm workspaces: infra, app, collector
├─ tsconfig.base.json
├─ infra/
│  ├─ package.json  tsconfig.json  cdk.json
│  ├─ bin/nfm-dashboard.ts     # 스택 조립 (env 고정)
│  └─ lib/
│     ├─ data-stack.ts         # DynamoDB 2테이블+GSI, Collector Lambda, Scheduler
│     ├─ nfm-onboarding-stack.ts # 온보딩 Lambda(Custom Resource) + SSM Association
│     ├─ agentcore-stack.ts    # MCP 도구 Lambda 3개 + Gateway IAM role
│     └─ app-stack.ts          # ECR/ECS/ALB/CF/Cognito/시크릿
├─ collector/
│  ├─ package.json  tsconfig.json  vitest.config.ts
│  └─ src/
│     ├─ types.ts              # FlowEdge, EndpointInfo, TopologySnapshot 등 공유 타입
│     ├─ normalize.ts          # 행→FlowEdge, edgeHash, dedupe  (순수 함수)
│     ├─ nfm-query.ts          # Start→Poll→Get 오케스트레이터(동시성/백오프)
│     ├─ storage.ts            # DDB 쓰기 + 토폴로지 스냅샷 집계
│     ├─ onboard.ts            # 신규 EC2 태깅+정책 attach (자동 온보딩)
│     └─ handler.ts            # Lambda 엔트리
├─ onboarding/                 # NfmOnboardingStack의 Custom Resource Lambda (Python)
│  └─ onboard_nfm.py           # scope/모니터/EKS add-on/PodIdentity 멱등 생성
├─ tools/                      # Gateway Lambda MCP 도구 (Python)
│  ├─ network_mcp.py           # awsops 이식 15도구 + analyze_reachability
│  ├─ nfm_mcp.py               # NFM 조회 5도구
│  ├─ ddb_mcp.py               # DDB 조회 6도구
│  ├─ create_gateway.py        # Gateway+타겟 생성 (awsops create_targets.py 패턴)
│  └─ tests/ (pytest)
├─ app/
│  ├─ package.json  next.config.mjs  tailwind.config.ts  middleware.ts  Dockerfile
│  ├─ src/lib/
│  │  ├─ i18n/ (LanguageContext.tsx, translations/{ko,en}.json)
│  │  ├─ ddb.ts  cw-metrics.ts  auth.ts  sse.ts  mcp-client.ts  bedrock.ts  ua.ts
│  ├─ src/app/ (page.tsx, topology/ flows/ paths/ insights/ diagnose/ agents/
│  │  ├─ login/ chat-popup/ 각 page.tsx
│  │  └─ api/ (auth/[...]/route.ts, overview/ flows/ topology/ paths/ insights/
│  │     agents/ ai/ diagnose/ nfm/refresh/ 각 route.ts)
│  └─ src/components/ (layout/{Sidebar,Topbar,MobileTabs}.tsx,
│     cards/{KpiCard,StatusBadge}.tsx, charts/*.tsx, chat/{FloatingChat,ChatPanel}.tsx,
│     Markdown.tsx)
├─ scripts/
│  ├─ save-cognito-secret.sh   # Secrets Manager에 초기 비밀번호 저장(대화형)
│  ├─ build-push.sh            # arm64 이미지 빌드/ECR 푸시
│  ├─ setup-gateway.sh         # create_gateway.py 실행 + SSM 파라미터 기록
│  └─ smoke.sh                 # 배포 후 스모크 (SSE/API/게이트웨이)
├─ e2e/ (playwright.config.ts, smoke.spec.ts)
└─ docs/ (기존 spec + design-refs)
```

### DynamoDB 키 설계 (스펙 8절 구체화 — GSI 3개로 확정)

- `nfm-dashboard-flows` (TTL attr `ttl`):
  - PK `pk` = `FLOW#<bucket>#<monitor>` / SK `sk` = `<metric>#<category>#<edgeHash>`
  - GSI1 `gsi1pk`=`POD#<nsA>/<podA>` `gsi1sk`=`<bucket>` (정렬상 A측 파드)
  - GSI2 `gsi2pk`=`POD#<nsB>/<podB>` `gsi2sk`=`<bucket>` (B측 파드)
  - GSI3 `gsi3pk`=`EDGE#<edgeHash>` `gsi3sk`=`<bucket>#<metric>` (엣지 시계열)
- `nfm-dashboard-meta`: `pk`/`sk` 단일 테이블 — `META#monitors`/`latest`, `STATUS#collect`/`<cycleTs>` 및 `latest`, `TOPO#latest`/`snapshot`(상위 2000 엣지로 트림), `COVERAGE#latest`/`ec2|eks`

### 공유 인터페이스 (모든 태스크가 준수)

```ts
// collector/src/types.ts — Task 2에서 정의, app은 동일 shape을 JSON으로 소비
export type MetricName = 'DATA_TRANSFERRED'|'RETRANSMISSIONS'|'TIMEOUTS'|'ROUND_TRIP_TIME';
export type DestCategory = 'INTRA_AZ'|'INTER_AZ'|'INTER_VPC';
export interface EndpointInfo { ip?: string; instanceId?: string; subnetId?: string; az?: string;
  vpcId?: string; region?: string; podName?: string; podNamespace?: string; serviceName?: string; }
export interface TraversedComponent { componentId?: string; componentType?: string;
  componentArn?: string; serviceName?: string; }
export interface FlowEdge { edgeHash: string; monitor: string; metric: MetricName;
  category: DestCategory; bucket: string; value: number; unit: string;
  a: EndpointInfo; b: EndpointInfo; snatIp?: string; dnatIp?: string; targetPort?: number;
  traversedConstructs: TraversedComponent[]; }
export interface TopologySnapshot { generatedAt: string; nodes: TopoNode[]; edges: TopoEdge[]; }
export interface TopoNode { id: string; kind: 'pod'|'node'|'vpc'|'external'; label: string;
  namespace?: string; cluster?: string; az?: string; vpcId?: string; }
export interface TopoEdge { id: string; source: string; target: string;
  metrics: Partial<Record<MetricName, number>>; category: DestCategory; targetPort?: number; }
```

SSE 이벤트 규약(app 공통): `event: status|chunk|done|error`, data는 JSON — `status:{stage,message}`, `chunk:{delta}`, `done:{content,usedTools,inputTokens,outputTokens,elapsedMs,model}`, `error:{message}`.

---

## Phase 1 — 리포 부트스트랩 & Collector 로직

### Task 1: 모노레포 스캐폴드

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`
- Create: `collector/package.json`, `collector/tsconfig.json`, `collector/vitest.config.ts`

**Interfaces:**
- Produces: npm workspaces(`infra`,`app`,`collector`), `npm -w collector test` 실행 가능 상태.

- [x] **Step 1: 루트 파일 생성**

```jsonc
// package.json
{ "name": "nfm-dashboard", "private": true,
  "workspaces": ["infra", "app", "collector"],
  "scripts": { "test": "npm -w collector run test" } }
```
```jsonc
// tsconfig.base.json
{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
  "strict": true, "esModuleInterop": true, "skipLibCheck": true, "resolveJsonModule": true } }
```
`.gitignore`: `node_modules/`, `.next/`, `cdk.out/`, `dist/`, `__pycache__/`, `.pytest_cache/`, `test-results/`, `*.tsbuildinfo`, `.env*`
`.nvmrc`: `22`

- [x] **Step 2: collector 워크스페이스**

```jsonc
// collector/package.json
{ "name": "collector", "private": true, "type": "module",
  "scripts": { "test": "vitest run", "build": "esbuild src/handler.ts --bundle --platform=node --target=node22 --format=esm --outfile=dist/handler.mjs --external:@aws-sdk/*" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0", "esbuild": "^0.24.0",
    "@types/aws-lambda": "^8.10.0", "aws-sdk-client-mock": "^4.1.0" },
  "dependencies": { "@aws-sdk/client-networkflowmonitor": "^3.700.0",
    "@aws-sdk/client-dynamodb": "^3.700.0", "@aws-sdk/lib-dynamodb": "^3.700.0",
    "@aws-sdk/client-ec2": "^3.700.0", "@aws-sdk/client-iam": "^3.700.0" } }
```
```ts
// collector/tsconfig.json
{ "extends": "../tsconfig.base.json", "include": ["src"] }
```
```ts
// collector/vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
```

- [x] **Step 3: 설치 및 확인**

Run: `npm install` → lockfile 생성. `npx -w collector vitest run` → "No test files found" (정상 — 아직 테스트 없음).

- [x] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: monorepo scaffold (workspaces: infra/app/collector)"
```

### Task 2: Collector — 정규화 모듈 (순수 함수, TDD)

**Files:**
- Create: `collector/src/types.ts` (파일 구조 맵의 "공유 인터페이스" 코드 그대로)
- Create: `collector/src/normalize.ts`
- Test: `collector/src/normalize.test.ts`

**Interfaces:**
- Produces: `endpointKey(e: EndpointInfo): string`, `edgeHashOf(a,b,targetPort?): string`,
  `normalizeRow(row: RawRow, ctx: {monitor,metric,category,bucket,unit}): FlowEdge`,
  `dedupeEdges(edges: FlowEdge[]): FlowEdge[]` (같은 sk 조합이면 value 큰 쪽 유지).
- `RawRow`는 `GetQueryResultsMonitorTopContributors`의 `MonitorTopContributorsRow` shape (camelCase: `localIp, localInstanceId, localSubnetId, localAz, localVpcId, localRegion, remote*, snatIp, dnatIp, targetPort, value, traversedConstructs, kubernetesMetadata:{localPodName,localPodNamespace,localServiceName,remotePodName,remotePodNamespace,remoteServiceName}`).

- [x] **Step 1: 실패하는 테스트 작성**

```ts
// collector/src/normalize.test.ts
import { describe, it, expect } from 'vitest';
import { endpointKey, edgeHashOf, normalizeRow, dedupeEdges } from './normalize.js';

const ctx = { monitor: 'nfm-eks-demo', metric: 'DATA_TRANSFERRED' as const,
  category: 'INTER_AZ' as const, bucket: '2026-07-08T11:45:00Z', unit: 'Bytes' };
const row = {
  localIp: '10.0.1.10', localInstanceId: 'i-aaa', localSubnetId: 'subnet-a',
  localAz: 'apne2-az1', localVpcId: 'vpc-1', localRegion: 'ap-northeast-2',
  remoteIp: '10.0.2.20', remoteInstanceId: 'i-bbb', remoteSubnetId: 'subnet-b',
  remoteAz: 'apne2-az2', remoteVpcId: 'vpc-1', remoteRegion: 'ap-northeast-2',
  targetPort: 8080, value: 1234,
  traversedConstructs: [{ componentId: 'tgw-1', componentType: 'TransitGateway' }],
  kubernetesMetadata: { localPodName: 'api-1', localPodNamespace: 'shop',
    localServiceName: 'api', remotePodName: 'db-0', remotePodNamespace: 'shop',
    remoteServiceName: 'db' } };

it('endpointKey prefers pod > instance > ip', () => {
  expect(endpointKey({ podNamespace: 'shop', podName: 'api-1', instanceId: 'i-a', ip: 'x' }))
    .toBe('pod:shop/api-1');
  expect(endpointKey({ instanceId: 'i-a', ip: 'x' })).toBe('i:i-a');
  expect(endpointKey({ ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
});

it('edgeHash is direction-independent', () => {
  const a = { podNamespace: 'shop', podName: 'api-1' }, b = { podNamespace: 'shop', podName: 'db-0' };
  expect(edgeHashOf(a, b, 8080)).toBe(edgeHashOf(b, a, 8080));
  expect(edgeHashOf(a, b, 8080)).not.toBe(edgeHashOf(a, b, 9090));
});

it('normalizeRow maps row → FlowEdge with sorted endpoints', () => {
  const e = normalizeRow(row, ctx);
  expect(e.monitor).toBe('nfm-eks-demo');
  expect(e.a.podName).toBe('api-1');       // 'pod:shop/api-1' < 'pod:shop/db-0'
  expect(e.b.podName).toBe('db-0');
  expect(e.value).toBe(1234);
  expect(e.traversedConstructs[0].componentId).toBe('tgw-1');
  expect(e.edgeHash).toMatch(/^[0-9a-f]{40}$/);
});

it('normalizeRow keeps endpoint fields attached to the right side after sort', () => {
  const flipped = { ...row,
    kubernetesMetadata: { ...row.kubernetesMetadata,
      localPodName: 'db-0', remotePodName: 'api-1' } };
  const e = normalizeRow(flipped as never, ctx);
  expect(e.a.podName).toBe('api-1');
  expect(e.a.instanceId).toBe('i-bbb');    // api-1은 remote측이었으므로 remote 필드가 따라감
});

it('dedupeEdges keeps max value per (metric,category,edgeHash)', () => {
  const e1 = normalizeRow(row, ctx), e2 = { ...e1, value: 99 };
  expect(dedupeEdges([e1, e2])).toHaveLength(1);
  expect(dedupeEdges([e1, e2])[0].value).toBe(1234);
});
```

- [x] **Step 2: 실패 확인** — Run: `npx -w collector vitest run` / Expected: FAIL `Cannot find module './normalize.js'`

- [x] **Step 3: 구현**

```ts
// collector/src/normalize.ts
import { createHash } from 'node:crypto';
import type { DestCategory, EndpointInfo, FlowEdge, MetricName, TraversedComponent } from './types.js';

export interface RawRow {
  localIp?: string; localInstanceId?: string; localSubnetId?: string; localAz?: string;
  localVpcId?: string; localRegion?: string;
  remoteIp?: string; remoteInstanceId?: string; remoteSubnetId?: string; remoteAz?: string;
  remoteVpcId?: string; remoteRegion?: string;
  snatIp?: string; dnatIp?: string; targetPort?: number; value?: number;
  traversedConstructs?: TraversedComponent[];
  kubernetesMetadata?: { localPodName?: string; localPodNamespace?: string; localServiceName?: string;
    remotePodName?: string; remotePodNamespace?: string; remoteServiceName?: string };
}
export interface RowCtx { monitor: string; metric: MetricName; category: DestCategory;
  bucket: string; unit: string; }

export function endpointKey(e: EndpointInfo): string {
  if (e.podName) return `pod:${e.podNamespace ?? '_'}/${e.podName}`;
  if (e.instanceId) return `i:${e.instanceId}`;
  return `ip:${e.ip ?? 'unknown'}`;
}

export function edgeHashOf(a: EndpointInfo, b: EndpointInfo, targetPort?: number): string {
  const [k1, k2] = [endpointKey(a), endpointKey(b)].sort();
  return createHash('sha1').update(`${k1}|${k2}|${targetPort ?? ''}`).digest('hex');
}

function side(row: RawRow, which: 'local' | 'remote'): EndpointInfo {
  const k = row.kubernetesMetadata ?? {};
  return which === 'local'
    ? { ip: row.localIp, instanceId: row.localInstanceId, subnetId: row.localSubnetId,
        az: row.localAz, vpcId: row.localVpcId, region: row.localRegion,
        podName: k.localPodName, podNamespace: k.localPodNamespace, serviceName: k.localServiceName }
    : { ip: row.remoteIp, instanceId: row.remoteInstanceId, subnetId: row.remoteSubnetId,
        az: row.remoteAz, vpcId: row.remoteVpcId, region: row.remoteRegion,
        podName: k.remotePodName, podNamespace: k.remotePodNamespace, serviceName: k.remoteServiceName };
}

export function normalizeRow(row: RawRow, ctx: RowCtx): FlowEdge {
  const local = side(row, 'local'), remote = side(row, 'remote');
  const [a, b] = endpointKey(local) <= endpointKey(remote) ? [local, remote] : [remote, local];
  return { edgeHash: edgeHashOf(local, remote, row.targetPort), monitor: ctx.monitor,
    metric: ctx.metric, category: ctx.category, bucket: ctx.bucket,
    value: row.value ?? 0, unit: ctx.unit, a, b,
    snatIp: row.snatIp, dnatIp: row.dnatIp, targetPort: row.targetPort,
    traversedConstructs: row.traversedConstructs ?? [] };
}

export function dedupeEdges(edges: FlowEdge[]): FlowEdge[] {
  const best = new Map<string, FlowEdge>();
  for (const e of edges) {
    const k = `${e.bucket}|${e.monitor}|${e.metric}|${e.category}|${e.edgeHash}`;
    const prev = best.get(k);
    if (!prev || e.value > prev.value) best.set(k, e);
  }
  return [...best.values()];
}
```

`collector/src/types.ts`는 본 문서 "공유 인터페이스" 블록을 그대로 생성.

- [x] **Step 4: 통과 확인** — Run: `npx -w collector vitest run` / Expected: 5 passed
- [x] **Step 5: Commit** — `git add collector && git commit -m "feat(collector): flow normalization with direction-independent edge hash"`

### Task 3: Collector — NFM 쿼리 오케스트레이터

**Files:**
- Create: `collector/src/nfm-query.ts`
- Test: `collector/src/nfm-query.test.ts` (aws-sdk-client-mock 사용)

**Interfaces:**
- Consumes: Task 2의 `normalizeRow`, `dedupeEdges`, `RawRow`.
- Produces: `runQueryMatrix(client, spec): Promise<{edges: FlowEdge[]; stats: CycleStats}>`
  - `spec = { monitors: string[]; metrics: MetricName[]; categories: DestCategory[]; startTime: Date; endTime: Date; bucket: string; concurrency: number }`
  - `CycleStats = { started: number; succeeded: number; failed: number; throttled: number; rows: number }`
- 내부 규칙: 쿼리당 `StartQueryMonitorTopContributors`(limit 100) → 2초 간격 `GetQueryStatus...` 폴링(최대 60회) → SUCCEEDED 시 `GetQueryResults...`(nextToken 루프) → 행마다 normalizeRow. FAILED/타임아웃이면 stats.failed 증가 후 계속. ThrottlingException은 1s→2s→4s→8s(+jitter) 재시도 4회 후 failed 처리, stats.throttled 집계. 동시 실행은 `concurrency` 슬롯 풀로 제한. RTT 쿼리의 unit은 응답의 `unit` 필드 사용(기본 'Count').

- [x] **Step 1: 실패하는 테스트 작성**

```ts
// collector/src/nfm-query.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { NetworkFlowMonitorClient, StartQueryMonitorTopContributorsCommand,
  GetQueryStatusMonitorTopContributorsCommand, GetQueryResultsMonitorTopContributorsCommand,
} from '@aws-sdk/client-networkflowmonitor';
import { runQueryMatrix } from './nfm-query.js';

const nfm = mockClient(NetworkFlowMonitorClient);
beforeEach(() => nfm.reset());

const spec = { monitors: ['m1'], metrics: ['DATA_TRANSFERRED' as const],
  categories: ['INTRA_AZ' as const], startTime: new Date(1e12), endTime: new Date(1e12 + 3e5),
  bucket: '2026-07-08T11:45:00Z', concurrency: 2, pollDelayMs: 0 };

it('start→status→results happy path yields normalized edges', async () => {
  nfm.on(StartQueryMonitorTopContributorsCommand).resolves({ queryId: 'q1' });
  nfm.on(GetQueryStatusMonitorTopContributorsCommand).resolves({ status: 'SUCCEEDED' });
  nfm.on(GetQueryResultsMonitorTopContributorsCommand).resolves({ unit: 'Bytes',
    topContributors: [{ localIp: '1.1.1.1', remoteIp: '2.2.2.2', value: 10 }] });
  const { edges, stats } = await runQueryMatrix(new NetworkFlowMonitorClient({}), spec);
  expect(edges).toHaveLength(1);
  expect(edges[0].unit).toBe('Bytes');
  expect(stats).toMatchObject({ started: 1, succeeded: 1, failed: 0, rows: 1 });
});

it('FAILED query is counted but does not abort the cycle', async () => {
  nfm.on(StartQueryMonitorTopContributorsCommand).resolves({ queryId: 'q1' });
  nfm.on(GetQueryStatusMonitorTopContributorsCommand).resolves({ status: 'FAILED' });
  const { edges, stats } = await runQueryMatrix(new NetworkFlowMonitorClient({}), spec);
  expect(edges).toHaveLength(0);
  expect(stats.failed).toBe(1);
});

it('ThrottlingException on Start retries then succeeds', async () => {
  const err = Object.assign(new Error('slow down'), { name: 'ThrottlingException' });
  nfm.on(StartQueryMonitorTopContributorsCommand)
    .rejectsOnce(err).resolves({ queryId: 'q1' });
  nfm.on(GetQueryStatusMonitorTopContributorsCommand).resolves({ status: 'SUCCEEDED' });
  nfm.on(GetQueryResultsMonitorTopContributorsCommand).resolves({ unit: 'Bytes', topContributors: [] });
  const { stats } = await runQueryMatrix(new NetworkFlowMonitorClient({}), { ...spec, retryBaseMs: 0 });
  expect(stats.throttled).toBe(1);
  expect(stats.succeeded).toBe(1);
});

it('paginates results with nextToken', async () => {
  nfm.on(StartQueryMonitorTopContributorsCommand).resolves({ queryId: 'q1' });
  nfm.on(GetQueryStatusMonitorTopContributorsCommand).resolves({ status: 'SUCCEEDED' });
  nfm.on(GetQueryResultsMonitorTopContributorsCommand)
    .resolvesOnce({ unit: 'Bytes', topContributors: [{ localIp: 'a', remoteIp: 'b', value: 1 }], nextToken: 't' })
    .resolvesOnce({ unit: 'Bytes', topContributors: [{ localIp: 'c', remoteIp: 'd', value: 2 }] });
  const { stats } = await runQueryMatrix(new NetworkFlowMonitorClient({}), spec);
  expect(stats.rows).toBe(2);
});
```

- [x] **Step 2: 실패 확인** — Run: `npx -w collector vitest run nfm-query` / Expected: FAIL (module not found)

- [x] **Step 3: 구현**

```ts
// collector/src/nfm-query.ts
import { NetworkFlowMonitorClient, StartQueryMonitorTopContributorsCommand,
  GetQueryStatusMonitorTopContributorsCommand, GetQueryResultsMonitorTopContributorsCommand,
  StopQueryMonitorTopContributorsCommand } from '@aws-sdk/client-networkflowmonitor';
import type { DestCategory, FlowEdge, MetricName } from './types.js';
import { normalizeRow, dedupeEdges, type RawRow } from './normalize.js';

export interface MatrixSpec { monitors: string[]; metrics: MetricName[]; categories: DestCategory[];
  startTime: Date; endTime: Date; bucket: string; concurrency: number;
  pollDelayMs?: number; retryBaseMs?: number; }
export interface CycleStats { started: number; succeeded: number; failed: number;
  throttled: number; rows: number; }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, stats: CycleStats, baseMs: number): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if ((e as Error).name === 'ThrottlingException' && i < 4) {
        stats.throttled++;
        await sleep(baseMs * 2 ** i + Math.random() * baseMs);
        continue;
      }
      throw e;
    }
  }
}

async function runOne(client: NetworkFlowMonitorClient, monitor: string, metric: MetricName,
    category: DestCategory, spec: MatrixSpec, stats: CycleStats): Promise<FlowEdge[]> {
  const base = spec.retryBaseMs ?? 1000, poll = spec.pollDelayMs ?? 2000;
  stats.started++;
  try {
    const { queryId } = await withRetry(() => client.send(new StartQueryMonitorTopContributorsCommand({
      monitorName: monitor, metricName: metric, destinationCategory: category,
      startTime: spec.startTime, endTime: spec.endTime, limit: 100 })), stats, base);
    for (let i = 0; i < 60; i++) {
      const { status } = await withRetry(() => client.send(
        new GetQueryStatusMonitorTopContributorsCommand({ monitorName: monitor, queryId })), stats, base);
      if (status === 'SUCCEEDED') break;
      if (status === 'FAILED' || status === 'CANCELED') { stats.failed++; return []; }
      if (i === 59) {
        await client.send(new StopQueryMonitorTopContributorsCommand({ monitorName: monitor, queryId }))
          .catch(() => {});
        stats.failed++; return [];
      }
      await sleep(poll);
    }
    const edges: FlowEdge[] = []; let nextToken: string | undefined;
    do {
      const res = await withRetry(() => client.send(new GetQueryResultsMonitorTopContributorsCommand({
        monitorName: monitor, queryId, nextToken })), stats, base);
      for (const row of res.topContributors ?? []) {
        stats.rows++;
        edges.push(normalizeRow(row as RawRow,
          { monitor, metric, category, bucket: spec.bucket, unit: res.unit ?? 'Count' }));
      }
      nextToken = res.nextToken;
    } while (nextToken);
    stats.succeeded++;
    return edges;
  } catch { stats.failed++; return []; }
}

export async function runQueryMatrix(client: NetworkFlowMonitorClient, spec: MatrixSpec) {
  const stats: CycleStats = { started: 0, succeeded: 0, failed: 0, throttled: 0, rows: 0 };
  const jobs: Array<() => Promise<FlowEdge[]>> = [];
  for (const m of spec.monitors) for (const met of spec.metrics) for (const c of spec.categories)
    jobs.push(() => runOne(client, m, met, c, spec, stats));
  const results: FlowEdge[] = []; let idx = 0;
  await Promise.all(Array.from({ length: Math.min(spec.concurrency, jobs.length) }, async () => {
    while (idx < jobs.length) { const j = jobs[idx++]; results.push(...await j()); }
  }));
  return { edges: dedupeEdges(results), stats };
}
```

- [x] **Step 4: 통과 확인** — Run: `npx -w collector vitest run` / Expected: 9 passed (Task 2의 5 + 신규 4)
- [x] **Step 5: Commit** — `git add collector && git commit -m "feat(collector): async NFM query orchestrator with concurrency and backoff"`

### Task 4: Collector — 저장 + 토폴로지 스냅샷

**Files:**
- Create: `collector/src/storage.ts`
- Test: `collector/src/storage.test.ts`

**Interfaces:**
- Consumes: Task 2 `FlowEdge`, `endpointKey`.
- Produces:
  - `flowItem(e: FlowEdge, ttlEpoch: number): Record<string, unknown>` — DDB 아이템 매핑(키 설계 준수. `gsi1pk/gsi1sk`는 a측이 pod일 때만, `gsi2pk/gsi2sk`는 b측이 pod일 때만 설정)
  - `buildTopology(edges: FlowEdge[], monitorToCluster: Record<string,string>): TopologySnapshot` — 노드 id는 `endpointKey()` 값. pod가 아닌 endpoint는 instanceId→`node`, 그 외→`external`. 엣지는 edgeHash별로 메트릭 병합, 상위 2000개(DATA_TRANSFERRED 내림차순)로 트림. `generatedAt`은 인자 `now: string`으로 받음(테스트 가능성).
  - `writeCycle(ddb: DynamoDBDocumentClient, tables: {flows,meta}, payload: {edges, topology, stats, cycleTs, coverage}): Promise<void>` — BatchWrite 25개 단위 + `STATUS#collect/latest`·`TOPO#latest/snapshot`·`COVERAGE#latest` Put.

- [x] **Step 1: 실패하는 테스트 작성**

```ts
// collector/src/storage.test.ts
import { describe, it, expect } from 'vitest';
import { flowItem, buildTopology } from './storage.js';
import type { FlowEdge } from './types.js';

const edge: FlowEdge = { edgeHash: 'abc', monitor: 'nfm-eks-demo', metric: 'DATA_TRANSFERRED',
  category: 'INTER_AZ', bucket: '2026-07-08T11:45:00Z', value: 100, unit: 'Bytes',
  a: { podName: 'api-1', podNamespace: 'shop', instanceId: 'i-aaa', az: 'az1' },
  b: { podName: 'db-0', podNamespace: 'shop', instanceId: 'i-bbb', az: 'az2' },
  targetPort: 5432, traversedConstructs: [] };

it('flowItem maps keys per schema', () => {
  const item = flowItem(edge, 1234567890);
  expect(item.pk).toBe('FLOW#2026-07-08T11:45:00Z#nfm-eks-demo');
  expect(item.sk).toBe('DATA_TRANSFERRED#INTER_AZ#abc');
  expect(item.gsi1pk).toBe('POD#shop/api-1');
  expect(item.gsi2pk).toBe('POD#shop/db-0');
  expect(item.gsi3pk).toBe('EDGE#abc');
  expect(item.gsi3sk).toBe('2026-07-08T11:45:00Z#DATA_TRANSFERRED');
  expect(item.ttl).toBe(1234567890);
});

it('flowItem omits pod GSIs for non-pod endpoints', () => {
  const e = { ...edge, a: { instanceId: 'i-x' }, b: { ip: '8.8.8.8' } };
  const item = flowItem(e as FlowEdge, 1);
  expect(item.gsi1pk).toBeUndefined();
  expect(item.gsi2pk).toBeUndefined();
});

it('buildTopology merges metrics per edge and classifies nodes', () => {
  const rtt = { ...edge, metric: 'ROUND_TRIP_TIME' as const, value: 900 };
  const topo = buildTopology([edge, rtt], { 'nfm-eks-demo': 'demo' }, '2026-07-08T11:50:00Z');
  expect(topo.nodes.find(n => n.id === 'pod:shop/api-1')?.kind).toBe('pod');
  expect(topo.nodes.find(n => n.id === 'pod:shop/api-1')?.cluster).toBe('demo');
  expect(topo.edges).toHaveLength(1);
  expect(topo.edges[0].metrics.DATA_TRANSFERRED).toBe(100);
  expect(topo.edges[0].metrics.ROUND_TRIP_TIME).toBe(900);
});
```

- [x] **Step 2: 실패 확인** — `npx -w collector vitest run storage` → FAIL

- [x] **Step 3: 구현**

```ts
// collector/src/storage.ts
import { DynamoDBDocumentClient, BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { CycleStats } from './nfm-query.js';
import type { EndpointInfo, FlowEdge, TopologySnapshot, TopoNode } from './types.js';
import { endpointKey } from './normalize.js';

export function flowItem(e: FlowEdge, ttlEpoch: number): Record<string, unknown> {
  const item: Record<string, unknown> = {
    pk: `FLOW#${e.bucket}#${e.monitor}`, sk: `${e.metric}#${e.category}#${e.edgeHash}`,
    gsi3pk: `EDGE#${e.edgeHash}`, gsi3sk: `${e.bucket}#${e.metric}`, ttl: ttlEpoch, ...e };
  if (e.a.podName) { item.gsi1pk = `POD#${e.a.podNamespace}/${e.a.podName}`; item.gsi1sk = e.bucket; }
  if (e.b.podName) { item.gsi2pk = `POD#${e.b.podNamespace}/${e.b.podName}`; item.gsi2sk = e.bucket; }
  return item;
}

function nodeOf(ep: EndpointInfo, cluster?: string): TopoNode {
  const id = endpointKey(ep);
  if (ep.podName) return { id, kind: 'pod', label: ep.podName, namespace: ep.podNamespace,
    cluster, az: ep.az, vpcId: ep.vpcId };
  if (ep.instanceId) return { id, kind: 'node', label: ep.instanceId, az: ep.az, vpcId: ep.vpcId };
  return { id, kind: 'external', label: ep.ip ?? 'unknown' };
}

export function buildTopology(edges: FlowEdge[], monitorToCluster: Record<string, string>,
    now: string): TopologySnapshot {
  const nodes = new Map<string, TopoNode>();
  const merged = new Map<string, TopologySnapshot['edges'][number]>();
  for (const e of edges) {
    const cluster = monitorToCluster[e.monitor];
    for (const ep of [e.a, e.b]) { const n = nodeOf(ep, ep.podName ? cluster : undefined);
      if (!nodes.has(n.id)) nodes.set(n.id, n); }
    const key = e.edgeHash;
    const cur = merged.get(key) ?? { id: key, source: endpointKey(e.a), target: endpointKey(e.b),
      metrics: {}, category: e.category, targetPort: e.targetPort };
    cur.metrics[e.metric] = (cur.metrics[e.metric] ?? 0) + e.value;
    merged.set(key, cur);
  }
  const top = [...merged.values()]
    .sort((x, y) => (y.metrics.DATA_TRANSFERRED ?? 0) - (x.metrics.DATA_TRANSFERRED ?? 0))
    .slice(0, 2000);
  const used = new Set(top.flatMap(e => [e.source, e.target]));
  return { generatedAt: now, nodes: [...nodes.values()].filter(n => used.has(n.id)), edges: top };
}

export async function writeCycle(ddb: DynamoDBDocumentClient,
    tables: { flows: string; meta: string },
    payload: { edges: FlowEdge[]; topology: TopologySnapshot; stats: CycleStats;
      cycleTs: string; coverage?: unknown }): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const items = payload.edges.map(e => ({ PutRequest: { Item: flowItem(e, ttl) } }));
  for (let i = 0; i < items.length; i += 25)
    await ddb.send(new BatchWriteCommand({ RequestItems: { [tables.flows]: items.slice(i, i + 25) } }));
  await ddb.send(new PutCommand({ TableName: tables.meta,
    Item: { pk: 'STATUS#collect', sk: payload.cycleTs, stats: payload.stats, ttl } }));
  await ddb.send(new PutCommand({ TableName: tables.meta,
    Item: { pk: 'STATUS#collect', sk: 'latest', cycleTs: payload.cycleTs, stats: payload.stats } }));
  await ddb.send(new PutCommand({ TableName: tables.meta,
    Item: { pk: 'TOPO#latest', sk: 'snapshot', topology: payload.topology } }));
  if (payload.coverage) await ddb.send(new PutCommand({ TableName: tables.meta,
    Item: { pk: 'COVERAGE#latest', sk: 'all', coverage: payload.coverage } }));
}
```

주의: `buildTopology` 시그니처는 테스트와 동일하게 `(edges, monitorToCluster, now)` 3-인자.

- [x] **Step 4: 통과 확인** — `npx -w collector vitest run` → 12 passed
- [x] **Step 5: Commit** — `git add collector && git commit -m "feat(collector): DDB flow items and topology snapshot aggregation"`

### Task 5: Collector — 자동 온보딩 + Lambda 핸들러

**Files:**
- Create: `collector/src/onboard.ts`, `collector/src/wi-query.ts`, `collector/src/handler.ts`
- Test: `collector/src/onboard.test.ts`

**Interfaces:**
- Consumes: Task 3 `runQueryMatrix`, Task 4 `buildTopology`/`writeCycle`.
- Produces: `discoverOnboarding(ec2, iam): Promise<Coverage>` — Coverage = `{ standalone: {instanceId, tagged, roleName, policyAttached}[]; eksNodeCount: number }`. 미태깅 standalone(EKS 태그 없는 인스턴스)에 `NfmAgent=managed` 태그 생성 + 인스턴스 프로파일 롤에 `CloudWatchNetworkFlowMonitorAgentPublishPolicy` attach(멱등). Lambda 핸들러 env: `TABLE_FLOWS, TABLE_META, MONITORS`(콤마구분 `이름=클러스터` 쌍, 클러스터 없으면 `이름=`), `CONCURRENCY`(기본 5).
- Produces(`wi-query.ts`): `collectWorkloadInsights(nfm, window: {startTime: Date; endTime: Date}): Promise<WiResult[]>` — `ListScopesCommand`로 scopeId 조회 후 metric 3종(DATA_TRANSFERRED/RETRANSMISSIONS/TIMEOUTS) × category 3종의 WorkloadInsights 쿼리(StartQueryWorkloadInsightsTopContributors→Status→Results, Task 3과 동일 폴링/백오프 규약)를 실행. `WiResult = {metric, category, rows: {accountId,localSubnetId,localAz,localVpcId,remoteIdentifier,value}[]}`. handler는 결과를 `NfmMeta`의 `WI#latest`/`all` 아이템 `{rows: WiResult[], cycleTs}`로 Put. 테스트: `collector/src/wi-query.test.ts` happy-path 1건(nfm-query.test와 동일 mock 패턴).

- [x] **Step 1: 실패하는 테스트 작성**

```ts
// collector/src/onboard.test.ts
import { it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { EC2Client, DescribeInstancesCommand, CreateTagsCommand } from '@aws-sdk/client-ec2';
import { IAMClient, ListAttachedRolePoliciesCommand, AttachRolePolicyCommand } from '@aws-sdk/client-iam';
import { discoverOnboarding } from './onboard.js';

const ec2 = mockClient(EC2Client), iam = mockClient(IAMClient);
beforeEach(() => { ec2.reset(); iam.reset(); });

it('tags untagged standalone instances and attaches publish policy', async () => {
  ec2.on(DescribeInstancesCommand).resolves({ Reservations: [{ Instances: [
    { InstanceId: 'i-eks', Tags: [{ Key: 'kubernetes.io/cluster/demo', Value: 'owned' }],
      IamInstanceProfile: { Arn: 'arn:aws:iam::1:instance-profile/eksrole' }, State: { Name: 'running' } },
    { InstanceId: 'i-solo', Tags: [{ Key: 'Name', Value: 'redis' }],
      IamInstanceProfile: { Arn: 'arn:aws:iam::1:instance-profile/solorole' }, State: { Name: 'running' } },
  ] }] });
  ec2.on(CreateTagsCommand).resolves({});
  iam.on(ListAttachedRolePoliciesCommand).resolves({ AttachedPolicies: [] });
  iam.on(AttachRolePolicyCommand).resolves({});
  const cov = await discoverOnboarding(new EC2Client({}), new IAMClient({}));
  expect(cov.eksNodeCount).toBe(1);
  expect(cov.standalone).toHaveLength(1);
  expect(cov.standalone[0]).toMatchObject({ instanceId: 'i-solo', tagged: true, policyAttached: true });
  expect(ec2.commandCalls(CreateTagsCommand)).toHaveLength(1);
  expect(iam.commandCalls(AttachRolePolicyCommand)).toHaveLength(1);
});

it('skips already-tagged instances (idempotent)', async () => {
  ec2.on(DescribeInstancesCommand).resolves({ Reservations: [{ Instances: [
    { InstanceId: 'i-done', Tags: [{ Key: 'NfmAgent', Value: 'managed' }],
      IamInstanceProfile: { Arn: 'arn:aws:iam::1:instance-profile/r' }, State: { Name: 'running' } } ] }] });
  iam.on(ListAttachedRolePoliciesCommand).resolves({ AttachedPolicies: [
    { PolicyArn: 'arn:aws:iam::aws:policy/CloudWatchNetworkFlowMonitorAgentPublishPolicy' }] });
  const cov = await discoverOnboarding(new EC2Client({}), new IAMClient({}));
  expect(ec2.commandCalls(CreateTagsCommand)).toHaveLength(0);
  expect(iam.commandCalls(AttachRolePolicyCommand)).toHaveLength(0);
  expect(cov.standalone[0].tagged).toBe(true);
});
```

- [x] **Step 2: 실패 확인** — `npx -w collector vitest run onboard` → FAIL

- [x] **Step 3: 구현**

```ts
// collector/src/onboard.ts
import { EC2Client, DescribeInstancesCommand, CreateTagsCommand } from '@aws-sdk/client-ec2';
import { IAMClient, ListAttachedRolePoliciesCommand, AttachRolePolicyCommand } from '@aws-sdk/client-iam';

const PUBLISH_POLICY = 'arn:aws:iam::aws:policy/CloudWatchNetworkFlowMonitorAgentPublishPolicy';
export interface Coverage {
  standalone: { instanceId: string; tagged: boolean; roleName?: string; policyAttached: boolean }[];
  eksNodeCount: number;
}

export async function discoverOnboarding(ec2: EC2Client, iam: IAMClient): Promise<Coverage> {
  const out: Coverage = { standalone: [], eksNodeCount: 0 };
  let nextToken: string | undefined;
  do {
    const res = await ec2.send(new DescribeInstancesCommand({ NextToken: nextToken,
      Filters: [{ Name: 'instance-state-name', Values: ['running'] }] }));
    nextToken = res.NextToken;
    for (const inst of (res.Reservations ?? []).flatMap(r => r.Instances ?? [])) {
      const tags = Object.fromEntries((inst.Tags ?? []).map(t => [t.Key, t.Value]));
      if (Object.keys(tags).some(k => k.startsWith('kubernetes.io/cluster/'))) { out.eksNodeCount++; continue; }
      const id = inst.InstanceId!;
      let tagged = tags.NfmAgent === 'managed';
      if (!tagged) {
        await ec2.send(new CreateTagsCommand({ Resources: [id],
          Tags: [{ Key: 'NfmAgent', Value: 'managed' }] }));
        tagged = true;
      }
      const roleName = inst.IamInstanceProfile?.Arn?.split('/').pop();
      let policyAttached = false;
      if (roleName) {
        const pols = await iam.send(new ListAttachedRolePoliciesCommand({ RoleName: roleName }));
        policyAttached = (pols.AttachedPolicies ?? []).some(p => p.PolicyArn === PUBLISH_POLICY);
        if (!policyAttached) {
          await iam.send(new AttachRolePolicyCommand({ RoleName: roleName, PolicyArn: PUBLISH_POLICY }));
          policyAttached = true;
        }
      }
      out.standalone.push({ instanceId: id, tagged, roleName, policyAttached });
    }
  } while (nextToken);
  return out;
}
```
주의: 인스턴스 프로파일명→롤명 매핑은 프로파일과 롤 이름이 같은 일반 관례를 따름. 실제 배포 후 다른 케이스가 발견되면 `GetInstanceProfile`로 보강(런타임 검증 항목).

```ts
// collector/src/handler.ts
import { NetworkFlowMonitorClient } from '@aws-sdk/client-networkflowmonitor';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EC2Client } from '@aws-sdk/client-ec2';
import { IAMClient } from '@aws-sdk/client-iam';
import { runQueryMatrix } from './nfm-query.js';
import { buildTopology, writeCycle } from './storage.js';
import { discoverOnboarding } from './onboard.js';
import { collectWorkloadInsights } from './wi-query.js';
import type { DestCategory, MetricName } from './types.js';

const nfm = new NetworkFlowMonitorClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true } });
const ec2 = new EC2Client({}), iam = new IAMClient({});

export const handler = async () => {
  const monitorPairs = (process.env.MONITORS ?? '').split(',').filter(Boolean)
    .map(s => s.split('=') as [string, string]);
  const monitorToCluster = Object.fromEntries(monitorPairs.filter(([, c]) => c));
  const now = new Date();
  const bucket = new Date(Math.floor(now.getTime() / 300000) * 300000).toISOString().replace(/\.\d+Z/, 'Z');
  const endTime = new Date(now.getTime() - 2 * 60000);
  const startTime = new Date(now.getTime() - 7 * 60000);
  const coverage = await discoverOnboarding(ec2, iam).catch(err => {
    console.error('onboarding failed', err); return undefined; });
  const { edges, stats } = await runQueryMatrix(nfm, {
    monitors: monitorPairs.map(([m]) => m),
    metrics: ['DATA_TRANSFERRED', 'RETRANSMISSIONS', 'TIMEOUTS', 'ROUND_TRIP_TIME'] as MetricName[],
    categories: ['INTRA_AZ', 'INTER_AZ', 'INTER_VPC'] as DestCategory[],
    startTime, endTime, bucket, concurrency: Number(process.env.CONCURRENCY ?? 5) });
  const topology = buildTopology(edges, monitorToCluster, now.toISOString());
  await writeCycle(ddb, { flows: process.env.TABLE_FLOWS!, meta: process.env.TABLE_META! },
    { edges, topology, stats, cycleTs: now.toISOString(), coverage });
  const wi = await collectWorkloadInsights(nfm, { startTime, endTime })
    .catch(err => { console.error('wi failed', err); return undefined; });
  if (wi) await ddb.send(new PutCommand({ TableName: process.env.TABLE_META!,
    Item: { pk: 'WI#latest', sk: 'all', rows: wi, cycleTs: now.toISOString() } }));
  console.log(JSON.stringify({ level: 'info', msg: 'cycle done', stats, edges: edges.length }));
  return { ok: true, stats };
};
```

- [x] **Step 4: 통과/빌드 확인** — `npx -w collector vitest run` → 15 passed (wi-query happy-path 포함). `npm -w collector run build` → `dist/handler.mjs` 생성.
- [x] **Step 5: Commit** — `git add collector && git commit -m "feat(collector): auto-onboarding and lambda handler"`

## Phase 2 — CDK 인프라 (데이터/온보딩)

### Task 6: CDK 앱 + DataStack 배포

**Files:**
- Create: `infra/package.json`, `infra/tsconfig.json`, `infra/cdk.json`, `infra/bin/nfm-dashboard.ts`, `infra/lib/data-stack.ts`
- Test: `infra/test/data-stack.test.ts` (assertions)

**Interfaces:**
- Produces: 테이블명 `nfm-dashboard-flows`/`nfm-dashboard-meta`, Collector 함수명 `nfm-dashboard-collector`. `MONITORS` env는 이후 Task 7 온보딩 결과와 일치해야 함 — 규약: EKS 모니터명 `nfm-eks-<클러스터명>`, VPC 모니터명 `nfm-vpc-all`. DataStack은 `monitorsEnv` context(`infra/cdk.json`의 `nfmMonitors`)에서 읽음. 초기값은 Task 7 완료 후 실제 클러스터명으로 갱신(Task 7 Step 5).

- [x] **Step 1: infra 워크스페이스 생성**

```jsonc
// infra/package.json
{ "name": "infra", "private": true,
  "scripts": { "build": "tsc --noEmit", "test": "vitest run", "cdk": "cdk" },
  "devDependencies": { "aws-cdk": "^2.170.0", "typescript": "^5.6.0", "vitest": "^2.1.0" },
  "dependencies": { "aws-cdk-lib": "^2.170.0", "constructs": "^10.4.0" } }
```
```jsonc
// infra/cdk.json
{ "app": "npx tsx bin/nfm-dashboard.ts",
  "context": { "nfmMonitors": "nfm-vpc-all=", "@aws-cdk/core:bootstrapQualifier": "hnb659fds" } }
```
(`tsx`가 없으면 `devDependencies`에 `"tsx": "^4.19.0"` 추가.)

```ts
// infra/bin/nfm-dashboard.ts
import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack.js';

const app = new cdk.App();
const env = { account: '<ACCOUNT_ID>', region: 'ap-northeast-2' };
new DataStack(app, 'NfmDash-Data', { env });
```

- [x] **Step 2: 실패하는 assertions 테스트**

```ts
// infra/test/data-stack.test.ts
import { it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DataStack } from '../lib/data-stack.js';

it('DataStack has 2 tables with TTL+GSIs, collector fn, 5min schedule', () => {
  const t = Template.fromStack(new DataStack(new App(), 'T',
    { env: { account: '<ACCOUNT_ID>', region: 'ap-northeast-2' } }));
  t.hasResourceProperties('AWS::DynamoDB::Table', {
    TableName: 'nfm-dashboard-flows',
    TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true } });
  t.hasResourceProperties('AWS::DynamoDB::Table', { TableName: 'nfm-dashboard-meta' });
  t.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: 'nfm-dashboard-collector', Architectures: ['arm64'], Timeout: 270 });
  t.hasResourceProperties('AWS::Scheduler::Schedule', {
    ScheduleExpression: 'rate(5 minutes)' });
});
```

- [x] **Step 3: 실패 확인** — `npx -w infra vitest run` → FAIL (data-stack 없음)

- [x] **Step 4: DataStack 구현**

```ts
// infra/lib/data-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as path from 'node:path';

export class DataStack extends cdk.Stack {
  readonly flows: ddb.Table; readonly meta: ddb.Table; readonly collector: lambda.Function;
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    this.flows = new ddb.Table(this, 'Flows', {
      tableName: 'nfm-dashboard-flows',
      partitionKey: { name: 'pk', type: ddb.AttributeType.STRING },
      sortKey: { name: 'sk', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl', removalPolicy: cdk.RemovalPolicy.DESTROY });
    for (const [i, [pk, sk]] of ([['gsi1pk','gsi1sk'],['gsi2pk','gsi2sk'],['gsi3pk','gsi3sk']] as const).entries())
      this.flows.addGlobalSecondaryIndex({ indexName: `GSI${i+1}`,
        partitionKey: { name: pk, type: ddb.AttributeType.STRING },
        sortKey: { name: sk, type: ddb.AttributeType.STRING } });
    this.meta = new ddb.Table(this, 'Meta', {
      tableName: 'nfm-dashboard-meta',
      partitionKey: { name: 'pk', type: ddb.AttributeType.STRING },
      sortKey: { name: 'sk', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl', removalPolicy: cdk.RemovalPolicy.DESTROY });

    this.collector = new lambda.Function(this, 'Collector', {
      functionName: 'nfm-dashboard-collector',
      runtime: lambda.Runtime.NODEJS_22_X, architecture: lambda.Architecture.ARM_64,
      handler: 'handler.handler', memorySize: 512, timeout: cdk.Duration.seconds(270),
      code: lambda.Code.fromAsset(path.join(__dirname, '../../collector/dist')),
      environment: { TABLE_FLOWS: this.flows.tableName, TABLE_META: this.meta.tableName,
        MONITORS: this.node.tryGetContext('nfmMonitors') ?? '', CONCURRENCY: '5' } });
    this.flows.grantWriteData(this.collector);
    this.meta.grantReadWriteData(this.collector);
    this.collector.addToRolePolicy(new iam.PolicyStatement({ actions: [
      'networkflowmonitor:StartQueryMonitorTopContributors',
      'networkflowmonitor:GetQueryStatusMonitorTopContributors',
      'networkflowmonitor:GetQueryResultsMonitorTopContributors',
      'networkflowmonitor:StopQueryMonitorTopContributors',
      'networkflowmonitor:ListMonitors', 'ec2:DescribeInstances', 'ec2:CreateTags',
      'iam:ListAttachedRolePolicies'], resources: ['*'] }));
    this.collector.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:AttachRolePolicy'], resources: ['arn:aws:iam::<ACCOUNT_ID>:role/*'],
      conditions: { ArnEquals: { 'iam:PolicyARN':
        'arn:aws:iam::aws:policy/CloudWatchNetworkFlowMonitorAgentPublishPolicy' } } }));

    const schedRole = new iam.Role(this, 'SchedRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com') });
    this.collector.grantInvoke(schedRole);
    new scheduler.CfnSchedule(this, 'Every5m', {
      flexibleTimeWindow: { mode: 'OFF' }, scheduleExpression: 'rate(5 minutes)',
      target: { arn: this.collector.functionArn, roleArn: schedRole.roleArn } });
  }
}
```

- [x] **Step 5: 테스트 통과 확인** — `npm -w collector run build && npx -w infra vitest run` → PASS
- [x] **Step 6: 배포** — `npx -w infra cdk deploy NfmDash-Data --require-approval never`
  Expected: CREATE_COMPLETE. 확인: `aws dynamodb describe-table --table-name nfm-dashboard-flows --query 'Table.TableStatus'` → `ACTIVE`, `aws lambda get-function --function-name nfm-dashboard-collector --query 'Configuration.State'` → `Active`.
- [x] **Step 7: Commit** — `git add infra collector && git commit -m "infra: DataStack (DynamoDB, collector lambda, 5min scheduler)"`

### Task 7: NfmOnboardingStack — Scope/모니터/EKS add-on/SSM Association

**Files:**
- Create: `onboarding/onboard_nfm.py`
- Create: `infra/lib/nfm-onboarding-stack.ts`
- Modify: `infra/bin/nfm-dashboard.ts` (스택 추가)
- Test: `onboarding/test_onboard_nfm.py` (pytest + botocore Stubber는 과도 — 순수 로직 함수만 테스트)

**Interfaces:**
- Consumes: 없음 (독립).
- Produces: NFM Scope 1개, 모니터 `nfm-eks-<cluster>` ×N + `nfm-vpc-all`, EKS add-on 설치 완료. Custom Resource 응답 Data에 `MonitorsEnv` 문자열(`nfm-eks-demo=demo,nfm-vpc-all=` 형식) — Task 6의 `nfmMonitors` context 갱신에 사용.
- `onboard_nfm.py`의 순수 함수: `monitors_env(clusters: list[str]) -> str`, `desired_monitors(clusters, vpc_ids) -> list[dict]`.

- [x] **Step 1: 실패하는 테스트 (순수 함수만)**

```python
# onboarding/test_onboard_nfm.py
from onboard_nfm import monitors_env, desired_monitors

def test_monitors_env_format():
    assert monitors_env(["demo", "prod"]) == "nfm-eks-demo=demo,nfm-eks-prod=prod,nfm-vpc-all="

def test_desired_monitors_shapes():
    mons = desired_monitors(["demo"], ["vpc-1", "vpc-2"])
    eks = next(m for m in mons if m["monitorName"] == "nfm-eks-demo")
    assert eks["localResources"] == [{"type": "AWS::EKS::Cluster",
        "identifier": "arn:aws:eks:ap-northeast-2:<ACCOUNT_ID>:cluster/demo"}]
    vpc = next(m for m in mons if m["monitorName"] == "nfm-vpc-all")
    assert {"type": "AWS::EC2::VPC",
            "identifier": "arn:aws:ec2:ap-northeast-2:<ACCOUNT_ID>:vpc/vpc-1"} in vpc["localResources"]
```

- [x] **Step 2: 실패 확인** — `cd onboarding && python3 -m pytest -q` → FAIL (module 없음)

- [x] **Step 3: 구현 (CFN Custom Resource 핸들러 포함)**

```python
# onboarding/onboard_nfm.py
"""NFM onboarding custom resource: scope, monitors, EKS add-ons, pod identity. Idempotent."""
import json, time, urllib.request
import boto3

REGION, ACCOUNT = "ap-northeast-2", "<ACCOUNT_ID>"
PUBLISH_POLICY = "arn:aws:iam::aws:policy/CloudWatchNetworkFlowMonitorAgentPublishPolicy"
NFM_NS, NFM_SA = "amazon-network-flow-monitor", "aws-network-flow-monitor-agent-service-account"


def monitors_env(clusters):
    parts = [f"nfm-eks-{c}={c}" for c in clusters]
    return ",".join(parts + ["nfm-vpc-all="])


def desired_monitors(clusters, vpc_ids):
    mons = [{"monitorName": f"nfm-eks-{c}", "localResources": [
        {"type": "AWS::EKS::Cluster",
         "identifier": f"arn:aws:eks:{REGION}:{ACCOUNT}:cluster/{c}"}]} for c in clusters]
    mons.append({"monitorName": "nfm-vpc-all", "localResources": [
        {"type": "AWS::EC2::VPC", "identifier": f"arn:aws:ec2:{REGION}:{ACCOUNT}:vpc/{v}"}
        for v in vpc_ids[:25]]})
    return mons


def ensure_scope(nfm):
    scopes = nfm.list_scopes().get("scopes", [])
    if scopes:
        return scopes[0]["scopeArn"]
    resp = nfm.create_scope(targets=[{"targetIdentifier": {
        "targetId": {"accountId": ACCOUNT}, "targetType": "ACCOUNT"}, "region": REGION}])
    for _ in range(60):
        s = nfm.get_scope(scopeId=resp["scopeId"])
        if s["status"] == "SUCCEEDED":
            break
        time.sleep(10)
    return resp["scopeArn"]


def ensure_monitors(nfm, scope_arn, clusters, vpc_ids):
    existing = {m["monitorName"] for m in nfm.list_monitors().get("monitors", [])}
    for spec in desired_monitors(clusters, vpc_ids):
        if spec["monitorName"] in existing:
            continue
        nfm.create_monitor(monitorName=spec["monitorName"],
                           localResources=spec["localResources"], scopeArn=scope_arn)


def ensure_eks(eks, iam, cluster):
    addons = eks.list_addons(clusterName=cluster).get("addons", [])
    if "eks-pod-identity-agent" not in addons:
        eks.create_addon(clusterName=cluster, addonName="eks-pod-identity-agent")
        _wait_addon(eks, cluster, "eks-pod-identity-agent")
    role_name = f"nfm-agent-{cluster}"
    try:
        iam.get_role(RoleName=role_name)
    except iam.exceptions.NoSuchEntityException:
        iam.create_role(RoleName=role_name, AssumeRolePolicyDocument=json.dumps({
            "Version": "2012-10-17", "Statement": [{"Effect": "Allow",
                "Principal": {"Service": "pods.eks.amazonaws.com"},
                "Action": ["sts:AssumeRole", "sts:TagSession"]}]}))
        iam.attach_role_policy(RoleName=role_name, PolicyArn=PUBLISH_POLICY)
    assocs = eks.list_pod_identity_associations(clusterName=cluster,
        namespace=NFM_NS).get("associations", [])
    if not any(a["serviceAccount"] == NFM_SA for a in assocs):
        eks.create_pod_identity_association(clusterName=cluster, namespace=NFM_NS,
            serviceAccount=NFM_SA, roleArn=f"arn:aws:iam::{ACCOUNT}:role/{role_name}")
    if "aws-network-flow-monitoring-agent" not in addons:
        eks.create_addon(clusterName=cluster, addonName="aws-network-flow-monitoring-agent")
        _wait_addon(eks, cluster, "aws-network-flow-monitoring-agent")


def _wait_addon(eks, cluster, name):
    for _ in range(60):
        st = eks.describe_addon(clusterName=cluster, addonName=name)["addon"]["status"]
        if st in ("ACTIVE", "DEGRADED"):
            return
        time.sleep(10)


def run():
    nfm = boto3.client("networkflowmonitor", region_name=REGION)
    eks = boto3.client("eks", region_name=REGION)
    iam = boto3.client("iam")
    ec2 = boto3.client("ec2", region_name=REGION)
    clusters = eks.list_clusters()["clusters"]
    vpc_ids = [v["VpcId"] for v in ec2.describe_vpcs()["Vpcs"]]
    scope_arn = ensure_scope(nfm)
    for c in clusters:
        ensure_eks(eks, iam, c)
    ensure_monitors(nfm, scope_arn, clusters, vpc_ids)
    return {"MonitorsEnv": monitors_env(clusters), "ScopeArn": scope_arn,
            "Clusters": ",".join(clusters)}


def send_cfn(event, context, status, data=None, reason=""):
    body = json.dumps({"Status": status, "Reason": reason[:400] or "ok",
        "PhysicalResourceId": "nfm-onboarding", "StackId": event["StackId"],
        "RequestId": event["RequestId"], "LogicalResourceId": event["LogicalResourceId"],
        "Data": data or {}}).encode()
    req = urllib.request.Request(event["ResponseURL"], data=body, method="PUT",
        headers={"Content-Type": ""})
    urllib.request.urlopen(req)


def handler(event, context):
    try:
        if event["RequestType"] == "Delete":   # 온보딩 리소스는 잔존시킴 (에이전트/모니터 유지)
            send_cfn(event, context, "SUCCESS")
            return
        send_cfn(event, context, "SUCCESS", run())
    except Exception as e:                      # noqa: BLE001
        send_cfn(event, context, "FAILED", reason=str(e))
```

- [x] **Step 4: 순수 함수 테스트 통과** — `cd onboarding && python3 -m pytest -q` → 2 passed

- [x] **Step 5: 스택 구현 + 배포**

```ts
// infra/lib/nfm-onboarding-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'node:path';

export class NfmOnboardingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    const fn = new lambda.Function(this, 'OnboardFn', {
      functionName: 'nfm-dashboard-onboarding',
      runtime: lambda.Runtime.PYTHON_3_13, architecture: lambda.Architecture.ARM_64,
      handler: 'onboard_nfm.handler', timeout: cdk.Duration.minutes(15),
      code: lambda.Code.fromAsset(path.join(__dirname, '../../onboarding')) });
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: [
      'networkflowmonitor:*', 'eks:ListClusters', 'eks:ListAddons', 'eks:CreateAddon',
      'eks:DescribeAddon', 'eks:ListPodIdentityAssociations', 'eks:CreatePodIdentityAssociation',
      'ec2:DescribeVpcs', 'iam:GetRole', 'iam:CreateRole', 'iam:AttachRolePolicy',
      'iam:PassRole', 'iam:CreateServiceLinkedRole'], resources: ['*'] }));
    const cr = new cdk.CustomResource(this, 'Onboarding', { serviceToken: fn.functionArn,
      properties: { Version: '1' } });   // Version 값 변경 시 재실행
    new cdk.CfnOutput(this, 'MonitorsEnv', { value: cr.getAttString('MonitorsEnv') });

    new cdk.aws_ssm.CfnAssociation ?? null; // (설명용 주석 — 아래가 실제 리소스)
    new (require('aws-cdk-lib/aws-ssm').CfnAssociation)(this, 'AgentInstall', {
      name: 'AWS-ConfigureAWSPackage',
      associationName: 'nfm-dashboard-agent-install',
      targets: [{ key: 'tag:NfmAgent', values: ['managed'] }],
      scheduleExpression: 'rate(1 day)',
      parameters: { action: ['Install'], name: ['AmazonCloudWatchNetworkFlowMonitorAgent'] } });
  }
}
```
주의: 위 `require` 라인은 계획 압축 표기 — 실제 코드는 파일 상단 `import * as ssm from 'aws-cdk-lib/aws-ssm'` 후 `new ssm.CfnAssociation(...)`으로 작성하고 설명용 줄은 제거한다.

`infra/bin/nfm-dashboard.ts`에 추가:
```ts
import { NfmOnboardingStack } from '../lib/nfm-onboarding-stack.js';
new NfmOnboardingStack(app, 'NfmDash-Onboarding', { env });
```

Run: `npx -w infra cdk deploy NfmDash-Onboarding --require-approval never`
Expected: CREATE_COMPLETE, Output `MonitorsEnv` 표시 (예: `nfm-eks-A=A,...,nfm-vpc-all=`).

- [x] **Step 6: context 갱신 + Collector 재배포**

`infra/cdk.json`의 `nfmMonitors`를 Step 5 Output 값으로 교체 →
`npx -w infra cdk deploy NfmDash-Data --require-approval never`

- [x] **Step 7: 검증**

```bash
aws networkflowmonitor list-monitors --query 'monitors[].monitorName'   # nfm-eks-* + nfm-vpc-all
aws networkflowmonitor list-scopes --query 'scopes[0].status'           # SUCCEEDED
aws eks list-addons --cluster-name <첫 클러스터> | grep network-flow    # addon 존재
aws lambda invoke --function-name nfm-dashboard-collector /tmp/out.json && cat /tmp/out.json
# {"ok":true,...} — 초기엔 rows 0 정상(에이전트 데이터 ~20분 소요)
```

- [x] **Step 8: Commit** — `git add onboarding infra && git commit -m "infra: NFM onboarding (scope, monitors, EKS add-ons, SSM association)"`

## Phase 3 — Gateway 도구 & AgentCoreStack

### Task 8: MCP 도구 Lambda 3종 (Python, TDD)

**Files:**
- Create: `tools/network_mcp.py` — `/home/ec2-user/my-project/awsops/agent/lambda/network_mcp.py`를 복사 후 수정: (1) cross_account import/`target_account_id` 분기 제거(단일 계정 boto3 기본 클라이언트), (2) `reachability.py`의 `analyze_reachability` 도구를 같은 파일 dispatch에 흡수, (3) 나머지 15개 도구 로직 유지.
- Create: `tools/nfm_mcp.py`, `tools/ddb_mcp.py`, `tools/requirements-dev.txt`(`pytest`, `boto3`)
- Test: `tools/tests/test_nfm_mcp.py`, `tools/tests/test_ddb_mcp.py`

**Interfaces:**
- 모든 핸들러는 awsops 계약: `lambda_handler(event, context)` — event(dict)에서 `tool_name`/`arguments`(또는 event 자체가 arguments)를 읽어 dispatch, 반환 `{"statusCode":200,"body":json.dumps(...)}` (`ok()`) / `{"statusCode":400,...}` (`err()`).
- `nfm_mcp.py` 도구: `list_nfm_monitors()`, `query_top_contributors(monitor_name, metric_name, destination_category, minutes_back=60, limit=50)` (내부 Start→poll(2s)→Get, 최대 120s), `get_workload_insights(metric_name, minutes_back=60)`, `get_agent_coverage()`(DDB `COVERAGE#latest`), `get_network_health()`(CW `AWS/NetworkFlowMonitor` 최근 30분 GetMetricData: 5지표×모니터).
- `ddb_mcp.py` 도구: `query_pod_flows(namespace, pod, limit=50)`(GSI1+GSI2 양측 쿼리 병합), `query_flow_edges(edge_hash, limit=50)`(GSI3), `get_topology_snapshot()`, `get_top_talkers(metric='DATA_TRANSFERRED', limit=20)`(TOPO#latest 엣지 정렬), `find_flow_path(src_pod, dst_pod)`(GSI1 쿼리 후 상대측 매칭 → traversedConstructs/양단 반환), `get_collection_status()`.
- env: `TABLE_FLOWS`, `TABLE_META` (ddb/nfm 공용).

- [x] **Step 1: 실패하는 테스트 작성** (dispatch·정렬 로직 중심 — boto3는 monkeypatch)

```python
# tools/tests/test_ddb_mcp.py
import json, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
import ddb_mcp

def test_unknown_tool_returns_err():
    r = ddb_mcp.lambda_handler({"tool_name": "nope", "arguments": {}}, None)
    assert r["statusCode"] == 400

def test_top_talkers_sorts_by_metric(monkeypatch):
    topo = {"edges": [
        {"id": "e1", "metrics": {"DATA_TRANSFERRED": 10}},
        {"id": "e2", "metrics": {"DATA_TRANSFERRED": 99}}], "nodes": []}
    monkeypatch.setattr(ddb_mcp, "_get_topology", lambda: topo)
    r = ddb_mcp.lambda_handler({"tool_name": "get_top_talkers",
                                "arguments": {"limit": 1}}, None)
    body = json.loads(r["body"])
    assert body["edges"][0]["id"] == "e2"
```
```python
# tools/tests/test_nfm_mcp.py
import json, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
import nfm_mcp

def test_dispatch_and_err_shape():
    r = nfm_mcp.lambda_handler({"tool_name": "bogus", "arguments": {}}, None)
    assert r["statusCode"] == 400
    assert "error" in json.loads(r["body"])
```

- [x] **Step 2: 실패 확인** — `cd tools && python3 -m pytest -q` → FAIL

- [x] **Step 3: 구현** — 핵심 뼈대 (전체 도구는 Interfaces 목록 그대로 구현):

```python
# tools/ddb_mcp.py (발췌 아님 — 이 구조로 6개 도구 전부)
import json, os
import boto3
from boto3.dynamodb.conditions import Key

TABLE_FLOWS = os.environ.get("TABLE_FLOWS", "nfm-dashboard-flows")
TABLE_META = os.environ.get("TABLE_META", "nfm-dashboard-meta")
_dyn = None

def _table(name):
    global _dyn
    if _dyn is None:
        _dyn = boto3.resource("dynamodb", region_name="ap-northeast-2")
    return _dyn.Table(name)

def ok(body):  return {"statusCode": 200, "body": json.dumps(body, default=str)}
def err(msg):  return {"statusCode": 400, "body": json.dumps({"error": msg})}

def _get_topology():
    it = _table(TABLE_META).get_item(Key={"pk": "TOPO#latest", "sk": "snapshot"}).get("Item")
    return it["topology"] if it else {"nodes": [], "edges": []}

def get_top_talkers(args):
    metric, limit = args.get("metric", "DATA_TRANSFERRED"), int(args.get("limit", 20))
    edges = sorted(_get_topology()["edges"],
                   key=lambda e: e.get("metrics", {}).get(metric, 0), reverse=True)[:limit]
    return ok({"metric": metric, "edges": edges})

def query_pod_flows(args):
    pk = f"POD#{args['namespace']}/{args['pod']}"; limit = int(args.get("limit", 50))
    t = _table(TABLE_FLOWS); items = []
    for idx, key in (("GSI1", "gsi1pk"), ("GSI2", "gsi2pk")):
        items += t.query(IndexName=idx, KeyConditionExpression=Key(key).eq(pk),
                         ScanIndexForward=False, Limit=limit).get("Items", [])
    items.sort(key=lambda i: i.get("bucket", ""), reverse=True)
    return ok({"flows": items[:limit]})

# query_flow_edges(GSI3), get_topology_snapshot, find_flow_path, get_collection_status 동일 패턴…

TOOLS = {"query_pod_flows": query_pod_flows, "query_flow_edges": ...,
         "get_topology_snapshot": lambda a: ok(_get_topology()),
         "get_top_talkers": get_top_talkers, "find_flow_path": ...,
         "get_collection_status": ...}

def lambda_handler(event, context):
    t = event.get("tool_name", ""); args = event.get("arguments", event)
    fn = TOOLS.get(t)
    return fn(args) if fn else err(f"unknown tool: {t}")
```
`...` 표기는 이 태스크에서 반드시 실제 함수로 완성한다(Interfaces의 동작 정의 참조). `nfm_mcp.py`도 동일 골격 + boto3 `networkflowmonitor`/`cloudwatch` 클라이언트.

- [x] **Step 4: 통과 확인** — `cd tools && python3 -m pytest -q` → 3 passed
- [x] **Step 5: Commit** — `git add tools && git commit -m "feat(tools): network/nfm/ddb MCP lambda tools (awsops handler contract)"`

### Task 9: AgentCoreStack + Gateway/타겟 생성

**Files:**
- Create: `infra/lib/agentcore-stack.ts` (도구 Lambda 3개 + Gateway 서비스 롤)
- Create: `tools/create_gateway.py` (awsops `create_targets.py` 패턴), `scripts/setup-gateway.sh`
- Modify: `infra/bin/nfm-dashboard.ts`

**Interfaces:**
- Lambda 함수명: `nfm-dashboard-mcp-network` / `-mcp-nfm` / `-mcp-ddb` (PYTHON_3_13, arm64, timeout 60s, env TABLE_FLOWS/TABLE_META). 각 함수에 `bedrock-agentcore.amazonaws.com` invoke 리소스 정책.
- Gateway 롤 `nfm-dashboard-gateway-role`: trust `bedrock-agentcore.amazonaws.com`, 인라인 정책 `lambda:InvokeFunction` (위 3개 함수 ARN).
- `create_gateway.py`: `create-gateway(name='nfm-gateway', protocolType='MCP', authorizerType 미지정→IAM/SigV4, roleArn=게이트웨이롤)` 멱등 + 타겟 3개(`network-mcp-target`/`nfm-mcp-target`/`ddb-mcp-target`, `toolSchema.inlinePayload`, `GATEWAY_IAM_ROLE`) 멱등 생성. 완료 후 SSM 파라미터 `/nfm-dashboard/gateway-url`에 `https://{gatewayId}.gateway.bedrock-agentcore.ap-northeast-2.amazonaws.com/mcp` 기록.
- 도구 스키마: Task 8 Interfaces의 인자명과 정확히 일치시킬 것 (예: `query_top_contributors`: `{monitor_name:string(req), metric_name:string(req), destination_category:string(req), minutes_back:integer, limit:integer}`).

- [x] **Step 1: 스택 구현**

```ts
// infra/lib/agentcore-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'node:path';

export class AgentCoreStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    const code = lambda.Code.fromAsset(path.join(__dirname, '../../tools'),
      { exclude: ['tests', 'create_gateway.py', '*.txt'] });
    const mk = (name: string, file: string) => {
      const fn = new lambda.Function(this, name, {
        functionName: `nfm-dashboard-mcp-${name.toLowerCase()}`,
        runtime: lambda.Runtime.PYTHON_3_13, architecture: lambda.Architecture.ARM_64,
        handler: `${file}.lambda_handler`, timeout: cdk.Duration.seconds(60), code,
        environment: { TABLE_FLOWS: 'nfm-dashboard-flows', TABLE_META: 'nfm-dashboard-meta' } });
      fn.addPermission('AgentCore', { principal: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        action: 'lambda:InvokeFunction' });
      return fn;
    };
    const net = mk('Network', 'network_mcp'), nfm = mk('Nfm', 'nfm_mcp'), ddbF = mk('Ddb', 'ddb_mcp');
    net.addToRolePolicy(new iam.PolicyStatement({ actions: ['ec2:Describe*', 'ec2:Get*',
      'ec2:CreateNetworkInsightsPath', 'ec2:StartNetworkInsightsAnalysis',
      'ec2:DescribeNetworkInsights*', 'elasticloadbalancing:Describe*',
      'network-firewall:Describe*', 'network-firewall:List*', 'logs:FilterLogEvents',
      'eks:Describe*', 'eks:List*'], resources: ['*'] }));
    nfm.addToRolePolicy(new iam.PolicyStatement({ actions: ['networkflowmonitor:*',
      'cloudwatch:GetMetricData', 'dynamodb:GetItem', 'dynamodb:Query'], resources: ['*'] }));
    ddbF.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [`arn:aws:dynamodb:ap-northeast-2:<ACCOUNT_ID>:table/nfm-dashboard-*`,
        `arn:aws:dynamodb:ap-northeast-2:<ACCOUNT_ID>:table/nfm-dashboard-*/index/*`] }));
    const gwRole = new iam.Role(this, 'GatewayRole', { roleName: 'nfm-dashboard-gateway-role',
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com') });
    gwRole.addToPolicy(new iam.PolicyStatement({ actions: ['lambda:InvokeFunction'],
      resources: [net.functionArn, nfm.functionArn, ddbF.functionArn] }));
    new cdk.CfnOutput(this, 'GatewayRoleArn', { value: gwRole.roleArn });
  }
}
```
`bin`에 `new AgentCoreStack(app, 'NfmDash-AgentCore', { env });` 추가.

- [x] **Step 2: 배포** — `npx -w infra cdk deploy NfmDash-AgentCore --require-approval never` → CREATE_COMPLETE

- [x] **Step 3: create_gateway.py 작성** — awsops 패턴 준수(EXISTS 체크, `prop()` 헬퍼). 게이트웨이 생성 부분:

```python
# tools/create_gateway.py (골격 — 타겟 3개의 tools 스키마는 Task 8 인자명과 1:1)
import boto3, json, os, sys, time
REGION, ACCOUNT = "ap-northeast-2", "<ACCOUNT_ID>"
client = boto3.client("bedrock-agentcore-control", region_name=REGION)
ssm = boto3.client("ssm", region_name=REGION)

def prop(t, d=""):
    r = {"type": t}
    if d: r["description"] = d
    return r

def ensure_gateway(role_arn):
    for g in client.list_gateways().get("items", []):
        if g["name"] == "nfm-gateway":
            return g["gatewayId"]
    r = client.create_gateway(name="nfm-gateway", protocolType="MCP", roleArn=role_arn,
                              description="NFM dashboard network/flow/ddb tools")
    gw_id = r["gatewayId"]
    while client.get_gateway(gatewayIdentifier=gw_id)["status"] != "READY":
        time.sleep(5)
    return gw_id

def create_target(gw_id, name, fn_name, desc, tools):
    existing = client.list_gateway_targets(gatewayIdentifier=gw_id).get("items", [])
    if any(e["name"] == name for e in existing):
        print("EXISTS", name); return
    client.create_gateway_target(gatewayIdentifier=gw_id, name=name, description=desc,
        targetConfiguration={"mcp": {"lambda": {
            "lambdaArn": f"arn:aws:lambda:{REGION}:{ACCOUNT}:function:{fn_name}",
            "toolSchema": {"inlinePayload": tools}}}},
        credentialProviderConfigurations=[{"credentialProviderType": "GATEWAY_IAM_ROLE"}])
    print("CREATED", name)

# NETWORK_TOOLS/NFM_TOOLS/DDB_TOOLS 리스트 정의(각 도구 name/description/inputSchema)…
# main: role_arn = sys.argv[1]; gw = ensure_gateway(role_arn); create_target ×3;
# ssm.put_parameter(Name="/nfm-dashboard/gateway-url", Value=f"https://{gw}.gateway.bedrock-agentcore.{REGION}.amazonaws.com/mcp", Type="String", Overwrite=True)
```
`…` 부분은 이 태스크에서 완성(도구 16+5+6=27개 스키마 전부 — awsops `create_targets.py`의 NETWORK GATEWAY 섹션에서 15개 스키마를 그대로 복사 가능).

```bash
# scripts/setup-gateway.sh
#!/usr/bin/env bash
set -euo pipefail
ROLE_ARN=$(aws cloudformation describe-stacks --stack-name NfmDash-AgentCore \
  --query "Stacks[0].Outputs[?OutputKey=='GatewayRoleArn'].OutputValue" --output text)
python3 tools/create_gateway.py "$ROLE_ARN"
```

- [x] **Step 4: 실행 + 검증**

```bash
bash scripts/setup-gateway.sh          # CREATED ×3 (재실행 시 EXISTS ×3 = 멱등 확인)
aws ssm get-parameter --name /nfm-dashboard/gateway-url --query Parameter.Value --output text
# tools/list 스모크 (SigV4는 Task 13에서 앱 구현 — 여기선 aws CLI 서명 곤란하므로 boto3 원라이너)
python3 - << 'EOF'
import boto3, json
from botocore.awsrequest import AWSRequest
from botocore.auth import SigV4Auth
import urllib.request
url = boto3.client('ssm', region_name='ap-northeast-2').get_parameter(
    Name='/nfm-dashboard/gateway-url')['Parameter']['Value']
body = json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/list"}).encode()
req = AWSRequest(method='POST', url=url, data=body,
    headers={'Content-Type':'application/json'})
SigV4Auth(boto3.Session().get_credentials(), 'bedrock-agentcore', 'ap-northeast-2').add_auth(req)
r = urllib.request.urlopen(urllib.request.Request(url, data=body, headers=dict(req.headers)))
tools = json.loads(r.read())['result']['tools']
print(len(tools), 'tools:', [t['name'] for t in tools][:5])
EOF
# Expected: 27 tools: ['get_path_trace_methodology', ...]
```

- [x] **Step 5: Commit** — `git add infra tools scripts && git commit -m "infra: AgentCore gateway nfm-gateway with 3 lambda MCP targets"`

## Phase 4 — Next.js 앱

### Task 10: Next.js 스캐폴드 + SnowUI 토큰 + i18n + 레이아웃

**Files:**
- Create: `app/package.json`, `app/next.config.mjs`, `app/tailwind.config.ts`, `app/postcss.config.mjs`, `app/tsconfig.json`
- Create: `app/src/app/{layout.tsx,globals.css,page.tsx(placeholder)}`
- Create: `app/src/lib/i18n/LanguageContext.tsx`, `app/src/lib/i18n/translations/{ko,en}.json`
- Create: `app/src/components/layout/{Sidebar,Topbar,MobileTabs}.tsx`
- Test: `app/src/lib/i18n/i18n.test.tsx` (vitest + @testing-library/react)

**Interfaces:**
- Produces: `useLanguage(): { lang: 'ko'|'en'; setLang; t(key: string, params?: Record<string,string|number>): string }`. 번역 키는 flat (`nav.overview`, `kpi.dataTransferred` …). `<AppShell>`(Sidebar+Topbar+MobileTabs 조합)은 `app/src/app/layout.tsx`에서 사용.
- Tailwind 토큰: `colors: { ink:'#1C1C1C', surface:'#F7F9FB', accentBlue:'#E3F5FF', accentLav:'#E5ECF6', accentMint:'#BAEDBD', chartBlue:'#A8C5DA', chartViolet:'#95A4FC', chartSky:'#B1E3FF' }`, `borderRadius: { card:'16px' }`. 다크는 `dark:` variant(`#1C1C1C` 배경).

- [x] **Step 1: 스캐폴드 생성** — `npx create-next-app@latest app --ts --app --tailwind --src-dir --no-eslint --import-alias "@/*"` 후 `output: 'standalone'`을 next.config에 설정. vitest/@testing-library 설치: `npm -w app i -D vitest @testing-library/react @vitejs/plugin-react jsdom`.

- [x] **Step 2: 실패하는 i18n 테스트**

```tsx
// app/src/lib/i18n/i18n.test.tsx
import { it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { LanguageProvider, useLanguage } from './LanguageContext';

it('t() resolves ko/en with params and falls back to key', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    <LanguageProvider>{children}</LanguageProvider>;
  const { result } = renderHook(() => useLanguage(), { wrapper });
  act(() => result.current.setLang('en'));
  expect(result.current.t('nav.overview')).toBe('Overview');
  act(() => result.current.setLang('ko'));
  expect(result.current.t('nav.overview')).toBe('개요');
  expect(result.current.t('common.updatedAgo', { min: 5 })).toContain('5');
  expect(result.current.t('no.such.key')).toBe('no.such.key');
});
```

- [x] **Step 3: 실패 확인** — `npx -w app vitest run` → FAIL

- [x] **Step 4: 구현** — awsops `src/lib/i18n` 패턴:

```tsx
// app/src/lib/i18n/LanguageContext.tsx
'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import ko from './translations/ko.json';
import en from './translations/en.json';

type Lang = 'ko' | 'en';
const dict: Record<Lang, Record<string, string>> = { ko, en };
const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void;
  t: (k: string, p?: Record<string, string | number>) => string } | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ko');
  useEffect(() => {
    const saved = localStorage.getItem('nfm-lang') as Lang | null;
    if (saved === 'ko' || saved === 'en') setLangState(saved);
  }, []);
  const setLang = (l: Lang) => { setLangState(l); localStorage.setItem('nfm-lang', l); };
  const t = (k: string, p?: Record<string, string | number>) => {
    let s = dict[lang][k] ?? k;
    for (const [key, v] of Object.entries(p ?? {})) s = s.replaceAll(`{${key}}`, String(v));
    return s;
  };
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}
export function useLanguage() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLanguage outside provider');
  return v;
}
```
`translations/ko.json`·`en.json` 초기 키: `nav.{overview,topology,flows,paths,insights,diagnose,agents}`, `common.{updatedAgo,loading,error,refresh,collecting}`, `kpi.{dataTransferred,retransmissions,timeouts,rtt,nhi}`, `chat.{title,placeholder,openPopup,send,regenerate}`, `auth.{login,logout}` — 이후 태스크에서 사용하는 모든 문자열 키를 함께 추가.

- **Sidebar.tsx**: SnowUI 스타일 — 로고/타이틀, 7개 nav 항목(`t('nav.*')` + lucide-react 아이콘), 현재 경로 `usePathname()` 매칭 시 `bg-surface rounded-card` pill. `hidden lg:flex w-56 flex-col`.
- **Topbar.tsx**: breadcrumb(현재 페이지명), 우측에 언어 토글(`ko/EN`), 다크 토글(`html.classList.toggle('dark')` + localStorage), 수동 새로고침 버튼.
- **MobileTabs.tsx**: `lg:hidden fixed bottom-0 inset-x-0` + `pb-[env(safe-area-inset-bottom)]`, 5개 핵심 탭(개요/토폴로지/플로우/진단/더보기), 44px 터치 타겟.
- **layout.tsx**: `<LanguageProvider><div className="flex"><Sidebar/><div className="flex-1"><Topbar/><main className="p-4 pb-20 lg:pb-4">{children}</main></div></div><MobileTabs/></LanguageProvider>` + `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`. footer에 `SnowUI (CC BY 4.0) 디자인 참조` attribution 링크.

- [x] **Step 5: 통과 + 렌더 확인** — `npx -w app vitest run` → PASS. `npm -w app run dev` 후 `curl -s localhost:3000 | grep -o '<title>[^<]*'` → 앱 타이틀.
- [x] **Step 6: Commit** — `git add app && git commit -m "feat(app): nextjs scaffold, SnowUI tokens, i18n, responsive shell"`

### Task 11: 인증 (Cognito Hosted UI + middleware)

**Files:**
- Create: `app/src/lib/auth.ts`, `app/middleware.ts`
- Create: `app/src/app/api/auth/login/route.ts`, `app/src/app/api/auth/callback/route.ts`, `app/src/app/api/auth/logout/route.ts`, `app/src/app/login/page.tsx`
- Test: `app/src/lib/auth.test.ts`

**Interfaces:**
- env(런타임): `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_DOMAIN`(https://xxx.auth.ap-northeast-2.amazoncognito.com), `APP_URL`(CloudFront https URL), `ORIGIN_VERIFY_SECRET`.
- Produces: `buildAuthUrls(env)` → `{authorize, token, logout}` URL 생성 순수함수; `verifyIdToken(token): Promise<{email:string}|null>` (aws-jwt-verify CognitoJwtVerifier, tokenUse 'id'); 쿠키명 `nfm_id_token`(httpOnly, Secure, SameSite=Lax, 8h).
- middleware 규칙: (1) `X-Origin-Verify` 헤더가 `ORIGIN_VERIFY_SECRET`과 불일치 시 403 (헬스체크 경로 `/api/health` 제외 — ALB 타겟그룹용), (2) `/login`, `/api/auth/*`, `/_next/*`, `/api/health` 제외 전 경로에서 `nfm_id_token` 쿠키 검증 실패 시 `/login`으로 redirect(API는 401 JSON).

- [x] **Step 1: 실패하는 테스트** — `buildAuthUrls`가 authorize/token/logout URL을 정확히 조립하는지(redirect_uri 인코딩 포함), 쿠키 직렬화 헬퍼 `sessionCookie(token)`이 옵션 포함하는지.

```ts
// app/src/lib/auth.test.ts
import { it, expect } from 'vitest';
import { buildAuthUrls, sessionCookie } from './auth';
const env = { COGNITO_DOMAIN: 'https://d.auth.ap-northeast-2.amazoncognito.com',
  COGNITO_CLIENT_ID: 'cid', APP_URL: 'https://x.cloudfront.net' };
it('authorize URL has code flow params', () => {
  const u = new URL(buildAuthUrls(env).authorize);
  expect(u.searchParams.get('response_type')).toBe('code');
  expect(u.searchParams.get('redirect_uri')).toBe('https://x.cloudfront.net/api/auth/callback');
});
it('session cookie is httpOnly+secure', () => {
  expect(sessionCookie('tok')).toMatch(/HttpOnly/i);
  expect(sessionCookie('tok')).toMatch(/Secure/i);
});
```

- [x] **Step 2: 실패 확인** → FAIL
- [x] **Step 3: 구현** — `auth.ts`(buildAuthUrls/sessionCookie/verifyIdToken), `login/route.ts`(authorize로 302), `callback/route.ts`(code→`${domain}/oauth2/token` POST(fetch, grant_type=authorization_code)→쿠키 설정→`/`로 302), `logout/route.ts`(쿠키 삭제+Cognito logout URL 302), `middleware.ts`(위 규칙 — verifier는 모듈 스코프 캐시), `login/page.tsx`(로그인 버튼 → `/api/auth/login`).
- [x] **Step 4: 통과 확인** — `npx -w app vitest run` → PASS (로컬에선 env 미설정 시 middleware가 인증 스킵하는 `AUTH_DISABLED=1` dev 플래그 지원 — 코드에 명시적 조건 `process.env.AUTH_DISABLED === '1'`)
- [x] **Step 5: Commit** — `git add app && git commit -m "feat(app): cognito hosted-ui auth with jwt middleware and origin verify"`

### Task 12: 데이터 API routes + DDB/CW 클라이언트

**Files:**
- Create: `app/src/lib/ddb.ts`, `app/src/lib/cw-metrics.ts`
- Create: `app/src/app/api/{overview,flows,topology,paths,insights,agents,health}/route.ts`, `app/src/app/api/nfm/refresh/route.ts`
- Test: `app/src/lib/ddb.test.ts` (aws-sdk-client-mock)

**Interfaces:**
- Consumes: DDB 키 설계(파일 구조 맵), Collector가 쓴 `TOPO#latest`/`STATUS#collect`/`COVERAGE#latest` 아이템 shape.
- Produces (`lib/ddb.ts`): `getTopology(): Promise<TopologySnapshot>`, `getCollectionStatus()`, `getCoverage()`, `queryFlowsByBucket(bucket, monitor?)`, `queryPodFlows(ns, pod, limit)`, `queryEdgeSeries(edgeHash, limit)`, `recentBuckets(n): string[]`(현재 시각부터 5분 격자 n개 — Collector bucket 규칙과 동일 수식 `Math.floor(t/300000)*300000`).
- Produces (`lib/cw-metrics.ts`): `getNfmMetrics(minutes=60)` → `AWS/NetworkFlowMonitor` 5지표(DataTransferred/Retransmissions/Timeouts/RoundTripTime/HealthIndicator)를 MonitorName 차원 나열(`ListMetrics`) 후 `GetMetricData`(period 300)로 시계열 반환.
- route 응답 shape:
  - `GET /api/overview` → `{ kpis: {dataTransferred,retransmissions,timeouts,rttAvg,nhi}, series: {...}, status, coverage }`
  - `GET /api/flows?bucket=&monitor=&pod=&ns=&limit=` → `{ flows: FlowEdge[] }` (pod 지정 시 GSI1+GSI2)
  - `GET /api/topology` → `TopologySnapshot`
  - `GET /api/paths?edge=<edgeHash>` → `{ series, latest: FlowEdge }` (GSI3 최신 + 시계열)
  - `GET /api/insights` → `NfmMeta`의 `WI#latest` 조회 → `{ byCategory: Record<DestCategory,{dataTransferred,retransmissions,timeouts}>, rows: WiResult[] }` (아이템 없으면 topology 기반 집계로 폴백)
  - `GET /api/agents` → `{ coverage, status }`
  - `POST /api/nfm/refresh` → Lambda `nfm-dashboard-collector` InvokeCommand(Event) 후 `{ triggered: true }`
  - `GET /api/health` → `{ ok: true }` (인증/origin-verify 제외 경로)

- [x] **Step 1: 실패하는 테스트** — `recentBuckets`가 5분 격자 ISO를 내는지, `queryPodFlows`가 GSI1/GSI2 두 번 쿼리해 병합하는지(mock).
- [x] **Step 2: 실패 확인** → FAIL
- [x] **Step 3: 구현** — 각 route는 `export const dynamic = 'force-dynamic'` + try/catch로 `{error}` 500. `/api/nfm/refresh`만 `@aws-sdk/client-lambda` 사용.
- [x] **Step 4: 통과 확인** — `npx -w app vitest run` → PASS. 로컬 검증: `AUTH_DISABLED=1 npm -w app run dev` 후 `curl -s localhost:3000/api/topology | head -c 200` (배포된 DDB에 대해 — EC2 개발 호스트의 IAM으로 접근 가능).
- [x] **Step 5: Commit** — `git add app && git commit -m "feat(app): data api routes over dynamodb and cloudwatch"`

### Task 13: MCP 클라이언트(SigV4) + `/api/ai` 에이전트 루프 SSE

**Files:**
- Create: `app/src/lib/mcp-client.ts`, `app/src/lib/bedrock.ts`, `app/src/lib/sse.ts`
- Create: `app/src/app/api/ai/route.ts`
- Test: `app/src/lib/mcp-client.test.ts`, `app/src/lib/sse.test.ts`

**Interfaces:**
- `lib/mcp-client.ts` (awsops `streamable_http_sigv4.py`의 TS 상응):
  - `mcpCall(url, method: 'tools/list'|'tools/call', params?): Promise<any>` — JSON-RPC 2.0 POST + `@smithy/signature-v4`(service `bedrock-agentcore`, region ap-northeast-2) 서명, `@aws-sdk/credential-provider-node` 자격증명. 응답 `result` 반환, `error`면 throw.
  - `listTools(url)` → MCP tool[] (5분 모듈 캐시); `callTool(url, name, args)` → 텍스트 결과(`content[0].text`).
  - `toBedrockTools(mcpTools)` → Bedrock `toolConfig.tools[]` (`{toolSpec:{name,description,inputSchema:{json:inputSchema}}}`). Gateway 도구명은 `target-name___tool_name` 형식일 수 있음 — 이름 그대로 사용(변형 금지, Bedrock name 제약 `[a-zA-Z0-9_-]{1,64}`에 맞게 `___` 유지, 64자 초과 시 잘라내되 map으로 원명 복원).
- `lib/bedrock.ts`: `bedrock`(BedrockRuntimeClient 싱글턴) export + `MODEL_ID='global.anthropic.claude-sonnet-5'`, `FALLBACK_MODEL_ID='global.anthropic.claude-sonnet-4-5-20250929-v1:0'`. `/api/ai`는 `bedrock.send(new ConverseStreamCommand(...))` 직접 사용. 모델 미가용 오류 시 1회 FALLBACK 재시도 헬퍼 `sendConverseStream(params)`도 export(`/api/diagnose`에서 사용).
- `lib/sse.ts`: `sseEvent(event,data): string`(`event: X\ndata: {...}\n\n`), `simulateStreaming(text, emit, chunkSize=50, delayMs=15)`, `keepalive(controller, intervalMs=15000)` 타이머 헬퍼.
- `/api/ai` POST body: `{ messages: {role:'user'|'assistant', content:string}[], lang: 'ko'|'en' }`. 에이전트 루프 최대 8회, 시스템 프롬프트: NFM 운영 어시스턴트 페르소나 + 도구 사용 지침 + 응답 언어 지시(lang). SSE `status`(`connecting/tool:<name>/thinking`)→`chunk`→`done`. Gateway 불가 시 도구 없이 Bedrock 직접(폴백) + `status:fallback`.

- [x] **Step 1: 실패하는 테스트**

```ts
// app/src/lib/sse.test.ts
import { it, expect, vi } from 'vitest';
import { sseEvent, simulateStreaming } from './sse';
it('sseEvent formats event frame', () => {
  expect(sseEvent('chunk', { delta: 'hi' })).toBe('event: chunk\ndata: {"delta":"hi"}\n\n');
});
it('simulateStreaming emits 50-char chunks', async () => {
  vi.useFakeTimers();
  const chunks: string[] = [];
  const p = simulateStreaming('a'.repeat(120), d => chunks.push(d), 50, 15);
  await vi.runAllTimersAsync(); await p;
  expect(chunks.map(c => c.length)).toEqual([50, 50, 20]);
});
```
```ts
// app/src/lib/mcp-client.test.ts
import { it, expect } from 'vitest';
import { toBedrockTools } from './mcp-client';
it('maps MCP tools to Bedrock toolSpec', () => {
  const out = toBedrockTools([{ name: 'ddb-mcp-target___get_top_talkers',
    description: 'top talkers', inputSchema: { type: 'object', properties: {} } }]);
  expect(out[0].toolSpec.name).toBe('ddb-mcp-target___get_top_talkers');
  expect(out[0].toolSpec.inputSchema.json).toEqual({ type: 'object', properties: {} });
});
```

- [x] **Step 2: 실패 확인** → FAIL
- [x] **Step 3: 구현** — `/api/ai` 루프 핵심(전문):

```ts
// app/src/app/api/ai/route.ts
import { NextRequest } from 'next/server';
import { ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrock, MODEL_ID } from '@/lib/bedrock';
import { listTools, callTool, toBedrockTools } from '@/lib/mcp-client';
import { sseEvent } from '@/lib/sse';
import { getParam } from '@/lib/ssm';   // /nfm-dashboard/gateway-url 캐시 조회 (lib/ssm.ts 동일 태스크에서 생성)

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { messages, lang = 'ko' } = await req.json();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: string, d: unknown) => controller.enqueue(encoder.encode(sseEvent(e, d)));
      const ka = setInterval(() => send('status', { stage: 'keepalive' }), 15000);
      const t0 = Date.now(); const usedTools: string[] = [];
      try {
        send('status', { stage: 'connecting' });
        const gatewayUrl = await getParam('/nfm-dashboard/gateway-url');
        let tools: ReturnType<typeof toBedrockTools> = [];
        try { tools = toBedrockTools(await listTools(gatewayUrl)); }
        catch { send('status', { stage: 'fallback' }); }
        const system = [{ text: `You are an AWS network operations assistant for an NFM (Network Flow Monitor) dashboard. Use tools to inspect flows, pods, paths and AWS network resources. Answer in ${lang === 'ko' ? 'Korean' : 'English'}. Cite concrete values from tool results.` }];
        const convo = messages.map((m: { role: string; content: string }) =>
          ({ role: m.role, content: [{ text: m.content }] }));
        let full = '';
        for (let turn = 0; turn < 8; turn++) {
          const res = await bedrock.send(new ConverseStreamCommand({ modelId: MODEL_ID,
            system, messages: convo,
            ...(tools.length ? { toolConfig: { tools } } : {}) }));
          const toolUses: { toolUseId: string; name: string; input: string }[] = [];
          let stopReason = ''; let text = '';
          for await (const ev of res.stream!) {
            if (ev.contentBlockStart?.start?.toolUse) {
              const t = ev.contentBlockStart.start.toolUse;
              toolUses.push({ toolUseId: t.toolUseId!, name: t.name!, input: '' });
            } else if (ev.contentBlockDelta?.delta?.text) {
              text += ev.contentBlockDelta.delta.text;
              send('chunk', { delta: ev.contentBlockDelta.delta.text });
            } else if (ev.contentBlockDelta?.delta?.toolUse?.input) {
              toolUses[toolUses.length - 1].input += ev.contentBlockDelta.delta.toolUse.input;
            } else if (ev.messageStop) stopReason = ev.messageStop.stopReason ?? '';
          }
          full += text;
          if (stopReason !== 'tool_use') break;
          const assistantContent: unknown[] = [];
          if (text) assistantContent.push({ text });
          for (const tu of toolUses) assistantContent.push({ toolUse: { toolUseId: tu.toolUseId,
            name: tu.name, input: JSON.parse(tu.input || '{}') } });
          convo.push({ role: 'assistant', content: assistantContent });
          const results: unknown[] = [];
          for (const tu of toolUses) {
            usedTools.push(tu.name);
            send('status', { stage: `tool:${tu.name}` });
            let out: string;
            try { out = await callTool(gatewayUrl, tu.name, JSON.parse(tu.input || '{}')); }
            catch (e) { out = `tool error: ${(e as Error).message}`; }
            results.push({ toolResult: { toolUseId: tu.toolUseId,
              content: [{ text: out.slice(0, 40000) }] } });
          }
          convo.push({ role: 'user', content: results });
        }
        send('done', { content: full, usedTools, elapsedMs: Date.now() - t0, model: MODEL_ID });
      } catch (e) {
        send('error', { message: (e as Error).message });
      } finally { clearInterval(ka); controller.close(); }
    } });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
}
```

- [x] **Step 4: 통과 + 실호출 확인** — `npx -w app vitest run` → PASS. 실검증(Gateway/Bedrock 실계정):
  `AUTH_DISABLED=1 npm -w app run dev` 후
  `curl -N -s localhost:3000/api/ai -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"현재 top talker pod 3개 알려줘"}]}' | head -40`
  Expected: `event: status` → `event: chunk`(토큰) → `event: done` (usedTools에 `get_top_talkers` 계열 포함). **Sonnet 5 첫 실호출 검증 지점** — 실패 시 bedrock.ts 폴백 로그 확인.
- [x] **Step 5: Commit** — `git add app && git commit -m "feat(app): sigv4 mcp client and streaming agent loop /api/ai"`

### Task 14: `/api/diagnose` (진단 SSE + regenerate)

**Files:**
- Create: `app/src/app/api/diagnose/route.ts`
- Test: `app/src/lib/diagnose-context.test.ts` + Create: `app/src/lib/diagnose-context.ts`

**Interfaces:**
- `buildDiagnoseContext(topology, status, anomalies): string` — 시스템 프롬프트에 주입할 컨텍스트 텍스트: 토폴로지 요약(노드/엣지 수, 클러스터별), 재전송·타임아웃 상위 20 엣지(파드쌍/값/카테고리), 수집 상태. 순수 함수.
- POST body: `{ focus?: string, lang: 'ko'|'en', regenerate?: boolean }` — regenerate여도 동일 경로(컨텍스트 재조회 + converseStream 재실행, 프롬프트에 "이전과 다른 관점으로" 지시 추가).
- 도구 미사용. `ConverseStreamCommand` contentBlockDelta → 즉시 `chunk` (Task 13의 sse.ts 재사용).

- [x] **Step 1: 실패하는 테스트** — anomalies 상위 20 트림·정렬, 빈 토폴로지 시 "수집 준비 중" 문구 포함 여부.
- [x] **Step 2: 실패 확인** → FAIL
- [x] **Step 3: 구현** — `diagnose-context.ts`(순수) + route(ddb.ts로 topology/status 조회 → anomalies는 RETRANSMISSIONS/TIMEOUTS 합 내림차순 상위 20 → converseStream → SSE).
- [x] **Step 4: 통과 + 실호출 확인** — vitest PASS + `curl -N localhost:3000/api/diagnose -d '{"lang":"ko"}' ...` → 진단 텍스트 스트리밍.
- [x] **Step 5: Commit** — `git add app && git commit -m "feat(app): llm diagnose route with context injection and regenerate"`

### Task 15: UI 페이지 6종 (overview/topology/flows/paths/insights/agents)

**Files:**
- Create: `app/src/components/cards/{KpiCard,StatusBadge}.tsx`, `app/src/components/charts/{TimeSeries,CategoryBars,CategoryDonut}.tsx`(recharts), `app/src/components/FlowTable.tsx`, `app/src/components/PathView.tsx`
- Create/Modify: `app/src/app/page.tsx`, `app/src/app/{topology,flows,paths,insights,agents}/page.tsx`
- 의존성: `npm -w app i recharts reactflow lucide-react`

**Interfaces:**
- Consumes: Task 12 API 응답 shape 그대로 (`fetch('/api/...')` + SWR 없이 `useEffect`+30초 폴링 훅 `usePolling(url, ms=30000)` — `app/src/lib/use-polling.ts`로 생성).
- 페이지별 요구:
  - `/`(overview): KpiCard 4장(값+단위 포맷 `formatBytes/formatCount/formatMicros` — `app/src/lib/format.ts`) + NHI StatusBadge + TimeSeries(DataTransferred) + 수집 상태 카드(성공/실패/스로틀, 마지막 사이클 시각) + 커버리지 요약. 데이터 없으면 `t('common.collecting')` 안내(에이전트 설치 후 ~20분).
  - `/topology`: React Flow — 노드 kind별 스타일(pod=accentBlue, node=accentLav, external=surface+점선), 클러스터/네임스페이스/카테고리 필터(topology.nodes에서 유니크 추출), 엣지 두께 `log(dataTransferred)` 스케일, 엣지 클릭 → 우측 패널(모바일: 하단 시트)에 메트릭+`/paths?edge=` 링크. 레이아웃은 `dagre` 자동 배치(`npm -w app i dagre @types/dagre`).
  - `/flows`: FlowTable — bucket 선택(최근 12개), 모니터/ns/pod 필터, 정렬(값 desc), 행 클릭 drawer(양단 상세+traversedConstructs). 모바일에선 카드 리스트로 전환(`hidden md:table` + 카드 뷰).
  - `/paths`: pod 쌍 선택(토폴로지에서 pod 목록) → `/api/paths` → PathView: `[pod A] → [node] → [subnet/AZ] → (traversedConstructs 아이콘 체인) → [subnet/AZ] → [node] → [pod B]` 가로 스테퍼(모바일 세로) + SNAT/DNAT/포트 배지 + 메트릭 시계열.
  - `/insights`: CategoryBars(카테고리별 3메트릭) + CategoryDonut(카테고리 분포).
  - `/agents`: 커버리지 테이블 — standalone(instanceId/tagged/policyAttached) + eksNodeCount, 마지막 수집 통계.
- 모든 문자열 `t()` 경유. dataviz 스킬의 접근성 규칙(색+형태 이중 부호화, 다크 대응)을 차트 컴포넌트에 적용.

- [x] **Step 1: format 유틸 실패 테스트** — `formatBytes(1536)='1.5 KB'`, `formatMicros(1500)='1.5 ms'` 등 (`app/src/lib/format.test.ts`).
- [x] **Step 2: 실패 확인** → FAIL / **Step 3: format.ts 구현 + 통과**
- [x] **Step 4: 컴포넌트/페이지 구현** — 위 Interfaces 명세 전부. dev 서버에서 6페이지 각각 콘솔 에러 0 확인.
- [x] **Step 5: Commit** — `git add app && git commit -m "feat(app): dashboard pages (overview, topology, flows, paths, insights, agents)"`

### Task 16: 챗 UI — FloatingChat + 팝업 분기 + `/diagnose` 페이지

**Files:**
- Create: `app/src/lib/ua.ts`, `app/src/lib/use-sse.ts`, `app/src/components/Markdown.tsx`
- Create: `app/src/components/chat/{FloatingChat,ChatPanel}.tsx`, `app/src/app/chat-popup/page.tsx`, `app/src/app/diagnose/page.tsx`
- 의존성: `npm -w app i react-markdown remark-gfm`
- Test: `app/src/lib/ua.test.ts`, `app/src/lib/use-sse.test.ts`

**Interfaces:**
- `ua.ts`: `chatOpenMode(userAgent: string): 'iframe-modal'|'popup'|'mobile-sheet'` — 규칙: 모바일(iPhone|iPad|Android) → `mobile-sheet`; Firefox( `Firefox/` 포함, `Seamonkey` 제외) → `popup`; Chrome/기타 데스크톱 → `iframe-modal` (Chrome은 Site Engagement Score 낮으면 popup이 탭으로 열리므로 iframe이 기본).
- `use-sse.ts`: `sendSse(url, body, handlers: {onStatus,onChunk,onDone,onError})` — `fetch` POST + `res.body.getReader()` + TextDecoder 수동 파싱(`event:`/`data:` 라인, `\n\n` 프레임 분리, 불완전 프레임 버퍼링). EventSource 미사용(POST body 필요).
- `ChatPanel`: 메시지 목록(user/assistant, assistant는 `<Markdown>`), status 배지(도구 호출명 표시), 입력창+전송, 대화 이력 state는 sessionStorage `nfm-chat` 동기화(팝업/iframe과 공유). props `{ compact?: boolean }`.
- `FloatingChat`: 우하단 FAB(56px) → 인라인 패널(모바일 풀스크린 시트: `fixed inset-0`, 데스크톱 `w-96 h-[32rem]` 카드). 헤더에 "팝업으로 열기" 버튼 → `chatOpenMode(navigator.userAgent)` 분기: `popup` → `window.open('/chat-popup','nfmchat','width=420,height=640,noopener')` 후 `window.closed` 체크 실패 시 iframe 폴백; `iframe-modal` → 오버레이 모달에 `<iframe src="/chat-popup">`; `mobile-sheet` → 인라인 풀스크린 유지.
- `/chat-popup`: AppShell 없는 독립 레이아웃, `<ChatPanel compact/>`.
- `/diagnose` 페이지: "진단 실행" 버튼 → `/api/diagnose` SSE → `<Markdown>` 점진 렌더 + **Regenerate** 버튼(`{regenerate:true}` 재호출), 응답 메타(모델/시간) 표시.
- `Markdown.tsx`: `react-markdown` v10 + `remark-gfm`, 테이블/코드 SnowUI 스타일(카드 배경, overflow-x-auto).

- [x] **Step 1: 실패하는 테스트**

```ts
// app/src/lib/ua.test.ts
import { it, expect } from 'vitest';
import { chatOpenMode } from './ua';
const FF = 'Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/128.0';
const CH = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1';
it('firefox → popup', () => expect(chatOpenMode(FF)).toBe('popup'));
it('chrome → iframe-modal', () => expect(chatOpenMode(CH)).toBe('iframe-modal'));
it('iphone → mobile-sheet', () => expect(chatOpenMode(IOS)).toBe('mobile-sheet'));
```
`use-sse.test.ts`: ReadableStream mock으로 `event: chunk\ndata: {"delta":"a"}\n\n` 프레임 2개 분할 전송(프레임 경계가 청크 중간에 오는 케이스 포함) → onChunk 2회 호출 검증.

- [x] **Step 2: 실패 확인** → FAIL / **Step 3: 구현** / **Step 4: 통과 + dev 수동 확인**(Chrome iframe, 모바일 뷰포트 시트)
- [x] **Step 5: Commit** — `git add app && git commit -m "feat(app): floating chat with popup strategy, diagnose page, markdown"`

### Task 17: 모바일 반응형 마감 + 접근성 점검

**Files:**
- Modify: Task 10~16의 페이지/컴포넌트 (브레이크포인트 보정)

- [x] **Step 1: 점검 목록 실행** — dev 서버에서 뷰포트 390×844(iPhone) 기준: (1) 가로 스크롤 없는지(각 페이지), (2) MobileTabs가 컨텐츠 가리지 않는지(`pb-20`), (3) FlowTable→카드 전환, (4) topology 터치 팬/줌(`reactflow` 기본 + `panOnDrag`), (5) PathView 세로 스테퍼, (6) FloatingChat 풀스크린 시트 + `env(safe-area-inset-bottom)`, (7) 다크 모드 각 페이지 대비.
- [x] **Step 2: 발견 이슈 수정 + 커밋** — `git commit -m "fix(app): mobile responsive polish (iPhone web)"`

## Phase 5 — 배포 & 검증

### Task 18: AppStack (ECR/ECS/ALB/CloudFront/Cognito) + 이미지 배포

**Files:**
- Create: `app/Dockerfile`, `scripts/save-cognito-secret.sh`, `scripts/build-push.sh`
- Create: `infra/lib/app-stack.ts`
- Modify: `infra/bin/nfm-dashboard.ts`
- Test: `infra/test/app-stack.test.ts`

**Interfaces:**
- Consumes: 기존 VPC `vpc-0dfa5610180dfa628`(fromLookup), prefix list `pl-22a6434b`, Secrets Manager `nfm-dashboard/cognito-admin`(사전 생성), SSM `/nfm-dashboard/gateway-url`.
- Produces: CloudFront URL(Output `AppUrl`), Cognito UserPool/Client/도메인, ECS 서비스 `nfm-dashboard-app`.
- Task Role 권한: `bedrock:InvokeModelWithResponseStream`+`bedrock:InvokeModel`(리소스 `*` — global 프로파일은 다중 리전 기반 모델 ARN 필요), `bedrock-agentcore:InvokeGateway`(`*`), DDB R/W(두 테이블+인덱스), `lambda:InvokeFunction`(collector), `cloudwatch:GetMetricData/ListMetrics`, `ssm:GetParameter`(`/nfm-dashboard/*`).

- [x] **Step 1: Dockerfile (arm64, standalone)**

```dockerfile
# app/Dockerfile
FROM public.ecr.aws/docker/library/node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY app/package.json app/
RUN npm ci --workspace app

FROM public.ecr.aws/docker/library/node:22-alpine AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY tsconfig.base.json package.json ./
COPY app ./app
COPY collector/src/types.ts ./collector/src/types.ts
RUN cd app && npx next build

FROM public.ecr.aws/docker/library/node:22-alpine
WORKDIR /srv
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/app/.next/standalone ./
COPY --from=build /repo/app/.next/static ./app/.next/static
COPY --from=build /repo/app/public ./app/public
EXPOSE 3000
CMD ["node", "app/server.js"]
```

- [x] **Step 2: 시크릿/빌드 스크립트**

```bash
# scripts/save-cognito-secret.sh
#!/usr/bin/env bash
set -euo pipefail
read -rsp "Cognito admin 초기 비밀번호 입력: " PW; echo
aws secretsmanager create-secret --name nfm-dashboard/cognito-admin \
  --secret-string "{\"email\":\"admin@whchoi.net\",\"password\":\"$PW\"}" 2>/dev/null || \
aws secretsmanager put-secret-value --secret-id nfm-dashboard/cognito-admin \
  --secret-string "{\"email\":\"admin@whchoi.net\",\"password\":\"$PW\"}"
echo "saved."
```
```bash
# scripts/build-push.sh
#!/usr/bin/env bash
set -euo pipefail
ACCOUNT=<ACCOUNT_ID>; REGION=ap-northeast-2; REPO=nfm-dashboard-app
TAG=${1:-latest}
aws ecr describe-repositories --repository-names $REPO >/dev/null 2>&1 || \
  aws ecr create-repository --repository-name $REPO >/dev/null
aws ecr get-login-password | docker login --username AWS --password-stdin \
  $ACCOUNT.dkr.ecr.$REGION.amazonaws.com
docker build --platform linux/arm64 -f app/Dockerfile -t $REPO:$TAG .
docker tag $REPO:$TAG $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG
docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG
```

- [x] **Step 3: 실패하는 assertions 테스트** — ALB SG ingress가 prefix list `pl-22a6434b`인지, TaskDefinition `RuntimePlatform.CpuArchitecture=ARM64`인지, CloudFront `/api/*` 비캐시 behavior 존재.

- [x] **Step 4: AppStack 구현** — 핵심 골격:

```ts
// infra/lib/app-stack.ts (골격 — 이 태스크에서 전부 완성)
// 1) Vpc.fromLookup(vpcId='vpc-0dfa5610180dfa628')
// 2) Cognito: UserPool(selfSignUp off) + Domain(prefix 'nfm-dashboard-<ACCOUNT_ID>')
//    + UserPoolClient(OAuth code flow, callback `${appUrl}/api/auth/callback`, logout `${appUrl}/login`)
//    — appUrl 순환 참조 회피: CloudFront 생성 후 UserPoolClient는 CfnUserPoolClient로 콜백 URL 지정
//    + AwsCustomResource: AdminCreateUser(MessageAction=SUPPRESS) → AdminSetUserPassword(Permanent)
//      비밀번호는 SecretValue가 아닌 커스텀리소스 Lambda 내부에서 secretsmanager GetSecretValue로 조회
// 3) ALB SG: ingress 80 from Peer.prefixList('pl-22a6434b') only. App SG: from ALB SG:3000.
// 4) FargateService: TaskDef(arm64, 1vCPU/2GB), 컨테이너 env:
//    COGNITO_*, APP_URL, ORIGIN_VERIFY_SECRET(cdk에서 crypto.randomUUID()로 생성해 CF와 공유),
//    TABLE_FLOWS/TABLE_META, desiredCount 1, healthCheck '/api/health',
//    ApplicationTargetGroup(deregistration 10s, healthcheck path /api/health)
// 5) CloudFront: ALB HTTP origin + customHeaders {'X-Origin-Verify': secret},
//    defaultBehavior: CachePolicy.CACHING_DISABLED + OriginRequestPolicy.ALL_VIEWER,
//    additionalBehaviors { '/_next/static/*': CACHING_OPTIMIZED },
//    (SSE는 CACHING_DISABLED behavior로 버퍼링 회피)
// 6) Task Role 권한: Interfaces 목록 그대로
// 7) Outputs: AppUrl, UserPoolId, ClientId, CognitoDomain
```

- [x] **Step 5: 배포 시퀀스**

```bash
bash scripts/save-cognito-secret.sh          # 1회 (사용자 제공 비밀번호 입력)
bash scripts/build-push.sh latest
npx -w infra cdk deploy NfmDash-App --require-approval never
# Expected: Outputs: AppUrl=https://dxxxx.cloudfront.net ...
```
검증: `curl -s -o /dev/null -w '%{http_code}' https://<AppUrl>/api/health` → 200,
브라우저에서 AppUrl → `/login` redirect → Cognito Hosted UI 로그인(admin@whchoi.net) → 대시보드.
ALB DNS 직접 호출 → 403 (origin verify).

- [x] **Step 6: Commit** — `git add infra app scripts && git commit -m "infra: AppStack (ECS/ALB/CloudFront/Cognito) and image pipeline"`

### Task 19: 운영 알람 + E2E 스모크

**Files:**
- Create: `infra/lib/ops-alarms.ts` (DataStack에 통합해도 무방 — Collector Errors≥1 3회, ECS RunningTaskCount<1, ALB 5xx>10/5min 알람)
- Create: `e2e/playwright.config.ts`, `e2e/smoke.spec.ts`, `scripts/smoke.sh`

**Interfaces:**
- Playwright env: `APP_URL`, `E2E_EMAIL=admin@whchoi.net`, `E2E_PASSWORD`(환경변수로만 — Secrets Manager에서 `aws secretsmanager get-secret-value`로 주입).

- [x] **Step 1: 스모크 시나리오 작성**

```ts
// e2e/smoke.spec.ts
import { test, expect } from '@playwright/test';

test('login → overview KPIs render', async ({ page }) => {
  await page.goto(process.env.APP_URL!);
  await page.fill('input[name="username"]', process.env.E2E_EMAIL!);   // Cognito Hosted UI
  await page.fill('input[name="password"]', process.env.E2E_PASSWORD!);
  await page.click('input[type="submit"], button[type="submit"]');
  await expect(page.getByTestId('kpi-dataTransferred')).toBeVisible({ timeout: 20000 });
});

test('chat SSE streams tokens', async ({ page }) => {
  await page.goto(process.env.APP_URL!);                 // storageState 재사용 설정
  await page.getByTestId('floating-chat-fab').click();
  await page.getByTestId('chat-input').fill('top talker pod?');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-assistant-msg').last()).toContainText(/\w/, { timeout: 60000 });
});

test('iphone viewport has no horizontal scroll', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(process.env.APP_URL!);                 // 인증 storageState 재사용
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
```
(로그인 상태 공유: 첫 테스트에서 `page.context().storageState({path:'e2e/.auth.json'})` 저장, config `use.storageState`로 재사용. KPI/챗 요소에 `data-testid`를 Task 15/16 컴포넌트에 추가하는 수정 포함.)

- [x] **Step 2: 실행** — `APP_URL=... E2E_PASSWORD=$(aws secretsmanager get-secret-value --secret-id nfm-dashboard/cognito-admin --query SecretString --output text | jq -r .password) npx playwright test` → 3 passed. 수집 20분 경과 전이면 KPI가 `collecting` 상태 — 테스트는 KPI 카드 렌더 자체를 검증하므로 통과 가능해야 함(빈 값도 카드 표시).
- [x] **Step 3: 알람 배포 + Commit** — `git commit -m "test: e2e smoke + ops alarms"`

### Task 20: 문서/마감

**Files:**
- Create: `README.md` — 아키텍처 다이어그램(ASCII), 배포 순서(스펙 12절), env 표, 스크립트 사용법, SnowUI attribution(CC BY 4.0 링크), awsops 참조 명시.
- Modify: `docs/superpowers/plans/2026-07-08-nfm-dashboard.md` 체크박스 최종 상태.

- [x] **Step 1: README 작성** (영/한 병기 섹션 헤더)
- [x] **Step 2: 전체 테스트 일괄 실행** — `npm test`(collector) + `npx -w infra vitest run` + `npx -w app vitest run` + `cd tools && python3 -m pytest -q` + `cd onboarding && python3 -m pytest -q` → 전부 PASS
- [x] **Step 3: Commit** — `git add -A && git commit -m "docs: README with deployment guide and attribution"`

## 실행 순서 요약 (재배포 시에도 이 순서)

1. Task 1~5 (로컬 코드) → 6 (Data 배포) → 7 (온보딩 배포, **이후 ~20분 데이터 대기**) → 8 → 9 (Gateway) → 10~17 (앱) → 18 (App 배포) → 19 (검증) → 20 (문서)
2. NFM 에이전트 데이터는 Task 7 직후부터 쌓이기 시작하므로, 앱 개발(10~17) 동안 자연히 실데이터가 준비됨.
