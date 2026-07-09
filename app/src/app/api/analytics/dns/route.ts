import { getDns } from '@/lib/ddb';
import type { DnsAggregate } from '@/lib/types';

export const dynamic = 'force-dynamic';

const EMPTY: DnsAggregate = { enabled: false, topDomains: [], failures: [],
  latency: { p50: 0, p90: 0, p95: 0, max: 0, count: 0 }, queryTypes: [],
  resolution: { nodes: [], links: [] }, nameFlow: [] };

export async function GET() {
  try {
    const dns = await getDns();
    return Response.json(dns ?? EMPTY);
  } catch (e) {
    console.error('[api/analytics/dns]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
