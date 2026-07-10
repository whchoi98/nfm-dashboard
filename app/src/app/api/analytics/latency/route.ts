import { getFlowsWindow } from '@/lib/ddb';
import { applyFlowFilters, parseLensParams } from '@/lib/analytics/filters';
import { latencyLens } from '@/lib/analytics/latency';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { buckets, namespace, category } = parseLensParams(req);
    const flows = applyFlowFilters(await getFlowsWindow(buckets), { namespace, category });
    return Response.json(latencyLens(flows));
  } catch (e) {
    console.error('[api/analytics/latency]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
