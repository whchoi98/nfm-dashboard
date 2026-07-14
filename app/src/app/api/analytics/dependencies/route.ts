import { cachedLens, getFlowsWindow, lensCacheKey } from '@/lib/ddb';
import { applyFlowFilters, parseLensParams } from '@/lib/analytics/filters';
import { dependenciesLens } from '@/lib/analytics/dependencies';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { buckets, namespace, category } = parseLensParams(req);
    const data = await cachedLens(lensCacheKey('analytics/dependencies', req.url), async () => {
      const flows = applyFlowFilters(await getFlowsWindow(buckets), { namespace, category });
      return dependenciesLens(flows);
    });
    return Response.json(data);
  } catch (e) {
    console.error('[api/analytics/dependencies]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
