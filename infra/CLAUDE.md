# infra — AWS CDK Module

## Role
CDK v2 (TypeScript) app defining all AWS infrastructure. Six stacks, env pinned to account `<ACCOUNT_ID>` / `ap-northeast-2` in `bin/nfm-dashboard.ts`:
`NfmDash-Data`, `NfmDash-Onboarding`, `NfmDash-AgentCore`, `NfmDash-App`, `NfmDash-Ops`, `NfmDash-Dns`.

## Key Files
- `bin/nfm-dashboard.ts` — app entry; instantiates the 6 stacks (Ops consumes `alb`/`targetGroup` from AppStack)
- `lib/data-stack.ts` — DynamoDB tables + collector Lambda + schedule + flow-archive pipeline: `flows` stream (`NEW_IMAGE`) → transform Lambda (`archive-transform.handler`) → Firehose L1 `CfnDeliveryStream` (Parquet, dynamic-partition by `dt`) → S3 archive bucket, catalogued by Glue L1 `CfnDatabase`/`CfnTable` (`nfm_dashboard.flows_archive`, partition projection) + Athena L1 `CfnWorkGroup` (`nfm-dashboard`). Glue columns MUST match the transform Lambda's `FlatFlowRow` (minus `dt`) or Firehose routes records to `errors/`. Fixed resource names (account `<ACCOUNT_ID>`) — no cross-stack export
- `lib/nfm-onboarding-stack.ts` — NFM onboarding resources
- `lib/agentcore-stack.ts` — AgentCore MCP tool Lambdas (Python 3.13, arm64) + gateway IAM role
- `lib/app-stack.ts` — ECR image → ECS Fargate (arm64) behind ALB, fronted by CloudFront, Cognito Hosted UI (PKCE). Header comment documents the ALB → CloudFront → Cognito circular-dependency resolution — read it before touching ordering. The `authDisabled` context (currently ON in `cdk.json`) injects `AUTH_DISABLED=1` into the task env, disabling only the middleware session gate (Cognito resources + origin-verify stay; ADR-005).
- `lib/ops-alarms.ts` — CloudWatch alarms on ALB/target group
- `lib/dns-stack.ts` — DNS resources
- `cdk.json`, `cdk.context.json` — CDK config/context; `test/` — stack tests (vitest)

## Rules
- ALL cdk commands require `-c imageTag`: `cd infra && npx cdk deploy <Stack> --require-approval never -c imageTag=<sha>`. Non-App stacks may use `-c imageTag=unused`.
- The App image is built/pushed by `bash scripts/build-push.sh <sha>` BEFORE deploying `NfmDash-App` with that tag.
- Deploying `NfmDash-Data` requires a fresh collector build (`npm -w collector run build`).
- Auth toggle: `authDisabled: true` in `cdk.json` context keeps login DISABLED on every App deploy; to re-enable auth, remove that key (or `-c authDisabled=false`) and redeploy `NfmDash-App` (ADR-005).
- After deploy, verify with `bash scripts/smoke.sh`.
