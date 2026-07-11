// /api/overview — landing-page payload: fleet-wide §15.4 KPIs (value + half-
// window deltaPct + per-bucket sparkline) from CloudWatch NFM metrics; top
// cost talkers, reliability breach count and the golden-signal error-rate
// series (retrans/timeout per GB per bucket) from ONE shared flows window;
// plus the existing per-monitor series / collection status / coverage.
import { getCollectionStatus, getCoverage, getFlowsWindow } from '@/lib/ddb';
import { getNfmMetrics, type NfmSeries } from '@/lib/cw-metrics';
import { buildOverviewKpis, errorRateSeries } from '@/lib/overview-metrics';
import { costLens } from '@/lib/analytics/cost';
import { reliabilityLens } from '@/lib/analytics/reliability';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [status, coverage, series, flows] = await Promise.all([
      getCollectionStatus(),
      getCoverage(),
      getNfmMetrics(60).catch(() => ({} as Record<string, NfmSeries>)),
      getFlowsWindow(12), // 10s-cached; feeds BOTH lenses below
    ]);
    const { kpis, rttP50, rttP95, nhi } = buildOverviewKpis(series);
    const topTalkers = costLens(flows)
      .top.slice(0, 6)
      .map(({ label, usd, bytes }) => ({ label, usd, bytes }));
    const breachCount = reliabilityLens(flows).breaches.length;
    const errorRates = errorRateSeries(flows); // golden-signal strip (additive field)
    return Response.json({
      kpis, rttP50, rttP95, nhi, topTalkers, breachCount, errorRates, series, status, coverage,
    });
  } catch (e) {
    console.error('[api/overview]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
