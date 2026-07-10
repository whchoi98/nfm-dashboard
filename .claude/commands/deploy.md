---
description: Build the app image, push to ECR, and deploy CDK stacks with a pinned imageTag
allowed-tools: Read, Glob, Bash(git status:*), Bash(git rev-parse:*), Bash(git log:*), Bash(npx -w app vitest:*), Bash(npm -w collector test:*), Bash(npx -w app tsc:*), Bash(bash scripts/build-push.sh:*), Bash(bash scripts/smoke.sh:*), Bash(cd infra && npx cdk:*), Bash(aws cloudformation describe-stacks:*), Bash(aws ecs describe-services:*)
---

# Deploy

Build and deploy the application. Deploy target: $ARGUMENTS (default: `NfmDash-App`).

Stacks (deploy order): `NfmDash-Data` → `NfmDash-Onboarding` → `NfmDash-AgentCore` → `NfmDash-App` → `NfmDash-Ops` → `NfmDash-Dns`.

## Step 1: Pre-Deploy Checks

1. Verify working tree is clean: `git status`
2. Verify current branch (warn if not `main`)
3. Run tests to ensure nothing is broken:
   `npx -w app vitest run && npm -w collector test && npx -w app tsc --noEmit`
4. Resolve the image tag: `TAG=$(git rev-parse --short HEAD)`
5. Check if a deployment runbook exists: `ls docs/runbooks/deploy-*.md` — if one exists, follow it.

## Step 2: Build and Push Image (app deploys only)

```bash
bash scripts/build-push.sh "$TAG"
```

Notes:
- The ECR repo `nfm-dashboard-app` is tag-IMMUTABLE: a new commit needs a new tag; re-pushing an existing SHA tag fails by design.
- Skip this step when deploying only non-App stacks.

## Step 3: CDK Deploy

```bash
cd infra && npx cdk deploy <Stack> --require-approval never -c imageTag="$TAG"
```

- **Every** `cdk` command needs `-c imageTag=...` (synth of NfmDash-App is unconditional). For non-App stacks, `-c imageTag=unused` is acceptable.
- `NfmDash-Ops` is cross-stack-coupled to `NfmDash-App` exports — deploy/delete with `--exclusively` awareness.
- The CLI may print a spurious "UPDATE_IN_PROGRESS cannot be updated" race while the CFN update proceeds fine — verify via `aws cloudformation describe-stacks` before re-running.

## Step 4: Verify

After deployment:
- Run the E2E smoke test: `bash scripts/smoke.sh`
- Check stack status: `aws cloudformation describe-stacks --stack-name <Stack> --query 'Stacks[0].StackStatus'`
- For app deploys, confirm the ECS task definition revision advanced and health endpoint returns 200

## Step 5: Summary

Display:
- What was deployed (stack + imageTag) and where
- Verification results (smoke test, stack status)
- Suggest creating a deployment runbook if none exists

## Error Recovery

### If pre-deploy checks fail (Step 1)
Stop. Do not deploy from a dirty tree or with failing tests unless the user explicitly authorizes a branch/mid-phase deploy.

### If build-push fails (Step 2)
- "tag already exists": the repo is immutable — pass a fresh tag (new commit or explicit `bash scripts/build-push.sh <new-tag>`)
- Docker login/ECR errors: check AWS credentials and region `ap-northeast-2`

### If deployment fails (Step 3)
- Check CloudFormation events for the failed resource and rollback reason
- `cd infra && npx cdk diff <Stack> -c imageTag="$TAG"` to inspect the pending change

### If a bad deployment was published — rollback
This repo has no git remote; rollback = redeploy the previous known-good image tag:
```bash
cd infra && npx cdk deploy NfmDash-App --require-approval never -c imageTag=<previous-sha>
```

### If health check fails after deployment (Step 4)
- Check ECS service events and container logs for startup errors
- Verify environment variables / SSM parameters (e.g. `/nfm-dashboard/gateway-url`) are set
- If unrecoverable, trigger the rollback procedure above
