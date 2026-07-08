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
