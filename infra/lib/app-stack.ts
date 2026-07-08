import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

const VPC_ID = 'vpc-0dfa5610180dfa628'; // cc-on-bedrock-vpc (existing, reuse NAT)
const CLOUDFRONT_ORIGIN_FACING_PL = 'pl-22a6434b'; // com.amazonaws.global.cloudfront.origin-facing
const ADMIN_SECRET_NAME = 'nfm-dashboard/cognito-admin'; // created out-of-band (scripts/save-cognito-secret.sh)

/**
 * AppStack: ECR image → ECS Fargate (arm64) behind ALB, fronted by CloudFront,
 * auth via Cognito Hosted UI (public client + PKCE).
 *
 * Circular-dependency resolution (APP_URL ↔ CloudFront ↔ Cognito ↔ container env):
 *   1. ALB is created first (no listener targets yet) — CloudFront only needs its DNS name.
 *   2. CloudFront Distribution references the ALB DNS; its `distributionDomainName`
 *      token becomes APP_URL.
 *   3. The Cognito UserPoolClient callback/logout URLs and the container env both
 *      consume the APP_URL token — no cycle, CloudFormation orders: ALB → Distribution
 *      → (UserPoolClient, TaskDefinition) → Service → Listener/TargetGroup.
 *   4. ORIGIN_VERIFY_SECRET is a Secrets Manager generated secret: stable across
 *      deploys (no synth-time randomness → no task-def/distribution churn), injected
 *      into CloudFront via a CFN dynamic reference and into the container via ECS
 *      `secrets` (never plaintext in the template).
 */
