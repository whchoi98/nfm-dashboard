#!/usr/bin/env bash
# Saves the Cognito initial-admin credentials to Secrets Manager.
# The AppStack custom resource reads this secret at deploy time (AdminCreateUser
# + AdminSetUserPassword) — the password never enters a CFN template or git.
set -euo pipefail
read -rsp "Cognito admin 초기 비밀번호 입력: " PW; echo
aws secretsmanager create-secret --name nfm-dashboard/cognito-admin \
  --secret-string "{\"email\":\"admin@whchoi.net\",\"password\":\"$PW\"}" 2>/dev/null || \
aws secretsmanager put-secret-value --secret-id nfm-dashboard/cognito-admin \
  --secret-string "{\"email\":\"admin@whchoi.net\",\"password\":\"$PW\"}"
echo "saved."
