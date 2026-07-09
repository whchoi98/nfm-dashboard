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
