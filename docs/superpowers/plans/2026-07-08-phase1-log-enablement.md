# Phase 1 — Log Enablement Infra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expand NFM category coverage to 7 categories in the collector, enable DNS query logging (Route53 Resolver + CoreDNS) across the account, and collect DNS aggregates into DynamoDB `DNS#latest` — so Phases 2+ have richer category data and a DNS data source.

**Architecture:** Extend the existing `collector` Lambda (add extended categories with 15-min rotation + a DNS Logs-Insights pass). Add a new CDK stack `NfmDash-Dns` (Route53 Resolver query-log config + VPC associations + CloudWatch Logs group). Enable the CoreDNS `log` plugin on all 4 EKS clusters reversibly via a Custom Resource. DNS parsing/aggregation are pure functions shared with the app.

**Tech Stack:** TypeScript collector (esbuild), CDK TypeScript (aws-cdk-lib), Python 3.13 Lambda (boto3 + EKS API), CloudWatch Logs Insights, DynamoDB, vitest/pytest.

## Global Constraints

(inherits the master index Global Constraints — see `2026-07-08-analytics-enrichment-index.md`. Key ones for this phase:)
- Region `ap-northeast-2`, account `<ACCOUNT_ID>`. arm64. No new NAT/VPC endpoints.
- NFM 7 categories: `INTRA_AZ, INTER_AZ, INTER_VPC, UNCLASSIFIED, AMAZON_S3, AMAZON_DYNAMODB, INTER_REGION`.
- Category rotation: core `[INTRA_AZ, INTER_AZ, INTER_VPC]` every cycle; extended `[UNCLASSIFIED, AMAZON_S3, AMAZON_DYNAMODB, INTER_REGION]` every `EXTENDED_CATEGORY_EVERY` (default 3) cycles. Monitor query status-poll cap reduced 60→30.
- DNS collection every `DNS_COLLECT_EVERY` (default 3) cycles (~15 min). Cycle counter persisted in `NfmMeta` `STATUS#collect/latest.cycle`.
- CoreDNS `log` enablement reversible (backup original ConfigMap). Resolver logs → CW Logs group `/nfm-dashboard/resolver-dns`. CoreDNS logs → existing `/aws/containerinsights/<cluster>/application`.
- Deploy: `cd infra && npx cdk deploy <stack> --require-approval never -c imageTag=unused`. Non-App stacks pass placeholder imageTag.
- conventional commits.

## File Structure

```
collector/src/types.ts            # DestCategory 7종 확대 (Modify)
collector/src/nfm-query.ts        # statusPollMax param (default 30) (Modify)
collector/src/categories.ts       # NEW — category rotation helper (pure)
collector/src/dns-parse.ts        # NEW — CoreDNS + Resolver log line → DnsRecord (pure)
collector/src/dns.ts              # NEW — DNS aggregations (pure)
collector/src/dns-collect.ts      # NEW — Logs Insights query + aggregate → DNS#latest
collector/src/handler.ts          # Modify — 7 categories + rotation + cycle counter + DNS pass
app/src/lib/types.ts              # DestCategory 7종 확대 (Modify, keep in sync)
infra/lib/dns-stack.ts            # NEW — NfmDash-Dns: Resolver query-log config + assoc + log group + CoreDNS-enable CR
infra/bin/nfm-dashboard.ts        # Modify — register NfmDash-Dns
infra/test/dns-stack.test.ts      # NEW — assertions
onboarding/enable_coredns_log.py  # NEW — CoreDNS log plugin enable (Custom Resource, reversible)
onboarding/test_enable_coredns_log.py # NEW — pure-fn tests
```

### Shared interfaces (this phase)

```ts
// collector/src/types.ts (widened)
export type DestCategory = 'INTRA_AZ'|'INTER_AZ'|'INTER_VPC'|'UNCLASSIFIED'|'AMAZON_S3'|'AMAZON_DYNAMODB'|'INTER_REGION';

// collector/src/dns-parse.ts
export interface DnsRecord { source: 'coredns'|'resolver'; ts?: string; clientIp?: string;
  srcId?: string; name: string; qtype: string; rcode: string; durationMs?: number; answerIps: string[]; }

// collector/src/dns.ts  (also the /api/analytics/dns response shape in Phase 2)
export interface DnsAggregate { enabled: boolean;
  topDomains: { name: string; count: number; internal: boolean }[];
  failures: { key: string; label: string; nxdomain: number; servfail: number; total: number; failRate: number }[];
  latency: { p50: number; p90: number; p95: number; max: number; count: number };
  queryTypes: { type: string; count: number }[];
  resolution: { nodes: { name: string }[]; links: { source: number; target: number; value: number }[] };
  nameFlow: { ip: string; name: string }[]; }
```

