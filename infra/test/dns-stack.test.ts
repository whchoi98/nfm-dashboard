import { it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DnsStack } from '../lib/dns-stack';

it('creates resolver query-log config + log group + association', () => {
  const t = Template.fromStack(new DnsStack(new App({ context: { imageTag: 'unused' } }), 'T',
    { env: { account: '<ACCOUNT_ID>', region: 'ap-northeast-2' } }));
  t.hasResourceProperties('AWS::Logs::LogGroup', { LogGroupName: '/nfm-dashboard/resolver-dns' });
  t.resourceCountIs('AWS::Route53Resolver::ResolverQueryLoggingConfig', 1);
  t.resourceCountIs('AWS::Route53Resolver::ResolverQueryLoggingConfigAssociation', 1);
});

it('creates the coredns-log enable lambda + custom resource', () => {
  const t = Template.fromStack(new DnsStack(new App({ context: { imageTag: 'unused' } }), 'T',
    { env: { account: '<ACCOUNT_ID>', region: 'ap-northeast-2' } }));
  t.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: 'nfm-dashboard-coredns-log', Handler: 'enable_coredns_log.handler' });
  t.hasResourceProperties('AWS::CloudFormation::CustomResource', { Version: '1' });
});
