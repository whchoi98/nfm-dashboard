import { cachedLens, getFlowsWindow, lensCacheKey, windowPlan } from '@/lib/ddb';
import { applyFlowFilters, parseLensParams } from '@/lib/analytics/filters';
import { costExplorerLens, deriveCluster } from '@/lib/analytics/cost-explorer';
import { parseMonitorsEnv } from '@/lib/monitors';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { buckets, namespace, category } = parseLensParams(req);
    const data = await cachedLens(lensCacheKey('cost-explorer', req.url), async () => {
      const flows = applyFlowFilters(await getFlowsWindow(buckets), { namespace, category });
      // MONITORS env ("name=cluster,...") overrides the name-derived cluster;
      // unmapped monitors still fall back to the default deriver.
      const clusters = parseMonitorsEnv(process.env.MONITORS);
      const clusterOf = (monitor: string) => clusters[monitor] ?? deriveCluster(monitor);
      // Each bucket covers 5 minutes — the run-rate scales this window to 30 days.
      return costExplorerLens(flows, { windowSeconds: windowPlan(buckets).windowSeconds, clusterOf });
    });
    return Response.json(data);
  } catch (e) {
    console.error('[api/cost-explorer]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
