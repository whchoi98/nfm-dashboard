import { EC2Client, DescribeInstancesCommand, CreateTagsCommand } from '@aws-sdk/client-ec2';
import { IAMClient, ListAttachedRolePoliciesCommand, AttachRolePolicyCommand,
  GetInstanceProfileCommand } from '@aws-sdk/client-iam';

const PUBLISH_POLICY = 'arn:aws:iam::aws:policy/CloudWatchNetworkFlowMonitorAgentPublishPolicy';
export interface Coverage {
  standalone: { instanceId: string; tagged: boolean; roleName?: string; policyAttached: boolean }[];
  eksNodeCount: number;
}

// Resolves the IAM role name backing an instance profile. Instance profile name and role name
// are not guaranteed to match, so this must be looked up via GetInstanceProfile rather than
// assumed from the profile ARN. Cached per profile name across the run to avoid redundant calls.
async function resolveRoleName(iam: IAMClient, profileName: string, instanceId: string,
  cache: Map<string, string | undefined>): Promise<string | undefined> {
  if (cache.has(profileName)) return cache.get(profileName);
  let roleName: string | undefined;
  try {
    const res = await iam.send(new GetInstanceProfileCommand({ InstanceProfileName: profileName }));
    roleName = res.InstanceProfile?.Roles?.[0]?.RoleName;
    if (!roleName) {
      console.warn(JSON.stringify({ level: 'warn', msg: 'role resolution failed', instanceId, profile: profileName }));
    }
  } catch {
    console.warn(JSON.stringify({ level: 'warn', msg: 'role resolution failed', instanceId, profile: profileName }));
  }
  cache.set(profileName, roleName);
  return roleName;
}

export async function discoverOnboarding(ec2: EC2Client, iam: IAMClient): Promise<Coverage> {
  const out: Coverage = { standalone: [], eksNodeCount: 0 };
  const roleNameCache = new Map<string, string | undefined>();
  let nextToken: string | undefined;
  do {
    const res = await ec2.send(new DescribeInstancesCommand({ NextToken: nextToken,
      Filters: [{ Name: 'instance-state-name', Values: ['running'] }] }));
    nextToken = res.NextToken;
    for (const inst of (res.Reservations ?? []).flatMap(r => r.Instances ?? [])) {
      const tags = Object.fromEntries((inst.Tags ?? []).map(t => [t.Key, t.Value]));
      if (Object.keys(tags).some(k => k.startsWith('kubernetes.io/cluster/'))) { out.eksNodeCount++; continue; }
      const id = inst.InstanceId!;
      let tagged = tags.NfmAgent === 'managed';
      if (!tagged) {
        await ec2.send(new CreateTagsCommand({ Resources: [id],
          Tags: [{ Key: 'NfmAgent', Value: 'managed' }] }));
        tagged = true;
      }
      const profileName = inst.IamInstanceProfile?.Arn?.split('/').pop();
      let roleName: string | undefined;
      let policyAttached = false;
      if (profileName) {
        roleName = await resolveRoleName(iam, profileName, id, roleNameCache);
        if (roleName) {
          const pols = await iam.send(new ListAttachedRolePoliciesCommand({ RoleName: roleName }));
          policyAttached = (pols.AttachedPolicies ?? []).some(p => p.PolicyArn === PUBLISH_POLICY);
          if (!policyAttached) {
            await iam.send(new AttachRolePolicyCommand({ RoleName: roleName, PolicyArn: PUBLISH_POLICY }));
            policyAttached = true;
          }
        }
      }
      out.standalone.push({ instanceId: id, tagged, roleName, policyAttached });
    }
  } while (nextToken);
  return out;
}
