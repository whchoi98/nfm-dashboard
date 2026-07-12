import { runHistoryQuery } from '@/lib/athena';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const result = await runHistoryQuery({
      from: sp.get('from') ?? sevenDaysAgo,
      to: sp.get('to') ?? today,
      monitor: sp.get('monitor') ?? undefined,
      namespace: sp.get('namespace') ?? undefined,
      metric: sp.get('metric') ?? undefined,
      limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
    });
    return Response.json(result);
  } catch (e) {
    console.error('[api/history]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
