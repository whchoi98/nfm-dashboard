"""Enable the CoreDNS `log` plugin on all EKS clusters, reversibly, via a CFN custom resource."""
import base64, json, os, re, tempfile, time, urllib.request
import boto3

REGION = "ap-northeast-2"
CLUSTER_ADMIN_POLICY = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
BACKUP_ANNOTATION = "nfm-dashboard/corefile-backup"


def add_log_plugin(corefile: str) -> str:
    if re.search(r"^\s*log\s*$", corefile, re.M):
        return corefile                      # idempotent
    # insert `log` as the first plugin inside the top server block `{ ... }`
    return re.sub(r"(\{\n)", r"\1    log\n", corefile, count=1)


def remove_log_plugin(corefile: str) -> str:
    return re.sub(r"^\s*log\s*\n", "", corefile, count=1, flags=re.M)


def _self_role_arn() -> str:
    arn = os.environ.get("SELF_ROLE_ARN")
    if arn:
        return arn
    # fallback: derive role ARN from the assumed-role caller identity
    ident = boto3.client("sts", region_name=REGION).get_caller_identity()["Arn"]
    m = re.match(r"arn:aws:sts::(\d+):assumed-role/([^/]+)/", ident)
    if not m:
        raise RuntimeError(f"cannot derive role ARN from {ident}")
    return f"arn:aws:iam::{m.group(1)}:role/{m.group(2)}"


def _ensure_access(eks, cluster: str, role_arn: str):
    """Idempotently grant this Lambda's role k8s admin on the cluster via EKS Access Entries."""
    try:
        eks.create_access_entry(clusterName=cluster, principalArn=role_arn)
    except eks.exceptions.ResourceInUseException:
        pass                                 # entry already exists
    eks.associate_access_policy(
        clusterName=cluster, principalArn=role_arn, policyArn=CLUSTER_ADMIN_POLICY,
        accessScope={"type": "cluster"})


def _remove_access(eks, cluster: str, role_arn: str):
    """Best-effort cleanup of the access entry (Delete path only)."""
    try:
        eks.delete_access_entry(clusterName=cluster, principalArn=role_arn)
    except Exception as e:                   # noqa: BLE001 — cleanup must never fail the delete
        print(json.dumps({"level": "warn", "cluster": cluster, "delete_access_entry": str(e)}))


def _k8s_patch_corefile(cluster: str, transform):
    """Read coredns ConfigMap Corefile, transform, write back. Uses EKS token + k8s REST."""
    eks = boto3.client("eks", region_name=REGION)
    c = eks.describe_cluster(name=cluster)["cluster"]
    endpoint = c["endpoint"]; ca = c["certificateAuthority"]["data"]
    token = _eks_token(cluster)
    ca_file = tempfile.NamedTemporaryFile(delete=False, suffix=".crt")
    ca_file.write(base64.b64decode(ca)); ca_file.flush()
    base = f"{endpoint}/api/v1/namespaces/kube-system/configmaps/coredns"
    cur = _req(base, token, ca_file.name)
    corefile = cur["data"]["Corefile"]
    backup = cur.get("metadata", {}).get("annotations", {}).get(BACKUP_ANNOTATION)
    if backup is None:
        backup = corefile
    new_corefile = transform(corefile)
    if new_corefile == corefile:
        return                               # already in desired state — no rollout churn
    patch = {"data": {"Corefile": new_corefile},
             "metadata": {"annotations": {BACKUP_ANNOTATION: backup}}}
    _req(base, token, ca_file.name, method="PATCH", body=patch,
         content_type="application/merge-patch+json")


def _eks_token(cluster: str) -> str:
    # STS get-caller-identity presigned URL → k8s bearer token (aws-iam-authenticator scheme).
    # The x-k8s-aws-id header MUST be part of the signed request or the API server rejects it.
    import botocore.session
    from botocore.signers import RequestSigner
    session = botocore.session.get_session()
    client = boto3.client("sts", region_name=REGION)
    signer = RequestSigner(client.meta.service_model.service_id, REGION, "sts", "v4",
                           session.get_credentials(), session.get_component("event_emitter"))
    url = signer.generate_presigned_url(
        {"method": "GET",
         "url": f"https://sts.{REGION}.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15",
         "body": {}, "headers": {"x-k8s-aws-id": cluster}, "context": {}},
        region_name=REGION, expires_in=60, operation_name="")
    return "k8s-aws-v1." + base64.urlsafe_b64encode(url.encode()).decode().rstrip("=")


def _req(url, token, ca, method="GET", body=None, content_type="application/json"):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": content_type,
                 "Accept": "application/json"})
    import ssl
    ctx = ssl.create_default_context(cafile=ca)
    with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
        return json.loads(r.read())


def _patch_with_retry(cluster: str, transform, attempts=3, delay=15):
    """Access-entry propagation can lag a few seconds → retry auth failures briefly."""
    for i in range(attempts):
        try:
            _k8s_patch_corefile(cluster, transform)
            return
        except urllib.error.HTTPError as e:
            if e.code in (401, 403) and i < attempts - 1:
                time.sleep(delay)
                continue
            raise


def send_cfn(event, status, reason="ok"):
    body = json.dumps({"Status": status, "Reason": reason[:400], "PhysicalResourceId": "coredns-log",
        "StackId": event["StackId"], "RequestId": event["RequestId"],
        "LogicalResourceId": event["LogicalResourceId"], "Data": {}}).encode()
    urllib.request.urlopen(urllib.request.Request(event["ResponseURL"], data=body, method="PUT",
        headers={"Content-Type": ""}), timeout=10)


def handler(event, context):
    try:
        eks = boto3.client("eks", region_name=REGION)
        clusters = eks.list_clusters()["clusters"]
        is_delete = event["RequestType"] == "Delete"
        transform = remove_log_plugin if is_delete else add_log_plugin
        role_arn = _self_role_arn()
        failed = []
        for cl in clusters:
            try:                             # one cluster failure must not block others
                _ensure_access(eks, cl, role_arn)
                _patch_with_retry(cl, transform)
                if is_delete:
                    _remove_access(eks, cl, role_arn)
            except Exception as e:           # noqa: BLE001
                print(json.dumps({"level": "error", "cluster": cl, "error": str(e)}))
                failed.append(cl)
        reason = "ok" if not failed else f"failed clusters: {','.join(failed)} (see fn logs)"
        send_cfn(event, "SUCCESS", reason)
    except Exception as e:                    # noqa: BLE001
        send_cfn(event, "SUCCESS" if event.get("RequestType") == "Delete" else "FAILED", str(e))
