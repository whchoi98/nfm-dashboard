// Internet-egress cost broken down by destination domain (Datadog "group by
// domain", with our $ estimate). Pure. Joins INTERNET DATA_TRANSFERRED flows to
// DNS answer→domain mappings (DnsAggregate.nameFlow) by the external IP.
import type { FlowEdge } from '../types';
import { egressBytesToUsd } from './cost';

export interface EgressDomainRow {
  domain: string;
  bytes: number;
  usd: number;
}

/** External endpoint IP of an INTERNET flow: prefer b.ip, fall back to a.ip. */
function externalIp(f: FlowEdge): string | undefined {
  return f.b?.ip ?? f.a?.ip;
}

export function egressByDomain(
  flows: FlowEdge[],
  nameFlow: { ip: string; name: string }[],
): EgressDomainRow[] {
  const ipToDomain = new Map(nameFlow.map((n) => [n.ip, n.name]));
  const acc = new Map<string, { bytes: number }>();
  for (const f of flows) {
    if (f.metric !== 'DATA_TRANSFERRED' || f.category !== 'INTERNET') continue;
    const ip = externalIp(f);
    const domain = (ip && ipToDomain.get(ip)) || 'unresolved';
    acc.set(domain, { bytes: (acc.get(domain)?.bytes ?? 0) + f.value });
  }
  return [...acc.entries()]
    .map(([domain, { bytes }]) => ({ domain, bytes, usd: egressBytesToUsd(bytes) }))
    .sort((x, y) => y.usd - x.usd || y.bytes - x.bytes || x.domain.localeCompare(y.domain));
}
