"""
NFM Dashboard DDB MCP Lambda - DynamoDB-backed flow/topology query tools
NFM Dashboard DDB MCP Lambda - DynamoDB 기반 플로우/토폴로지 조회 도구

Provides 6 tools via AgentCore Gateway MCP (awsops lambda_handler contract):
query_pod_flows, query_flow_edges, get_topology_snapshot, get_top_talkers,
find_flow_path, get_collection_status.
AgentCore Gateway MCP를 통해 6개 도구를 제공합니다 (awsops lambda_handler 계약).
"""
import json, os
import boto3
from boto3.dynamodb.conditions import Key

TABLE_FLOWS = os.environ.get("TABLE_FLOWS", "nfm-dashboard-flows")
TABLE_META = os.environ.get("TABLE_META", "nfm-dashboard-meta")
_dyn = None


def _table(name):
    global _dyn
    if _dyn is None:
        _dyn = boto3.resource("dynamodb", region_name="ap-northeast-2")
    return _dyn.Table(name)


def ok(body):  return {"statusCode": 200, "body": json.dumps(body, default=str)}
def err(msg):  return {"statusCode": 400, "body": json.dumps({"error": msg})}


def _get_topology():
    it = _table(TABLE_META).get_item(Key={"pk": "TOPO#latest", "sk": "snapshot"}).get("Item")
    return it["topology"] if it else {"nodes": [], "edges": []}


def _pod_str(endpoint):
    """Render an endpoint map as "namespace/pod" for comparison. / 엔드포인트를 "namespace/pod" 문자열로 변환"""
    if not endpoint:
        return ""
    return "{}/{}".format(endpoint.get("podNamespace", ""), endpoint.get("podName", ""))


def get_top_talkers(args):
    metric, limit = args.get("metric", "DATA_TRANSFERRED"), int(args.get("limit", 20))
    edges = sorted(_get_topology()["edges"],
                   key=lambda e: e.get("metrics", {}).get(metric, 0), reverse=True)[:limit]
    return ok({"metric": metric, "edges": edges})


def query_pod_flows(args):
    pk = f"POD#{args['namespace']}/{args['pod']}"; limit = int(args.get("limit", 50))
    t = _table(TABLE_FLOWS); items = []
    for idx, key in (("GSI1", "gsi1pk"), ("GSI2", "gsi2pk")):
        items += t.query(IndexName=idx, KeyConditionExpression=Key(key).eq(pk),
                         ScanIndexForward=False, Limit=limit).get("Items", [])
    items.sort(key=lambda i: i.get("bucket", ""), reverse=True)
    return ok({"flows": items[:limit]})


def query_flow_edges(args):
    """Query all flow items for a given edge hash via GSI3, newest first. / GSI3로 edge_hash의 모든 플로우 조회 (최신순)"""
    edge_hash = args.get("edge_hash", "")
    if not edge_hash:
        return err("edge_hash required")
    limit = int(args.get("limit", 50))
    pk = f"EDGE#{edge_hash}"
    items = _table(TABLE_FLOWS).query(
        IndexName="GSI3", KeyConditionExpression=Key("gsi3pk").eq(pk),
        ScanIndexForward=False, Limit=limit).get("Items", [])
    return ok({"edgeHash": edge_hash, "flows": items[:limit]})


def find_flow_path(args):
    """Find the latest flow connecting src_pod and dst_pod ("namespace/pod" strings).
    src_pod과 dst_pod("namespace/pod" 문자열)을 연결하는 최신 플로우를 찾는다.

    Queries GSI1 (and GSI2 as a fallback, since either side of a flow item may
    hold src_pod depending on edge normalization) keyed on src_pod, then filters
    for items whose other side matches dst_pod.
    GSI1을 우선 조회하고(엣지 정규화상 src_pod이 a/b 어느 쪽에도 위치할 수 있어 GSI2도 보조 조회),
    상대측이 dst_pod과 일치하는 항목을 필터링한다.
    """
    src_pod = args.get("src_pod", "")
    dst_pod = args.get("dst_pod", "")
    if not src_pod or not dst_pod:
        return err("src_pod and dst_pod required")
    pk = f"POD#{src_pod}"
    t = _table(TABLE_FLOWS)
    items = []
    for idx, key in (("GSI1", "gsi1pk"), ("GSI2", "gsi2pk")):
        items += t.query(IndexName=idx, KeyConditionExpression=Key(key).eq(pk),
                         ScanIndexForward=False).get("Items", [])

    matches = [i for i in items if _pod_str(i.get("a")) == dst_pod or _pod_str(i.get("b")) == dst_pod]
    if not matches:
        return err(f"no flow path found between {src_pod} and {dst_pod}")
    matches.sort(key=lambda i: i.get("bucket", ""), reverse=True)
    latest = matches[0]
    return ok({
        "a": latest.get("a"), "b": latest.get("b"),
        "traversedConstructs": latest.get("traversedConstructs", []),
        "snatIp": latest.get("snatIp"), "dnatIp": latest.get("dnatIp"),
        "targetPort": latest.get("targetPort"),
        "metric": latest.get("metric"), "value": latest.get("value"),
        "bucket": latest.get("bucket"), "monitor": latest.get("monitor"),
    })


def get_collection_status(args):
    """Return the latest collector cycle status from TABLE_META. / 최신 수집 사이클 상태 조회"""
    it = _table(TABLE_META).get_item(Key={"pk": "STATUS#collect", "sk": "latest"}).get("Item")
    return ok(it if it else {})


TOOLS = {"query_pod_flows": query_pod_flows, "query_flow_edges": query_flow_edges,
         "get_topology_snapshot": lambda a: ok(_get_topology()),
         "get_top_talkers": get_top_talkers, "find_flow_path": find_flow_path,
         "get_collection_status": get_collection_status}


def lambda_handler(event, context):
    t = event.get("tool_name", ""); args = event.get("arguments", event)
    fn = TOOLS.get(t)
    return fn(args) if fn else err(f"unknown tool: {t}")
