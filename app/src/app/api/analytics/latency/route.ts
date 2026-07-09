import { getFlowsWindow } from '@/lib/ddb';
import { latencyLens } from '@/lib/analytics/latency';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const flows = await getFlowsWindow(12);
    return Response.json(latencyLens(flows));
  } catch (e) {
    console.error('[api/analytics/latency]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
