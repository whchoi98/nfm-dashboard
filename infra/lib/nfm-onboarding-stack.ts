import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'node:path';

export class NfmOnboardingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    const fn = new lambda.Function(this, 'OnboardFn', {
      functionName: 'nfm-dashboard-onboarding',
      runtime: lambda.Runtime.PYTHON_3_13, architecture: lambda.Architecture.ARM_64,
      handler: 'onboard_nfm.handler', timeout: cdk.Duration.minutes(15),
      code: lambda.Code.fromAsset(path.join(__dirname, '../../onboarding')) });
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: [
      'networkflowmonitor:*', 'eks:ListClusters', 'eks:ListAddons', 'eks:CreateAddon',
      'eks:DescribeAddon', 'eks:ListPodIdentityAssociations', 'eks:CreatePodIdentityAssociation',
      'ec2:DescribeVpcs', 'iam:GetRole', 'iam:CreateRole', 'iam:AttachRolePolicy',
      'iam:PassRole', 'iam:CreateServiceLinkedRole'], resources: ['*'] }));
    const cr = new cdk.CustomResource(this, 'Onboarding', { serviceToken: fn.functionArn,
      properties: { Version: '1' } });   // Version 값 변경 시 재실행
    new cdk.CfnOutput(this, 'MonitorsEnv', { value: cr.getAttString('MonitorsEnv') });

    new ssm.CfnAssociation(this, 'AgentInstall', {
      name: 'AWS-ConfigureAWSPackage',
      associationName: 'nfm-dashboard-agent-install',
      targets: [{ key: 'tag:NfmAgent', values: ['managed'] }],
      scheduleExpression: 'rate(1 day)',
      parameters: { action: ['Install'], name: ['AmazonCloudWatchNetworkFlowMonitorAgent'] } });
  }
}
