import { getTopology, getCollectionStatus, getCoverage } from '@/lib/ddb';
import { getNfmMetrics, type NfmSeries } from '@/lib/cw-metrics';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [topology, status, coverage, series] = await Promise.all([
      getTopology(), getCollectionStatus(), getCoverage(),
      getNfmMetrics(60).catch(() => ({} as Record<string, NfmSeries>)),
    ]);
    const kpis = { dataTransferred: 0, retransmissions: 0, timeouts: 0,
      rttAvg: null as number | null, nhi: null as number | null };
    let rttSum = 0, rttCount = 0;
    for (const e of topology?.edges ?? []) {
      kpis.dataTransferred += e.metrics.DATA_TRANSFERRED ?? 0;
      kpis.retransmissions += e.metrics.RETRANSMISSIONS ?? 0;
      kpis.timeouts += e.metrics.TIMEOUTS ?? 0;
      if (e.metrics.ROUND_TRIP_TIME != null) { rttSum += e.metrics.ROUND_TRIP_TIME; rttCount++; }
    }
    if (rttCount) kpis.rttAvg = rttSum / rttCount;
    // Network Health Indicator: worst latest HealthIndicator value (0 = healthy) across monitors
    const latest = Object.values(series)
      .filter(s => s.metric === 'HealthIndicator' && s.values.length > 0)
      .map(s => s.values[s.values.length - 1]);
    if (latest.length) kpis.nhi = Math.max(...latest);
    return Response.json({ kpis, series, status, coverage });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
