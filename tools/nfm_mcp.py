"""
NFM Dashboard NFM MCP Lambda - NetworkFlowMonitor / CloudWatch query tools
NFM Dashboard NFM MCP Lambda - NetworkFlowMonitor / CloudWatch 조회 도구

Provides 5 tools via AgentCore Gateway MCP (awsops lambda_handler contract):
list_nfm_monitors, query_top_contributors, get_workload_insights,
get_agent_coverage, get_network_health.
AgentCore Gateway MCP를 통해 5개 도구를 제공합니다 (awsops lambda_handler 계약).

Note: the `networkflowmonitor` boto3 client uses camelCase parameter/response
keys (a smithy/JSON-protocol service), unlike most "query protocol" AWS
services -- confirmed against the live service model.
`networkflowmonitor` boto3 클라이언트는 (smithy/JSON 프로토콜 서비스라서) 대부분의
"query protocol" 서비스와 달리 camelCase 파라미터/응답 키를 사용한다 (실제 서비스 모델로 확인).
"""
import json, os, time
from datetime import datetime, timedelta, timezone
import boto3

TABLE_META = os.environ.get("TABLE_META", "nfm-dashboard-meta")
REGION = "ap-northeast-2"

WI_CATEGORIES = ("INTRA_AZ", "INTER_AZ", "INTER_VPC")
# GetMetricData stat per AWS/NetworkFlowMonitor metric name / 지표별 GetMetricData 통계 방식
CW_METRIC_STATS = {
    "DataTransferred": "Sum", "Retransmissions": "Sum", "Timeouts": "Sum",
    "RoundTripTime": "Average", "HealthIndicator": "Average",
}

_nfm = None
_cw = None
_dyn = None


def _nfm_client():
    global _nfm
    if _nfm is None:
        _nfm = boto3.client("networkflowmonitor", region_name=REGION)
    return _nfm


def _cw_client():
    global _cw
    if _cw is None:
        _cw = boto3.client("cloudwatch", region_name=REGION)
    return _cw


def _table(name):
    global _dyn
    if _dyn is None:
        _dyn = boto3.resource("dynamodb", region_name=REGION)
    return _dyn.Table(name)


def ok(body):  return {"statusCode": 200, "body": json.dumps(body, default=str)}
def err(msg):  return {"statusCode": 400, "body": json.dumps({"error": msg})}


def list_nfm_monitors(args):
    """List all NetworkFlowMonitor monitors. / 모든 NetworkFlowMonitor 모니터 목록 조회"""
    nfm = _nfm_client()
    monitors, next_token = [], None
    while True:
        kwargs = {"nextToken": next_token} if next_token else {}
        resp = nfm.list_monitors(**kwargs)
        monitors += resp.get("monitors", [])
        next_token = resp.get("nextToken")
        if not next_token:
            break
    return ok({"monitors": [{"name": m.get("monitorName"), "status": m.get("monitorStatus"),
                              "arn": m.get("monitorArn")} for m in monitors]})


def _truncate_row(row):
    """Trim a raw MonitorTopContributors row to the essentials for agent consumption.
    MonitorTopContributors 원본 행을 에이전트가 쓰기 좋은 핵심 필드로 축약."""
    return {
        "value": row.get("value"),
        "targetPort": row.get("targetPort"),
        "ips": {"local": row.get("localIp"), "remote": row.get("remoteIp")},
        "instances": {"local": row.get("localInstanceId"), "remote": row.get("remoteInstanceId")},
        "azs": {"local": row.get("localAz"), "remote": row.get("remoteAz")},
        "kubernetesMetadata": row.get("kubernetesMetadata", {}),
        "traversedConstructs": row.get("traversedConstructs", []),
    }


