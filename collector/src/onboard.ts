import { EC2Client, DescribeInstancesCommand, CreateTagsCommand } from '@aws-sdk/client-ec2';
import { IAMClient, ListAttachedRolePoliciesCommand, AttachRolePolicyCommand } from '@aws-sdk/client-iam';

const PUBLISH_POLICY = 'arn:aws:iam::aws:policy/CloudWatchNetworkFlowMonitorAgentPublishPolicy';
export interface Coverage {
  standalone: { instanceId: string; tagged: boolean; roleName?: string; policyAttached: boolean }[];
  eksNodeCount: number;
}

export async function discoverOnboarding(ec2: EC2Client, iam: IAMClient): Promise<Coverage> {
  const out: Coverage = { standalone: [], eksNodeCount: 0 };
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
      const roleName = inst.IamInstanceProfile?.Arn?.split('/').pop();
      let policyAttached = false;
      if (roleName) {
        const pols = await iam.send(new ListAttachedRolePoliciesCommand({ RoleName: roleName }));
        policyAttached = (pols.AttachedPolicies ?? []).some(p => p.PolicyArn === PUBLISH_POLICY);
        if (!policyAttached) {
          await iam.send(new AttachRolePolicyCommand({ RoleName: roleName, PolicyArn: PUBLISH_POLICY }));
          policyAttached = true;
        }
      }
      out.standalone.push({ instanceId: id, tagged, roleName, policyAttached });
    }
  } while (nextToken);
  return out;
}
