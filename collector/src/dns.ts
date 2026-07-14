import type { DnsRecord } from './dns-parse.js';
import type { FlowEdge } from './types.js';
export interface DnsSourceStat { latencyP50: number; latencyP95: number; latencySampleCount: number; failRate: number; count: number }
export interface DnsAggregate { enabled: boolean;
  topDomains: { name: string; count: number; internal: boolean }[];
  failures: { key: string; label: string; nxdomain: number; servfail: number; total: number; failRate: number }[];
  latency: { p50: number; p90: number; p95: number; max: number; count: number };
  queryTypes: { type: string; count: number }[];
  resolution: { nodes: { name: string }[]; links: { source: number; target: number; value: number }[] };
  nameFlow: { ip: string; name: string }[];
  bySource: { coredns: DnsSourceStat; resolver: DnsSourceStat }; }

const emptySourceStat = (): DnsSourceStat => ({ latencyP50: 0, latencyP95: 0, latencySampleCount: 0, failRate: 0, count: 0 });

const internalName = (n: string) => n.endsWith('.cluster.local') || n.endsWith('.internal');
const nsOf = (n: string) => { const m = /^[^.]+\.([^.]+)\.svc\.cluster\.local$/.exec(n); return m ? m[1] : null; };
function pct(sorted: number[], p: number) { if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]; }

export function aggregateDns(records: DnsRecord[], flows: FlowEdge[] = []): DnsAggregate {
  if (!records.length) return { enabled: false, topDomains: [], failures: [], queryTypes: [],
    latency: { p50: 0, p90: 0, p95: 0, max: 0, count: 0 }, resolution: { nodes: [], links: [] }, nameFlow: [],
    bySource: { coredns: emptySourceStat(), resolver: emptySourceStat() } };
  const byName = new Map<string, number>(), byType = new Map<string, number>();
  const fail = new Map<string, { nxdomain: number; servfail: number; total: number }>();
  const durs: number[] = []; const resNodes = new Map<string, number>(); const links = new Map<string, number>();
  const bySrc: Record<'coredns' | 'resolver', { durs: number[]; total: number; failed: number }> = {
    coredns: { durs: [], total: 0, failed: 0 }, resolver: { durs: [], total: 0, failed: 0 },
  };
  for (const r of records) {
    byName.set(r.name, (byName.get(r.name) ?? 0) + 1);
    byType.set(r.qtype, (byType.get(r.qtype) ?? 0) + 1);
    const key = nsOf(r.name) ?? r.clientIp ?? 'unknown';
    const f = fail.get(key) ?? { nxdomain: 0, servfail: 0, total: 0 };
    f.total++; if (r.rcode === 'NXDOMAIN') f.nxdomain++; if (r.rcode === 'SERVFAIL') f.servfail++;
    fail.set(key, f);
    if (typeof r.durationMs === 'number') durs.push(r.durationMs);
    const s = bySrc[r.source]; s.total++;
    if (r.rcode === 'NXDOMAIN' || r.rcode === 'SERVFAIL') s.failed++;
    if (typeof r.durationMs === 'number') s.durs.push(r.durationMs);
    const src = r.srcId ?? r.clientIp ?? 'unknown';
    for (const id of [src, r.name]) if (!resNodes.has(id)) resNodes.set(id, resNodes.size);
    const lk = `${resNodes.get(src)}>${resNodes.get(r.name)}`;
    links.set(lk, (links.get(lk) ?? 0) + 1);
  }
  durs.sort((a, b) => a - b);
  const stat = (b: { durs: number[]; total: number; failed: number }): DnsSourceStat => {
    const d = [...b.durs].sort((x, y) => x - y);
    return { latencyP50: pct(d, 50), latencyP95: pct(d, 95), latencySampleCount: d.length,
      failRate: b.total ? b.failed / b.total : 0, count: b.total };
  };
  const flowIps = new Set(flows.flatMap(fl => [fl.a?.ip, fl.b?.ip].filter(Boolean) as string[]));
  const nameFlowSet = new Map<string, string>();
  for (const r of records) if (r.source === 'resolver') for (const ip of r.answerIps) if (flowIps.has(ip)) nameFlowSet.set(ip, r.name);
  return { enabled: true,
    topDomains: [...byName].map(([name, count]) => ({ name, count, internal: internalName(name) }))
      .sort((a, b) => b.count - a.count).slice(0, 50),
    failures: [...fail].map(([key, f]) => ({ key, label: key, ...f, failRate: (f.nxdomain + f.servfail) / f.total }))
      .sort((a, b) => b.failRate - a.failRate),
    latency: { p50: pct(durs, 50), p90: pct(durs, 90), p95: pct(durs, 95), max: durs.at(-1) ?? 0, count: durs.length },
    queryTypes: [...byType].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    resolution: { nodes: [...resNodes.keys()].map(name => ({ name })),
      links: [...links].map(([k, value]) => { const [s, t] = k.split('>').map(Number); return { source: s, target: t, value }; }) },
    nameFlow: [...nameFlowSet].map(([ip, name]) => ({ ip, name })),
    bySource: { coredns: stat(bySrc.coredns), resolver: stat(bySrc.resolver) } };
}
