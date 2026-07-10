import { getFlowsWindow } from '@/lib/ddb';
import { costLens } from '@/lib/analytics/cost';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = Number(url.searchParams.get('buckets'));
    const buckets = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 288) : 12;
    const flows = await getFlowsWindow(buckets);
    return Response.json(costLens(flows));
  } catch (e) {
    console.error('[api/analytics/cost]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
