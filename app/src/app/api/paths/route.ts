import { queryEdgeSeries } from '@/lib/ddb';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const edge = new URL(req.url).searchParams.get('edge');
    if (!edge) return Response.json({ error: 'edge query parameter is required' }, { status: 400 });
    const series = await queryEdgeSeries(edge, 288); // 288 bucket#metric items ≈ ~6h of 5-min buckets, newest first
    return Response.json({ series, latest: series[0] ?? null });
  } catch (e) {
    console.error('[api/paths]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
