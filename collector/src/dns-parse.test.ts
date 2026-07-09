import { it, expect } from 'vitest';
import { parseCoreDns, parseResolver } from './dns-parse.js';

it('parses a coredns log line', () => {
  const r = parseCoreDns('[INFO] 10.0.1.5:34953 - 42 "A IN api.shop.svc.cluster.local. udp 63 false 512" NOERROR qr,aa,rd 106 0.000342s');
  expect(r).toMatchObject({ source: 'coredns', clientIp: '10.0.1.5', name: 'api.shop.svc.cluster.local',
    qtype: 'A', rcode: 'NOERROR' });
  expect(r!.durationMs).toBeCloseTo(0.342, 2);
});
it('parses NXDOMAIN coredns line', () => {
  expect(parseCoreDns('[INFO] 10.0.2.9:5 - 1 "A IN nope.internal. udp 40 false 512" NXDOMAIN qr,rd 40 0.001s')!.rcode)
    .toBe('NXDOMAIN');
});
it('returns null for non-query coredns noise', () => {
  expect(parseCoreDns('[INFO] plugin/reload: Running configuration MD5 = abc')).toBeNull();
});
it('parses a resolver JSON record with answers', () => {
  const r = parseResolver({ query_name: 'ddb.ap-northeast-2.amazonaws.com.', query_type: 'A',
    rcode: 'NOERROR', srcaddr: '10.100.1.20', srcids: { instance: 'i-abc' },
    answers: [{ Rdata: '52.1.2.3' }, { Rdata: '52.1.2.4' }], query_timestamp: '2026-07-08T12:00:00Z' });
  expect(r).toMatchObject({ source: 'resolver', clientIp: '10.100.1.20', srcId: 'i-abc',
    name: 'ddb.ap-northeast-2.amazonaws.com', qtype: 'A', rcode: 'NOERROR' });
  expect(r!.answerIps).toEqual(['52.1.2.3', '52.1.2.4']);
});
