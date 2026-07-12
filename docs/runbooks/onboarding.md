# Runbook: Onboard a Monitored Cluster / Account

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Overview
The procedure for bringing a new EKS cluster (or a new account) into the NFM
Dashboard observability pipeline (AWS account `<ACCOUNT_ID>`, region
`ap-northeast-2`). Onboarding has two halves, each implemented as an idempotent
CloudFormation custom resource backed by a Python script under `onboarding/`:

- **CoreDNS query logging** — `onboarding/enable_coredns_log.py`, wired into the
  `NfmDash-Dns` stack (`lib/dns-stack.ts`, `CorednsLogFn`). It enables the CoreDNS
  `log` plugin on every EKS cluster in the account, **reversibly**: it stores the
  original Corefile in the ConfigMap annotation `nfm-dashboard/corefile-backup`
  before patching, so Delete can restore it verbatim.
- **NFM monitors + agent coverage** — `onboarding/onboard_nfm.py`, wired into the
  `NfmDash-Onboarding` stack (`lib/nfm-onboarding-stack.ts`, `OnboardFn`). It
  ensures a Network Flow Monitor scope, per-cluster monitors (`nfm-eks-<cluster>`)
  plus an all-VPC monitor (`nfm-vpc-all`), the `eks-pod-identity-agent` and
  `aws-network-flow-monitoring-agent` EKS add-ons, a per-cluster agent IAM role
  (`nfm-agent-<cluster>`) with the AWS-managed
  `CloudWatchNetworkFlowMonitorAgentPublishPolicy`, and the pod-identity
  association for the agent service account.

Both scripts enumerate **all** clusters (`eks.list_clusters()`) and VPCs on every
run, so onboarding a newly created cluster is simply a matter of **re-running the
two custom resources**. The `collector` Lambda (5-minute cycle) then picks up the
resulting NFM flows and DNS samples and the data appears in the dashboard.

## When to Use
- A new EKS cluster was created in account `<ACCOUNT_ID>` and its pod-to-pod
  flows + DNS should show up in the dashboard.
- First-time bring-up of the pipeline in a fresh account/region (deploy the
  stacks; the env is pinned in `infra/bin/nfm-dashboard.ts`).
- Re-asserting coverage after an add-on / CoreDNS config drifted.

Not for: shipping app or collector code — use `docs/runbooks/deploy.md`.

## Prerequisites
- AWS credentials for account `<ACCOUNT_ID>` with CDK / CloudFormation / Lambda
  / EKS / IAM / Network Flow Monitor access.
- Node.js + repo dependencies installed (`npm ci` at repo root); working
  directory `/home/ec2-user/my-project/nfm-dashboard`.
- `kubectl` + a kubeconfig for the target cluster **for verification only**
  (step 3). The custom resources do **not** need an operator kubeconfig — they
  self-grant transient k8s admin via EKS Access Entries
  (`AmazonEKSClusterAdminPolicy`) and talk to the API server with a presigned
  STS token, revoking the access entry after each cluster.
- As with every cdk command in this repo, `-c imageTag` is mandatory; these
  non-App stacks take `-c imageTag=unused`.

## Procedure

The custom resources only re-execute when their `Version` property changes
(`{ Version: '1' }` in both stack files). To force a re-run against a
newly-added cluster, bump that string, then deploy.

### 1. Enable CoreDNS logging
Bump the `CorednsLog` custom-resource version in `infra/lib/dns-stack.ts`
(the `properties: { Version: '1' }` on the `CorednsLog` CustomResource), then
deploy the DNS stack:
```bash
cd infra
npx cdk deploy NfmDash-Dns --require-approval never -c imageTag=unused
```
On Create/Update the Lambda adds `log` as the first plugin of the CoreDNS server
block and records the pre-change Corefile in the `nfm-dashboard/corefile-backup`
annotation (idempotent — a cluster already carrying `log` is left untouched and
no backup is written). A partial failure (some clusters) still reports SUCCESS
with the failed clusters listed in the CFN reason; a full failure reports FAILED.

### 2. Register NFM monitors + agent coverage
Bump the `Onboarding` custom-resource version in
`infra/lib/nfm-onboarding-stack.ts` (`properties: { Version: '1' }`), then deploy:
```bash
cd infra
npx cdk deploy NfmDash-Onboarding --require-approval never -c imageTag=unused
```
This creates/ensures the scope, the `nfm-eks-<cluster>` and `nfm-vpc-all`
monitors, the two EKS add-ons, the `nfm-agent-<cluster>` role + publish policy,
and the pod-identity association. The stack also creates an SSM association
(`AWS-ConfigureAWSPackage`, `nfm-dashboard-agent-install`) that installs the NFM
agent daily on EC2 instances tagged `NfmAgent=managed`. The stack `MonitorsEnv`
output lists the monitor→cluster mapping the collector reads.

