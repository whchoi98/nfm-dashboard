import { getFlowsWindow } from '@/lib/ddb';
import { dependenciesLens } from '@/lib/analytics/dependencies';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const flows = await getFlowsWindow(12);
    return Response.json(dependenciesLens(flows));
  } catch (e) {
    console.error('[api/analytics/dependencies]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
