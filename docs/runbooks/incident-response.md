# Runbook: Incident Response (Ops Alarms)

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Overview
How to receive and respond to the operational CloudWatch alarms defined by the
`NfmDash-Ops` stack (`infra/lib/ops-alarms.ts`) for the live NFM Dashboard
(https://dv4r4bnlhlpcx.cloudfront.net, AWS account `<ACCOUNT_ID>`, region
`ap-northeast-2`). The stack creates three alarms, all wired to a single SNS
topic (`nfm-dashboard-alarms`) on both `ALARM` and `OK`:

| Alarm name | Metric | Condition |
| --- | --- | --- |
| `nfm-dashboard-collector-errors` | `AWS/Lambda` `Errors` (Sum), dim `FunctionName=nfm-dashboard-collector` | `>= 1` for **3** consecutive 5-min periods |
| `nfm-dashboard-alb-no-healthy-hosts` | target group `HealthyHostCount` (Minimum) | `< 1` for **3** consecutive 1-min periods |
| `nfm-dashboard-alb-5xx` | ALB `HTTPCode_ELB_5XX_Count` (Sum) | `> 10` in **1** 5-min period |

> The topic has **no subscriptions created in code** — the stack only emits the
> `AlarmTopicArn` output. An operator MUST subscribe out-of-band (below), or
> alarms will fire silently.

## When to Use
- Setting up alarm notifications for the first time (subscribe to the SNS topic).
- An alarm transitioned to `ALARM` (email/notification received, or seen in the
  CloudWatch console) and you need to triage it.

## Prerequisites
- AWS credentials for account `<ACCOUNT_ID>`, region `ap-northeast-2`, with
  CloudWatch / SNS / Lambda Logs / ECS / ELBv2 read access.
- AWS CLI configured (`--region ap-northeast-2`).

## Procedure

### 1. Subscribe to the alarm SNS topic
Find the topic ARN — either from the stack output or by name
(`nfm-dashboard-alarms`):
```bash
# From the NfmDash-Ops stack output:
aws cloudformation describe-stacks --stack-name NfmDash-Ops \
  --query "Stacks[0].Outputs[?OutputKey=='AlarmTopicArn'].OutputValue" --output text

# Or by topic name:
aws sns list-topics --query "Topics[?contains(TopicArn,'nfm-dashboard-alarms')].TopicArn" --output text
```
Subscribe an endpoint (email shown; SMS / HTTPS / chatbot also work), then
confirm the subscription link that SNS emails you:
```bash
TOPIC_ARN=$(aws cloudformation describe-stacks --stack-name NfmDash-Ops \
  --query "Stacks[0].Outputs[?OutputKey=='AlarmTopicArn'].OutputValue" --output text)
aws sns subscribe --topic-arn "$TOPIC_ARN" \
  --protocol email --notification-endpoint you@example.com
aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN"   # verify: not "PendingConfirmation"
```

### 2. Triage: `nfm-dashboard-collector-errors`
The collector Lambda (`nfm-dashboard-collector`, runs every 5 min) errored in 3
consecutive periods — NFM flow / monitor / DNS data is no longer being ingested.
Check the collector logs:
```bash
aws logs tail /aws/lambda/nfm-dashboard-collector --since 1h --follow
```
Look for: NFM query throttling / rate limits (CloudWatch NFM `GetQueryResults`),
DynamoDB write failures against `nfm-dashboard-flows` / `nfm-dashboard-meta`
(throttling / `ProvisionedThroughput` / access errors), and unhandled
exceptions / timeouts. If throttling, the incident is usually transient and the
alarm clears on the next clean cycle (`OK` notice); if writes fail persistently,
inspect the collector's IAM role and the table status. The 5-minute bucket key
formula is shared with `app/src/lib/ddb.ts` — a schema/key mismatch surfaces
here.

