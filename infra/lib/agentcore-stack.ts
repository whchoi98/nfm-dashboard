import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'node:path';

export class AgentCoreStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    const code = lambda.Code.fromAsset(path.join(__dirname, '../../tools'),
      { exclude: ['tests', 'create_gateway.py', '*.txt'] });
    const mk = (name: string, file: string) => {
      const fn = new lambda.Function(this, name, {
        functionName: `nfm-dashboard-mcp-${name.toLowerCase()}`,
        runtime: lambda.Runtime.PYTHON_3_13, architecture: lambda.Architecture.ARM_64,
        handler: `${file}.lambda_handler`, timeout: cdk.Duration.seconds(60), code,
        environment: { TABLE_FLOWS: 'nfm-dashboard-flows', TABLE_META: 'nfm-dashboard-meta' } });
      // Scope invoke to AgentCore gateways in this account only (confused-deputy guard)
      fn.addPermission('AgentCore', { principal: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        action: 'lambda:InvokeFunction', sourceAccount: this.account,
        sourceArn: `arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway/*` });
      return fn;
    };
    const net = mk('Network', 'network_mcp'), nfm = mk('Nfm', 'nfm_mcp'), ddbF = mk('Ddb', 'ddb_mcp');
    // Reachability Analyzer (analyze_reachability tool) needs create/start plus
    // ec2:CreateTags (TagSpecifications on create) and the tiros:* backend
    // actions the analysis engine calls; these APIs are account-level → '*'.
    net.addToRolePolicy(new iam.PolicyStatement({ actions: ['ec2:Describe*', 'ec2:Get*',
      'ec2:CreateNetworkInsightsPath', 'ec2:DeleteNetworkInsightsPath',
      'ec2:StartNetworkInsightsAnalysis', 'ec2:CreateTags',
      'tiros:CreateQuery', 'tiros:GetQueryAnswer', 'tiros:GetQueryExplanation',
      'ec2:DescribeNetworkInsights*', 'elasticloadbalancing:Describe*',
      'network-firewall:Describe*', 'network-firewall:List*', 'logs:FilterLogEvents',
      'eks:Describe*', 'eks:List*'], resources: ['*'] }));
    // Least-privilege: enumerated NFM read/query actions + CW metrics (CW requires *)
    nfm.addToRolePolicy(new iam.PolicyStatement({ actions: [
      'networkflowmonitor:ListMonitors', 'networkflowmonitor:ListScopes',
      'networkflowmonitor:GetMonitor', 'networkflowmonitor:GetScope',
      'networkflowmonitor:StartQueryMonitorTopContributors',
      'networkflowmonitor:GetQueryStatusMonitorTopContributors',
      'networkflowmonitor:GetQueryResultsMonitorTopContributors',
      'networkflowmonitor:StopQueryMonitorTopContributors',
      'networkflowmonitor:StartQueryWorkloadInsightsTopContributors',
      'networkflowmonitor:GetQueryStatusWorkloadInsightsTopContributors',
      'networkflowmonitor:GetQueryResultsWorkloadInsightsTopContributors',
      'networkflowmonitor:StopQueryWorkloadInsightsTopContributors',
      'cloudwatch:GetMetricData', 'cloudwatch:ListMetrics'], resources: ['*'] }));
    nfm.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [`arn:aws:dynamodb:ap-northeast-2:<ACCOUNT_ID>:table/nfm-dashboard-*`,
        `arn:aws:dynamodb:ap-northeast-2:<ACCOUNT_ID>:table/nfm-dashboard-*/index/*`] }));
    ddbF.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [`arn:aws:dynamodb:ap-northeast-2:<ACCOUNT_ID>:table/nfm-dashboard-*`,
        `arn:aws:dynamodb:ap-northeast-2:<ACCOUNT_ID>:table/nfm-dashboard-*/index/*`] }));
    const gwRole = new iam.Role(this, 'GatewayRole', { roleName: 'nfm-dashboard-gateway-role',
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com') });
    gwRole.addToPolicy(new iam.PolicyStatement({ actions: ['lambda:InvokeFunction'],
      resources: [net.functionArn, nfm.functionArn, ddbF.functionArn] }));
    new cdk.CfnOutput(this, 'GatewayRoleArn', { value: gwRole.roleArn });
  }
}
