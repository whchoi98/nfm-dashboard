import { getTopology } from '@/lib/ddb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const topology = await getTopology();
    return Response.json(topology ?? { generatedAt: '', nodes: [], edges: [] });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