### 3. Triage: `nfm-dashboard-alb-no-healthy-hosts`
No healthy app task behind the ALB (`HealthyHostCount < 1`) — the dashboard is
unreachable. Check the ECS service and target-group health (cluster
`nfm-dashboard`, service `nfm-dashboard-app`):
```bash
# ECS service: running vs desired count, recent events, rollout state:
aws ecs describe-services --cluster nfm-dashboard --services nfm-dashboard-app \
  --query "services[0].{running:runningCount,desired:desiredCount,deployments:deployments[].rolloutState,events:events[0:5].message}"

# Task health / stopped-task reason (why a task died):
aws ecs list-tasks --cluster nfm-dashboard --service-name nfm-dashboard-app --desired-status STOPPED
aws ecs describe-tasks --cluster nfm-dashboard --tasks <task-arn> \
  --query "tasks[0].{lastStatus:lastStatus,stopped:stoppedReason,containers:containers[].reason}"

# Target group health (why the ALB marks targets unhealthy):
TG_ARN=$(aws elbv2 describe-target-groups \
  --query "TargetGroups[?contains(TargetGroupName,'nfm-dashboard') || contains(TargetGroupName,'NfmDash')].TargetGroupArn | [0]" --output text)
aws elbv2 describe-target-health --target-group-arn "$TG_ARN"
```
Then read the app container logs (see [Finding logs](#finding-logs)) for
startup crashes / failing health checks. Common causes: a bad image rollout
(roll back per `docs/runbooks/deploy.md`), the container failing its health
check, or a task-role / env misconfiguration.

**OOM signature (2026-07-14 incident):** `describe-tasks` shows
`stopCode: EssentialContainerExited` with container `exitCode 137` and reason
`OutOfMemoryError: container killed due to memory usage` — the task blew past
its Fargate memory limit and ECS enters a replace loop (brief 502/504 windows
while the target group is empty). Since the fix, a heap-side failure would
instead surface as `exit 134` (V8 "Reached heap limit" abort at
`--max-old-space-size=3072`). Leading indicator in the app logs, minutes before
the kill:
```
@smithy/node-http-handler:WARN - socket usage at capacity=N and M additional requests are enqueued.
```
That warning means the DynamoDB fan-out (bucket-window queries × monitors) is
queuing on the SDK socket pool — every menu slows first, then memory climbs.
Mitigations shipped as task-def rev 25 / image `5f344e8`: 4096 MiB task +
NODE_OPTIONS heap cap, 512-socket keep-alive agent, `getFlowsWindow`/
`getFlowsWindowPair` shared cache — settle-based 10s TTL at rev 25, upgraded
to the version-aligned cache (collector cycle + 5-min grid) at rev 26 /
`37736cf` (`app/src/lib/ddb.ts`, ADR-007). If
it recurs, capture WHICH routes/windows were hot (`?buckets=` sizes in access
patterns), then consider lowering `BUCKET_QUERY_CONCURRENCY`, quantizing
`?buckets`, or moving multi-day windows to the Athena cold tier.

**CPU crash-loop signature (2026-07-15 incident):** task killed with
`Task failed ELB health checks` + `exitCode 137` but container reason **null**
(ECS SIGKILL on stop — NOT a cgroup OOM), ECS `CPUUtilization` max pegged at
100%, and `nfm-dashboard-flows` `ConsumedReadCapacityUnits` spiking 10-40x
baseline while ALB RequestCount stays low — a FEW requests each triggering a
huge window fan-out. Cause: a large-`?buckets` cold fetch+lens compute blocks
the 1-vCPU event loop for minutes → health checks time out → task replaced →
in-process cache dies → polling re-triggers the same cold compute on the fresh
task, forever. Mitigations shipped as rev 27 / image `6af919b`: interactive
lens ranges capped at 24h (`MAX_BUCKETS=288`, TimeRange '7d' removed — 7d+ is
served by the Athena `/history` page) and target-group
`unhealthyThresholdCount` 2→5 (75s tolerance). Interactive 7d returns only
behind collector pre-aggregated rollups.

### 4. Triage: `nfm-dashboard-alb-5xx`
The ALB returned more than 10 ELB-generated 5xx in 5 minutes — viewers are
getting errors. Walk the request path CloudFront → ALB → target → app:
```bash
# Is a target even healthy? (an unhealthy TG is the usual root of ELB 5xx)
aws elbv2 describe-target-health --target-group-arn "$TG_ARN"

# ELB 5xx vs target 5xx over the window (distinguish ALB-level from app-level):
aws cloudwatch get-metric-statistics --namespace AWS/ApplicationELB \
  --metric-name HTTPCode_ELB_5XX_Count --statistics Sum --period 300 \
  --start-time "$(date -u -d '1 hour ago' +%FT%TZ)" --end-time "$(date -u +%FT%TZ)" \
  --dimensions Name=LoadBalancer,Value=<lb-name>
```
`HTTPCode_ELB_5XX_Count` (what this alarm watches) is generated by the ALB
itself — typically no healthy target or connection failures, so overlap with
`nfm-dashboard-alb-no-healthy-hosts` is expected; triage step 3 first if both
fire. If targets are healthy, the 5xx is coming from the app — read the app
container logs for the failing route/stack trace. Verify the edge directly:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://dv4r4bnlhlpcx.cloudfront.net/login   # expect 200
curl -s -o /dev/null -w "%{http_code}\n" https://dv4r4bnlhlpcx.cloudfront.net/        # expect 302 (-> Cognito) — or 200 when the `authDisabled` toggle is on (ADR-005)
```

### 5. Finding logs
<a id="finding-logs"></a>
- **Collector Lambda**: `/aws/lambda/nfm-dashboard-collector` (fixed name).
- **App (ECS Fargate)**: the container uses the `awsLogs` driver with stream
  prefix `app` (`infra/lib/app-stack.ts`); the log group is CDK-generated
  (1-month retention). Resolve its exact name from the running task definition,
  then tail it:
  ```bash
  LG=$(aws ecs describe-task-definition --task-definition nfm-dashboard-app \
    --query "taskDefinition.containerDefinitions[0].logConfiguration.options.\"awslogs-group\"" --output text)
  aws logs tail "$LG" --since 30m --follow
  ```
- **Firehose (flow-archive)**: `/aws/kinesisfirehose/nfm-dashboard-flow-archive`
  (only relevant to cold-tier archiving, not these three alarms).

## Verification
- [ ] `aws sns list-subscriptions-by-topic` shows a confirmed subscription (not `PendingConfirmation`).
- [ ] The firing alarm has returned to `OK` (an `OK` SNS notice is sent on recovery).
- [ ] (collector) A subsequent collector run logged no errors / new buckets appear.
- [ ] (no-healthy-hosts) `HealthyHostCount >= 1` and ECS `runningCount == desiredCount`.
- [ ] (5xx) CloudFront `/login` → `200`, `/` → `302` (auth on) / `200` (`authDisabled`); `bash scripts/smoke.sh` → 3/3.

## Rollback
- If a bad deploy caused `no-healthy-hosts` or `alb-5xx`, roll back the app to the
  previous immutable image tag per `docs/runbooks/deploy.md` (Rollback):
  ```bash
  cd infra && npx cdk deploy NfmDash-App --require-approval never -c imageTag="<previous-SHA>"
  ```
- The alarms themselves are stateless (they auto-clear to `OK` when the metric
  recovers); no alarm-side rollback is needed.

## Notes
- Alarms and topic are defined in `infra/lib/ops-alarms.ts`; the topic ARN is the
  `AlarmTopicArn` output of `NfmDash-Ops`.
- Subscriptions are intentionally not in code — re-subscribe after any topic
  replacement.
- `HTTPCode_ELB_5XX_Count` and `HealthyHostCount<1` alarms commonly co-fire; the
  target-group health check is the shared root signal.
- Last verified: 2026-07-12

---

<a id="korean"></a>

# 한국어

## 개요
라이브 NFM Dashboard(https://dv4r4bnlhlpcx.cloudfront.net, AWS 계정
`<ACCOUNT_ID>`, 리전 `ap-northeast-2`)에 대해 `NfmDash-Ops` 스택
(`infra/lib/ops-alarms.ts`)이 정의한 운영 CloudWatch 알람을 수신하고 대응하는
방법. 스택은 세 개의 알람을 생성하며, 모두 단일 SNS 토픽
(`nfm-dashboard-alarms`)에 `ALARM`과 `OK` 양쪽으로 연결된다:

| 알람 이름 | 메트릭 | 조건 |
| --- | --- | --- |
| `nfm-dashboard-collector-errors` | `AWS/Lambda` `Errors`(Sum), 차원 `FunctionName=nfm-dashboard-collector` | 연속 **3**개 5분 구간 동안 `>= 1` |
| `nfm-dashboard-alb-no-healthy-hosts` | 타깃 그룹 `HealthyHostCount`(Minimum) | 연속 **3**개 1분 구간 동안 `< 1` |
| `nfm-dashboard-alb-5xx` | ALB `HTTPCode_ELB_5XX_Count`(Sum) | **1**개 5분 구간에서 `> 10` |

> 토픽에는 **코드로 생성된 구독이 없다** — 스택은 `AlarmTopicArn` 출력만 내보낸다.
> 운영자가 반드시 별도로 구독해야 하며(아래), 그렇지 않으면 알람이 조용히
> 발생한다.

## 사용 시점
- 알람 알림을 처음 설정할 때(SNS 토픽 구독).
- 알람이 `ALARM`으로 전환되어(이메일/알림 수신 또는 CloudWatch 콘솔에서 확인)
  트리아지가 필요할 때.

## 사전 요구 사항
- 계정 `<ACCOUNT_ID>`, 리전 `ap-northeast-2`에 대한 CloudWatch / SNS / Lambda
  Logs / ECS / ELBv2 읽기 권한이 있는 AWS 자격 증명.
- AWS CLI 구성(`--region ap-northeast-2`).

## 절차

### 1. 알람 SNS 토픽 구독
토픽 ARN을 찾는다 — 스택 출력 또는 이름(`nfm-dashboard-alarms`)으로:
```bash
# NfmDash-Ops 스택 출력에서:
aws cloudformation describe-stacks --stack-name NfmDash-Ops \
  --query "Stacks[0].Outputs[?OutputKey=='AlarmTopicArn'].OutputValue" --output text

# 또는 토픽 이름으로:
aws sns list-topics --query "Topics[?contains(TopicArn,'nfm-dashboard-alarms')].TopicArn" --output text
```
엔드포인트를 구독하고(이메일 예시; SMS / HTTPS / chatbot도 가능), SNS가 보내는
확인 링크를 승인한다:
```bash
TOPIC_ARN=$(aws cloudformation describe-stacks --stack-name NfmDash-Ops \
  --query "Stacks[0].Outputs[?OutputKey=='AlarmTopicArn'].OutputValue" --output text)
aws sns subscribe --topic-arn "$TOPIC_ARN" \
  --protocol email --notification-endpoint you@example.com
aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN"   # 확인: "PendingConfirmation"이 아니어야 함
```

### 2. 트리아지: `nfm-dashboard-collector-errors`
컬렉터 Lambda(`nfm-dashboard-collector`, 5분마다 실행)가 연속 3개 구간에서
오류를 냄 — NFM 플로우 / 모니터 / DNS 데이터가 더 이상 수집되지 않는다.
컬렉터 로그를 확인한다:
```bash
aws logs tail /aws/lambda/nfm-dashboard-collector --since 1h --follow
```
확인 항목: NFM 쿼리 스로틀링 / 속도 제한(CloudWatch NFM `GetQueryResults`),
`nfm-dashboard-flows` / `nfm-dashboard-meta`에 대한 DynamoDB 쓰기 실패
(스로틀링 / `ProvisionedThroughput` / 접근 오류), 처리되지 않은 예외 / 타임아웃.
스로틀링이면 대개 일시적이며 다음 정상 사이클에 알람이 해제된다(`OK` 알림).
쓰기가 지속적으로 실패하면 컬렉터 IAM 역할과 테이블 상태를 점검한다. 5분 버킷 키
공식은 `app/src/lib/ddb.ts`와 공유되므로, 스키마/키 불일치가 여기서 드러난다.

### 3. 트리아지: `nfm-dashboard-alb-no-healthy-hosts`
ALB 뒤에 정상 앱 태스크가 없음(`HealthyHostCount < 1`) — 대시보드에 도달할 수
없다. ECS 서비스와 타깃 그룹 상태를 확인한다(클러스터 `nfm-dashboard`, 서비스
`nfm-dashboard-app`):
```bash
# ECS 서비스: running vs desired, 최근 이벤트, 롤아웃 상태:
aws ecs describe-services --cluster nfm-dashboard --services nfm-dashboard-app \
  --query "services[0].{running:runningCount,desired:desiredCount,deployments:deployments[].rolloutState,events:events[0:5].message}"

# 태스크 상태 / 중지 사유(태스크가 죽은 이유):
aws ecs list-tasks --cluster nfm-dashboard --service-name nfm-dashboard-app --desired-status STOPPED
aws ecs describe-tasks --cluster nfm-dashboard --tasks <task-arn> \
  --query "tasks[0].{lastStatus:lastStatus,stopped:stoppedReason,containers:containers[].reason}"

# 타깃 그룹 상태(ALB가 타깃을 unhealthy로 표시하는 이유):
TG_ARN=$(aws elbv2 describe-target-groups \
  --query "TargetGroups[?contains(TargetGroupName,'nfm-dashboard') || contains(TargetGroupName,'NfmDash')].TargetGroupArn | [0]" --output text)
aws elbv2 describe-target-health --target-group-arn "$TG_ARN"
```
그다음 앱 컨테이너 로그([로그 찾기](#로그-찾기))에서 기동 크래시 / 헬스체크
실패를 읽는다. 흔한 원인: 잘못된 이미지 롤아웃(`docs/runbooks/deploy.md` 롤백),
컨테이너 헬스체크 실패, 태스크 역할 / 환경변수 오구성.

**OOM 시그니처 (2026-07-14 인시던트):** `describe-tasks`에
`stopCode: EssentialContainerExited` + 컨테이너 `exitCode 137` + reason
`OutOfMemoryError: container killed due to memory usage`가 보이면 태스크가
Fargate 메모리 한도를 초과해 ECS가 교체 루프에 들어간 것이다(타깃 그룹이 비는
동안 짧은 502/504 창 발생). 수정 이후 힙 쪽 실패는 `exit 134`(V8 "Reached heap
limit" abort, `--max-old-space-size=3072`)로 나타난다. 죽기 몇 분 전 앱 로그의
선행 지표:
```
@smithy/node-http-handler:WARN - socket usage at capacity=N and M additional requests are enqueued.
```
이 경고는 DynamoDB fan-out(버킷 윈도우 쿼리 × 모니터)이 SDK 소켓 풀에 큐잉되고
있다는 뜻 — 먼저 모든 메뉴가 느려지고, 그다음 메모리가 차오른다. 조치는 태스크
정의 rev 25 / 이미지 `5f344e8`로 배포됨: 4096 MiB 태스크 + NODE_OPTIONS 힙 캡,
512-소켓 keep-alive agent, `getFlowsWindow`/`getFlowsWindowPair` 공유
공유 캐시 — rev 25에서는 settle 기준 10초 TTL, rev 26/`37736cf`에서 버전 정렬
캐시(수집기 사이클 + 5분 그리드)로 업그레이드(`app/src/lib/ddb.ts`, ADR-007).
재발 시 어떤 라우트/윈도우가
뜨거웠는지(`?buckets=` 크기) 확보한 뒤 `BUCKET_QUERY_CONCURRENCY` 하향,
`?buckets` 양자화, 또는 다일(multi-day) 윈도우의 Athena 콜드 티어 이전을
검토한다.

**CPU 크래시 루프 시그니처 (2026-07-15 인시던트):** `Task failed ELB health
checks` + `exitCode 137`인데 컨테이너 reason이 **null**(ECS의 중지 SIGKILL —
cgroup OOM 아님), ECS `CPUUtilization` 최대 100% 고정, ALB RequestCount는
낮은데 `nfm-dashboard-flows`의 `ConsumedReadCapacityUnits`가 평시의 10~40배 —
소수의 요청이 각각 초대형 window fan-out을 유발하는 패턴. 원인: 큰 `?buckets`
콜드 fetch+lens 계산이 1 vCPU 이벤트 루프를 수 분간 블록 → 헬스체크 타임아웃 →
태스크 교체 → 인프로세스 캐시 소실 → 폴링이 새 태스크에 같은 콜드 계산을 즉시
재유발하는 무한 루프. 조치는 rev 27 / 이미지 `6af919b`로 배포됨: 인터랙티브
lens 범위 24h 상한(`MAX_BUCKETS=288`, TimeRange `7d` 제거 — 7d+는 Athena
`/history` 페이지 담당) + 타깃 그룹 `unhealthyThresholdCount` 2→5 (75초 유예).
인터랙티브 7d는 collector 사전 집계(rollup) 이후에만 복원한다.

### 4. 트리아지: `nfm-dashboard-alb-5xx`
ALB가 5분간 10건 초과의 ELB 발생 5xx를 반환 — 뷰어가 오류를 받고 있다. 요청
경로 CloudFront → ALB → 타깃 → 앱을 따라간다:
```bash
# 정상 타깃이 있는가? (unhealthy TG가 ELB 5xx의 통상적 근본 원인)
aws elbv2 describe-target-health --target-group-arn "$TG_ARN"

# 구간 내 ELB 5xx vs 타깃 5xx (ALB 수준과 앱 수준 구분):
aws cloudwatch get-metric-statistics --namespace AWS/ApplicationELB \
  --metric-name HTTPCode_ELB_5XX_Count --statistics Sum --period 300 \
  --start-time "$(date -u -d '1 hour ago' +%FT%TZ)" --end-time "$(date -u +%FT%TZ)" \
  --dimensions Name=LoadBalancer,Value=<lb-name>
```
이 알람이 감시하는 `HTTPCode_ELB_5XX_Count`는 ALB 자체가 생성한다 — 대개 정상
타깃 없음 또는 연결 실패이므로 `nfm-dashboard-alb-no-healthy-hosts`와 겹치는 것이
예상된다. 둘 다 발생하면 3단계를 먼저 트리아지한다. 타깃이 정상인데도 5xx면 앱에서
발생한 것이니, 앱 컨테이너 로그에서 실패 라우트/스택 트레이스를 읽는다. 엣지를
직접 검증한다:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://dv4r4bnlhlpcx.cloudfront.net/login   # 200 기대
curl -s -o /dev/null -w "%{http_code}\n" https://dv4r4bnlhlpcx.cloudfront.net/        # 302 기대 (-> Cognito) — `authDisabled` 토글 ON이면 200 (ADR-005)
```

### 5. 로그 찾기
<a id="로그-찾기"></a>
- **컬렉터 Lambda**: `/aws/lambda/nfm-dashboard-collector`(고정 이름).
- **앱(ECS Fargate)**: 컨테이너는 스트림 프리픽스 `app`의 `awsLogs` 드라이버를
  사용(`infra/lib/app-stack.ts`); 로그 그룹은 CDK 생성(보존 1개월). 실행 중인
  태스크 정의에서 정확한 이름을 해석한 뒤 tail 한다:
  ```bash
  LG=$(aws ecs describe-task-definition --task-definition nfm-dashboard-app \
    --query "taskDefinition.containerDefinitions[0].logConfiguration.options.\"awslogs-group\"" --output text)
  aws logs tail "$LG" --since 30m --follow
  ```
- **Firehose(flow-archive)**: `/aws/kinesisfirehose/nfm-dashboard-flow-archive`
  (cold 계층 아카이빙에만 관련, 이 세 알람과는 무관).

## 검증
- [ ] `aws sns list-subscriptions-by-topic`에 확인된 구독 표시(`PendingConfirmation` 아님).
- [ ] 발생한 알람이 `OK`로 복귀(복구 시 `OK` SNS 알림 전송).
- [ ] (컬렉터) 이후 컬렉터 실행에 오류 없음 / 새 버킷 생성 확인.
- [ ] (no-healthy-hosts) `HealthyHostCount >= 1` 및 ECS `runningCount == desiredCount`.
- [ ] (5xx) CloudFront `/login` → `200`, `/` → `302`(인증 ON) / `200`(`authDisabled`); `bash scripts/smoke.sh` → 3/3.

## 롤백
- 잘못된 배포가 `no-healthy-hosts` 또는 `alb-5xx`를 유발했다면, `docs/runbooks/deploy.md`
  (롤백)에 따라 앱을 직전 불변 이미지 태그로 롤백한다:
  ```bash
  cd infra && npx cdk deploy NfmDash-App --require-approval never -c imageTag="<이전-SHA>"
  ```
- 알람 자체는 상태 비저장(메트릭이 복구되면 자동으로 `OK`로 해제)이므로 알람 쪽
  롤백은 필요 없다.

## 참고
- 알람과 토픽은 `infra/lib/ops-alarms.ts`에 정의; 토픽 ARN은 `NfmDash-Ops`의
  `AlarmTopicArn` 출력.
- 구독은 의도적으로 코드에 없음 — 토픽 교체 후 재구독해야 함.
- `HTTPCode_ELB_5XX_Count`와 `HealthyHostCount<1` 알람은 흔히 동시에 발생한다.
  타깃 그룹 헬스체크가 공통 근본 신호다.
- 최종 검증일: 2026-07-12
