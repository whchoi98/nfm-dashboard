import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as path from 'node:path';
import * as fs from 'node:fs';

export class DataStack extends cdk.Stack {
  readonly flows: ddb.Table; readonly meta: ddb.Table; readonly collector: lambda.Function;
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    this.flows = new ddb.Table(this, 'Flows', {
      tableName: 'nfm-dashboard-flows',
      partitionKey: { name: 'pk', type: ddb.AttributeType.STRING },
      sortKey: { name: 'sk', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl', removalPolicy: cdk.RemovalPolicy.DESTROY });
    for (const [i, [pk, sk]] of ([['gsi1pk','gsi1sk'],['gsi2pk','gsi2sk'],['gsi3pk','gsi3sk']] as const).entries())
      this.flows.addGlobalSecondaryIndex({ indexName: `GSI${i+1}`,
        partitionKey: { name: pk, type: ddb.AttributeType.STRING },
        sortKey: { name: sk, type: ddb.AttributeType.STRING } });
    this.meta = new ddb.Table(this, 'Meta', {
      tableName: 'nfm-dashboard-meta',
      partitionKey: { name: 'pk', type: ddb.AttributeType.STRING },
      sortKey: { name: 'sk', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl', removalPolicy: cdk.RemovalPolicy.DESTROY });

    const collectorDist = path.join(__dirname, '../../collector/dist');
    if (!fs.existsSync(path.join(collectorDist, 'handler.mjs')))
      throw new Error('collector/dist/handler.mjs missing — run: npm -w collector run build');
    this.collector = new lambda.Function(this, 'Collector', {
      functionName: 'nfm-dashboard-collector',
      runtime: lambda.Runtime.NODEJS_22_X, architecture: lambda.Architecture.ARM_64,
      handler: 'handler.handler', memorySize: 512, timeout: cdk.Duration.seconds(270),
      code: lambda.Code.fromAsset(collectorDist),
      environment: { TABLE_FLOWS: this.flows.tableName, TABLE_META: this.meta.tableName,
        MONITORS: this.node.tryGetContext('nfmMonitors') ?? '', CONCURRENCY: '5',
        EXTENDED_CATEGORY_EVERY: '3', DNS_COLLECT_EVERY: '3',
        DNS_CORE_GROUPS: ['ekscluster01-iptables', 'ekscluster01-ipvs', 'ekscluster01-nftables',
          'eksworkshop'].map(c => `/aws/containerinsights/${c}/application`).join(','),
        DNS_RESOLVER_GROUP: '/nfm-dashboard/resolver-dns' } });
    this.flows.grantWriteData(this.collector);
    this.meta.grantReadWriteData(this.collector);
    this.collector.addToRolePolicy(new iam.PolicyStatement({ actions: [
      'networkflowmonitor:StartQueryMonitorTopContributors',
      'networkflowmonitor:GetQueryStatusMonitorTopContributors',
      'networkflowmonitor:GetQueryResultsMonitorTopContributors',
      'networkflowmonitor:StopQueryMonitorTopContributors',
      'networkflowmonitor:ListMonitors',
      'networkflowmonitor:ListScopes',
      'networkflowmonitor:StartQueryWorkloadInsightsTopContributors',
      'networkflowmonitor:GetQueryStatusWorkloadInsightsTopContributors',
      'networkflowmonitor:GetQueryResultsWorkloadInsightsTopContributors',
      'networkflowmonitor:StopQueryWorkloadInsightsTopContributors',
      'ec2:DescribeInstances', 'ec2:CreateTags'], resources: ['*'] }));
    this.collector.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:ListAttachedRolePolicies', 'iam:GetInstanceProfile'],
      resources: ['arn:aws:iam::<ACCOUNT_ID>:role/*', 'arn:aws:iam::<ACCOUNT_ID>:instance-profile/*'] }));
    this.collector.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:AttachRolePolicy'], resources: ['arn:aws:iam::<ACCOUNT_ID>:role/*'],
      conditions: { ArnEquals: { 'iam:PolicyARN':
        'arn:aws:iam::aws:policy/CloudWatchNetworkFlowMonitorAgentPublishPolicy' } } }));
    // DNS pass: Logs Insights over CoreDNS (Container Insights) + Resolver query log groups.
    // StartQuery supports log-group scoping; GetQueryResults/StopQuery take only a queryId
    // (no resource type in the CWL service authorization reference), so they need '*'.
    this.collector.addToRolePolicy(new iam.PolicyStatement({ actions: ['logs:StartQuery'],
      resources: [
        'arn:aws:logs:ap-northeast-2:<ACCOUNT_ID>:log-group:/aws/containerinsights/*',
        'arn:aws:logs:ap-northeast-2:<ACCOUNT_ID>:log-group:/nfm-dashboard/resolver-dns',
        'arn:aws:logs:ap-northeast-2:<ACCOUNT_ID>:log-group:/nfm-dashboard/resolver-dns:*'] }));
    this.collector.addToRolePolicy(new iam.PolicyStatement({
      actions: ['logs:GetQueryResults', 'logs:StopQuery'], resources: ['*'] }));

    const schedRole = new iam.Role(this, 'SchedRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com') });
    this.collector.grantInvoke(schedRole);
    new scheduler.CfnSchedule(this, 'Every5m', {
      flexibleTimeWindow: { mode: 'OFF' }, scheduleExpression: 'rate(5 minutes)',
      target: { arn: this.collector.functionArn, roleArn: schedRole.roleArn } });
  }
}
