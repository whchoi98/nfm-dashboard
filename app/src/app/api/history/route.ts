import { HistoryValidationError, runHistoryQuery } from '@/lib/athena';

export const dynamic = 'force-dynamic';

// Empty / whitespace-only query params (e.g. a UI clearing a filter field sends
// `?monitor=`) are treated as absent, not as an invalid filter value.
function clean(v: string | null): string | undefined {
  const s = v?.trim();
  return s ? s : undefined;
}

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const limit = clean(sp.get('limit'));
    const result = await runHistoryQuery({
      from: clean(sp.get('from')) ?? sevenDaysAgo,
      to: clean(sp.get('to')) ?? today,
      monitor: clean(sp.get('monitor')),
      namespace: clean(sp.get('namespace')),
      metric: clean(sp.get('metric')),
      limit: limit !== undefined ? Number(limit) : undefined,
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof HistoryValidationError) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    console.error('[api/history]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