---

## Task 1: Category expansion (7종) + rotation + poll cap

**Files:**
- Modify: `collector/src/types.ts` (DestCategory), `app/src/lib/types.ts` (keep identical)
- Create: `collector/src/categories.ts`
- Modify: `collector/src/nfm-query.ts` (statusPollMax param), `collector/src/handler.ts`
- Test: `collector/src/categories.test.ts`

**Interfaces:**
- Produces: `categoriesForCycle(cycle: number, everyN?: number): DestCategory[]` — returns CORE always, plus EXTENDED when `cycle % everyN === 0`. `CORE`/`EXTENDED` exported const arrays.
- `runQueryMatrix` gains optional `spec.statusPollMax` (default 30).

- [ ] **Step 1: Write failing test**

```ts
// collector/src/categories.test.ts
import { it, expect } from 'vitest';
import { categoriesForCycle, CORE, EXTENDED } from './categories.js';

it('core categories every cycle', () => {
  expect(categoriesForCycle(1, 3)).toEqual(CORE);
  expect(categoriesForCycle(2, 3)).toEqual(CORE);
});
it('extended categories appended every Nth cycle', () => {
  expect(categoriesForCycle(3, 3)).toEqual([...CORE, ...EXTENDED]);
  expect(categoriesForCycle(6, 3)).toEqual([...CORE, ...EXTENDED]);
});
it('CORE=3, EXTENDED=4, all 7 distinct', () => {
  expect(CORE).toHaveLength(3);
  expect(EXTENDED).toHaveLength(4);
  expect(new Set([...CORE, ...EXTENDED]).size).toBe(7);
});
```

- [ ] **Step 2: Run test → FAIL** — `npx -w collector vitest run categories` → "Cannot find module './categories.js'"

- [ ] **Step 3: Implement**

```ts
// collector/src/categories.ts
import type { DestCategory } from './types.js';
export const CORE: DestCategory[] = ['INTRA_AZ', 'INTER_AZ', 'INTER_VPC'];
export const EXTENDED: DestCategory[] = ['UNCLASSIFIED', 'AMAZON_S3', 'AMAZON_DYNAMODB', 'INTER_REGION'];
export function categoriesForCycle(cycle: number, everyN = 3): DestCategory[] {
  return everyN > 0 && cycle % everyN === 0 ? [...CORE, ...EXTENDED] : [...CORE];
}
```

