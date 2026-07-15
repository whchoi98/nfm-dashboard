import { it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AppStack } from '../lib/app-stack';

// Vpc.fromLookup falls back to a dummy VPC when no cdk.context.json is present.
// `imageTag` is required context (deploys pin the immutable per-commit SHA tag).
// NOTE: unit tests never read cdk.json — context here is exactly what's passed.
const template = (ctx: Record<string, unknown> = {}) => Template.fromStack(new AppStack(
  new App({ context: { imageTag: 'test', ...ctx } }), 'T',
  { env: { account: '123456789012', region: 'ap-northeast-2' } }));

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

it('target group tolerates slow cold computes before killing the task', () => {
  const t = template();
  // interval 15s x unhealthy 5 = 75s of blocked event loop before replacement —
  // a 24h cold window compute (~40s) must never crash-loop the task
  // (2026-07-15 incident: threshold 2 killed tasks after 30s).
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
    HealthCheckIntervalSeconds: 15, UnhealthyThresholdCount: 5 });
});

it('TaskDefinition is arm64 Fargate with prod env and no AUTH_DISABLED', () => {
  const t = template();
  t.hasResourceProperties('AWS::ECS::TaskDefinition', {
    RequiresCompatibilities: ['FARGATE'],
    RuntimePlatform: { CpuArchitecture: 'ARM64', OperatingSystemFamily: 'LINUX' },
    Cpu: '1024', Memory: '4096' });
  const td = Object.values(t.findResources('AWS::ECS::TaskDefinition'))[0];
  const env: Array<{ Name: string; Value?: string }> = td.Properties.ContainerDefinitions[0].Environment;
  const names = env.map((e) => e.Name);
  // Node must GC against a heap ceiling below the task limit instead of being
  // OOM-killed by the cgroup (exit 137) under analytics fan-out load.
  expect(env.find((e) => e.Name === 'NODE_OPTIONS')?.Value).toContain('--max-old-space-size=3072');
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

it('authDisabled context injects AUTH_DISABLED=1 but keeps perimeter + Cognito intact', () => {
  // Both context shapes: cdk.json gives a boolean, `-c authDisabled=true` a string.
  for (const authDisabled of [true, 'true'] as const) {
    const t = template({ authDisabled });
    const td = Object.values(t.findResources('AWS::ECS::TaskDefinition'))[0];
    const env: Array<{ Name: string; Value?: string }> =
      td.Properties.ContainerDefinitions[0].Environment;
    expect(env.find((e) => e.Name === 'AUTH_DISABLED')?.Value).toBe('1');
    // The toggle must never touch the perimeter or the login infrastructure.
    const secrets: Array<{ Name: string }> = td.Properties.ContainerDefinitions[0].Secrets;
    expect(secrets.map((s) => s.Name)).toContain('ORIGIN_VERIFY_SECRET');
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', { GenerateSecret: false });
  }
});

it('AppStack synth fails fast when the imageTag context is missing', () => {
  expect(() => Template.fromStack(new AppStack(new App(), 'T',
    { env: { account: '123456789012', region: 'ap-northeast-2' } })))
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
