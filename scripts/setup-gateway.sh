#!/usr/bin/env bash
set -euo pipefail
ROLE_ARN=$(aws cloudformation describe-stacks --stack-name NfmDash-AgentCore \
  --query "Stacks[0].Outputs[?OutputKey=='GatewayRoleArn'].OutputValue" --output text)
python3 tools/create_gateway.py "$ROLE_ARN"
