import { getFlowsWindow } from '@/lib/ddb';
import { reliabilityLens, type ReliabilityCw } from '@/lib/analytics/reliability';
import { getNfmMetrics, type NfmSeries } from '@/lib/cw-metrics';
import type { Series } from '@/lib/analytics/aggregate';

export const dynamic = 'force-dynamic';

/**
 * CW HealthIndicator series (keys "HealthIndicator:<monitor>") → ReliabilityCw:
 * per-monitor Series plus an overall worst-case aggregate — per timestamp the MAX
 * across monitors (HealthIndicator is 0=healthy / >0=degraded, so the fleet is
 * unhealthy at t if ANY monitor is). Zero HealthIndicator series → no aggregate.
 */
function buildReliabilityCw(cwSeries: Record<string, NfmSeries>): ReliabilityCw {
  const byMonitor: Record<string, Series> = {};
  for (const [key, s] of Object.entries(cwSeries)) {
    if (!key.startsWith('HealthIndicator:')) continue;
    const monitor = s.monitor || key.slice('HealthIndicator:'.length);
    byMonitor[monitor] = { label: monitor,
      points: s.timestamps.map((t, i) => ({ t, v: s.values[i] ?? 0 })) };
  }
  const lanes = Object.values(byMonitor);
  if (lanes.length === 0) return { byMonitor: {} };
  const worstByT = new Map<string, number>(); // union of timestamps across monitors
  for (const lane of lanes) {
    for (const p of lane.points) {
      const cur = worstByT.get(p.t);
      worstByT.set(p.t, cur === undefined ? p.v : Math.max(cur, p.v));
    }
  }
  const points = [...worstByT.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([t, v]) => ({ t, v }));
  return { healthIndicator: { label: 'nhi', points }, byMonitor };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = Number(url.searchParams.get('buckets'));
    const buckets = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 288) : 12;
    const flows = await getFlowsWindow(buckets);
    let cw: ReliabilityCw | undefined;
    try {
      cw = buildReliabilityCw(await getNfmMetrics());
    } catch (e) {
      // CW being down must not 500 the whole lens — fall back to flows-only (empty nhi).
      console.error('[api/analytics/reliability] CloudWatch fetch failed; nhi omitted', e);
    }
    return Response.json(reliabilityLens(flows, cw));
  } catch (e) {
    console.error('[api/analytics/reliability]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
