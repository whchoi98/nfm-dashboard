import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';

const app = new cdk.App();
const env = { account: '<ACCOUNT_ID>', region: 'ap-northeast-2' };
new DataStack(app, 'NfmDash-Data', { env });