def query_top_contributors(args):
    """Start->poll(2s, max 60 = 120s)->Get monitor top-contributors query.
    모니터 상위 기여자 쿼리를 Start->poll(2초, 최대 60회=120초)->Get 순서로 실행."""
    monitor_name = args.get("monitor_name", "")
    metric_name = args.get("metric_name", "")
    destination_category = args.get("destination_category", "")
    minutes_back = int(args.get("minutes_back", 60))
    limit = int(args.get("limit", 50))
    if not monitor_name or not metric_name or not destination_category:
        return err("monitor_name, metric_name, and destination_category are required")

    nfm = _nfm_client()
    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=minutes_back)
    try:
        resp = nfm.start_query_monitor_top_contributors(
            monitorName=monitor_name, metricName=metric_name,
            destinationCategory=destination_category,
            startTime=start, endTime=end, limit=min(limit, 100))
    except Exception as e:
        return err(f"start query failed: {e}")
    query_id = resp.get("queryId")

    status = None
    for i in range(60):
        status = nfm.get_query_status_monitor_top_contributors(
            monitorName=monitor_name, queryId=query_id).get("status")
        if status == "SUCCEEDED":
            break
        if status in ("FAILED", "CANCELED"):
            return err(f"query {status.lower()}")
        if i == 59:
            try:
                nfm.stop_query_monitor_top_contributors(monitorName=monitor_name, queryId=query_id)
            except Exception:
                pass
            return err("query timed out after 120s")
        time.sleep(2)

    rows, next_token = [], None
    while True:
        kwargs = {"monitorName": monitor_name, "queryId": query_id}
        if next_token:
            kwargs["nextToken"] = next_token
        results = nfm.get_query_results_monitor_top_contributors(**kwargs)
        rows += results.get("topContributors", [])
        next_token = results.get("nextToken")
        if not next_token or len(rows) >= limit:
            break

    return ok({"monitor": monitor_name, "metric": metric_name, "category": destination_category,
               "rows": [_truncate_row(r) for r in rows[:limit]]})


def get_workload_insights(args):
    """Start->poll(2s, max 30=60s)->Get workload-insights top-contributors for one metric
    across all destination categories (INTRA_AZ/INTER_AZ/INTER_VPC).
    한 지표에 대해 모든 목적지 카테고리(INTRA_AZ/INTER_AZ/INTER_VPC)의 워크로드 인사이트
    상위 기여자를 Start->poll(2초, 최대 30회=60초)->Get 순서로 실행."""
    metric_name = args.get("metric_name", "")
    minutes_back = int(args.get("minutes_back", 60))
    if not metric_name:
        return err("metric_name required")

    nfm = _nfm_client()
    try:
        scopes = nfm.list_scopes().get("scopes", [])
    except Exception as e:
        return err(f"list_scopes failed: {e}")
    if not scopes:
        return err("no scope found")
    scope_id = scopes[0].get("scopeId")

    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=minutes_back)

    results = []
    for category in WI_CATEGORIES:
        try:
            resp = nfm.start_query_workload_insights_top_contributors(
                scopeId=scope_id, metricName=metric_name, destinationCategory=category,
                startTime=start, endTime=end, limit=100)
        except Exception as e:
            results.append({"category": category, "error": str(e), "rows": []})
            continue
        query_id = resp.get("queryId")

        status = None
        for i in range(30):
            status = nfm.get_query_status_workload_insights_top_contributors(
                scopeId=scope_id, queryId=query_id).get("status")
            if status in ("SUCCEEDED", "FAILED", "CANCELED"):
                break
            if i == 29:
                try:
                    nfm.stop_query_workload_insights_top_contributors(scopeId=scope_id, queryId=query_id)
                except Exception:
                    pass
            else:
                time.sleep(2)

        if status != "SUCCEEDED":
            results.append({"category": category, "rows": [], "status": status})
            continue

        rows, next_token = [], None
        while True:
            kwargs = {"scopeId": scope_id, "queryId": query_id}
            if next_token:
                kwargs["nextToken"] = next_token
            res = nfm.get_query_results_workload_insights_top_contributors(**kwargs)
            for r in res.get("topContributors", []):
                rows.append({"accountId": r.get("accountId"), "localSubnetId": r.get("localSubnetId"),
                             "localAz": r.get("localAz"), "localVpcId": r.get("localVpcId"),
                             "remoteIdentifier": r.get("remoteIdentifier"), "value": r.get("value")})
            next_token = res.get("nextToken")
            if not next_token:
                break
        results.append({"category": category, "rows": rows})

    return ok({"scopeId": scope_id, "metric": metric_name, "results": results})


def get_agent_coverage(args):
    """Read the latest agent coverage snapshot from TABLE_META (COVERAGE#latest/all).
    TABLE_META에서 최신 에이전트 커버리지 스냅샷을 조회 (COVERAGE#latest/all)."""
    it = _table(TABLE_META).get_item(Key={"pk": "COVERAGE#latest", "sk": "all"}).get("Item")
    return ok(it.get("coverage", {}) if it else {})


def get_network_health(args):
    """GetMetricData over AWS/NetworkFlowMonitor for the last 30 minutes, period 300s,
    for the 5 standard metrics across every monitor discovered via ListMetrics.
    ListMetrics로 발견한 모든 모니터에 대해 5개 표준 지표를 최근 30분/300초 주기로 GetMetricData 조회."""
    cw = _cw_client()
    metrics, next_token = [], None
    while True:
        kwargs = {"Namespace": "AWS/NetworkFlowMonitor"}
        if next_token:
            kwargs["NextToken"] = next_token
        resp = cw.list_metrics(**kwargs)
        metrics += resp.get("Metrics", [])
        next_token = resp.get("NextToken")
        if not next_token:
            break
    if not metrics:
        return ok({"monitors": {}})

    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=30)
    queries = []
    query_meta = {}
    for i, m in enumerate(metrics):
        metric_name = m.get("MetricName", "")
        dims = m.get("Dimensions", [])
        dim_value = dims[0].get("Value", "") if dims else ""
        monitor_label = dim_value.split("/")[-1] if dim_value else "unknown"
        qid = f"q{i}"
        query_meta[qid] = {"monitor": monitor_label, "metric": metric_name}
        queries.append({
            "Id": qid,
            "MetricStat": {
                "Metric": {"Namespace": "AWS/NetworkFlowMonitor", "MetricName": metric_name, "Dimensions": dims},
                "Period": 300,
                "Stat": CW_METRIC_STATS.get(metric_name, "Average"),
            },
            "ReturnData": True,
        })

    monitors = {}
    # GetMetricData accepts at most 500 queries per call / GetMetricData는 호출당 최대 500개 쿼리
    for chunk_start in range(0, len(queries), 500):
        chunk = queries[chunk_start:chunk_start + 500]
        resp = cw.get_metric_data(MetricDataQueries=chunk, StartTime=start, EndTime=end)
        for r in resp.get("MetricDataResults", []):
            meta = query_meta.get(r.get("Id"), {})
            monitor_label, metric_name = meta.get("monitor", "unknown"), meta.get("metric", "")
            entry = monitors.setdefault(monitor_label, {})
            timestamps = r.get("Timestamps", [])
            values = r.get("Values", [])
            entry[metric_name] = {
                "latest": values[0] if values else None,
                "datapoints": [{"timestamp": t, "value": v} for t, v in zip(timestamps, values)],
            }

    return ok({"monitors": monitors, "startTime": start, "endTime": end})


TOOLS = {
    "list_nfm_monitors": list_nfm_monitors,
    "query_top_contributors": query_top_contributors,
    "get_workload_insights": get_workload_insights,
    "get_agent_coverage": get_agent_coverage,
    "get_network_health": get_network_health,
}


def lambda_handler(event, context):
    t = event.get("tool_name", ""); args = event.get("arguments", event)
    fn = TOOLS.get(t)
    if fn is None:
        return err(f"unknown tool: {t}")
    try:
        return fn(args)
    except Exception as e:  # isolate tool failures into the ok()/err() contract / 도구 실패를 ok()/err() 계약 안으로 격리
        return err(f"{type(e).__name__}: {e}")
