import { CloudWatchLogsClient, StartQueryCommand, GetQueryResultsCommand,
  StopQueryCommand } from '@aws-sdk/client-cloudwatch-logs';
import { parseCoreDns, parseResolver, type DnsRecord } from './dns-parse.js';
import { aggregateDns, type DnsAggregate } from './dns.js';
import type { FlowEdge } from './types.js';

export interface CollectDnsOpts {
  coreDnsGroups: string[]; resolverGroup: string;
  startTime: number; endTime: number;          // epoch seconds (Logs Insights)
  flows?: FlowEdge[];                          // for nameFlow correlation
  pollDelayMs?: number; maxPolls?: number; recordCap?: number;
}

// Container Insights application logs are JSON with the raw line embedded; `like /IN /`
// matches the coredns query line whether @message is raw or JSON-wrapped.
const CORE_QUERY = 'fields @message | filter @message like /IN / | limit 5000';
const RESOLVER_QUERY = 'fields @message | limit 5000';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runInsights(logs: CloudWatchLogsClient, logGroupName: string, queryString: string,
    o: { startTime: number; endTime: number; pollDelayMs: number; maxPolls: number }): Promise<string[]> {
  const { queryId } = await logs.send(new StartQueryCommand({ logGroupName, queryString,
    startTime: o.startTime, endTime: o.endTime, limit: 5000 }));
  if (!queryId) return [];
  for (let i = 0; i < o.maxPolls; i++) {
    const res = await logs.send(new GetQueryResultsCommand({ queryId }));
    if (res.status === 'Complete')
      return (res.results ?? [])
        .map(row => row.find(f => f.field === '@message')?.value)
        .filter((v): v is string => typeof v === 'string');
    if (res.status === 'Failed' || res.status === 'Cancelled' || res.status === 'Timeout') {
      console.error(JSON.stringify({ level: 'error', msg: 'insights query terminal',
        group: logGroupName, status: res.status }));
      return [];
    }
    if (i < o.maxPolls - 1 && o.pollDelayMs > 0) await sleep(o.pollDelayMs);
  }
  await logs.send(new StopQueryCommand({ queryId })).catch(() => {});
  console.error(JSON.stringify({ level: 'error', msg: 'insights query poll cap reached',
    group: logGroupName }));
  return [];
}

function parseCore(msg: string): DnsRecord | null {
  const direct = parseCoreDns(msg);
  if (direct) return direct;
  // Container Insights wraps stdout lines as {"log": "...", "kubernetes": {...}}
  try { const log = (JSON.parse(msg) as { log?: unknown }).log;
    return typeof log === 'string' ? parseCoreDns(log.trim()) : null; }
  catch { return null; }
}

function parseResolverMsg(msg: string): DnsRecord | null {
  try { return parseResolver(JSON.parse(msg)); } catch { return null; }
}

export async function collectDns(logs: CloudWatchLogsClient, opts: CollectDnsOpts): Promise<DnsAggregate> {
  const o = { startTime: opts.startTime, endTime: opts.endTime,
    pollDelayMs: opts.pollDelayMs ?? 2000, maxPolls: opts.maxPolls ?? 30 };
  const recordCap = opts.recordCap ?? 20000;
  // Resolver group FIRST: records are capped in job order, and the resolver log is the
  // only source of nameFlow — CoreDNS volume must never starve it out of the cap.
  const jobs: { group: string; query: string; parse: (msg: string) => DnsRecord | null }[] = [
    ...(opts.resolverGroup ? [{ group: opts.resolverGroup, query: RESOLVER_QUERY,
      parse: parseResolverMsg }] : []),
    ...opts.coreDnsGroups.map(group => ({ group, query: CORE_QUERY, parse: parseCore }))];
  const perGroup = await Promise.all(jobs.map(async j => ({
    ...j, messages: await runInsights(logs, j.group, j.query, o).catch(e => {
      console.error(JSON.stringify({ level: 'error', msg: 'insights query failed',
        group: j.group, error: (e as Error).name, detail: (e as Error).message }));
      return [] as string[]; }) })));
  const records: DnsRecord[] = [];
  let truncated = false;
  for (const { messages, parse } of perGroup) {
    for (const msg of messages) {
      if (records.length >= recordCap) { truncated = true; break; }
      const rec = parse(msg);
      if (rec) records.push(rec);
    }
    if (truncated) break;
  }
  if (truncated) console.warn(JSON.stringify({ level: 'warn',
    msg: 'dns records truncated', cap: recordCap }));
  console.log(JSON.stringify({ level: 'info', msg: 'dns collected', records: records.length,
    groups: perGroup.map(g => ({ group: g.group, messages: g.messages.length })) }));
  return aggregateDns(records, opts.flows ?? []);
}
