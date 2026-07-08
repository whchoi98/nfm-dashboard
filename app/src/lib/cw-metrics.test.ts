import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { CloudWatchClient, ListMetricsCommand, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { getNfmMetrics } from './cw-metrics';

const cwMock = mockClient(CloudWatchClient);

beforeEach(() => { cwMock.reset(); });

const ARN = 'arn:aws:networkflowmonitor:ap-northeast-2:123456789012:monitor/nfm-vpc-all';

describe('getNfmMetrics', () => {
  it('discovers dimensions via ListMetrics and returns series keyed by metric+monitor', async () => {
    cwMock.on(ListMetricsCommand).resolves({
      Metrics: [
        { Namespace: 'AWS/NetworkFlowMonitor', MetricName: 'DataTransferred',
          Dimensions: [{ Name: 'MonitorId', Value: ARN }] },
        { Namespace: 'AWS/NetworkFlowMonitor', MetricName: 'RoundTripTime',
          Dimensions: [{ Name: 'MonitorId', Value: ARN }] },
      ],
    });
    const t = new Date('2026-07-08T11:45:00Z');
    cwMock.on(GetMetricDataCommand).resolves({
      MetricDataResults: [
        { Id: 'm0', Timestamps: [t], Values: [1024] },
        { Id: 'm1', Timestamps: [t], Values: [1.5] },
      ],
    });

    const out = await getNfmMetrics(60);

    expect(Object.keys(out).sort()).toEqual([
      'DataTransferred:nfm-vpc-all',
      'RoundTripTime:nfm-vpc-all',
    ]);
    expect(out['DataTransferred:nfm-vpc-all'].values).toEqual([1024]);
    expect(out['DataTransferred:nfm-vpc-all'].timestamps).toEqual(['2026-07-08T11:45:00.000Z']);
    expect(out['RoundTripTime:nfm-vpc-all'].monitor).toBe('nfm-vpc-all');

    // GetMetricData must reuse the discovered dimensions verbatim (MonitorId, not MonitorName)
    const gmd = cwMock.commandCalls(GetMetricDataCommand)[0].args[0].input;
    const q0 = gmd.MetricDataQueries?.[0];
    expect(q0?.MetricStat?.Period).toBe(300);
    expect(q0?.MetricStat?.Metric?.Dimensions).toEqual([{ Name: 'MonitorId', Value: ARN }]);
  });

  it('returns empty object and skips GetMetricData when no metrics exist', async () => {
    cwMock.on(ListMetricsCommand).resolves({ Metrics: [] });
    const out = await getNfmMetrics();
    expect(out).toEqual({});
    expect(cwMock.commandCalls(GetMetricDataCommand)).toHaveLength(0);
  });
});
