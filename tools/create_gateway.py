"""
NFM Dashboard AgentCore Gateway setup - create nfm-gateway + 3 Lambda MCP targets.
NFM Dashboard AgentCore Gateway 설정 - nfm-gateway 및 Lambda MCP 타겟 3개 생성.

Usage: python3 tools/create_gateway.py <gateway-role-arn>

Idempotent (awsops agent/lambda/create_targets.py pattern): gateway and each
target are created only if absent (EXISTS check by name). After completion the
gateway MCP URL is written to SSM parameter /nfm-dashboard/gateway-url.
멱등 실행 (awsops create_targets.py 패턴): 게이트웨이와 각 타겟은 이름 기준
EXISTS 체크 후 없을 때만 생성. 완료 후 게이트웨이 MCP URL을 SSM 파라미터에 기록.

Note: create_gateway requires authorizerType (API-required parameter). We use
"NONE" to match the 13 existing awsops gateways in this account (all READY,
consumed with SigV4-signed clients). "AWS_IAM" is the stricter alternative.
참고: create_gateway는 authorizerType이 필수 파라미터라서, 이 계정의 기존
awsops 게이트웨이 13개와 동일하게 "NONE"을 사용한다 (SigV4 서명 클라이언트로 사용).
"""
import sys
import time

import boto3

REGION, ACCOUNT = "ap-northeast-2", "<ACCOUNT_ID>"
GATEWAY_NAME = "nfm-gateway"
client = boto3.client("bedrock-agentcore-control", region_name=REGION)
ssm = boto3.client("ssm", region_name=REGION)


def prop(t, d=""):
    r = {"type": t}
    if d:
        r["description"] = d
    return r


def find_gateway():
    """Find nfm-gateway by exact name across all pages. / 전체 페이지에서 이름으로 게이트웨이 검색."""
    next_token = None
    while True:
        kwargs = {"nextToken": next_token} if next_token else {}
        resp = client.list_gateways(**kwargs)
        for g in resp.get("items", []):
            if g["name"] == GATEWAY_NAME:
                return g["gatewayId"]
        next_token = resp.get("nextToken")
        if not next_token:
            return None


def ensure_gateway(role_arn):
    """Create nfm-gateway if absent; wait until READY. / 없으면 생성 후 READY까지 대기."""
    gw_id = find_gateway()
    if gw_id:
        print("EXISTS", GATEWAY_NAME, gw_id)
        return gw_id
    try:
        r = client.create_gateway(name=GATEWAY_NAME, protocolType="MCP",
                                  authorizerType="NONE", roleArn=role_arn,
                                  description="NFM dashboard network/flow/ddb tools")
    except client.exceptions.ConflictException:
        # Race/late visibility: gateway already exists / 경합 또는 지연 노출: 이미 존재
        gw_id = find_gateway()
        if gw_id:
            print("EXISTS", GATEWAY_NAME, gw_id)
            return gw_id
        raise
    except Exception as e:
        # Newly created IAM roles can take a moment to propagate / IAM 롤 전파 지연 대비 1회 재시도
        print("create_gateway failed ({}); retrying in 15s...".format(str(e)[:120]))
        time.sleep(15)
        r = client.create_gateway(name=GATEWAY_NAME, protocolType="MCP",
                                  authorizerType="NONE", roleArn=role_arn,
                                  description="NFM dashboard network/flow/ddb tools")
    gw_id = r["gatewayId"]
    while True:
        status = client.get_gateway(gatewayIdentifier=gw_id)["status"]
        if status == "READY":
            break
        if status == "FAILED":
            print("ERROR: gateway creation FAILED", gw_id)
            sys.exit(1)
        time.sleep(5)
    print("CREATED", GATEWAY_NAME, gw_id)
    return gw_id


def create_target(gw_id, name, fn_name, desc, tools):
    """Create a Lambda MCP target if absent. / 없으면 Lambda MCP 타겟 생성."""
    next_token = None
    while True:
        kwargs = {"gatewayIdentifier": gw_id}
        if next_token:
            kwargs["nextToken"] = next_token
        resp = client.list_gateway_targets(**kwargs)
        if any(e["name"] == name for e in resp.get("items", [])):
            print("EXISTS", name)
            return
        next_token = resp.get("nextToken")
        if not next_token:
            break
    client.create_gateway_target(gatewayIdentifier=gw_id, name=name, description=desc,
        targetConfiguration={"mcp": {"lambda": {
            "lambdaArn": f"arn:aws:lambda:{REGION}:{ACCOUNT}:function:{fn_name}",
            "toolSchema": {"inlinePayload": tools}}}},
        credentialProviderConfigurations=[{"credentialProviderType": "GATEWAY_IAM_ROLE"}])
    print("CREATED", name)


