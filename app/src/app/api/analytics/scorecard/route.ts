import { getFlowsWindow } from '@/lib/ddb';
import { applyFlowFilters, parseLensParams } from '@/lib/analytics/filters';
import { scorecardLens } from '@/lib/analytics/scorecard';
import { getNfmMetrics, healthByMonitor } from '@/lib/cw-metrics';
import type { Series } from '@/lib/analytics/aggregate';

export const dynamic = 'force-dynamic';

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
