import { it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AppStack } from '../lib/app-stack';

// Vpc.fromLookup falls back to a dummy VPC when no cdk.context.json is present.
// `imageTag` is required context (deploys pin the immutable per-commit SHA tag).
const template = () => Template.fromStack(new AppStack(
  new App({ context: { imageTag: 'test' } }), 'T',
  { env: { account: '<ACCOUNT_ID>', region: 'ap-northeast-2' } }));

it('ALB SG ingress is ONLY the CloudFront origin-facing prefix list on :80', () => {
  const t = template();
  t.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
    SourcePrefixListId: 'pl-22a6434b', FromPort: 80, ToPort: 80, IpProtocol: 'tcp' });
  // No stray 0.0.0.0/0 ingress anywhere (listener created with open: false):
  // the only rules are the prefix-list one and ALB→app:3000.
  const rules = Object.values(t.findResources('AWS::EC2::SecurityGroupIngress'));
  expect(rules).toHaveLength(2);
  for (const rule of rules) expect(rule.Properties.CidrIp).toBeUndefined();
  for (const sg of Object.values(t.findResources('AWS::EC2::SecurityGroup'))) {
    expect(sg.Properties.SecurityGroupIngress).toBeUndefined();
  }
});

it('TaskDefinition is arm64 Fargate with prod env and no AUTH_DISABLED', () => {
  const t = template();
  t.hasResourceProperties('AWS::ECS::TaskDefinition', {
    RequiresCompatibilities: ['FARGATE'],
    RuntimePlatform: { CpuArchitecture: 'ARM64', OperatingSystemFamily: 'LINUX' },
    Cpu: '1024', Memory: '2048' });
  const td = Object.values(t.findResources('AWS::ECS::TaskDefinition'))[0];
  const env: Array<{ Name: string }> = td.Properties.ContainerDefinitions[0].Environment;
  const names = env.map((e) => e.Name);
  expect(names).toContain('NODE_ENV');
  expect(names).toContain('COGNITO_USER_POOL_ID');
  expect(names).toContain('COGNITO_CLIENT_ID');
  expect(names).toContain('COGNITO_DOMAIN');
  expect(names).toContain('APP_URL');
  expect(names).not.toContain('AUTH_DISABLED');
  expect(names).not.toContain('ORIGIN_VERIFY_SECRET'); // must arrive via `secrets`, not env
  const secrets: Array<{ Name: string }> = td.Properties.ContainerDefinitions[0].Secrets;
  expect(secrets.map((s) => s.Name)).toContain('ORIGIN_VERIFY_SECRET');
  // Image is pinned to the context-provided immutable tag — never `latest`.
  const image = JSON.stringify(td.Properties.ContainerDefinitions[0].Image);
  expect(image).toContain(':test');
  expect(image).not.toContain(':latest');
});

it('AppStack synth fails fast when the imageTag context is missing', () => {
  expect(() => Template.fromStack(new AppStack(new App(), 'T',
    { env: { account: '<ACCOUNT_ID>', region: 'ap-northeast-2' } })))
    .toThrow(/imageTag/);
});

it('CloudFront has a no-cache /api/* behavior and forwards the origin-verify header', () => {
  const t = template();
  const CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
  const ALL_VIEWER = '216adef6-5c7f-47e4-b989-5492eafa07d3';
  t.hasResourceProperties('AWS::CloudFront::Distribution', { DistributionConfig: Match.objectLike({
    DefaultCacheBehavior: Match.objectLike({
      CachePolicyId: CACHING_DISABLED, OriginRequestPolicyId: ALL_VIEWER }),
    CacheBehaviors: Match.arrayWith([
      Match.objectLike({ PathPattern: '/api/*', CachePolicyId: CACHING_DISABLED,
        OriginRequestPolicyId: ALL_VIEWER }),
      Match.objectLike({ PathPattern: '/_next/static/*',
        CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6' }), // CACHING_OPTIMIZED
    ]),
    Origins: [Match.objectLike({
      CustomOriginConfig: Match.objectLike({ OriginProtocolPolicy: 'http-only' }),
      OriginCustomHeaders: [Match.objectLike({ HeaderName: 'X-Origin-Verify' })] })],
  }) });
});

it('Cognito client is a public PKCE client with CloudFront callback URLs', () => {
  const t = template();
  t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
    GenerateSecret: false, // PUBLIC client — PKCE only
    AllowedOAuthFlows: ['code'],
    AllowedOAuthScopes: Match.arrayWith(['openid', 'email']) });
  t.hasResourceProperties('AWS::Cognito::UserPool', {
    AdminCreateUserConfig: { AllowAdminCreateUserOnly: true } });
});
