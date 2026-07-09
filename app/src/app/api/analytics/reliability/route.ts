import { getFlowsWindow } from '@/lib/ddb';
import { reliabilityLens } from '@/lib/analytics/reliability';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const flows = await getFlowsWindow(12);
    return Response.json(reliabilityLens(flows));
  } catch (e) {
    console.error('[api/analytics/reliability]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
