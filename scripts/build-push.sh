#!/usr/bin/env bash
# Builds the arm64 app image (Next.js standalone) and pushes it to ECR.
# Usage: bash scripts/build-push.sh [tag]   (default: current git short SHA)
# Pushes the immutable per-commit tag AND a convenience `latest` tag.
# Deploys must pin the SHA tag: cdk deploy NfmDash-App -c imageTag=<sha>
set -euo pipefail
cd "$(dirname "$0")/.."
ACCOUNT=<ACCOUNT_ID>; REGION=ap-northeast-2; REPO=nfm-dashboard-app
TAG=${1:-$(git rev-parse --short HEAD)}
# New repos are created tag-IMMUTABLE; a pre-existing repo may still be MUTABLE.
aws ecr describe-repositories --repository-names $REPO --region $REGION >/dev/null 2>&1 || \
  aws ecr create-repository --repository-name $REPO --region $REGION \
    --image-tag-mutability IMMUTABLE \
    --image-scanning-configuration scanOnPush=true >/dev/null
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin \
  $ACCOUNT.dkr.ecr.$REGION.amazonaws.com
docker build --platform linux/arm64 -f app/Dockerfile -t $REPO:$TAG .
docker tag $REPO:$TAG $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG
docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG
# Convenience alias only — never referenced by the stack. On an IMMUTABLE repo
# re-pushing `latest` is rejected; warn instead of failing (the SHA tag rules).
docker tag $REPO:$TAG $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:latest
docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:latest || \
  echo "WARN: pushing 'latest' failed (tag-immutable repo?) — SHA tag $TAG is authoritative." >&2
echo "Pushed image tag: $TAG"
