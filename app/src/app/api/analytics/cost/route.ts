import { cachedLens, getFlowsWindow, lensCacheKey } from '@/lib/ddb';
import { applyFlowFilters, parseLensParams } from '@/lib/analytics/filters';
import { costLens } from '@/lib/analytics/cost';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { buckets, namespace, category } = parseLensParams(req);
    const data = await cachedLens(lensCacheKey('analytics/cost', req.url), async () => {
      const flows = applyFlowFilters(await getFlowsWindow(buckets), { namespace, category });
      return costLens(flows);
    });
    return Response.json(data);
  } catch (e) {
    console.error('[api/analytics/cost]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
