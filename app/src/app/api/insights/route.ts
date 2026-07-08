import { getWorkloadInsights, getTopology } from '@/lib/ddb';
import type { DestCategory, WiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

type CategoryTotals = { dataTransferred: number; retransmissions: number; timeouts: number };
const emptyByCategory = (): Record<DestCategory, CategoryTotals> => ({
  INTRA_AZ: { dataTransferred: 0, retransmissions: 0, timeouts: 0 },
  INTER_AZ: { dataTransferred: 0, retransmissions: 0, timeouts: 0 },
  INTER_VPC: { dataTransferred: 0, retransmissions: 0, timeouts: 0 },
});
const METRIC_KEY: Record<string, keyof CategoryTotals> = {
  DATA_TRANSFERRED: 'dataTransferred', RETRANSMISSIONS: 'retransmissions', TIMEOUTS: 'timeouts',
};

export async function GET() {
  try {
    const wi = await getWorkloadInsights();
    const byCategory = emptyByCategory();
    if (wi && wi.rows.length > 0) {
      for (const r of wi.rows as WiResult[]) {
        const cat = byCategory[r.category as DestCategory];
        const key = METRIC_KEY[r.metric];
        if (!cat || !key) continue;
        cat[key] += r.rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
      }
      return Response.json({ byCategory, rows: wi.rows });
    }
    // Fallback: aggregate the latest topology snapshot when WI#latest is absent
    const topology = await getTopology();
    for (const e of topology?.edges ?? []) {
      const cat = byCategory[e.category];
      if (!cat) continue;
      cat.dataTransferred += e.metrics.DATA_TRANSFERRED ?? 0;
      cat.retransmissions += e.metrics.RETRANSMISSIONS ?? 0;
      cat.timeouts += e.metrics.TIMEOUTS ?? 0;
    }
    return Response.json({ byCategory, rows: [] });
  } catch (e) {
    console.error('[api/insights]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
