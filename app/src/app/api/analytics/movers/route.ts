import { cachedLens, getFlowsWindowPair, lensCacheKey } from '@/lib/ddb';
import { applyFlowFilters, parseLensParams } from '@/lib/analytics/filters';
import { moversLens } from '@/lib/analytics/movers';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { buckets, namespace, category } = parseLensParams(req);
    const data = await cachedLens(lensCacheKey('analytics/movers', req.url), async () => {
      // Two adjacent windows of `buckets` each; namespace/category apply to BOTH.
      const { current, prior } = await getFlowsWindowPair(buckets);
      return moversLens(
        applyFlowFilters(current, { namespace, category }),
        applyFlowFilters(prior, { namespace, category }),
      );
    });
    return Response.json(data);
  } catch (e) {
    console.error('[api/analytics/movers]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
