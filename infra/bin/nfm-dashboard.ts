import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';
import { NfmOnboardingStack } from '../lib/nfm-onboarding-stack';
import { AgentCoreStack } from '../lib/agentcore-stack';
import { AppStack } from '../lib/app-stack';

const app = new cdk.App();
const env = { account: '<ACCOUNT_ID>', region: 'ap-northeast-2' };
new DataStack(app, 'NfmDash-Data', { env });
new NfmOnboardingStack(app, 'NfmDash-Onboarding', { env });
new AgentCoreStack(app, 'NfmDash-AgentCore', { env });
new AppStack(app, 'NfmDash-App', { env });
