import { it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DataStack } from '../lib/data-stack';

it('DataStack has 2 tables with TTL+GSIs, collector fn, 5min schedule', () => {
  const t = Template.fromStack(new DataStack(new App(), 'T',
    { env: { account: '<ACCOUNT_ID>', region: 'ap-northeast-2' } }));
  t.hasResourceProperties('AWS::DynamoDB::Table', {
    TableName: 'nfm-dashboard-flows',
    TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true } });
  t.hasResourceProperties('AWS::DynamoDB::Table', { TableName: 'nfm-dashboard-meta' });
  t.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: 'nfm-dashboard-collector', Architectures: ['arm64'], Timeout: 270 });
  t.hasResourceProperties('AWS::Scheduler::Schedule', {
    ScheduleExpression: 'rate(5 minutes)' });
});
