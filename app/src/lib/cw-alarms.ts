// CloudWatch alarm states for the Alerts page (Phase 8 Task 1). Server-only.
// Mirrors the cw-metrics client pattern; scoped to this dashboard's alarms
// via the `nfm-dashboard-` name prefix (infra names all its alarms that way).
import { CloudWatchClient, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';

const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';
const ALARM_PREFIX = 'nfm-dashboard-';

let client: CloudWatchClient | undefined;
function cw(): CloudWatchClient {
  return (client ??= new CloudWatchClient({ region: REGION }));
}

export interface AlarmState {
  name: string;
  stateValue: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';
  stateReason?: string;
  metricName?: string;
  updatedAt?: string;
}

function toStateValue(v: string | undefined): AlarmState['stateValue'] {
  return v === 'OK' || v === 'ALARM' ? v : 'INSUFFICIENT_DATA';
}

/**
 * All `nfm-dashboard-*` CloudWatch alarms with their current state.
 * NEVER throws — any failure (missing IAM, region issues, throttling)
 * degrades to [] so the alerts route can still serve derived events.
 */
export async function getAlarms(): Promise<AlarmState[]> {
  try {
    const alarms: AlarmState[] = [];
    let nextToken: string | undefined;
    do {
      const res = await cw().send(
        new DescribeAlarmsCommand({ AlarmNamePrefix: ALARM_PREFIX, NextToken: nextToken }),
      );
      for (const a of res.MetricAlarms ?? []) {
        if (!a.AlarmName?.startsWith(ALARM_PREFIX)) continue;
        alarms.push({
          name: a.AlarmName,
          stateValue: toStateValue(a.StateValue),
          stateReason: a.StateReason,
          metricName: a.MetricName,
          updatedAt: a.StateUpdatedTimestamp?.toISOString(),
        });
      }
      nextToken = res.NextToken;
    } while (nextToken);
    return alarms;
  } catch (e) {
    console.error('[cw-alarms] DescribeAlarms failed; returning []', e);
    return [];
  }
}
