# tools — AgentCore MCP Tool Lambdas (Python)

## Role
Python tools backing the Bedrock AgentCore gateway. Three MCP tool Lambdas expose read-only NFM/DynamoDB/network data to the chatbot over MCP (invoked via SigV4 through the gateway), plus a one-time gateway provisioning script. Deployed by the `NfmDash-AgentCore` stack (Python 3.13, arm64). The app's `src/lib/mcp-client.ts` is the SigV4 client that calls these through the gateway.

## Key Files
- `nfm_mcp.py` — MCP tools over CloudWatch Network Flow Monitor (monitor/workload-insights queries, health indicator)
- `ddb_mcp.py` — MCP tools reading the `nfm-dashboard-flows` / `nfm-dashboard-meta` DynamoDB tables (flows, snapshots, latest)
- `network_mcp.py` — MCP tools for network reachability / path analysis
- `create_gateway.py` — one-time AgentCore gateway + target provisioning (also driven by `scripts/setup-gateway.sh`)
- `requirements-dev.txt` — dev/test deps
- `prompts/` — tool prompt assets (if present)

## Rules
- Read-only: these tools query AWS + DynamoDB; they never mutate operational data.
- Keep tool input/output schemas aligned with what the chatbot backend (`app/src/lib`) expects; the gateway target config in `create_gateway.py` must match the deployed tool signatures.
- Region `ap-northeast-2`, account `<ACCOUNT_ID>`; the gateway URL lives in SSM SecureString `/nfm-dashboard/gateway-url`.
- Tests co-located (`test_*.py` / pytest); dev deps in `requirements-dev.txt`.
