import { getFlowsWindowPair } from '@/lib/ddb';
import { applyFlowFilters, parseLensParams } from '@/lib/analytics/filters';
import { moversLens } from '@/lib/analytics/movers';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { buckets, namespace, category } = parseLensParams(req);
    // Two adjacent windows of `buckets` each; namespace/category apply to BOTH.
    const { current, prior } = await getFlowsWindowPair(buckets);
    return Response.json(
      moversLens(
        applyFlowFilters(current, { namespace, category }),
        applyFlowFilters(prior, { namespace, category }),
      ),
    );
  } catch (e) {
    console.error('[api/analytics/movers]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
