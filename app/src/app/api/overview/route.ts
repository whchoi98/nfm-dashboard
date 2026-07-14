// /api/overview — landing-page payload: fleet-wide §15.4 KPIs (value + half-
// window deltaPct + per-bucket sparkline) from CloudWatch NFM metrics; top
// cost talkers, reliability breach count, the golden-signal error-rate
// series (retrans/timeout per GB per bucket) and the at-a-glance summary
// block (scorecard/efficiency/concentration/dns) from ONE shared flows window;
// plus the existing per-monitor series / collection status / coverage.
import { getCollectionStatus, getCoverage, getDns, getFlowsWindow } from '@/lib/ddb';
import { getNfmMetrics, healthByMonitor, type NfmSeries } from '@/lib/cw-metrics';
import { buildOverviewKpis, errorRateSeries, overviewSummary } from '@/lib/overview-metrics';
import { costLens } from '@/lib/analytics/cost';
import { reliabilityLens } from '@/lib/analytics/reliability';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [status, coverage, series, flows, dns] = await Promise.all([
      getCollectionStatus(),
      getCoverage(),
      getNfmMetrics(60).catch(() => ({} as Record<string, NfmSeries>)),
      getFlowsWindow(12), // version-cached (collector cycle + 5-min grid); feeds the lenses below
      getDns().catch(() => null), // DNS is optional — degrade summary (dns → null) instead of 500
    ]);
    const { kpis, rttP50, rttP95, nhi } = buildOverviewKpis(series);
    const topTalkers = costLens(flows)
      .top.slice(0, 6)
      .map(({ label, usd, bytes }) => ({ label, usd, bytes }));
    const breachCount = reliabilityLens(flows).breaches.length;
    const errorRates = errorRateSeries(flows); // golden-signal strip (additive field)
    const summary = overviewSummary(flows, {
      byMonitor: healthByMonitor(series), // same HealthIndicator:<monitor> mapping as the scorecard route
      dns,
      windowSeconds: 12 * 300, // 12 five-minute buckets
    });
    return Response.json({
      kpis, rttP50, rttP95, nhi, topTalkers, breachCount, errorRates, series, status, coverage,
      summary, // additive at-a-glance block (Phase 12 overview cards)
    });
  } catch (e) {
    console.error('[api/overview]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
