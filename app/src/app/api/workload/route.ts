import { getWorkloadInsights } from '@/lib/ddb';

export const dynamic = 'force-dynamic';

/** Latest Workload Insights top-contributors snapshot (WI#latest/all). */
export async function GET() {
  try {
    const wi = await getWorkloadInsights();
    return Response.json({ rows: wi?.rows ?? [], cycleTs: wi?.cycleTs });
  } catch (e) {
    console.error('[api/workload]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
