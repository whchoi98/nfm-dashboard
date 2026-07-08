export interface DnsRecord { source: 'coredns'|'resolver'; ts?: string; clientIp?: string;
  srcId?: string; name: string; qtype: string; rcode: string; durationMs?: number; answerIps: string[]; }

const CORE_RE = /^\[[A-Z]+\]\s+([0-9.]+):\d+\s+-\s+\d+\s+"(\S+)\s+\S+\s+(\S+?)\.?\s+\S+\s+\d+\s+\S+\s+\d+"\s+(\S+)\s+\S+\s+\d+\s+([\d.]+)s/;

export function parseCoreDns(line: string): DnsRecord | null {
  const m = CORE_RE.exec(line);
  if (!m) return null;
  const [, clientIp, qtype, name, rcode, dur] = m;
  return { source: 'coredns', clientIp, name: name.replace(/\.$/, ''), qtype, rcode,
    durationMs: Number(dur) * 1000, answerIps: [] };
}

export function parseResolver(rec: unknown): DnsRecord | null {
  const r = rec as Record<string, any>;
  if (!r || typeof r.query_name !== 'string') return null;
  return { source: 'resolver', ts: r.query_timestamp, clientIp: r.srcaddr,
    srcId: r.srcids?.instance ?? r.srcids?.[0]?.instance,
    name: String(r.query_name).replace(/\.$/, ''), qtype: r.query_type ?? '?',
    rcode: r.rcode ?? '?', answerIps: Array.isArray(r.answers) ? r.answers.map((a: any) => a.Rdata).filter(Boolean) : [] };
}
