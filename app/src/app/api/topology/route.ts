import { getTopology } from '@/lib/ddb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const topology = await getTopology();
    return Response.json(topology ?? { generatedAt: '', nodes: [], edges: [] });
  } catch (e) {
    console.error('[api/topology]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
