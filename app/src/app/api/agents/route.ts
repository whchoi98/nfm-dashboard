import { getCoverage, getCollectionStatus } from '@/lib/ddb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [coverage, status] = await Promise.all([getCoverage(), getCollectionStatus()]);
    return Response.json({ coverage, status });
  } catch (e) {
    console.error('[api/agents]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
