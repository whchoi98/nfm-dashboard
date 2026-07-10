/** Best-effort CloudWatch metrics-console deep link for the NFM namespace
 *  (extracted verbatim from monitors/[name]). With a monitor ARN the query
 *  pins that monitor's MonitorId dimension; otherwise it opens the whole
 *  AWS/NetworkFlowMonitor namespace. The console hash uses its own
 *  '*'-escaped percent-encoding; if the query part ever drifts, the console
 *  still opens on the metrics home for the region. Region precedence:
 *  explicit opt → ARN region → AWS_REGION → ap-northeast-2. */
export function cloudWatchMetricsUrl(opts: { region?: string; monitorArn?: string } = {}): string {
  const { monitorArn } = opts;
  const region =
    opts.region || monitorArn?.split(':')[3] || process.env.AWS_REGION || 'ap-northeast-2';
  const base = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#metricsV2`;
  const query = monitorArn
    ? `{AWS/NetworkFlowMonitor,MonitorId} MonitorId="${monitorArn}"`
    : 'AWS/NetworkFlowMonitor';
  const escaped = encodeURIComponent(query).replace(/%/g, '*').replace(/'/g, '*27');
  return `${base}:graph=~();query=~'${escaped}'`;
}
