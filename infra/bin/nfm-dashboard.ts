import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';
import { NfmOnboardingStack } from '../lib/nfm-onboarding-stack';
import { AgentCoreStack } from '../lib/agentcore-stack';
import { AppStack } from '../lib/app-stack';
import { OpsAlarmsStack } from '../lib/ops-alarms';
import { DnsStack } from '../lib/dns-stack';

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-2',
};
new DataStack(app, 'NfmDash-Data', { env });
new NfmOnboardingStack(app, 'NfmDash-Onboarding', { env });
new AgentCoreStack(app, 'NfmDash-AgentCore', { env });
const appStack = new AppStack(app, 'NfmDash-App', { env });
new OpsAlarmsStack(app, 'NfmDash-Ops', {
  env, alb: appStack.alb, targetGroup: appStack.targetGroup });
new DnsStack(app, 'NfmDash-Dns', { env });
