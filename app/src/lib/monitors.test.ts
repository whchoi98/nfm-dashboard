import { describe, expect, it } from 'vitest';
import type { NfmSeries } from './cw-metrics';
import {
  buildMonitorDetail,
  buildMonitorList,
  parseMonitorsEnv,
  trafficSummary,
} from './monitors';

const series = (metric: string, monitor: string, values: number[], arn?: string): NfmSeries => ({
  metric,
  monitor,
  ...(arn ? { monitorArn: arn } : {}),
  timestamps: values.map((_, i) => new Date(1700000000000 + i * 300000).toISOString()),
  values,
});

const ARN = 'arn:aws:networkflowmonitor:ap-northeast-2:123456789012:monitor/m1';

const METRICS: Record<string, NfmSeries> = {
  'DataTransferred:m1': series('DataTransferred', 'm1', [100, 200, 300], ARN),
  'Retransmissions:m1': series('Retransmissions', 'm1', [1, 2, 3], ARN),
  'Timeouts:m1': series('Timeouts', 'm1', [0, 1, 0], ARN),
  'RoundTripTime:m1': series('RoundTripTime', 'm1', [400, 100, 300, 200], ARN),
  'HealthIndicator:m1': series('HealthIndicator', 'm1', [0, 0, 1], ARN),
  'DataTransferred:m2': series('DataTransferred', 'm2', [50]),
};

describe('trafficSummary (AWS traffic-summary semantics: avg/sum/sum/min)', () => {
  it('reduces avg / sum / sum / min + nearest-rank p50/p95', () => {
    const s = trafficSummary(METRICS, 'm1');
    expect(s.dataTransferredAvg).toBe(200); // mean(100,200,300)
    expect(s.retransmissionsSum).toBe(6);
    expect(s.timeoutsSum).toBe(1);
    expect(s.rttMin).toBe(100);
    expect(s.rttP50).toBe(200); // sorted [100,200,300,400], nearest-rank
    expect(s.rttP95).toBe(400);
  });

  it('returns null RTT stats and 0 sums when series are missing', () => {
    const s = trafficSummary(METRICS, 'm2');
    expect(s.dataTransferredAvg).toBe(50);
    expect(s.retransmissionsSum).toBe(0);
    expect(s.timeoutsSum).toBe(0);
    expect(s.rttMin).toBeNull();
    expect(s.rttP50).toBeNull();
    expect(s.rttP95).toBeNull();
  });
});

describe('buildMonitorList', () => {
  it('one row per monitor, latest NHI, DataTransferred sum + spark, sorted desc', () => {
    const list = buildMonitorList(METRICS, { m2: 'eks-blue' });
    expect(list.map((m) => m.name)).toEqual(['m1', 'm2']); // 600 > 50
    expect(list[0].nhi).toBe(1); // latest HealthIndicator value
    expect(list[0].dataTransferred).toBe(600);
    expect(list[0].spark).toEqual([100, 200, 300]);
    expect(list[0].cluster).toBeUndefined();
    expect(list[1].nhi).toBeNull(); // no HealthIndicator series
    expect(list[1].cluster).toBe('eks-blue');
  });

  it('returns [] for an empty metrics map', () => {
    expect(buildMonitorList({})).toEqual([]);
  });
});

describe('buildMonitorDetail', () => {
  it('builds nhi + traffic + timelines + arn for a known monitor', () => {
    const d = buildMonitorDetail(METRICS, 'm1');
    expect(d).not.toBeNull();
    expect(d!.name).toBe('m1');
    expect(d!.nhi).toBe(1);
    expect(d!.monitorArn).toBe(ARN);
    expect(d!.traffic.dataTransferredAvg).toBe(200);
    expect(d!.nhiTimeline.points).toHaveLength(3);
    expect(d!.dataSeries.points).toHaveLength(3);
    expect(d!.dataSeries.points[0]).toEqual({
      t: new Date(1700000000000).toISOString(),
      v: 100,
    });
  });

  it('returns null when the monitor has no metrics at all', () => {
    expect(buildMonitorDetail(METRICS, 'nope')).toBeNull();
  });

  it('omits arn and yields empty NHI timeline when those series are absent', () => {
    const d = buildMonitorDetail(METRICS, 'm2');
    expect(d).not.toBeNull();
    expect(d!.monitorArn).toBeUndefined();
    expect(d!.nhi).toBeNull();
    expect(d!.nhiTimeline.points).toEqual([]);
  });
});

describe('parseMonitorsEnv', () => {
  it('parses a name=cluster comma list (trimming whitespace)', () => {
    expect(parseMonitorsEnv('m1=eks-a, m2=eks-b')).toEqual({ m1: 'eks-a', m2: 'eks-b' });
  });
  it('ignores malformed entries and handles undefined', () => {
    expect(parseMonitorsEnv(undefined)).toEqual({});
    expect(parseMonitorsEnv('plainname,=x,y=')).toEqual({});
  });
});
