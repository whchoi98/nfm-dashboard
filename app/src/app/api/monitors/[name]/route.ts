import { getNfmMetrics } from '@/lib/cw-metrics';
import { buildMonitorDetail } from '@/lib/monitors';

export const dynamic = 'force-dynamic';

/** The segment usually arrives percent-encoded; NFM names are URL-safe, so a
 *  failed decode (stray '%') just falls back to the raw segment. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** GET /api/monitors/[name] → MonitorDetail (404 when the name has no metrics). */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await params;
    const metrics = await getNfmMetrics();
    const detail = buildMonitorDetail(metrics, safeDecode(name));
    if (!detail) return Response.json({ error: 'monitor not found' }, { status: 404 });
    return Response.json(detail);
  } catch (e) {
    console.error('[api/monitors/[name]]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
