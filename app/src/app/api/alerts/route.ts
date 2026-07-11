import { getAlarms } from '@/lib/cw-alarms';
import { getNfmMetrics } from '@/lib/cw-metrics';
import { getCollectionHistory, getFlowsWindow, getFlowsWindowPair } from '@/lib/ddb';
import { reliabilityLens } from '@/lib/analytics/reliability';
import { moversLens } from '@/lib/analytics/movers';
import { deriveEvents } from '@/lib/alerts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/alerts → { alarms, events }: live CloudWatch alarm states plus the
 * derived event feed (NHI degradation, reliability breaches, collection gaps,
 * retrans/timeout spikes). CloudWatch failures degrade to empty sections —
 * getAlarms() returns [] internally and metrics fall back to {} — only the
 * DDB-backed signals failing produces a 500.
 */
export async function GET() {
  try {
    const [alarms, cwSeries, flows, pair, history] = await Promise.all([
      getAlarms(),
      getNfmMetrics().catch((e) => {
        console.error('[api/alerts] CloudWatch metrics failed; nhi events omitted', e);
        return {} as Awaited<ReturnType<typeof getNfmMetrics>>;
      }),
      getFlowsWindow(),
      getFlowsWindowPair(6),
      getCollectionHistory(),
    ]);

    // Degraded ⇔ the monitor's latest HealthIndicator sample > 0 (cw-metrics contract).
    const nhiByMonitor = Object.values(cwSeries)
      .filter((s) => s.metric === 'HealthIndicator')
      .map((s) => ({ monitor: s.monitor, degraded: (s.values[s.values.length - 1] ?? 0) > 0 }));

    const movers = moversLens(pair.current, pair.prior);
    const events = deriveEvents({
      nhiByMonitor,
      breaches: reliabilityLens(flows).breaches,
      collectionHistory: history.map((h) => ({
        cycleTs: h.cycleTs,
        failed: h.stats.failed,
        started: h.stats.started,
        throttled: h.stats.throttled,
      })),
      movers: [...movers.retransmissions, ...movers.timeouts],
    });

    return Response.json({ alarms, events });
  } catch (e) {
    console.error('[api/alerts]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