Widen `collector/src/types.ts` DestCategory to the 7-union (see Shared interfaces). Copy the identical union into `app/src/lib/types.ts` (keep the file's existing comment).

In `collector/src/nfm-query.ts`: change the poll loop bound from the literal `60` to `spec.statusPollMax ?? 30`, and add `statusPollMax?: number;` to `MatrixSpec`.

- [ ] **Step 4: Wire handler** — in `collector/src/handler.ts`:
  - Read current cycle: after loading meta, `const cycle = (statusLatest?.cycle ?? 0) + 1;` (read `STATUS#collect/latest` item's `cycle`, default 0). Persist `cycle` into the `STATUS#collect/latest` write (extend `writeCycle` payload or Put here).
  - Replace the hardcoded `categories: [...]` with `categories: categoriesForCycle(cycle, Number(process.env.EXTENDED_CATEGORY_EVERY ?? 3))`.
  - Pass `statusPollMax: 30` in the matrix spec.

- [ ] **Step 5: Run tests → PASS** — `npx -w collector vitest run` (expect prior suite + 3 new pass), `npx -w collector tsc --noEmit` clean, `npx -w app tsc --noEmit`/build clean (types.ts widen doesn't break app consumers — DestCategory is only widened).

- [ ] **Step 6: Build + Commit**

```bash
npm -w collector run build
git add collector/src app/src/lib/types.ts && git commit -m "feat(collector): expand NFM categories to 7 with rotation, reduce poll cap"
```

---

## Task 2: NfmDash-Dns stack — Resolver query logging

**Files:**
- Create: `infra/lib/dns-stack.ts`, `infra/test/dns-stack.test.ts`
- Modify: `infra/bin/nfm-dashboard.ts`

**Interfaces:**
- Produces: CW Logs group `/nfm-dashboard/resolver-dns`; Route53 Resolver query-log config `nfm-dashboard-resolver` associated to the target VPC(s). Stack `NfmDash-Dns`.

- [ ] **Step 1: Failing assertions test**

```ts
// infra/test/dns-stack.test.ts
import { it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DnsStack } from '../lib/dns-stack';

it('creates resolver query-log config + log group + association', () => {
  const t = Template.fromStack(new DnsStack(new App({ context: { imageTag: 'unused' } }), 'T',
    { env: { account: '<ACCOUNT_ID>', region: 'ap-northeast-2' } }));
  t.hasResourceProperties('AWS::Logs::LogGroup', { LogGroupName: '/nfm-dashboard/resolver-dns' });
  t.resourceCountIs('AWS::Route53Resolver::ResolverQueryLoggingConfig', 1);
  t.resourceCountIs('AWS::Route53Resolver::ResolverQueryLoggingConfigAssociation', 1);
});
```

- [ ] **Step 2: Run → FAIL** — `npx -w infra vitest run dns-stack` (module missing)

- [ ] **Step 3: Implement stack**

```ts
// infra/lib/dns-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as r53r from 'aws-cdk-lib/aws-route53resolver';

const VPC_ID = 'vpc-0dfa5610180dfa628'; // cc-on-bedrock-vpc

export class DnsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    const lg = new logs.LogGroup(this, 'ResolverDnsLg', {
      logGroupName: '/nfm-dashboard/resolver-dns',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY });
    const cfg = new r53r.CfnResolverQueryLoggingConfig(this, 'ResolverQlc', {
      name: 'nfm-dashboard-resolver', destinationArn: lg.logGroupArn });
    new r53r.CfnResolverQueryLoggingConfigAssociation(this, 'ResolverQlcAssoc', {
      resolverQueryLogConfigId: cfg.attrId, resourceId: VPC_ID });
    new cdk.CfnOutput(this, 'ResolverLogGroup', { value: lg.logGroupName });
  }
}
```

Register in `infra/bin/nfm-dashboard.ts`: `import { DnsStack } from '../lib/dns-stack';` + `new DnsStack(app, 'NfmDash-Dns', { env });`

- [ ] **Step 4: Test → PASS + Deploy**

```bash
npx -w infra vitest run dns-stack     # PASS
cd infra && npx cdk deploy NfmDash-Dns --require-approval never -c imageTag=unused
```
Expected CREATE_COMPLETE. Verify:
```bash
aws route53resolver list-resolver-query-log-configs --query 'ResolverQueryLogConfigs[].Name'  # nfm-dashboard-resolver
aws route53resolver list-resolver-query-log-config-associations --query 'ResolverQueryLogConfigAssociations[].{r:ResourceId,s:Status}'  # vpc-... ACTIVE
aws logs describe-log-groups --log-group-name-prefix /nfm-dashboard/resolver-dns --query 'logGroups[0].logGroupName'
```

- [ ] **Step 5: Commit** — `git add infra && git commit -m "infra: NfmDash-Dns Route53 Resolver query logging to CloudWatch Logs"`

---

## Task 3: CoreDNS log plugin enablement (reversible Custom Resource)

**Files:**
- Create: `onboarding/enable_coredns_log.py`, `onboarding/test_enable_coredns_log.py`
- Modify: `infra/lib/dns-stack.ts` (add the enable Lambda + CustomResource)

**Interfaces:**
- Produces: CoreDNS Corefile on all clusters includes the `log` plugin. On stack delete, restores backup (reversible). Pure fn `add_log_plugin(corefile: str) -> str` (idempotent) tested.

- [ ] **Step 1: Failing pure-fn test**

```python
# onboarding/test_enable_coredns_log.py
from enable_coredns_log import add_log_plugin, remove_log_plugin

COREFILE = """.:53 {
    errors
    health
    kubernetes cluster.local in-addr.arpa ip6.arpa { pods insecure fallthrough in-addr.arpa ip6.arpa }
    forward . /etc/resolv.conf
    cache 30
}"""

def test_add_log_is_idempotent():
    once = add_log_plugin(COREFILE)
    assert "\n    log\n" in once
    assert add_log_plugin(once) == once   # idempotent, no double insert

def test_remove_restores():
    assert remove_log_plugin(add_log_plugin(COREFILE)).strip() == COREFILE.strip()
```

- [ ] **Step 2: Run → FAIL** — `cd onboarding && python3 -m pytest test_enable_coredns_log.py -q`

- [ ] **Step 3: Implement** (`onboarding/enable_coredns_log.py`) — pure fns + CFN Custom Resource handler that lists clusters, reads the `coredns` ConfigMap Corefile via the EKS/k8s API, backs it up (to the ConfigMap annotation `nfm-dashboard/corefile-backup`), applies `add_log_plugin`, and on Delete applies `remove_log_plugin`.

```python
# onboarding/enable_coredns_log.py
"""Enable the CoreDNS `log` plugin on all EKS clusters, reversibly, via a CFN custom resource."""
import base64, json, re, tempfile, urllib.request
import boto3

REGION = "ap-northeast-2"

def add_log_plugin(corefile: str) -> str:
    if re.search(r"^\s*log\s*$", corefile, re.M):
        return corefile                      # idempotent
    # insert `log` as the first plugin inside the top server block `{ ... }`
    return re.sub(r"(\{\n)", r"\1    log\n", corefile, count=1)

def remove_log_plugin(corefile: str) -> str:
    return re.sub(r"^\s*log\s*\n", "", corefile, count=1, flags=re.M)

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
    backup = cur.get("metadata", {}).get("annotations", {}).get("nfm-dashboard/corefile-backup")
    if backup is None:
        backup = corefile
    new_corefile = transform(corefile)
    patch = {"data": {"Corefile": new_corefile},
             "metadata": {"annotations": {"nfm-dashboard/corefile-backup": backup}}}
    _req(base, token, ca_file.name, method="PATCH", body=patch,
         content_type="application/merge-patch+json")

def _eks_token(cluster: str) -> str:
    # STS get-caller-identity presigned URL → k8s bearer token (aws-iam-authenticator scheme)
    import botocore.session
    from botocore.signers import RequestSigner
    session = botocore.session.get_session()
    client = boto3.client("sts", region_name=REGION)
    signer = RequestSigner(client.meta.service_model.service_id, REGION, "sts", "v4",
                           session.get_credentials(), session.get_component("event_emitter"))
    url = signer.generate_presigned_url(
        {"method": "GET",
         "body": {}, "url": f"https://sts.{REGION}.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15",
         "context": {}, "query_string": {}},
        region_name=REGION, expires_in=60, operation_name="")
    return "k8s-aws-v1." + base64.urlsafe_b64encode(url.encode()).decode().rstrip("=")

def _req(url, token, ca, method="GET", body=None, content_type="application/json"):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": content_type, "Accept": "application/json"})
    import ssl
    ctx = ssl.create_default_context(cafile=ca)
    with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
        return json.loads(r.read())

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
        transform = remove_log_plugin if event["RequestType"] == "Delete" else add_log_plugin
        for cl in clusters:
            try:
                _k8s_patch_corefile(cl, transform)
            except Exception as e:               # noqa: BLE001 — one cluster failure must not block others
                print(json.dumps({"level": "error", "cluster": cl, "error": str(e)}))
        send_cfn(event, "SUCCESS")
    except Exception as e:                        # noqa: BLE001
        send_cfn(event, "SUCCESS" if event.get("RequestType") == "Delete" else "FAILED", str(e))
```

Add to `infra/lib/dns-stack.ts`: a Python 3.13 arm64 Lambda from `../../onboarding` (handler `enable_coredns_log.handler`, timeout 5 min), IAM `eks:DescribeCluster`,`eks:ListClusters`,`sts:GetCallerIdentity`; grant its role EKS access (the clusters' aws-auth must map this role — NOTE: the onboarding role from Task 7 already has cluster access via the earlier setup; if not, the CR logs per-cluster failure and the operator maps it). A `cdk.CustomResource` with `Version:'1'`. **The Lambda's execution role must be added to each cluster's access entries** — add `eks:AssociateAccessPolicy`/access-entry creation OR document a one-time `eksctl create iamidentitymapping`. Since aws-auth editing is itself k8s, include an access-entry (EKS API `CreateAccessEntry` + `AssociateAccessPolicy` AmazonEKSClusterAdminPolicy) call for the Lambda role inside the handler before patching (guarded/idempotent).

- [ ] **Step 4: pytest → PASS** — `cd onboarding && python3 -m pytest -q` (existing 2 + 2 new = 4)

- [ ] **Step 5: Deploy + verify (careful — mutates 4 live clusters, reversible)**

```bash
cd infra && npx cdk deploy NfmDash-Dns --require-approval never -c imageTag=unused   # updates stack with CR
# verify one cluster's Corefile now has `log`:
aws eks describe-cluster --name eksworkshop --query cluster.endpoint  # sanity
# (Corefile check is via k8s; confirm CoreDNS logs appear after ~2-3 min:)
aws logs filter-log-events --log-group-name /aws/containerinsights/eksworkshop/application \
  --filter-pattern 'coredns' --max-items 5 --query 'events[].message' 2>&1 | head
```
Expected: CoreDNS query log lines appear in the application log group within a few minutes. If a cluster failed (access), the CR log names it; map the role and redeploy.

- [ ] **Step 6: Commit** — `git add onboarding infra && git commit -m "infra: enable CoreDNS log plugin on all clusters (reversible custom resource)"`

---

## Task 4: DNS log parsers (dns-parse.ts, pure TDD)

**Files:**
- Create: `collector/src/dns-parse.ts`, `collector/src/dns-parse.test.ts`

**Interfaces:**
- Produces: `parseCoreDns(line: string): DnsRecord | null`, `parseResolver(json: unknown): DnsRecord | null`. `DnsRecord` per Shared interfaces (source/ts/clientIp/srcId/name/qtype/rcode/durationMs/answerIps).
- CoreDNS `log` plugin line format (default):
  `[INFO] 10.0.1.5:34953 - 42 "A IN api.shop.svc.cluster.local. udp 63 false 512" NOERROR qr,aa,rd 106 0.000342s`
- Resolver query-log JSON record fields: `query_name`, `query_type`, `rcode`, `srcaddr`, `srcids.instance`, `answers[].Rdata`, `query_timestamp`.

- [ ] **Step 1: Failing test**

```ts
// collector/src/dns-parse.test.ts
import { it, expect } from 'vitest';
import { parseCoreDns, parseResolver } from './dns-parse.js';

it('parses a coredns log line', () => {
  const r = parseCoreDns('[INFO] 10.0.1.5:34953 - 42 "A IN api.shop.svc.cluster.local. udp 63 false 512" NOERROR qr,aa,rd 106 0.000342s');
  expect(r).toMatchObject({ source: 'coredns', clientIp: '10.0.1.5', name: 'api.shop.svc.cluster.local',
    qtype: 'A', rcode: 'NOERROR' });
  expect(r!.durationMs).toBeCloseTo(0.342, 2);
});
it('parses NXDOMAIN coredns line', () => {
  expect(parseCoreDns('[INFO] 10.0.2.9:5 - 1 "A IN nope.internal. udp 40 false 512" NXDOMAIN qr,rd 40 0.001s')!.rcode)
    .toBe('NXDOMAIN');
});
it('returns null for non-query coredns noise', () => {
  expect(parseCoreDns('[INFO] plugin/reload: Running configuration MD5 = abc')).toBeNull();
});
it('parses a resolver JSON record with answers', () => {
  const r = parseResolver({ query_name: 'ddb.ap-northeast-2.amazonaws.com.', query_type: 'A',
    rcode: 'NOERROR', srcaddr: '10.100.1.20', srcids: { instance: 'i-abc' },
    answers: [{ Rdata: '52.1.2.3' }, { Rdata: '52.1.2.4' }], query_timestamp: '2026-07-08T12:00:00Z' });
  expect(r).toMatchObject({ source: 'resolver', clientIp: '10.100.1.20', srcId: 'i-abc',
    name: 'ddb.ap-northeast-2.amazonaws.com', qtype: 'A', rcode: 'NOERROR' });
  expect(r!.answerIps).toEqual(['52.1.2.3', '52.1.2.4']);
});
```

- [ ] **Step 2: Run → FAIL** — `npx -w collector vitest run dns-parse`

- [ ] **Step 3: Implement**

```ts
// collector/src/dns-parse.ts
export interface DnsRecord { source: 'coredns'|'resolver'; ts?: string; clientIp?: string;
  srcId?: string; name: string; qtype: string; rcode: string; durationMs?: number; answerIps: string[]; }

const CORE_RE = /^\[[A-Z]+\]\s+([0-9.]+):\d+\s+-\s+\d+\s+"(\S+)\s+\S+\s+(\S+?)\.?\s+\S+\s+\d+\s+\S+\s+\d+"\s+(\S+)\s+\S+\s+\d+\s+([\d.]+)s/;

export function parseCoreDns(line: string): DnsRecord | null {
  const m = CORE_RE.exec(line);
  if (!m) return null;
  const [, clientIp, qtype, name, rcode, dur] = m;
  return { source: 'coredns', clientIp, name: name.replace(/\.$/, ''), qtype, rcode,
    durationMs: Number(dur) * 1000, answerIps: [] };
}

export function parseResolver(rec: unknown): DnsRecord | null {
  const r = rec as Record<string, any>;
  if (!r || typeof r.query_name !== 'string') return null;
  return { source: 'resolver', ts: r.query_timestamp, clientIp: r.srcaddr,
    srcId: r.srcids?.instance ?? r.srcids?.[0]?.instance,
    name: String(r.query_name).replace(/\.$/, ''), qtype: r.query_type ?? '?',
    rcode: r.rcode ?? '?', answerIps: Array.isArray(r.answers) ? r.answers.map((a: any) => a.Rdata).filter(Boolean) : [] };
}
```

- [ ] **Step 4: Run → PASS** — `npx -w collector vitest run dns-parse` (4 pass)
- [ ] **Step 5: Commit** — `git add collector/src/dns-parse.* && git commit -m "feat(collector): CoreDNS + Resolver DNS log parsers"`

---

## Task 5: DNS aggregations (dns.ts, pure TDD)

**Files:**
- Create: `collector/src/dns.ts`, `collector/src/dns.test.ts`

**Interfaces:**
- Consumes: `DnsRecord` (Task 4), `FlowEdge` (existing types.ts).
- Produces: `aggregateDns(records: DnsRecord[], flows?: FlowEdge[]): DnsAggregate` (shape per Shared interfaces). Internal helpers exported for test: `topDomains`, `failureRates`, `dnsLatency`, `queryTypeBreakdown`, `resolutionSankey`, `nameFlow`.

- [ ] **Step 1: Failing test**

```ts
// collector/src/dns.test.ts
import { it, expect } from 'vitest';
import { aggregateDns } from './dns.js';
import type { DnsRecord } from './dns-parse.js';

const recs: DnsRecord[] = [
  { source:'coredns', clientIp:'10.0.1.5', name:'api.shop.svc.cluster.local', qtype:'A', rcode:'NOERROR', durationMs:0.3, answerIps:[] },
  { source:'coredns', clientIp:'10.0.1.5', name:'api.shop.svc.cluster.local', qtype:'A', rcode:'NOERROR', durationMs:0.5, answerIps:[] },
  { source:'coredns', clientIp:'10.0.2.9', name:'nope.internal', qtype:'A', rcode:'NXDOMAIN', durationMs:1.0, answerIps:[] },
  { source:'resolver', clientIp:'10.100.1.20', srcId:'i-abc', name:'ddb.ap-northeast-2.amazonaws.com', qtype:'A', rcode:'NOERROR', answerIps:['52.1.2.3'] },
];

it('enabled=false for empty input', () => {
  expect(aggregateDns([]).enabled).toBe(false);
});
it('topDomains counts + internal flag', () => {
  const a = aggregateDns(recs);
  const top = a.topDomains.find(d => d.name === 'api.shop.svc.cluster.local')!;
  expect(top.count).toBe(2); expect(top.internal).toBe(true);
  expect(a.topDomains.find(d => d.name.includes('amazonaws.com'))!.internal).toBe(false);
});
it('failureRates computes NXDOMAIN fraction', () => {
  const a = aggregateDns(recs);
  const tot = a.failures.reduce((s, f) => s + f.total, 0);
  expect(tot).toBe(4);
  expect(a.failures.some(f => f.nxdomain === 1)).toBe(true);
});
it('queryTypes + latency percentiles present', () => {
  const a = aggregateDns(recs);
  expect(a.queryTypes.find(q => q.type === 'A')!.count).toBe(4);
  expect(a.latency.count).toBe(3);   // only coredns has durationMs
});
it('nameFlow correlates resolver answer IP to a flow remote IP', () => {
  const flows = [{ edgeHash:'e1', a:{ip:'10.100.1.20'}, b:{ip:'52.1.2.3'} }] as any;
  const a = aggregateDns(recs, flows);
  expect(a.nameFlow).toContainEqual({ ip: '52.1.2.3', name: 'ddb.ap-northeast-2.amazonaws.com' });
});
```

- [ ] **Step 2: Run → FAIL** — `npx -w collector vitest run dns.test`

- [ ] **Step 3: Implement** (`collector/src/dns.ts`) — pure aggregation over records; `internal` = name endsWith `.cluster.local` or `.internal`; failures keyed by namespace derived from `*.<ns>.svc.cluster.local` else clientIp; latency percentiles over records with `durationMs`; resolutionSankey = source(clientIp/srcId) → name; nameFlow = for each resolver record with answerIps, if any answerIp equals a flow endpoint ip, emit `{ip, name}` (dedup).

```ts
// collector/src/dns.ts
import type { DnsRecord } from './dns-parse.js';
import type { FlowEdge } from './types.js';
export interface DnsAggregate { enabled: boolean;
  topDomains: { name: string; count: number; internal: boolean }[];
  failures: { key: string; label: string; nxdomain: number; servfail: number; total: number; failRate: number }[];
  latency: { p50: number; p90: number; p95: number; max: number; count: number };
  queryTypes: { type: string; count: number }[];
  resolution: { nodes: { name: string }[]; links: { source: number; target: number; value: number }[] };
  nameFlow: { ip: string; name: string }[]; }

const internalName = (n: string) => n.endsWith('.cluster.local') || n.endsWith('.internal');
const nsOf = (n: string) => { const m = /^[^.]+\.([^.]+)\.svc\.cluster\.local$/.exec(n); return m ? m[1] : null; };
function pct(sorted: number[], p: number) { if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]; }

export function aggregateDns(records: DnsRecord[], flows: FlowEdge[] = []): DnsAggregate {
  if (!records.length) return { enabled: false, topDomains: [], failures: [], queryTypes: [],
    latency: { p50: 0, p90: 0, p95: 0, max: 0, count: 0 }, resolution: { nodes: [], links: [] }, nameFlow: [] };
  const byName = new Map<string, number>(), byType = new Map<string, number>();
  const fail = new Map<string, { nxdomain: number; servfail: number; total: number }>();
  const durs: number[] = []; const resNodes = new Map<string, number>(); const links = new Map<string, number>();
  for (const r of records) {
    byName.set(r.name, (byName.get(r.name) ?? 0) + 1);
    byType.set(r.qtype, (byType.get(r.qtype) ?? 0) + 1);
    const key = nsOf(r.name) ?? r.clientIp ?? 'unknown';
    const f = fail.get(key) ?? { nxdomain: 0, servfail: 0, total: 0 };
    f.total++; if (r.rcode === 'NXDOMAIN') f.nxdomain++; if (r.rcode === 'SERVFAIL') f.servfail++;
    fail.set(key, f);
    if (typeof r.durationMs === 'number') durs.push(r.durationMs);
    const src = r.srcId ?? r.clientIp ?? 'unknown';
    for (const id of [src, r.name]) if (!resNodes.has(id)) resNodes.set(id, resNodes.size);
    const lk = `${resNodes.get(src)}>${resNodes.get(r.name)}`;
    links.set(lk, (links.get(lk) ?? 0) + 1);
  }
  durs.sort((a, b) => a - b);
  const flowIps = new Set(flows.flatMap(fl => [fl.a?.ip, fl.b?.ip].filter(Boolean) as string[]));
  const nameFlowSet = new Map<string, string>();
  for (const r of records) for (const ip of r.answerIps) if (flowIps.has(ip)) nameFlowSet.set(ip, r.name);
  return { enabled: true,
    topDomains: [...byName].map(([name, count]) => ({ name, count, internal: internalName(name) }))
      .sort((a, b) => b.count - a.count).slice(0, 50),
    failures: [...fail].map(([key, f]) => ({ key, label: key, ...f, failRate: (f.nxdomain + f.servfail) / f.total }))
      .sort((a, b) => b.failRate - a.failRate),
    latency: { p50: pct(durs, 50), p90: pct(durs, 90), p95: pct(durs, 95), max: durs.at(-1) ?? 0, count: durs.length },
    queryTypes: [...byType].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    resolution: { nodes: [...resNodes.keys()].map(name => ({ name })),
      links: [...links].map(([k, value]) => { const [s, t] = k.split('>').map(Number); return { source: s, target: t, value }; }) },
    nameFlow: [...nameFlowSet].map(([ip, name]) => ({ ip, name })) };
}
```

- [ ] **Step 4: Run → PASS** — `npx -w collector vitest run dns.test` (5 pass)
- [ ] **Step 5: Commit** — `git add collector/src/dns.* && git commit -m "feat(collector): DNS aggregations (domains, failures, latency, resolution, name-flow)"`

---

## Task 6: DNS collection via Logs Insights + handler wiring + IAM

**Files:**
- Create: `collector/src/dns-collect.ts`, `collector/src/dns-collect.test.ts`
- Modify: `collector/src/handler.ts` (DNS pass every N cycles), `infra/lib/data-stack.ts` (IAM logs:StartQuery etc. + env)

**Interfaces:**
- Consumes: Task 4 parsers, Task 5 `aggregateDns`.
- Produces: `collectDns(logs, opts): Promise<DnsAggregate>` — runs CloudWatch Logs Insights over the CoreDNS application log groups + resolver log group, parses via dns-parse, returns `aggregateDns`. Handler writes `DNS#latest`/`all` to `NfmMeta` every `DNS_COLLECT_EVERY` cycles.

- [ ] **Step 1: Failing test (mock CloudWatchLogsClient)**

```ts
// collector/src/dns-collect.test.ts
import { it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { CloudWatchLogsClient, StartQueryCommand, GetQueryResultsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { collectDns } from './dns-collect.js';

const cw = mockClient(CloudWatchLogsClient);
beforeEach(() => cw.reset());

it('runs insights, parses coredns messages, aggregates', async () => {
  cw.on(StartQueryCommand).resolves({ queryId: 'q1' });
  cw.on(GetQueryResultsCommand).resolves({ status: 'Complete', results: [
    [{ field: '@message', value: '[INFO] 10.0.1.5:1 - 1 "A IN api.shop.svc.cluster.local. udp 1 false 1" NOERROR qr 1 0.0003s' }],
  ] });
  const agg = await collectDns(new CloudWatchLogsClient({}),
    { coreDnsGroups: ['/aws/containerinsights/c/application'], resolverGroup: '/nfm-dashboard/resolver-dns',
      startTime: 0, endTime: 1, pollDelayMs: 0 });
  expect(agg.enabled).toBe(true);
  expect(agg.topDomains[0].name).toBe('api.shop.svc.cluster.local');
});
```

- [ ] **Step 2: Run → FAIL** — `npx -w collector vitest run dns-collect`

- [ ] **Step 3: Implement** (`collector/src/dns-collect.ts`) — for each log group: `StartQuery` (query string below) → poll `GetQueryResults` until `Complete`/`Failed` (cap ~30 × pollDelay, default 2s) → collect `@message` values → parse (CoreDNS group → `parseCoreDns`, resolver group → `parseResolver(JSON.parse(msg))`) → concat records → `aggregateDns(records, flows)`.
  - CoreDNS Insights query: `fields @message | filter @message like /"\w+ IN /| filter kubernetes.container_name = "coredns" | limit 5000` (Container Insights application logs are JSON; use `filter @message like /IN /` fallback since container_name may be a parsed field — the impl tries the structured field and falls back).
  - Resolver Insights query: `fields @message | limit 5000` (resolver query logs are JSON per event).
  - Records capped (e.g. 20000) to bound memory; log if truncated.

- [ ] **Step 4: Run → PASS** — `npx -w collector vitest run` (full suite green)

- [ ] **Step 5: Wire handler + IAM**
  - `collector/src/handler.ts`: after WI, `if (cycle % Number(process.env.DNS_COLLECT_EVERY ?? 3) === 0) { const dns = await collectDns(cwlogs, {...}).catch(e=>{console.error('dns failed',e);return undefined;}); if (dns) await ddb.send(new PutCommand({ TableName: TABLE_META, Item: { pk:'DNS#latest', sk:'all', dns, cycleTs: now.toISOString() } })); }`. Build coreDnsGroups from cluster names (`/aws/containerinsights/<cluster>/application`) discovered via `eks:ListClusters` (reuse) or env `DNS_CORE_GROUPS`; resolverGroup=`/nfm-dashboard/resolver-dns`.
  - `infra/lib/data-stack.ts`: add IAM statement `logs:StartQuery, logs:StopQuery, logs:GetQueryResults` on `*` (Insights needs `*` or the group ARNs; scope to `arn:aws:logs:ap-northeast-2:<ACCOUNT_ID>:log-group:/aws/containerinsights/*` and `.../nfm-dashboard/resolver-dns:*`), and `eks:ListClusters`. Add env `DNS_COLLECT_EVERY=3`, `EXTENDED_CATEGORY_EVERY=3`.

- [ ] **Step 6: Build + deploy + verify**

```bash
npm -w collector run build
npm run deploy:data      # collector build + NfmDash-Data deploy (Task 6 of base plan wired this)
# force a DNS-collecting cycle: invoke a few times or wait; then:
aws lambda invoke --function-name nfm-dashboard-collector /tmp/p1.json && cat /tmp/p1.json
aws dynamodb get-item --table-name nfm-dashboard-meta \
  --key '{"pk":{"S":"DNS#latest"},"sk":{"S":"all"}}' --query 'Item.dns.M.enabled' 2>&1 | head
# expect enabled=true once CoreDNS/Resolver logs have flowed (~15 min after Task 3 + Resolver assoc)
```

- [ ] **Step 7: Commit** — `git add collector infra && git commit -m "feat(collector): DNS collection via Logs Insights into DNS#latest + IAM"`

---

## Phase 1 self-review checklist (run before finishing branch)
- [ ] Category rotation: `categoriesForCycle` core-always/extended-every-3, poll cap 30 — covered Task 1.
- [ ] DestCategory 7종 in BOTH collector + app types — Task 1.
- [ ] Resolver query logging deployed + associated to VPC — Task 2.
- [ ] CoreDNS `log` enabled reversibly on 4 clusters — Task 3 (verify logs flow).
- [ ] DNS parsers (both formats) + aggregations TDD — Tasks 4,5.
- [ ] DNS collection writes `DNS#latest` every ~15 min, IAM present — Task 6.
- [ ] Full suite green (collector + infra + onboarding). Deploys: NfmDash-Dns CREATE, NfmDash-Data UPDATE.
- [ ] No secrets committed. Reversibility of CoreDNS change confirmed (backup annotation).
