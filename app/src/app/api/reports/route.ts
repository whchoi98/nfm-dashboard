// /api/reports — ReportData for the /reports export page: overview KPIs
// (CloudWatch NFM metrics), top cost talkers + window cost, reliability breach
// count, and default-threshold anomalies, all from ONE shared flows window
// pair. The client renders it via buildReportMarkdown / toCsv.
import { getFlowsWindowPair } from '@/lib/ddb';
import { getNfmMetrics, type NfmSeries } from '@/lib/cw-metrics';
import { buildOverviewKpis } from '@/lib/overview-metrics';
import { AZ_TRANSFER_USD_PER_GB, BILLED_CATEGORIES, costLens } from '@/lib/analytics/cost';
import { MONTH_SECONDS } from '@/lib/analytics/cost-explorer';
import {
  DEFAULT_RETRANS_RATE,
  DEFAULT_TIMEOUT_RATE,
  reliabilityLens,
} from '@/lib/analytics/reliability';
import { DEFAULT_SIGMA, detectAnomalies } from '@/lib/analytics/anomalies';
import type { ReportData } from '@/lib/report';

export const dynamic = 'force-dynamic';

const MAX_TALKERS = 10;
const MAX_ANOMALIES = 20;

export async function GET() {
  try {
    const [series, { current, prior }] = await Promise.all([
      getNfmMetrics(60).catch(() => ({}) as Record<string, NfmSeries>),
      getFlowsWindowPair(12), // current window feeds cost + reliability lenses
    ]);
    const { kpis, rttP50, rttP95, nhi } = buildOverviewKpis(series);
    const cost = costLens(current);
    const anomalies = detectAnomalies(current, prior, {
      retransThreshold: DEFAULT_RETRANS_RATE,
      timeoutThreshold: DEFAULT_TIMEOUT_RATE,
      sigma: DEFAULT_SIGMA,
    });
    const windowSeconds = 12 * 300; // getFlowsWindowPair(12) window
    const billedCategories = [...BILLED_CATEGORIES];
    const byCategory = billedCategories
      .map((category) => ({ category, ...cost.byCategory[category] }))
      .filter((c) => c.usd > 0 || c.bytes > 0)
      .sort((a, b) => b.usd - a.usd || b.bytes - a.bytes);
    const data: ReportData = {
      kpis: {
        dataTransferred: kpis.dataTransferred.value,
        retransmissions: kpis.retransmissions.value,
        timeouts: kpis.timeouts.value,
        rtt: kpis.rtt.value,
        rttP50,
        rttP95,
        nhi,
      },
      topTalkers: cost.top
        .slice(0, MAX_TALKERS)
        .map(({ label, bytes, usd }) => ({ label, bytes, usd })),
      breachCount: reliabilityLens(current).breaches.length,
      anomalies: anomalies
        .slice(0, MAX_ANOMALIES)
        .map(({ label, kind, severity, detail }) => ({ label, kind, severity, detail })),
      cost: {
        totalUsd: cost.totalUsd,
        monthlyRunRate: cost.totalUsd * (MONTH_SECONDS / windowSeconds),
        windowSeconds,
        ratePerGbPerDirection: AZ_TRANSFER_USD_PER_GB,
        billedCategories,
        byCategory,
      },
    };
    return Response.json(data);
  } catch (e) {
    console.error('[api/reports]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
