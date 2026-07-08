import { it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { EC2Client, DescribeInstancesCommand, CreateTagsCommand } from '@aws-sdk/client-ec2';
import { IAMClient, ListAttachedRolePoliciesCommand, AttachRolePolicyCommand,
  GetInstanceProfileCommand } from '@aws-sdk/client-iam';
import { discoverOnboarding } from './onboard.js';

const ec2 = mockClient(EC2Client), iam = mockClient(IAMClient);
beforeEach(() => { ec2.reset(); iam.reset(); });

it('tags untagged standalone instances and attaches publish policy', async () => {
  ec2.on(DescribeInstancesCommand).resolves({ Reservations: [{ Instances: [
    { InstanceId: 'i-eks', Tags: [{ Key: 'kubernetes.io/cluster/demo', Value: 'owned' }],
      IamInstanceProfile: { Arn: 'arn:aws:iam::1:instance-profile/eksrole' }, State: { Name: 'running' } },
    { InstanceId: 'i-solo', Tags: [{ Key: 'Name', Value: 'redis' }],
      IamInstanceProfile: { Arn: 'arn:aws:iam::1:instance-profile/solorole-profile' }, State: { Name: 'running' } },
  ] }] });
  ec2.on(CreateTagsCommand).resolves({});
  iam.on(GetInstanceProfileCommand).resolves({ InstanceProfile: { Roles: [{ RoleName: 'solorole-actual-role' }] } } as any);
  iam.on(ListAttachedRolePoliciesCommand).resolves({ AttachedPolicies: [] });
  iam.on(AttachRolePolicyCommand).resolves({});
  const cov = await discoverOnboarding(new EC2Client({}), new IAMClient({}));
  expect(cov.eksNodeCount).toBe(1);
  expect(cov.standalone).toHaveLength(1);
  expect(cov.standalone[0]).toMatchObject({ instanceId: 'i-solo', tagged: true,
    roleName: 'solorole-actual-role', policyAttached: true });
  expect(ec2.commandCalls(CreateTagsCommand)).toHaveLength(1);
  expect(iam.commandCalls(AttachRolePolicyCommand)).toHaveLength(1);
  expect(iam.commandCalls(AttachRolePolicyCommand)[0].args[0].input).toMatchObject({
    RoleName: 'solorole-actual-role' });
});

it('skips already-tagged instances (idempotent)', async () => {
  ec2.on(DescribeInstancesCommand).resolves({ Reservations: [{ Instances: [
    { InstanceId: 'i-done', Tags: [{ Key: 'NfmAgent', Value: 'managed' }],
      IamInstanceProfile: { Arn: 'arn:aws:iam::1:instance-profile/r' }, State: { Name: 'running' } } ] }] });
  iam.on(GetInstanceProfileCommand).resolves({ InstanceProfile: { Roles: [{ RoleName: 'r' }] } } as any);
  iam.on(ListAttachedRolePoliciesCommand).resolves({ AttachedPolicies: [
    { PolicyArn: 'arn:aws:iam::aws:policy/CloudWatchNetworkFlowMonitorAgentPublishPolicy' }] });
  const cov = await discoverOnboarding(new EC2Client({}), new IAMClient({}));
  expect(ec2.commandCalls(CreateTagsCommand)).toHaveLength(0);
  expect(iam.commandCalls(AttachRolePolicyCommand)).toHaveLength(0);
  expect(cov.standalone[0].tagged).toBe(true);
});

it('reports policyAttached false without throwing when GetInstanceProfile fails', async () => {
  ec2.on(DescribeInstancesCommand).resolves({ Reservations: [{ Instances: [
    { InstanceId: 'i-badprofile', Tags: [{ Key: 'Name', Value: 'app' }],
      IamInstanceProfile: { Arn: 'arn:aws:iam::1:instance-profile/ghost-profile' }, State: { Name: 'running' } },
  ] }] });
  ec2.on(CreateTagsCommand).resolves({});
  iam.on(GetInstanceProfileCommand).rejects(new Error('NoSuchEntity'));
  const cov = await discoverOnboarding(new EC2Client({}), new IAMClient({}));
  expect(cov.standalone).toHaveLength(1);
  expect(cov.standalone[0]).toMatchObject({ instanceId: 'i-badprofile', policyAttached: false, roleName: undefined });
  expect(iam.commandCalls(AttachRolePolicyCommand)).toHaveLength(0);
});

it('caches instance profile lookups for repeated profile ARNs', async () => {
  ec2.on(DescribeInstancesCommand).resolves({ Reservations: [{ Instances: [
    { InstanceId: 'i-solo1', Tags: [{ Key: 'Name', Value: 'app1' }],
      IamInstanceProfile: { Arn: 'arn:aws:iam::1:instance-profile/solorole-profile' }, State: { Name: 'running' } },
    { InstanceId: 'i-solo2', Tags: [{ Key: 'Name', Value: 'app2' }],
      IamInstanceProfile: { Arn: 'arn:aws:iam::1:instance-profile/solorole-profile' }, State: { Name: 'running' } },
  ] }] });
  ec2.on(CreateTagsCommand).resolves({});
  iam.on(GetInstanceProfileCommand).resolves({ InstanceProfile: { Roles: [{ RoleName: 'solorole-actual-role' }] } } as any);
  iam.on(ListAttachedRolePoliciesCommand).resolves({ AttachedPolicies: [] });
  iam.on(AttachRolePolicyCommand).resolves({});
  const cov = await discoverOnboarding(new EC2Client({}), new IAMClient({}));
  expect(cov.standalone).toHaveLength(2);
  expect(cov.standalone[0]).toMatchObject({ instanceId: 'i-solo1', roleName: 'solorole-actual-role' });
  expect(cov.standalone[1]).toMatchObject({ instanceId: 'i-solo2', roleName: 'solorole-actual-role' });
  expect(iam.commandCalls(GetInstanceProfileCommand)).toHaveLength(1);
});
