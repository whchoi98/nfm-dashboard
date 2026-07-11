import { getFlowsWindow, recentBuckets } from '@/lib/ddb';
import { applyFlowFilters, parseLensParams } from '@/lib/analytics/filters';
import {
  networkAnalyticsLens, NET_METRICS, SCOPES, type NetMetric, type Scope,
} from '@/lib/analytics/network-analytics';

export const dynamic = 'force-dynamic';

/** Invalid/missing scope or metric params fall back to defaults (never 400). */
function parseScope(raw: string | null): Scope {
  return SCOPES.includes(raw as Scope) ? (raw as Scope) : 'service';
}
function parseMetric(raw: string | null): NetMetric {
  return NET_METRICS.includes(raw as NetMetric) ? (raw as NetMetric) : 'volume';
}

export async function GET(req: Request) {
  try {
    const { buckets, namespace, category } = parseLensParams(req);
    const url = new URL(req.url);
    const sourceScope = parseScope(url.searchParams.get('src'));
    const destScope = parseScope(url.searchParams.get('dst'));
    const metric = parseMetric(url.searchParams.get('metric'));
    const flows = applyFlowFilters(await getFlowsWindow(buckets), { namespace, category });
    return Response.json(networkAnalyticsLens(flows, {
      sourceScope,
      destScope,
      metric,
      windowSeconds: buckets * 300,
      buckets: recentBuckets(buckets),
    }));
  } catch (e) {
    console.error('[api/network]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