# ========== nfm-dashboard-mcp-network: 16 tools (tools/network_mcp.py) ==========
NETWORK_TOOLS = [{"name": n, "description": d, "inputSchema": s} for n, d, s in [
    ("get_path_trace_methodology", "Step-by-step methodology for tracing a network path between two endpoints (SG, NACL, routes, TGW, VPN, firewall, flow logs). Call first when troubleshooting connectivity.",
     {"type": "object", "properties": {}}),
    ("find_ip_address", "Locate ENIs by private or public IP address; returns ENI ID, VPC, subnet, AZ, attached instance.",
     {"type": "object", "properties": {"ip_address": prop("string", "IPv4 address to locate")},
      "required": ["ip_address"]}),
    ("get_eni_details", "Full ENI details: security group rules (in/out), subnet NACL rules, and effective route table routes.",
     {"type": "object", "properties": {"eni_id": prop("string", "ENI ID (eni-...)")},
      "required": ["eni_id"]}),
    ("list_vpcs", "List all VPCs with name, CIDR, and state.",
     {"type": "object", "properties": {}}),
    ("get_vpc_network_details", "Comprehensive VPC config: subnets, route table/SG counts, IGWs, NAT gateways, VPC endpoints.",
     {"type": "object", "properties": {"vpc_id": prop("string", "VPC ID (vpc-...)")},
      "required": ["vpc_id"]}),
    ("get_vpc_flow_logs", "Fetch recent VPC Flow Log events from CloudWatch Logs (ACCEPT/REJECT records).",
     {"type": "object", "properties": {"vpc_id": prop("string", "VPC ID (vpc-...)"),
        "minutes": prop("integer", "Look-back window in minutes (default 30)"),
        "filter_pattern": prop("string", "CloudWatch Logs filter pattern, e.g. REJECT or an IP")},
      "required": ["vpc_id"]}),
    ("describe_network", "Describe network resources by type: security_group, nacl, route_table, subnet, or vpc. Filter by resource_id or vpc_id.",
     {"type": "object", "properties": {
        "resource_type": prop("string", "One of: security_group, nacl, route_table, subnet, vpc"),
        "resource_id": prop("string", "Specific resource ID (optional)"),
        "vpc_id": prop("string", "Filter by VPC ID (optional)")},
      "required": ["resource_type"]}),
    ("list_transit_gateways", "List all Transit Gateways with state, owner, and ASN.",
     {"type": "object", "properties": {}}),
    ("get_tgw_details", "Transit Gateway details with attachments and route tables.",
     {"type": "object", "properties": {"tgw_id": prop("string", "Transit Gateway ID (tgw-...)")},
      "required": ["tgw_id"]}),
    ("get_tgw_routes", "Search one TGW route table for active/blackhole routes.",
     {"type": "object", "properties": {"route_table_id": prop("string", "TGW route table ID (tgw-rtb-...)")},
      "required": ["route_table_id"]}),
    ("get_all_tgw_routes", "Routes from every route table of a Transit Gateway.",
     {"type": "object", "properties": {"tgw_id": prop("string", "Transit Gateway ID (tgw-...)")},
      "required": ["tgw_id"]}),
    ("list_tgw_peerings", "List peering attachments of a Transit Gateway.",
     {"type": "object", "properties": {"tgw_id": prop("string", "Transit Gateway ID (tgw-...)")},
      "required": ["tgw_id"]}),
    ("list_vpn_connections", "List Site-to-Site VPN connections with per-tunnel status.",
     {"type": "object", "properties": {}}),
    ("list_network_firewalls", "List AWS Network Firewalls (name, ARN).",
     {"type": "object", "properties": {}}),
    ("get_firewall_rules", "Network Firewall policy rule groups (stateless + stateful) and default actions.",
     {"type": "object", "properties": {"firewall_name": prop("string", "Network Firewall name")},
      "required": ["firewall_name"]}),
    ("analyze_reachability", "Start a VPC Reachability Analyzer analysis between two resources (instance/ENI IDs); definitive path verdict. Returns pathId/analysisId to check later.",
     {"type": "object", "properties": {
        "source": prop("string", "Source resource ID (instance, ENI, IGW, etc.)"),
        "destination": prop("string", "Destination resource ID"),
        "protocol": prop("string", "tcp or udp (default tcp)"),
        "port": prop("integer", "Destination port (default 443)")},
      "required": ["source", "destination"]}),
]]

