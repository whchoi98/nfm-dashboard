import { it, expect } from 'vitest';
import { aggregateDns } from './dns.js';
import type { DnsRecord } from './dns-parse.js';

const recs: DnsRecord[] = [
  { source:'coredns', clientIp:'10.0.1.5', name:'api.shop.svc.cluster.local', qtype:'A', rcode:'NOERROR', durationMs:0.3, answerIps:[] },
  { source:'coredns', clientIp:'10.0.1.5', name:'api.shop.svc.cluster.local', qtype:'A', rcode:'NOERROR', durationMs:0.5, answerIps:[] },
  { source:'coredns', clientIp:'10.0.2.9', name:'nope.internal', qtype:'A', rcode:'NXDOMAIN', durationMs:1.0, answerIps:[] },
  { source:'resolver', clientIp:'10.100.1.20', srcId:'i-abc', name:'ddb.ap-northeast-2.amazonaws.com', qtype:'A', rcode:'NOERROR', answerIps:['52.1.2.3'] },
];

it('enabled=false for empty input', () => {
  expect(aggregateDns([]).enabled).toBe(false);
});
it('topDomains counts + internal flag', () => {
  const a = aggregateDns(recs);
  const top = a.topDomains.find(d => d.name === 'api.shop.svc.cluster.local')!;
  expect(top.count).toBe(2); expect(top.internal).toBe(true);
  expect(a.topDomains.find(d => d.name.includes('amazonaws.com'))!.internal).toBe(false);
});
it('failureRates computes NXDOMAIN fraction', () => {
  const a = aggregateDns(recs);
  const tot = a.failures.reduce((s, f) => s + f.total, 0);
  expect(tot).toBe(4);
  expect(a.failures.some(f => f.nxdomain === 1)).toBe(true);
});
it('queryTypes + latency percentiles present', () => {
  const a = aggregateDns(recs);
  expect(a.queryTypes.find(q => q.type === 'A')!.count).toBe(4);
  expect(a.latency.count).toBe(3);   // only coredns has durationMs
});
it('nameFlow correlates resolver answer IP to a flow remote IP', () => {
  const flows = [{ edgeHash:'e1', a:{ip:'10.100.1.20'}, b:{ip:'52.1.2.3'} }] as any;
  const a = aggregateDns(recs, flows);
  expect(a.nameFlow).toContainEqual({ ip: '52.1.2.3', name: 'ddb.ap-northeast-2.amazonaws.com' });
});
it('nameFlow only counts resolver records', () => {
  const recs = [
    { source:'coredns', name:'svc.local', qtype:'A', rcode:'NOERROR', answerIps:['10.0.0.9'] },
    { source:'resolver', name:'ddb.amazonaws.com', qtype:'A', rcode:'NOERROR', answerIps:['10.0.0.8'] },
  ] as any;
  const flows = [{ edgeHash:'e', a:{ip:'x'}, b:{ip:'10.0.0.9'} }, { edgeHash:'f', a:{ip:'y'}, b:{ip:'10.0.0.8'} }] as any;
  const nf = aggregateDns(recs, flows).nameFlow;
  expect(nf).toEqual([{ ip:'10.0.0.8', name:'ddb.amazonaws.com' }]);
});
it('splits latency + failRate by DNS source (coredns vs resolver)', () => {
  const recs = [
    { source: 'resolver', name: 'a.com', qtype: 'A', rcode: 'NOERROR', durationMs: 10, answerIps: [] },
    { source: 'resolver', name: 'b.com', qtype: 'A', rcode: 'NXDOMAIN', durationMs: 30, answerIps: [] },
    { source: 'coredns', name: 'svc.local', qtype: 'A', rcode: 'NOERROR', durationMs: 2, answerIps: [] },
  ] as import('./dns-parse.js').DnsRecord[];
  const agg = aggregateDns(recs);
  expect(agg.bySource.resolver.count).toBe(2);
  expect(agg.bySource.resolver.failRate).toBeCloseTo(0.5, 5); // 1 NXDOMAIN of 2
  expect(agg.bySource.coredns.count).toBe(1);
  expect(agg.bySource.coredns.failRate).toBe(0);
  expect(agg.bySource.resolver.latencyP95).toBeGreaterThanOrEqual(agg.bySource.resolver.latencyP50);
});
it('bySource.resolver has zero latency samples in production (Route53 Resolver logs carry no durationMs)', () => {
  const recs = [
    { source: 'resolver', name: 'a.com', qtype: 'A', rcode: 'NOERROR', answerIps: [] },
    { source: 'resolver', name: 'b.com', qtype: 'A', rcode: 'NXDOMAIN', answerIps: [] },
    { source: 'coredns', name: 'svc.local', qtype: 'A', rcode: 'NOERROR', durationMs: 2, answerIps: [] },
    { source: 'coredns', name: 'svc2.local', qtype: 'A', rcode: 'NOERROR', durationMs: 4, answerIps: [] },
  ] as import('./dns-parse.js').DnsRecord[];
  const agg = aggregateDns(recs);
  expect(agg.bySource.resolver.latencySampleCount).toBe(0);
  expect(agg.bySource.resolver.latencyP50).toBe(0);
  expect(agg.bySource.resolver.latencyP95).toBe(0);
  expect(agg.bySource.coredns.latencySampleCount).toBeGreaterThan(0);
});
