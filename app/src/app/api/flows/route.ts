import { queryFlowsByBucket, queryPodFlows, recentBuckets } from '@/lib/ddb';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const pod = sp.get('pod'), ns = sp.get('ns');
    const limit = Math.min(Math.max(Number(sp.get('limit')) || 200, 1), 1000);
    const flows = pod && ns
      ? await queryPodFlows(ns, pod, limit)
      : await queryFlowsByBucket(sp.get('bucket') ?? recentBuckets(1)[0],
          sp.get('monitor') ?? undefined);
    return Response.json({ flows });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
