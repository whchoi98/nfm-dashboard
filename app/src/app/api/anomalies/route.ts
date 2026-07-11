import { getFlowsWindowPair } from '@/lib/ddb';
import { applyFlowFilters, parseLensParams } from '@/lib/analytics/filters';
import { DEFAULT_SIGMA, detectAnomalies } from '@/lib/analytics/anomalies';
import { DEFAULT_RETRANS_RATE, DEFAULT_TIMEOUT_RATE } from '@/lib/analytics/reliability';

export const dynamic = 'force-dynamic';

/** Positive-finite query number; anything else falls back to the lens default. */
function numParam(url: URL, name: string, fallback: number): number {
  const raw = Number(url.searchParams.get(name));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export async function GET(req: Request) {
  try {
    const { buckets, namespace, category } = parseLensParams(req);
    // Thresholds/σ come from the Settings page via query params; the
    // reliability lens defaults (10/5) + σ=3 apply when absent/invalid.
    const url = new URL(req.url);
    const opts = {
      retransThreshold: numParam(url, 'retrans', DEFAULT_RETRANS_RATE),
      timeoutThreshold: numParam(url, 'timeout', DEFAULT_TIMEOUT_RATE),
      sigma: numParam(url, 'sigma', DEFAULT_SIGMA),
    };
    // Two adjacent windows of `buckets` each; namespace/category apply to BOTH.
    const { current, prior } = await getFlowsWindowPair(buckets);
    return Response.json({
      anomalies: detectAnomalies(
        applyFlowFilters(current, { namespace, category }),
        applyFlowFilters(prior, { namespace, category }),
        opts,
      ),
    });
  } catch (e) {
    console.error('[api/anomalies]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
