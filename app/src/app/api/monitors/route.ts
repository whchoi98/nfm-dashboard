import { getNfmMetrics } from '@/lib/cw-metrics';
import { buildMonitorList, parseMonitorsEnv } from '@/lib/monitors';

export const dynamic = 'force-dynamic';

/** GET /api/monitors → { monitors: MonitorListItem[] } sorted by traffic desc. */
export async function GET() {
  try {
    const metrics = await getNfmMetrics();
    const monitors = buildMonitorList(metrics, parseMonitorsEnv(process.env.MONITORS));
    return Response.json({ monitors });
  } catch (e) {
    console.error('[api/monitors]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
