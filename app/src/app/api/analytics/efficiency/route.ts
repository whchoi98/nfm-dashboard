import { getFlowsWindow } from '@/lib/ddb';
import { applyFlowFilters, parseLensParams } from '@/lib/analytics/filters';
import { efficiencyLens } from '@/lib/analytics/efficiency';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { buckets, namespace, category } = parseLensParams(req);
    const flows = applyFlowFilters(await getFlowsWindow(buckets), { namespace, category });
    // Each bucket covers 5 minutes — the run-rate scales this window to 30 days.
    return Response.json(efficiencyLens(flows, { windowSeconds: buckets * 300 }));
  } catch (e) {
    console.error('[api/analytics/efficiency]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