> **NFM warm-up:** flow data begins ~20 minutes after the
> `aws-network-flow-monitoring-agent` add-on install (the script deliberately
> does **not** block on the add-on reaching ACTIVE). Do not expect flows in the
> dashboard immediately after step 2.

### 3. Confirm the collector picks up flows + DNS
The collector runs on a 5-minute cycle and writes into `nfm-dashboard-flows` /
`nfm-dashboard-meta`. After the NFM warm-up:
```bash
# a) CoreDNS log plugin is live on the target cluster (verification kubeconfig):
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -n '  *log'
kubectl -n kube-system get configmap coredns \
  -o jsonpath='{.metadata.annotations.nfm-dashboard/corefile-backup}' | head -c 40   # backup present

# b) NFM monitors exist for the new cluster:
aws networkflowmonitor list-monitors --region ap-northeast-2 \
  --query "monitors[?monitorName=='nfm-eks-<cluster>']"

# c) EKS add-ons are progressing/active:
aws eks describe-addon --region ap-northeast-2 --cluster-name <cluster> \
  --addon-name aws-network-flow-monitoring-agent --query "addon.status" --output text
```
Then open the dashboard (https://dv4r4bnlhlpcx.cloudfront.net) and confirm the
new cluster's flows and DNS activity appear once a collector cycle has run after
the warm-up.

## Verification
- [ ] `NfmDash-Dns` and `NfmDash-Onboarding` stacks are `UPDATE_COMPLETE` / `CREATE_COMPLETE`.
- [ ] Target cluster's CoreDNS `Corefile` contains `log` and the `nfm-dashboard/corefile-backup` annotation is set.
- [ ] `nfm-eks-<cluster>` monitor exists (and `nfm-vpc-all`).
- [ ] `eks-pod-identity-agent` + `aws-network-flow-monitoring-agent` add-ons present; `nfm-agent-<cluster>` role exists.
- [ ] After the ~20-min warm-up + one 5-min collector cycle, the new cluster's flows + DNS appear in the dashboard.

## Rollback
- **CoreDNS logging (reversible):** deleting the `CorednsLog` custom resource
  runs the script's Delete path, which restores the original Corefile from the
  `nfm-dashboard/corefile-backup` annotation verbatim and drops the annotation;
  if no backup exists (the CR never modified that cluster) it is skipped. Delete
  always reports SUCCESS so it never blocks stack deletion.
  ```bash
  cd infra && npx cdk destroy NfmDash-Dns --force -c imageTag=unused
  ```
- **NFM monitors / agents (intentionally NOT auto-reversed):** `onboard_nfm.py`'s
  Delete path is a deliberate no-op — it leaves the scope, monitors, add-ons,
  roles, and pod-identity associations in place so deleting/redeploying the stack
  does not tear down live monitoring. To remove coverage, undo manually in
  `ap-northeast-2`, e.g.:
  ```bash
  aws networkflowmonitor delete-monitor --region ap-northeast-2 --monitor-name nfm-eks-<cluster>
  aws eks delete-addon --region ap-northeast-2 --cluster-name <cluster> --addon-name aws-network-flow-monitoring-agent
  # then delete the pod-identity association and the nfm-agent-<cluster> role if no longer needed
  ```

## Notes
- Region `ap-northeast-2`, account `<ACCOUNT_ID>` — hard-coded in both scripts
  and pinned in `infra/bin/nfm-dashboard.ts`.
- Both custom resources are idempotent and re-run only on a `Version` bump.
- Related docs: `onboarding/CLAUDE.md`, `infra/CLAUDE.md`, `collector/CLAUDE.md`,
  `docs/reference/data.md` (what the collector does with the flows/DNS).
- Last verified: 2026-07-12

---

<a id="korean"></a>

# 한국어

## 개요
새 EKS 클러스터(또는 새 계정)를 NFM Dashboard 관측성 파이프라인(AWS 계정
`<ACCOUNT_ID>`, 리전 `ap-northeast-2`)에 편입시키는 절차. 온보딩은 두 부분으로
나뉘며, 각각 `onboarding/` 아래의 Python 스크립트가 뒷받침하는 멱등(idempotent)
CloudFormation 커스텀 리소스로 구현되어 있다:

- **CoreDNS 쿼리 로깅** — `onboarding/enable_coredns_log.py`, `NfmDash-Dns`
  스택(`lib/dns-stack.ts`, `CorednsLogFn`)에 연결. 계정 내 모든 EKS 클러스터에서
  CoreDNS `log` 플러그인을 **되돌릴 수 있게** 활성화한다: 패치 전에 원본 Corefile을
  ConfigMap 어노테이션 `nfm-dashboard/corefile-backup`에 저장하므로 Delete 시
  원본을 그대로 복원할 수 있다.
- **NFM 모니터 + 에이전트 커버리지** — `onboarding/onboard_nfm.py`,
  `NfmDash-Onboarding` 스택(`lib/nfm-onboarding-stack.ts`, `OnboardFn`)에 연결.
  Network Flow Monitor scope, 클러스터별 모니터(`nfm-eks-<cluster>`)와 전체 VPC
  모니터(`nfm-vpc-all`), `eks-pod-identity-agent` 및
  `aws-network-flow-monitoring-agent` EKS 애드온, AWS 관리형
  `CloudWatchNetworkFlowMonitorAgentPublishPolicy`가 붙은 클러스터별 에이전트 IAM
  역할(`nfm-agent-<cluster>`), 에이전트 서비스 계정의 pod-identity 연결을 보장한다.

두 스크립트 모두 실행 때마다 **모든** 클러스터(`eks.list_clusters()`)와 VPC를
열거하므로, 새로 만든 클러스터의 온보딩은 결국 **두 커스텀 리소스를 재실행**하는
것으로 끝난다. 이후 `collector` Lambda(5분 주기)가 그 결과로 생성된 NFM 플로우와
DNS 샘플을 수집하고 데이터가 대시보드에 나타난다.

## 사용 시점
- 계정 `<ACCOUNT_ID>`에 새 EKS 클러스터가 생성되어 그 pod-to-pod 플로우 + DNS를
  대시보드에 표시하려는 경우.
- 새 계정/리전에서 파이프라인을 최초로 기동하는 경우(스택을 배포; env는
  `infra/bin/nfm-dashboard.ts`에 고정).
- 애드온 / CoreDNS 설정이 드리프트된 뒤 커버리지를 재확정하는 경우.

해당 없음: 앱/컬렉터 코드 배포는 `docs/runbooks/deploy.md` 참조.

## 사전 요구 사항
- CDK / CloudFormation / Lambda / EKS / IAM / Network Flow Monitor 접근 권한이
  있는 계정 `<ACCOUNT_ID>`의 AWS 자격 증명.
- Node.js + 저장소 의존성 설치(저장소 루트에서 `npm ci`); 작업 디렉터리
  `/home/ec2-user/my-project/nfm-dashboard`.
- **검증 용도로만** 대상 클러스터의 `kubectl` + kubeconfig(3단계). 커스텀
  리소스는 운영자 kubeconfig가 **필요 없다** — EKS Access Entries
  (`AmazonEKSClusterAdminPolicy`)로 일시적 k8s admin을 스스로 부여하고 presigned
  STS 토큰으로 API 서버와 통신하며, 각 클러스터 처리 후 access entry를 회수한다.
- 저장소의 모든 cdk 명령과 마찬가지로 `-c imageTag`가 필수이며, App이 아닌 이
  스택들은 `-c imageTag=unused`를 넘긴다.

## 절차

커스텀 리소스는 `Version` 속성이 바뀔 때만 재실행된다(두 스택 파일 모두
`{ Version: '1' }`). 새로 추가된 클러스터에 대해 강제로 재실행하려면 그 문자열을
올린 뒤 배포한다.

### 1. CoreDNS 로깅 활성화
`infra/lib/dns-stack.ts`의 `CorednsLog` 커스텀 리소스 버전(`CorednsLog`
CustomResource의 `properties: { Version: '1' }`)을 올린 뒤 DNS 스택을 배포한다:
```bash
cd infra
npx cdk deploy NfmDash-Dns --require-approval never -c imageTag=unused
```
Create/Update 시 Lambda는 CoreDNS 서버 블록의 첫 플러그인으로 `log`를 추가하고,
변경 전 Corefile을 `nfm-dashboard/corefile-backup` 어노테이션에 기록한다(멱등 —
이미 `log`가 있는 클러스터는 건드리지 않고 백업도 쓰지 않는다). 일부 클러스터만
실패하면 실패 클러스터를 CFN reason에 나열한 채 SUCCESS를 보고하고, 전부 실패하면
FAILED를 보고한다.

### 2. NFM 모니터 + 에이전트 커버리지 등록
`infra/lib/nfm-onboarding-stack.ts`의 `Onboarding` 커스텀 리소스
버전(`properties: { Version: '1' }`)을 올린 뒤 배포한다:
```bash
cd infra
npx cdk deploy NfmDash-Onboarding --require-approval never -c imageTag=unused
```
scope, `nfm-eks-<cluster>` 및 `nfm-vpc-all` 모니터, 두 EKS 애드온,
`nfm-agent-<cluster>` 역할 + publish 정책, pod-identity 연결을 생성/보장한다.
스택은 또한 `NfmAgent=managed` 태그가 붙은 EC2 인스턴스에 NFM 에이전트를 매일
설치하는 SSM 연결(`AWS-ConfigureAWSPackage`, `nfm-dashboard-agent-install`)을
생성한다. 스택의 `MonitorsEnv` 출력은 컬렉터가 읽는 모니터→클러스터 매핑을
나열한다.

> **NFM 워밍업:** 플로우 데이터는 `aws-network-flow-monitoring-agent` 애드온
> 설치 후 약 20분 뒤에 시작된다(스크립트는 의도적으로 애드온의 ACTIVE 도달을
> 기다리지 **않는다**). 2단계 직후 곧바로 대시보드에 플로우가 보이길 기대하지
> 말 것.

### 3. 컬렉터의 플로우 + DNS 수집 확인
컬렉터는 5분 주기로 실행되어 `nfm-dashboard-flows` / `nfm-dashboard-meta`에
기록한다. NFM 워밍업 이후:
```bash
# a) 대상 클러스터에서 CoreDNS log 플러그인이 적용됨(검증용 kubeconfig):
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -n '  *log'
kubectl -n kube-system get configmap coredns \
  -o jsonpath='{.metadata.annotations.nfm-dashboard/corefile-backup}' | head -c 40   # 백업 존재

# b) 새 클러스터의 NFM 모니터 존재:
aws networkflowmonitor list-monitors --region ap-northeast-2 \
  --query "monitors[?monitorName=='nfm-eks-<cluster>']"

# c) EKS 애드온 진행/활성 상태:
aws eks describe-addon --region ap-northeast-2 --cluster-name <cluster> \
  --addon-name aws-network-flow-monitoring-agent --query "addon.status" --output text
```
그다음 대시보드(https://dv4r4bnlhlpcx.cloudfront.net)를 열어, 워밍업 후 컬렉터
주기가 한 번 돈 뒤 새 클러스터의 플로우와 DNS 활동이 나타나는지 확인한다.

## 검증
- [ ] `NfmDash-Dns`, `NfmDash-Onboarding` 스택이 `UPDATE_COMPLETE` / `CREATE_COMPLETE`.
- [ ] 대상 클러스터의 CoreDNS `Corefile`에 `log`가 포함되고 `nfm-dashboard/corefile-backup` 어노테이션이 설정됨.
- [ ] `nfm-eks-<cluster>` 모니터 존재(및 `nfm-vpc-all`).
- [ ] `eks-pod-identity-agent` + `aws-network-flow-monitoring-agent` 애드온 존재; `nfm-agent-<cluster>` 역할 존재.
- [ ] 약 20분 워밍업 + 5분 컬렉터 주기 1회 후 새 클러스터의 플로우 + DNS가 대시보드에 나타남.

## 롤백
- **CoreDNS 로깅(되돌리기 가능):** `CorednsLog` 커스텀 리소스를 삭제하면
  스크립트의 Delete 경로가 실행되어 `nfm-dashboard/corefile-backup` 어노테이션의
  원본 Corefile을 그대로 복원하고 어노테이션을 제거한다. 백업이 없으면(해당
  클러스터를 이 CR이 수정한 적 없음) 건너뛴다. Delete는 항상 SUCCESS를 보고하므로
  스택 삭제를 막지 않는다.
  ```bash
  cd infra && npx cdk destroy NfmDash-Dns --force -c imageTag=unused
  ```
- **NFM 모니터 / 에이전트(의도적으로 자동 복원 안 함):** `onboard_nfm.py`의
  Delete 경로는 의도적 no-op이다 — scope, 모니터, 애드온, 역할, pod-identity
  연결을 그대로 남겨 두어 스택 삭제/재배포로 라이브 모니터링이 해체되지 않게
  한다. 커버리지를 제거하려면 `ap-northeast-2`에서 수동으로 되돌린다. 예:
  ```bash
  aws networkflowmonitor delete-monitor --region ap-northeast-2 --monitor-name nfm-eks-<cluster>
  aws eks delete-addon --region ap-northeast-2 --cluster-name <cluster> --addon-name aws-network-flow-monitoring-agent
  # 이후 필요 없으면 pod-identity 연결과 nfm-agent-<cluster> 역할을 삭제
  ```

## 참고
- 리전 `ap-northeast-2`, 계정 `<ACCOUNT_ID>` — 두 스크립트에 하드코딩되고
  `infra/bin/nfm-dashboard.ts`에 고정.
- 두 커스텀 리소스는 멱등이며 `Version` 상승 시에만 재실행된다.
- 관련 문서: `onboarding/CLAUDE.md`, `infra/CLAUDE.md`, `collector/CLAUDE.md`,
  `docs/reference/data.md`(컬렉터가 플로우/DNS로 하는 일).
- 최종 검증일: 2026-07-12
