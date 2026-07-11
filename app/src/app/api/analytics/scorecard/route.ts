import { getFlowsWindow } from '@/lib/ddb';
import { applyFlowFilters, parseLensParams } from '@/lib/analytics/filters';
import { scorecardLens } from '@/lib/analytics/scorecard';
import { getNfmMetrics, type NfmSeries } from '@/lib/cw-metrics';
import type { Series } from '@/lib/analytics/aggregate';

export const dynamic = 'force-dynamic';

/**
 * CW HealthIndicator series (keys "HealthIndicator:<monitor>") → per-monitor
 * Series lanes (0 = healthy / > 0 = degraded, stat Maximum). Same mapping as the
 * reliability route's buildReliabilityCw, minus the worst-case aggregate the
 * scorecard lens derives itself (breachTimeline).
 */
function healthByMonitor(cwSeries: Record<string, NfmSeries>): Record<string, Series> {
  const byMonitor: Record<string, Series> = {};
  for (const [key, s] of Object.entries(cwSeries)) {
    if (!key.startsWith('HealthIndicator:')) continue;
    const monitor = s.monitor || key.slice('HealthIndicator:'.length);
    byMonitor[monitor] = {
      label: monitor,
      points: s.timestamps.map((t, i) => ({ t, v: s.values[i] ?? 0 })),
    };
  }
  return byMonitor;
}

export async function GET(req: Request) {
  try {
    const { buckets, namespace, category } = parseLensParams(req);
    const flows = applyFlowFilters(await getFlowsWindow(buckets), { namespace, category });
    let byMonitor: Record<string, Series> = {};
    try {
      byMonitor = healthByMonitor(await getNfmMetrics());
    } catch (e) {
      // CW being down must not 500 the whole lens — fall back to flows-only
      // (null availability, empty breach timeline).
      console.error('[api/analytics/scorecard] CloudWatch fetch failed; availability omitted', e);
    }
    return Response.json(scorecardLens(flows, { byMonitor }));
  } catch (e) {
    console.error('[api/analytics/scorecard]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