# ========== nfm-dashboard-mcp-nfm: 5 tools (tools/nfm_mcp.py) ==========
NFM_TOOLS = [{"name": n, "description": d, "inputSchema": s} for n, d, s in [
    ("list_nfm_monitors", "List all CloudWatch NetworkFlowMonitor monitors (name, status, ARN).",
     {"type": "object", "properties": {}}),
    ("query_top_contributors", "Run a NetworkFlowMonitor top-contributors query for one monitor/metric/category; returns per-flow rows (IPs, instances, AZs, k8s metadata, traversed constructs). Takes up to ~2 min.",
     {"type": "object", "properties": {
        "monitor_name": prop("string", "NetworkFlowMonitor monitor name"),
        "metric_name": prop("string", "One of: DATA_TRANSFERRED, RETRANSMISSIONS, TIMEOUTS, ROUND_TRIP_TIME"),
        "destination_category": prop("string", "One of: INTRA_AZ, INTER_AZ, INTER_VPC, UNCLASSIFIED, AMAZON_S3, AMAZON_DYNAMODB"),
        "minutes_back": prop("integer", "Look-back window in minutes (default 60)"),
        "limit": prop("integer", "Max rows (default 50, max 100)")},
      "required": ["monitor_name", "metric_name", "destination_category"]}),
    ("get_workload_insights", "Workload Insights top contributors for one metric across INTRA_AZ/INTER_AZ/INTER_VPC categories (account-scope view).",
     {"type": "object", "properties": {
        "metric_name": prop("string", "One of: DATA_TRANSFERRED, RETRANSMISSIONS, TIMEOUTS, ROUND_TRIP_TIME"),
        "minutes_back": prop("integer", "Look-back window in minutes (default 60)")},
      "required": ["metric_name"]}),
    ("get_agent_coverage", "Latest NFM agent coverage snapshot (which EC2/EKS nodes report flow data).",
     {"type": "object", "properties": {}}),
    ("get_network_health", "AWS/NetworkFlowMonitor CloudWatch metrics for every monitor over the last 30 minutes (DataTransferred, Retransmissions, Timeouts, RoundTripTime, HealthIndicator).",
     {"type": "object", "properties": {}}),
]]

# ========== nfm-dashboard-mcp-ddb: 6 tools (tools/ddb_mcp.py) ==========
DDB_TOOLS = [{"name": n, "description": d, "inputSchema": s} for n, d, s in [
    ("query_pod_flows", "All recent flows involving a Kubernetes pod (either direction), newest first.",
     {"type": "object", "properties": {
        "namespace": prop("string", "Kubernetes namespace"),
        "pod": prop("string", "Pod name"),
        "limit": prop("integer", "Max flows (default 50)")},
      "required": ["namespace", "pod"]}),
    ("query_flow_edges", "Time-series flow records for one topology edge by its edge hash, newest first.",
     {"type": "object", "properties": {
        "edge_hash": prop("string", "Edge hash from the topology snapshot"),
        "limit": prop("integer", "Max records (default 50)")},
      "required": ["edge_hash"]}),
    ("get_topology_snapshot", "Latest full network topology snapshot (nodes and edges with metrics).",
     {"type": "object", "properties": {}}),
    ("get_top_talkers", "Topology edges ranked by a metric - the busiest/worst flows.",
     {"type": "object", "properties": {
        "metric": prop("string", "Ranking metric: DATA_TRANSFERRED (default), RETRANSMISSIONS, TIMEOUTS, or ROUND_TRIP_TIME"),
        "limit": prop("integer", "Max edges (default 20)")},
      "required": []}),
    ("find_flow_path", "Latest flow connecting two pods, with traversed constructs (TGW/NAT/etc.) and SNAT/DNAT IPs.",
     {"type": "object", "properties": {
        "src_pod": prop("string", 'Source pod as "namespace/pod"'),
        "dst_pod": prop("string", 'Destination pod as "namespace/pod"')},
      "required": ["src_pod", "dst_pod"]}),
    ("get_collection_status", "Latest collector cycle status (last run time, per-monitor row counts, errors).",
     {"type": "object", "properties": {}}),
]]


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 tools/create_gateway.py <gateway-role-arn>")
        sys.exit(1)
    role_arn = sys.argv[1]
    gw_id = ensure_gateway(role_arn)
    create_target(gw_id, "network-mcp-target", "nfm-dashboard-mcp-network",
        "AWS Network MCP - VPC, TGW, VPN, ENI, Firewall, Flow Logs, Reachability (16 tools)",
        NETWORK_TOOLS)
    create_target(gw_id, "nfm-mcp-target", "nfm-dashboard-mcp-nfm",
        "NetworkFlowMonitor MCP - monitors, top contributors, workload insights, health (5 tools)",
        NFM_TOOLS)
    create_target(gw_id, "ddb-mcp-target", "nfm-dashboard-mcp-ddb",
        "Flow/topology store MCP - pod flows, edges, topology, top talkers, paths (6 tools)",
        DDB_TOOLS)
    url = f"https://{gw_id}.gateway.bedrock-agentcore.{REGION}.amazonaws.com/mcp"
    ssm.put_parameter(Name="/nfm-dashboard/gateway-url", Value=url, Type="String", Overwrite=True)
    print("SSM /nfm-dashboard/gateway-url =", url)


if __name__ == "__main__":
    main()
