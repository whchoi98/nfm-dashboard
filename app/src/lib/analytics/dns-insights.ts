// DNS deep-dive derivations (Phase 7 Task 4). Pure functions over the
// collector-built DnsAggregate snapshot — no I/O, consumed by DnsTab widgets.
// The aggregate is a point-in-time snapshot (no history), so everything here
// is snapshot-derivable; time trends need collector history (follow-up).
import type { DnsAggregate } from '../types';

export interface InternalExternalSplit {
  internalCount: number; // Σ query counts of internal domains
  externalCount: number; // Σ query counts of external domains
  internalPct: number; // 0..100 (0 when there are no queries)
}

/** Internal vs external query-volume split from topDomains[].internal. */
export function internalExternalSplit(
  topDomains: DnsAggregate['topDomains'] | undefined,
): InternalExternalSplit {
  let internalCount = 0;
  let externalCount = 0;
  for (const d of topDomains ?? []) {
    if (d.internal) internalCount += d.count;
    else externalCount += d.count;
  }
  const total = internalCount + externalCount;
  return {
    internalCount,
    externalCount,
    internalPct: total > 0 ? (internalCount / total) * 100 : 0,
  };
}

export interface NxdomainSource {
  label: string;
  nxdomain: number;
  total: number;
  failRate: number; // 0..1 fraction (collector/src/dns.ts)
}

/** Failure sources ranked by NXDOMAIN count desc; rows without NXDOMAINs dropped. */
export function topNxdomainSources(
  failures: DnsAggregate['failures'] | undefined,
  n = 8,
): NxdomainSource[] {
  return (failures ?? [])
    .filter((f) => f.nxdomain > 0)
    .sort((a, b) => b.nxdomain - a.nxdomain)
    .slice(0, n)
    .map((f) => ({ label: f.label, nxdomain: f.nxdomain, total: f.total, failRate: f.failRate }));
}

export interface RcodeBreakdown {
  nxdomain: number;
  servfail: number;
}

/** Total failing responses by rcode, summed across all failure sources. */
export function rcodeBreakdown(failures: DnsAggregate['failures'] | undefined): RcodeBreakdown {
  let nxdomain = 0;
  let servfail = 0;
  for (const f of failures ?? []) {
    nxdomain += f.nxdomain;
    servfail += f.servfail;
  }
  return { nxdomain, servfail };
}

export interface ResolverRow {
  label: string;
  value: number; // summed query count
}

/**
 * Heaviest querying nodes in the resolution graph. The collector builds the
 * graph as source(client/pod srcId ?? clientIp) → target(domain name) with
 * value = query count, so there is no explicit resolver node: best effort per
 * the plan, we aggregate summed link value per SOURCE node (the querying
 * side), which surfaces the busiest DNS query sources without duplicating
 * the top-domains widget. Out-of-range node indexes are skipped.
 */
export function topResolvers(
  resolution: DnsAggregate['resolution'] | undefined,
  n = 8,
): ResolverRow[] {
  const nodes = resolution?.nodes ?? [];
  const bySource = new Map<number, number>();
  for (const l of resolution?.links ?? []) {
    if (!nodes[l.source]) continue;
    bySource.set(l.source, (bySource.get(l.source) ?? 0) + l.value);
  }
  return [...bySource.entries()]
    .map(([idx, value]) => ({ label: nodes[idx].name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}
