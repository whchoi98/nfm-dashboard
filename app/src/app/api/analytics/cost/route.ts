import { getFlowsWindow } from '@/lib/ddb';
import { costLens } from '@/lib/analytics/cost';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const flows = await getFlowsWindow(12);
    return Response.json(costLens(flows));
  } catch (e) {
    console.error('[api/analytics/cost]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
