import { it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AppStack } from '../lib/app-stack';
import { OpsAlarmsStack } from '../lib/ops-alarms';

// OpsAlarmsStack consumes the ALB/target group from AppStack (cross-stack refs),
// so synth both. `imageTag` is required context for AppStack.
const template = () => {
  const app = new App({ context: { imageTag: 'test' } });
  const env = { account: '123456789012', region: 'ap-northeast-2' };
  const appStack = new AppStack(app, 'TApp', { env });
  return Template.fromStack(new OpsAlarmsStack(app, 'TOps', {
    env, alb: appStack.alb, targetGroup: appStack.targetGroup }));
};

it('creates exactly the 3 ops alarms wired to the nfm-dashboard-alarms topic', () => {
  const t = template();
  t.resourceCountIs('AWS::CloudWatch::Alarm', 3);
  t.hasResourceProperties('AWS::SNS::Topic', { TopicName: 'nfm-dashboard-alarms' });
  // Every alarm notifies the topic on ALARM (and OK for recovery).
  for (const alarm of Object.values(t.findResources('AWS::CloudWatch::Alarm'))) {
    expect(alarm.Properties.AlarmActions).toHaveLength(1);
    expect(alarm.Properties.OKActions).toHaveLength(1);
  }
});

it('collector errors: >=1 error for 3 consecutive 5-min periods', () => {
  template().hasResourceProperties('AWS::CloudWatch::Alarm', {
    AlarmName: 'nfm-dashboard-collector-errors',
    Namespace: 'AWS/Lambda', MetricName: 'Errors',
    Dimensions: [{ Name: 'FunctionName', Value: 'nfm-dashboard-collector' }],
    Statistic: 'Sum', Period: 300,
    ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    Threshold: 1, EvaluationPeriods: 3,
    TreatMissingData: 'notBreaching' });
});

it('ALB liveness: HealthyHostCount < 1 for 3 minutes (missing data breaches)', () => {
  template().hasResourceProperties('AWS::CloudWatch::Alarm', {
    AlarmName: 'nfm-dashboard-alb-no-healthy-hosts',
    Namespace: 'AWS/ApplicationELB', MetricName: 'HealthyHostCount',
    Dimensions: Match.arrayWith([Match.objectLike({ Name: 'LoadBalancer' }),
      Match.objectLike({ Name: 'TargetGroup' })]),
    Statistic: 'Minimum', Period: 60,
    ComparisonOperator: 'LessThanThreshold',
    Threshold: 1, EvaluationPeriods: 3,
    TreatMissingData: 'breaching' });
});

it('ALB 5xx: HTTPCode_ELB_5XX_Count > 10 in 5 minutes', () => {
  template().hasResourceProperties('AWS::CloudWatch::Alarm', {
    AlarmName: 'nfm-dashboard-alb-5xx',
    Namespace: 'AWS/ApplicationELB', MetricName: 'HTTPCode_ELB_5XX_Count',
    Dimensions: Match.arrayWith([Match.objectLike({ Name: 'LoadBalancer' })]),
    Statistic: 'Sum', Period: 300,
    ComparisonOperator: 'GreaterThanThreshold',
    Threshold: 10, EvaluationPeriods: 1,
    TreatMissingData: 'notBreaching' });
});
