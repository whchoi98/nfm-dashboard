# Infrastructure as Code / IaC 구현 상세

[![English](https://img.shields.io/badge/Language-English-blue)](#english)
[![한국어](https://img.shields.io/badge/Language-한국어-red)](#korean)

<a id="english"></a>
## English

### 1. Overview
All AWS resources are defined in the `infra` workspace with AWS CDK v2 (TypeScript): six stacks instantiated in `bin/nfm-dashboard.ts`, env pinned to account `<ACCOUNT_ID>` / `ap-northeast-2`.

### 2. Components
| Component | Path | Purpose |
|---|---|---|
| CDK app entry | `infra/bin/nfm-dashboard.ts` | Instantiates the 6 stacks; `NfmDash-Ops` consumes `alb`/`targetGroup` from AppStack |
| Data stack | `infra/lib/data-stack.ts` | `NfmDash-Data`: DynamoDB tables + collector Lambda + schedule + flow-archive pipeline (DDB Streams → transform Lambda → Firehose Parquet → S3 + Glue/Athena) |
| Onboarding stack | `infra/lib/nfm-onboarding-stack.ts` | `NfmDash-Onboarding`: NFM monitor onboarding resources |
| AgentCore stack | `infra/lib/agentcore-stack.ts` | `NfmDash-AgentCore`: MCP tool Lambdas (Python 3.13, arm64) + gateway IAM role |
| App stack | `infra/lib/app-stack.ts` | `NfmDash-App`: Fargate + ALB + CloudFront + Cognito runtime |
| Ops stack | `infra/lib/ops-alarms.ts` | `NfmDash-Ops`: CloudWatch alarms |
| DNS stack | `infra/lib/dns-stack.ts` | `NfmDash-Dns`: DNS resources |
| Config / tests | `infra/cdk.json`, `infra/cdk.context.json`, `infra/test/` | CDK config, cached context, stack tests (vitest) |

### 3. Key Decisions
<!-- TODO: list 3-5 decisions or link to docs/decisions/ADR-*.md -->
- Flow archive infra co-located in `NfmDash-Data` (not a separate stack): enabling the DynamoDB stream mutates the `Flows` Table construct and `grantStreamRead`/`DynamoEventSource` need the L2 object in-scope, so this avoids a cross-stack stream-ARN export. Fixed resource names let `NfmDash-App` reference them by ARN.
- Firehose Parquet conversion, Glue catalog, and Athena workgroup use **L1 `Cfn*`** constructs — the stable L2 `DeliveryStream` does not expose `DataFormatConversionConfiguration`, and Glue/Athena have no L2 in `aws-cdk-lib` (alpha not installed). Glue table columns MUST match the transform Lambda's `FlatFlowRow` exactly or Firehose routes records to the `errors/` prefix.

### 4. Code Pointers
<!-- TODO: 3-7 entries; paths must be valid (checked by /sync-docs) -->
- `infra/bin/nfm-dashboard.ts` — single source of truth for stack names, ordering, and the pinned env
- Deploy: `cd infra && npx cdk deploy <Stack> --require-approval never -c imageTag=<sha>` — EVERY cdk command needs `-c imageTag` (non-App stacks: `-c imageTag=unused`); root `package.json` script `deploy:data` builds the collector first
- `infra/lib/app-stack.ts` — the only stack consuming `imageTag`; read its header comment before changing resource ordering

### 5. Cross-references
<!-- TODO -->
- Related modules: `infra/CLAUDE.md`
- Related ADRs:
- Related runbooks:

<a id="korean"></a>
## 한국어

### 1. 개요
모든 AWS 리소스는 `infra` 워크스페이스에서 AWS CDK v2(TypeScript)로 정의된다. `bin/nfm-dashboard.ts`에서 6개 스택을 생성하며, env는 계정 `<ACCOUNT_ID>` / `ap-northeast-2`로 고정.

### 2. 구성요소
| 구성요소 | 경로 | 목적 |
|---|---|---|
| CDK 앱 엔트리 | `infra/bin/nfm-dashboard.ts` | 6개 스택 생성; `NfmDash-Ops`는 AppStack의 `alb`/`targetGroup` 사용 |
| Data 스택 | `infra/lib/data-stack.ts` | `NfmDash-Data`: DynamoDB 테이블 + collector Lambda + 스케줄 + flow 아카이브 파이프라인(DDB Streams → transform Lambda → Firehose Parquet → S3 + Glue/Athena) |
| Onboarding 스택 | `infra/lib/nfm-onboarding-stack.ts` | `NfmDash-Onboarding`: NFM 모니터 온보딩 리소스 |
| AgentCore 스택 | `infra/lib/agentcore-stack.ts` | `NfmDash-AgentCore`: MCP 툴 Lambda(Python 3.13, arm64) + 게이트웨이 IAM 롤 |
| App 스택 | `infra/lib/app-stack.ts` | `NfmDash-App`: Fargate + ALB + CloudFront + Cognito 런타임 |
| Ops 스택 | `infra/lib/ops-alarms.ts` | `NfmDash-Ops`: CloudWatch 알람 |
| DNS 스택 | `infra/lib/dns-stack.ts` | `NfmDash-Dns`: DNS 리소스 |
| 설정/테스트 | `infra/cdk.json`, `infra/cdk.context.json`, `infra/test/` | CDK 설정, 컨텍스트 캐시, 스택 테스트(vitest) |

### 3. 주요 결정
<!-- TODO: 3-5개 결정 나열 또는 docs/decisions/ADR-*.md 링크 -->
- flow 아카이브 인프라는 `NfmDash-Data`에 함께 배치(별도 스택 아님): DynamoDB 스트림 활성화는 `Flows` 테이블 construct를 변경하고 `grantStreamRead`/`DynamoEventSource`가 L2 객체를 필요로 하므로, 크로스 스택 stream-ARN export를 피한다. 고정 리소스 이름으로 `NfmDash-App`이 ARN으로 참조한다.
- Firehose Parquet 변환·Glue 카탈로그·Athena 워크그룹은 **L1 `Cfn*`** construct 사용 — 안정 L2 `DeliveryStream`은 `DataFormatConversionConfiguration`을 노출하지 않고, Glue/Athena는 `aws-cdk-lib`에 L2가 없다(alpha 미설치). Glue 테이블 컬럼은 transform Lambda의 `FlatFlowRow`와 정확히 일치해야 하며, 어긋나면 Firehose가 레코드를 `errors/` 프리픽스로 보낸다.

### 4. 코드 포인터
<!-- TODO: 3-7개 항목; 경로는 실재해야 함 (/sync-docs가 점검) -->
- `infra/bin/nfm-dashboard.ts` — 스택 이름·순서·고정 env의 단일 소스
- 배포: `cd infra && npx cdk deploy <Stack> --require-approval never -c imageTag=<sha>` — 모든 cdk 명령에 `-c imageTag` 필수(비-App 스택은 `-c imageTag=unused`); 루트 `package.json`의 `deploy:data`는 collector 빌드를 선행
- `infra/lib/app-stack.ts` — `imageTag`를 소비하는 유일한 스택; 리소스 순서 변경 전 헤더 주석 필독

### 5. 상호 참조
<!-- TODO -->
- 관련 모듈: `infra/CLAUDE.md`
- 관련 ADR:
- 관련 런북:
