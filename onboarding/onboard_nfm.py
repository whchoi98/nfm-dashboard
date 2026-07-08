"""NFM onboarding custom resource: scope, monitors, EKS add-ons, pod identity. Idempotent."""
import json, time, urllib.request
import boto3

REGION, ACCOUNT = "ap-northeast-2", "<ACCOUNT_ID>"
PUBLISH_POLICY = "arn:aws:iam::aws:policy/CloudWatchNetworkFlowMonitorAgentPublishPolicy"
NFM_NS, NFM_SA = "amazon-network-flow-monitor", "aws-network-flow-monitor-agent-service-account"


def monitors_env(clusters):
    parts = [f"nfm-eks-{c}={c}" for c in clusters]
    return ",".join(parts + ["nfm-vpc-all="])


def desired_monitors(clusters, vpc_ids):
    mons = [{"monitorName": f"nfm-eks-{c}", "localResources": [
        {"type": "AWS::EKS::Cluster",
         "identifier": f"arn:aws:eks:{REGION}:{ACCOUNT}:cluster/{c}"}]} for c in clusters]
    mons.append({"monitorName": "nfm-vpc-all", "localResources": [
        {"type": "AWS::EC2::VPC", "identifier": f"arn:aws:ec2:{REGION}:{ACCOUNT}:vpc/{v}"}
        for v in vpc_ids[:25]]})
    return mons


def ensure_scope(nfm):
    scopes = nfm.list_scopes().get("scopes", [])
    if scopes:
        return scopes[0]["scopeArn"]
    resp = nfm.create_scope(targets=[{"targetIdentifier": {
        "targetId": {"accountId": ACCOUNT}, "targetType": "ACCOUNT"}, "region": REGION}])
    # Bounded wait: scope typically activates quickly. Monitors reference scopeArn from
    # the create response regardless, so a still-pending scope after 3min is a warn, not a raise.
    for _ in range(18):
        s = nfm.get_scope(scopeId=resp["scopeId"])
        if s["status"] == "SUCCEEDED":
            break
        time.sleep(10)
    else:
        print(f"WARN: scope {resp['scopeId']} not SUCCEEDED after 3min wait "
              f"(last status={s['status']}); proceeding with scopeArn from create response")
    return resp["scopeArn"]


def ensure_monitors(nfm, scope_arn, clusters, vpc_ids):
    existing = {m["monitorName"] for m in nfm.list_monitors().get("monitors", [])}
    for spec in desired_monitors(clusters, vpc_ids):
        if spec["monitorName"] in existing:
            continue
        nfm.create_monitor(monitorName=spec["monitorName"],
                           localResources=spec["localResources"], scopeArn=scope_arn)


def ensure_eks(eks, iam, cluster):
    # Controller adjustment 1: bound the wait for eks-pod-identity-agent to avoid
    # exceeding the Lambda 15-min cap across 4 clusters x 2 addons. Addons reach
    # ACTIVE on their own; proceed regardless after the short poll.
    addons = eks.list_addons(clusterName=cluster).get("addons", [])
    if "eks-pod-identity-agent" not in addons:
        eks.create_addon(clusterName=cluster, addonName="eks-pod-identity-agent")
        _wait_addon(eks, cluster, "eks-pod-identity-agent", attempts=12)
    role_name = f"nfm-agent-{cluster}"
    try:
        iam.get_role(RoleName=role_name)
    except iam.exceptions.NoSuchEntityException:
        iam.create_role(RoleName=role_name, AssumeRolePolicyDocument=json.dumps({
            "Version": "2012-10-17", "Statement": [{"Effect": "Allow",
                "Principal": {"Service": "pods.eks.amazonaws.com"},
                "Action": ["sts:AssumeRole", "sts:TagSession"]}]}))
        iam.attach_role_policy(RoleName=role_name, PolicyArn=PUBLISH_POLICY)
    assocs = eks.list_pod_identity_associations(clusterName=cluster,
        namespace=NFM_NS).get("associations", [])
    if not any(a["serviceAccount"] == NFM_SA for a in assocs):
        try:
            eks.create_pod_identity_association(clusterName=cluster, namespace=NFM_NS,
                serviceAccount=NFM_SA, roleArn=f"arn:aws:iam::{ACCOUNT}:role/{role_name}")
        except eks.exceptions.ResourceInUseException:  # Controller adjustment 2: tolerate races/reruns
            pass
    # Controller adjustment 1: no wait for the network-flow-monitoring-agent addon —
    # NFM data starts flowing ~20min after install regardless of addon ACTIVE status.
    if "aws-network-flow-monitoring-agent" not in addons:
        eks.create_addon(clusterName=cluster, addonName="aws-network-flow-monitoring-agent")


def _wait_addon(eks, cluster, name, attempts=60):
    for _ in range(attempts):
        st = eks.describe_addon(clusterName=cluster, addonName=name)["addon"]["status"]
        if st in ("ACTIVE", "DEGRADED"):
            return
        time.sleep(10)


def run():
    nfm = boto3.client("networkflowmonitor", region_name=REGION)
    eks = boto3.client("eks", region_name=REGION)
    iam = boto3.client("iam")
    ec2 = boto3.client("ec2", region_name=REGION)
    clusters = eks.list_clusters()["clusters"]
    vpc_ids = [v["VpcId"] for v in ec2.describe_vpcs()["Vpcs"]]
    scope_arn = ensure_scope(nfm)
    for c in clusters:
        ensure_eks(eks, iam, c)
    ensure_monitors(nfm, scope_arn, clusters, vpc_ids)
    return {"MonitorsEnv": monitors_env(clusters), "ScopeArn": scope_arn,
            "Clusters": ",".join(clusters)}


def send_cfn(event, context, status, data=None, reason=""):
    body = json.dumps({"Status": status, "Reason": reason[:400] or "ok",
        "PhysicalResourceId": "nfm-onboarding", "StackId": event["StackId"],
        "RequestId": event["RequestId"], "LogicalResourceId": event["LogicalResourceId"],
        "Data": data or {}}).encode()
    req = urllib.request.Request(event["ResponseURL"], data=body, method="PUT",
        headers={"Content-Type": ""})
    urllib.request.urlopen(req, timeout=10)


def handler(event, context):
    try:
        if event["RequestType"] == "Delete":   # 온보딩 리소스는 잔존시킴 (에이전트/모니터 유지)
            send_cfn(event, context, "SUCCESS")
            return
        # Controller adjustment 6: run() on both Create and Update requests.
        send_cfn(event, context, "SUCCESS", run())
    except Exception as e:                      # noqa: BLE001
        try:
            send_cfn(event, context, "FAILED", reason=str(e))
        except Exception as send_err:            # noqa: BLE001 -- double fault must not escape unhandled
            print(f"send_cfn FAILED notification itself failed: {send_err!r} (original error: {e!r})")
