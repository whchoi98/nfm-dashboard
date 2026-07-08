import { queryEdgeSeries } from '@/lib/ddb';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const edge = new URL(req.url).searchParams.get('edge');
    if (!edge) return Response.json({ error: 'edge query parameter is required' }, { status: 400 });
    const series = await queryEdgeSeries(edge, 288); // ~24h of 5-min items, newest first
    return Response.json({ series, latest: series[0] ?? null });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
