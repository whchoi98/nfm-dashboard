import { cachedLens, getFlowsWindow, lensCacheKey } from '@/lib/ddb';
import { applyFlowFilters, parseLensParams } from '@/lib/analytics/filters';
import { efficiencyLens } from '@/lib/analytics/efficiency';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { buckets, namespace, category } = parseLensParams(req);
    const data = await cachedLens(lensCacheKey('analytics/efficiency', req.url), async () => {
      const flows = applyFlowFilters(await getFlowsWindow(buckets), { namespace, category });
      // Each bucket covers 5 minutes — the run-rate scales this window to 30 days.
      return efficiencyLens(flows, { windowSeconds: buckets * 300 });
    });
    return Response.json(data);
  } catch (e) {
    console.error('[api/analytics/efficiency]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
