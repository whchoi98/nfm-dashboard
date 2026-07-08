#!/usr/bin/env bash
# Builds the arm64 app image (Next.js standalone) and pushes it to ECR.
# Usage: bash scripts/build-push.sh [tag]   (default: latest)
set -euo pipefail
cd "$(dirname "$0")/.."
ACCOUNT=<ACCOUNT_ID>; REGION=ap-northeast-2; REPO=nfm-dashboard-app
TAG=${1:-latest}
aws ecr describe-repositories --repository-names $REPO --region $REGION >/dev/null 2>&1 || \
  aws ecr create-repository --repository-name $REPO --region $REGION \
    --image-scanning-configuration scanOnPush=true >/dev/null
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin \
  $ACCOUNT.dkr.ecr.$REGION.amazonaws.com
docker build --platform linux/arm64 -f app/Dockerfile -t $REPO:$TAG .
docker tag $REPO:$TAG $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG
docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG
