#!/usr/bin/env bash
# Live E2E smoke against the deployed app.
#   bash scripts/smoke.sh            # all 3 specs
#   bash scripts/smoke.sh -g login   # filter, extra args pass through to playwright
#
# The Cognito admin password is pulled from Secrets Manager at runtime (only
# when auth is enabled) and only ever lives in this process's environment —
# never on disk, never in git. When the deployed `authDisabled` CDK context is
# on, E2E_AUTH_DISABLED=1 is exported and the spec asserts the no-login flow.
set -euo pipefail
cd "$(dirname "$0")/.."

REGION="${AWS_REGION:-ap-northeast-2}"

# APP_URL: default to the live CloudFront URL from the NfmDash-App stack output.
if [[ -z "${APP_URL:-}" ]]; then
  APP_URL="$(aws cloudformation describe-stacks --stack-name NfmDash-App --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='AppUrl'].OutputValue" --output text)"
fi
export APP_URL

export E2E_EMAIL="${E2E_EMAIL:-admin@whchoi.net}"

# Auth mode: mirror the deployed `authDisabled` CDK context (infra/cdk.json) so
# the spec asserts what is actually deployed. Explicit E2E_AUTH_DISABLED wins.
if [[ -z "${E2E_AUTH_DISABLED:-}" ]]; then
  E2E_AUTH_DISABLED="$(python3 -c 'import json; ctx = json.load(open("infra/cdk.json")).get("context", {}); print(1 if str(ctx.get("authDisabled", "")).lower() == "true" else 0)')"
fi
export E2E_AUTH_DISABLED

# Cognito credentials are only needed when the login flow is exercised.
if [[ "$E2E_AUTH_DISABLED" != "1" && -z "${E2E_PASSWORD:-}" ]]; then
  E2E_PASSWORD="$(aws secretsmanager get-secret-value --secret-id nfm-dashboard/cognito-admin \
    --region "$REGION" --query SecretString --output text \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["password"])')"
fi
export E2E_PASSWORD="${E2E_PASSWORD:-}"

echo "smoke: APP_URL=$APP_URL E2E_EMAIL=$E2E_EMAIL AUTH_DISABLED=$E2E_AUTH_DISABLED"
npx playwright test --config e2e/playwright.config.ts "$@"
