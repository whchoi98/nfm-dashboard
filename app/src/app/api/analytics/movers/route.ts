import { cachedLens, getFlowsWindowPair, GRAIN_SWITCH_BUCKETS, lensCacheKey } from '@/lib/ddb';
import { applyFlowFilters, parseLensParams, priorCoverage } from '@/lib/analytics/filters';
import { moversLens } from '@/lib/analytics/movers';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { buckets, namespace, category } = parseLensParams(req);
    const data = await cachedLens(lensCacheKey('analytics/movers', req.url), async () => {
      // Two adjacent windows of `buckets` each; namespace/category apply to BOTH.
      const { current, prior } = await getFlowsWindowPair(buckets);
      if (buckets > GRAIN_SWITCH_BUCKETS) {
        const expectedPriorHours = Math.round(buckets / 12);
        // A window-over-window lens with a partially-retained prior half
        // reports fake spikes on every entity (2026-07-15 final-review
        // finding): serve the honest empty state until hourly retention
        // covers the prior window.
        if (priorCoverage(prior, expectedPriorHours) < 0.8) {
          return { ...moversLens([], []), insufficientPrior: true as const };
        }
      }
      return moversLens(
        applyFlowFilters(current, { namespace, category }),
        applyFlowFilters(prior, { namespace, category }),
      );
    });
    return Response.json(data);
  } catch (e) {
    console.error('[api/analytics/movers]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
