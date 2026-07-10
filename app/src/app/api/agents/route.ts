import { getCoverage, getCollectionStatus, getCollectionHistory } from '@/lib/ddb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [coverage, status, history] = await Promise.all([
      getCoverage(), getCollectionStatus(), getCollectionHistory(),
    ]);
    return Response.json({ coverage, status, history });
  } catch (e) {
    console.error('[api/agents]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
