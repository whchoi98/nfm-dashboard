/** Best-effort CloudWatch metrics-console deep link for the NFM namespace
 *  (extracted verbatim from monitors/[name]). With a monitor ARN the query
 *  pins that monitor's MonitorId dimension; otherwise it opens the whole
 *  AWS/NetworkFlowMonitor namespace. The console hash uses its own
 *  '*'-escaped percent-encoding; if the query part ever drifts, the console
 *  still opens on the metrics home for the region. Region precedence:
 *  explicit opt → ARN region → AWS_REGION → ap-northeast-2. */
export function cloudWatchMetricsUrl(opts: { region?: string; monitorArn?: string } = {}): string {
  const { monitorArn } = opts;
  const region = resolveRegion(opts.region, monitorArn);
  const base = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#metricsV2`;
  const query = monitorArn
    ? `{AWS/NetworkFlowMonitor,MonitorId} MonitorId="${monitorArn}"`
    : 'AWS/NetworkFlowMonitor';
  return `${base}:graph=~();query=~'${consoleEscape(query)}'`;
}

/** Best-effort CloudWatch create-alarm console deep link for an NFM metric.
 *  `#alarmsV2:create` always lands on the alarm-creation wizard; the appended
 *  search query (namespace + metric + MonitorId) narrows the metric picker
 *  best-effort — if the console ignores it, the wizard still opens. Same
 *  region precedence and '*'-escape convention as cloudWatchMetricsUrl. */
export function cloudWatchCreateAlarmUrl(
  opts: { region?: string; monitorArn?: string; metricName?: string } = {},
): string {
  const { monitorArn, metricName } = opts;
  const region = resolveRegion(opts.region, monitorArn);
  const base = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:create`;
  const parts = ['AWS/NetworkFlowMonitor'];
  if (metricName) parts.push(metricName);
  if (monitorArn) parts.push(`MonitorId="${monitorArn}"`);
  return `${base}?query=~'${consoleEscape(parts.join(' '))}'`;
}

/** Region precedence: explicit opt → ARN region → AWS_REGION → ap-northeast-2. */
function resolveRegion(region?: string, monitorArn?: string): string {
  return region || monitorArn?.split(':')[3] || process.env.AWS_REGION || 'ap-northeast-2';
}

/** CloudWatch console-hash percent-encoding ('%' → '*', "'" → '*27'). */
function consoleEscape(query: string): string {
  return encodeURIComponent(query).replace(/%/g, '*').replace(/'/g, '*27');
}
