import { cachedLens, getFlowsWindowPair, GRAIN_SWITCH_BUCKETS, lensCacheKey } from '@/lib/ddb';
import { applyFlowFilters, parseLensParams, priorCoverage } from '@/lib/analytics/filters';
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
    const body = await cachedLens(lensCacheKey('anomalies', req.url), async () => {
      // Two adjacent windows of `buckets` each; namespace/category apply to BOTH.
      const { current, prior } = await getFlowsWindowPair(buckets);
      if (buckets > GRAIN_SWITCH_BUCKETS) {
        const expectedPriorHours = Math.round(buckets / 12);
        // A window-over-window lens with a partially-retained prior half
        // reports fake spikes on every entity (2026-07-15 final-review
        // finding): serve the honest empty state until hourly retention
        // covers the prior window.
        if (priorCoverage(prior, expectedPriorHours) < 0.8) {
          return { anomalies: [], insufficientPrior: true as const };
        }
      }
      return { anomalies: detectAnomalies(
        applyFlowFilters(current, { namespace, category }),
        applyFlowFilters(prior, { namespace, category }),
        opts,
      ) };
    });
    return Response.json(body);
  } catch (e) {
    console.error('[api/anomalies]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
