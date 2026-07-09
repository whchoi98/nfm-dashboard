import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as r53r from 'aws-cdk-lib/aws-route53resolver';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'node:path';

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

    // CoreDNS `log` plugin enablement on all EKS clusters (reversible: Delete restores).
    const fn = new lambda.Function(this, 'CorednsLogFn', {
      functionName: 'nfm-dashboard-coredns-log',
      runtime: lambda.Runtime.PYTHON_3_13, architecture: lambda.Architecture.ARM_64,
      handler: 'enable_coredns_log.handler', timeout: cdk.Duration.minutes(5),
      code: lambda.Code.fromAsset(path.join(__dirname, '../../onboarding')) });
    fn.addEnvironment('SELF_ROLE_ARN', fn.role!.roleArn);
    // Access entries grant the k8s RBAC; this IAM lets the fn create them + read clusters.
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: [
      'eks:DescribeCluster', 'eks:ListClusters',
      'eks:CreateAccessEntry', 'eks:AssociateAccessPolicy', 'eks:ListAccessEntries',
      'eks:DeleteAccessEntry',   // Delete path: best-effort access-entry cleanup
      'sts:GetCallerIdentity'], resources: ['*'] }));
    const cr = new cdk.CustomResource(this, 'CorednsLog', {
      serviceToken: fn.functionArn, properties: { Version: '1' } }); // Version 변경 시 재실행
    cr.node.addDependency(fn.role!);   // IAM policy must exist before the CR invokes the fn
  }
}
