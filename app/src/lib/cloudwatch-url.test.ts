import { afterEach, describe, it, expect, vi } from 'vitest';
import { cloudWatchMetricsUrl } from './cloudwatch-url';

afterEach(() => vi.unstubAllEnvs());

const ARN = 'arn:aws:networkflowmonitor:us-west-2:123456789012:monitor/demo-mon';

describe('cloudWatchMetricsUrl', () => {
  it('derives the region from the monitor ARN and pins its MonitorId', () => {
    const url = cloudWatchMetricsUrl({ monitorArn: ARN });
    expect(url).toContain('https://us-west-2.console.aws.amazon.com/cloudwatch/home?region=us-west-2#metricsV2');
    // console-hash escaping: % → *, so the ARN's ':' arrives as *3A
    expect(url).toContain('MonitorId*3D*22arn*3Aaws*3Anetworkflowmonitor');
    expect(url).not.toContain('%');
  });

  it('falls back to the namespace query and AWS_REGION without an ARN', () => {
    vi.stubEnv('AWS_REGION', 'ap-southeast-1');
    const url = cloudWatchMetricsUrl();
    expect(url).toContain('ap-southeast-1.console.aws.amazon.com');
    expect(url).toContain("query=~'AWS*2FNetworkFlowMonitor");
  });

  it('defaults to ap-northeast-2 when nothing else supplies a region', () => {
    vi.stubEnv('AWS_REGION', '');
    expect(cloudWatchMetricsUrl()).toContain('ap-northeast-2.console.aws.amazon.com');
  });

  it('lets an explicit region override the ARN region', () => {
    expect(cloudWatchMetricsUrl({ region: 'eu-west-1', monitorArn: ARN })).toContain(
      'https://eu-west-1.console.aws.amazon.com',
    );
  });
});
