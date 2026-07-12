import { it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DataStack } from '../lib/data-stack';

it('DataStack has 2 tables with TTL+GSIs, collector fn, 5min schedule', () => {
  const t = Template.fromStack(new DataStack(new App(), 'T',
    { env: { account: '123456789012', region: 'ap-northeast-2' } }));
  t.hasResourceProperties('AWS::DynamoDB::Table', {
    TableName: 'nfm-dashboard-flows',
    TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true } });
  t.hasResourceProperties('AWS::DynamoDB::Table', { TableName: 'nfm-dashboard-meta' });
  t.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: 'nfm-dashboard-collector', Architectures: ['arm64'], Timeout: 270 });
  t.hasResourceProperties('AWS::Scheduler::Schedule', {
    ScheduleExpression: 'rate(5 minutes)' });
});

it('DataStack collector has DNS env + Logs Insights IAM', () => {
  const t = Template.fromStack(new DataStack(new App(), 'T',
    { env: { account: '123456789012', region: 'ap-northeast-2' } }));
  t.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: 'nfm-dashboard-collector',
    Environment: { Variables: Match.objectLike({
      DNS_COLLECT_EVERY: '3', EXTENDED_CATEGORY_EVERY: '3',
      DNS_RESOLVER_GROUP: '/nfm-dashboard/resolver-dns',
      DNS_CORE_GROUPS: Match.stringLikeRegexp(
        'containerinsights/ekscluster01-iptables/application.*eksworkshop/application') }) } });
  t.hasResourceProperties('AWS::IAM::Policy', { PolicyDocument: { Statement: Match.arrayWith([
    Match.objectLike({ Action: 'logs:StartQuery', Resource: Match.arrayWith([
      'arn:aws:logs:ap-northeast-2:123456789012:log-group:/aws/containerinsights/*']) }),
    Match.objectLike({ Action: ['logs:GetQueryResults', 'logs:StopQuery'], Resource: '*' }),
  ]) } });
});
