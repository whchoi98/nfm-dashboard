#!/usr/bin/env bash
# Live E2E smoke against the deployed app.
#   bash scripts/smoke.sh            # all 3 specs
#   bash scripts/smoke.sh -g login   # filter, extra args pass through to playwright
#
# The Cognito admin password is pulled from Secrets Manager at runtime and
# only ever lives in this process's environment — never on disk, never in git.
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

if [[ -z "${E2E_PASSWORD:-}" ]]; then
  E2E_PASSWORD="$(aws secretsmanager get-secret-value --secret-id nfm-dashboard/cognito-admin \
    --region "$REGION" --query SecretString --output text \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["password"])')"
fi
export E2E_PASSWORD

echo "smoke: APP_URL=$APP_URL E2E_EMAIL=$E2E_EMAIL"
npx playwright test --config e2e/playwright.config.ts "$@"
