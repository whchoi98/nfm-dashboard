import { getCoverage, getCollectionStatus } from '@/lib/ddb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [coverage, status] = await Promise.all([getCoverage(), getCollectionStatus()]);
    return Response.json({ coverage, status });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