export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    const region = 'ap-northeast-2';

    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: VPC_ID });

    // ── Security groups ────────────────────────────────────────────────────
    // ALB accepts traffic ONLY from CloudFront origin-facing IPs (managed prefix list).
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc, description: 'nfm-dashboard ALB - ingress from CloudFront origin-facing only',
      allowAllOutbound: true });
    albSg.addIngressRule(ec2.Peer.prefixList(CLOUDFRONT_ORIGIN_FACING_PL), ec2.Port.tcp(80),
      'CloudFront origin-facing');
    const appSg = new ec2.SecurityGroup(this, 'AppSg', {
      vpc, description: 'nfm-dashboard app tasks - ingress from ALB only', allowAllOutbound: true });
    appSg.addIngressRule(albSg, ec2.Port.tcp(3000), 'ALB to app');

    // ── ALB (public subnets; listener added after the service exists) ─────
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc, internetFacing: true, securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      idleTimeout: cdk.Duration.seconds(120) }); // SSE streams idle longer than default 60s

    // ── Origin-verify shared secret (CloudFront ↔ middleware) ─────────────
    const originVerify = new secretsmanager.Secret(this, 'OriginVerify', {
      secretName: 'nfm-dashboard/origin-verify',
      description: 'X-Origin-Verify header shared between CloudFront and the app middleware',
      generateSecretString: { passwordLength: 48, excludePunctuation: true, includeSpace: false } });

    // ── CloudFront ─────────────────────────────────────────────────────────
    const origin = new origins.HttpOrigin(alb.loadBalancerDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      readTimeout: cdk.Duration.seconds(60), keepaliveTimeout: cdk.Duration.seconds(60),
      // Dynamic reference — resolved by CloudFormation, never plaintext in the template.
      customHeaders: { 'X-Origin-Verify': originVerify.secretValue.unsafeUnwrap() } });
    const noCache = {
      origin,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    } satisfies cloudfront.BehaviorOptions;
    const distribution = new cloudfront.Distribution(this, 'Dist', {
      comment: 'nfm-dashboard',
      defaultBehavior: noCache, // dynamic pages + SSE: no caching, no buffering
      additionalBehaviors: {
        '/api/*': noCache, // explicit: API (incl. SSE /api/ai) is never cached
        '/_next/static/*': {
          origin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED, // immutable hashed assets
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      },
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3 });
    const appUrl = `https://${distribution.distributionDomainName}`;

    // ── Cognito ────────────────────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'nfm-dashboard',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY });
    const domain = userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: 'nfm-dashboard-<ACCOUNT_ID>' } });
    const client = userPool.addClient('Client', {
      userPoolClientName: 'nfm-dashboard-app',
      generateSecret: false, // PUBLIC client — PKCE, the callback never sends a secret
      preventUserExistenceErrors: true,
      // Session cookie lives 8h; keep the id token verifiable for the same window.
      idTokenValidity: cdk.Duration.hours(8),
      accessTokenValidity: cdk.Duration.hours(8),
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: [`${appUrl}/api/auth/callback`],
        logoutUrls: [`${appUrl}/login`] } });

    // Initial admin user. The password is read INSIDE the Lambda from Secrets
    // Manager (scripts/save-cognito-secret.sh) — it never appears in the template.
    const adminSecret = secretsmanager.Secret.fromSecretNameV2(this, 'AdminSecret', ADMIN_SECRET_NAME);
    const adminFn = new lambda.Function(this, 'AdminUserFn', {
      runtime: lambda.Runtime.NODEJS_22_X, architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler', timeout: cdk.Duration.seconds(60),
      logRetention: logs.RetentionDays.ONE_MONTH,
      code: lambda.Code.fromInline(ADMIN_USER_HANDLER) });
    adminSecret.grantRead(adminFn);
    adminFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminSetUserPassword'],
      resources: [userPool.userPoolArn] }));
    new cdk.CustomResource(this, 'AdminUser', {
      serviceToken: adminFn.functionArn,
      properties: { UserPoolId: userPool.userPoolId, SecretId: ADMIN_SECRET_NAME } });

    // ── ECS Fargate (arm64, private subnets, existing NAT) ────────────────
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, clusterName: 'nfm-dashboard' });
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      family: 'nfm-dashboard-app', cpu: 1024, memoryLimitMiB: 2048,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX } });
    const repo = ecr.Repository.fromRepositoryName(this, 'Repo', 'nfm-dashboard-app');
    taskDef.addContainer('app', {
      containerName: 'app',
      image: ecs.ContainerImage.fromEcrRepository(repo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'app', logRetention: logs.RetentionDays.ONE_MONTH }),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        NODE_ENV: 'production', // AUTH_DISABLED can never bypass (middleware fail-open guard)
        AWS_REGION: region,
        APP_URL: appUrl,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: client.userPoolClientId,
        COGNITO_DOMAIN: domain.baseUrl(), // https://<prefix>.auth.ap-northeast-2.amazoncognito.com
        TABLE_FLOWS: 'nfm-dashboard-flows',
        TABLE_META: 'nfm-dashboard-meta',
        COLLECTOR_FUNCTION: 'nfm-dashboard-collector',
        MONITORS: this.node.tryGetContext('nfmMonitors') ?? '' },
      secrets: { ORIGIN_VERIFY_SECRET: ecs.Secret.fromSecretsManager(originVerify) } });

    // Task role — least privilege per runtime needs of the app.
    const task = taskDef.taskRole;
    task.addToPrincipalPolicy(new iam.PolicyStatement({ // Converse(Stream) on global inference profile
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: ['*'] })); // global profile fans out to multi-region foundation-model ARNs
    task.addToPrincipalPolicy(new iam.PolicyStatement({ // SigV4 MCP calls to the AgentCore gateway
      actions: ['bedrock-agentcore:InvokeGateway'],
      resources: [`arn:aws:bedrock-agentcore:${region}:${this.account}:gateway/*`] }));
    task.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:BatchGetItem',
        'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:BatchWriteItem'],
      resources: [`arn:aws:dynamodb:${region}:${this.account}:table/nfm-dashboard-*`,
        `arn:aws:dynamodb:${region}:${this.account}:table/nfm-dashboard-*/index/*`] }));
    task.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${region}:${this.account}:function:nfm-dashboard-collector`] }));
    task.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:GetMetricData', 'cloudwatch:ListMetrics'], resources: ['*'] }));
    task.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${region}:${this.account}:parameter/nfm-dashboard/*`] }));
    task.addToPrincipalPolicy(new iam.PolicyStatement({ // SecureString /nfm-dashboard/gateway-url (aws/ssm key)
      actions: ['kms:Decrypt'], resources: ['*'],
      conditions: { StringEquals: { 'kms:ViaService': `ssm.${region}.amazonaws.com` } } }));

    const service = new ecs.FargateService(this, 'Service', {
      cluster, taskDefinition: taskDef, serviceName: 'nfm-dashboard-app',
      desiredCount: 1, securityGroups: [appSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      minHealthyPercent: 100, maxHealthyPercent: 200,
      circuitBreaker: { rollback: true } });

    const listener = alb.addListener('Http', { port: 80, open: false }); // SG stays prefix-list-only
    listener.addTargets('App', {
      port: 3000, protocol: elbv2.ApplicationProtocol.HTTP, targets: [service],
      deregistrationDelay: cdk.Duration.seconds(10),
      healthCheck: { path: '/api/health', healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(15), healthyThresholdCount: 2 } });

    // ── Outputs ────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'AppUrl', { value: appUrl });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'ClientId', { value: client.userPoolClientId });
    new cdk.CfnOutput(this, 'CognitoDomain', { value: domain.baseUrl() });
    new cdk.CfnOutput(this, 'AlbDns', { value: alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
  }
}

// Custom-resource Lambda: AdminCreateUser(SUPPRESS) + AdminSetUserPassword(Permanent).
// Reads {email,password} from Secrets Manager inside the Lambda — never via CFN params.
const ADMIN_USER_HANDLER = `
const { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand } =
  require('@aws-sdk/client-cognito-identity-provider');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const https = require('https');

function respond(event, status, reason) {
  const body = JSON.stringify({
    Status: status, Reason: reason || 'ok',
    PhysicalResourceId: event.PhysicalResourceId || 'nfm-dashboard-admin-user',
    StackId: event.StackId, RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId, Data: {} });
  const u = new URL(event.ResponseURL);
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'PUT',
      headers: { 'content-type': '', 'content-length': Buffer.byteLength(body) } },
      (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', reject); req.write(body); req.end();
  });
}

exports.handler = async (event) => {
  try {
    if (event.RequestType === 'Delete') { await respond(event, 'SUCCESS'); return; }
    const { UserPoolId, SecretId } = event.ResourceProperties;
    const sm = new SecretsManagerClient({});
    const sec = await sm.send(new GetSecretValueCommand({ SecretId }));
    const { email, password } = JSON.parse(sec.SecretString);
    const idp = new CognitoIdentityProviderClient({});
    try {
      await idp.send(new AdminCreateUserCommand({ UserPoolId, Username: email,
        MessageAction: 'SUPPRESS',
        UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }] }));
    } catch (e) { if (e.name !== 'UsernameExistsException') throw e; }
    await idp.send(new AdminSetUserPasswordCommand({ UserPoolId, Username: email,
      Password: password, Permanent: true }));
    await respond(event, 'SUCCESS');
  } catch (e) {
    console.error('admin user provisioning failed:', e.name); // never log the secret payload
    await respond(event, 'FAILED', e.name || 'error');
  }
};
`;
