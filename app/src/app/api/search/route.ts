import { getDns, getFlowsWindow, getTopology } from '@/lib/ddb';
import { MIN_QUERY_LENGTH, searchEntities } from '@/lib/search';

export const dynamic = 'force-dynamic';

/**
 * GET /api/search?q= → { results }: unified entity search across the topology
 * snapshot, the recent flows window, and the DNS aggregate (each may be
 * null/empty — searchEntities tolerates missing sources). Queries shorter
 * than 2 chars short-circuit to { results: [] } without touching DynamoDB.
 */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams.get('q') ?? '';
    if (q.trim().length < MIN_QUERY_LENGTH) return Response.json({ results: [] });

    const [topology, flows, dns] = await Promise.all([getTopology(), getFlowsWindow(), getDns()]);
    return Response.json({ results: searchEntities(q, { topology, flows, dns }) });
  } catch (e) {
    console.error('[api/search]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
