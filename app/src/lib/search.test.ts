import { describe, it, expect } from 'vitest';
import { searchEntities, type SearchResult } from './search';
import type { DnsAggregate, FlowEdge, TopologySnapshot } from './types';

/** Minimal FlowEdge factory — only endpoint fields matter to the search fn. */
function edge(a: FlowEdge['a'], b: FlowEdge['b'] = {}): FlowEdge {
  return {
    edgeHash: 'h',
    monitor: 'm',
    metric: 'DATA_TRANSFERRED',
    category: 'INTRA_AZ',
    bucket: '2026-07-11T00:00:00Z',
    value: 1,
    unit: 'Bytes',
    a,
    b,
    traversedConstructs: [],
  };
}

const TOPO: TopologySnapshot = {
  generatedAt: '2026-07-11T00:00:00Z',
  nodes: [
    { id: 'pod:default/api-server-1', kind: 'pod', label: 'api-server-1', namespace: 'default', cluster: 'eks-main' },
    { id: 'node:ip-10-0-1-5', kind: 'node', label: 'ip-10-0-1-5', cluster: 'eks-main' },
    { id: 'vpc:vpc-abc', kind: 'vpc', label: 'vpc-abc' },
  ],
  edges: [],
};

const FLOWS: FlowEdge[] = [
  edge(
    { podName: 'api-server-1', podNamespace: 'default', ip: '10.0.1.10', subnetId: 'subnet-aaa111' },
    { serviceName: 'checkout-svc', ip: '10.0.2.20' },
  ),
  edge({ podName: 'api-server-1', podNamespace: 'default' }), // duplicate pod endpoint
];

const DNS: DnsAggregate = {
  enabled: true,
  topDomains: [{ name: 'api.example.com', count: 10, internal: false }],
  failures: [],
  latency: { p50: 1, p90: 2, p95: 3, max: 4, count: 5 },
  queryTypes: [],
  resolution: { nodes: [], links: [] },
  nameFlow: [
    { ip: '10.0.2.20', name: 'checkout.internal.example.com' },
    { ip: '10.0.9.9', name: 'api.example.com' }, // duplicate domain name
  ],
};

const ALL = { topology: TOPO, flows: FLOWS, dns: DNS };

function ofType(results: SearchResult[], type: SearchResult['type']): SearchResult[] {
  return results.filter((r) => r.type === type);
}

describe('searchEntities', () => {
  it('returns [] for queries shorter than 2 chars (incl. whitespace-only)', () => {
    expect(searchEntities('', ALL)).toEqual([]);
    expect(searchEntities('a', ALL)).toEqual([]);
    expect(searchEntities('  a  ', ALL)).toEqual([]);
  });

  it('returns [] when all sources are empty/null', () => {
    expect(searchEntities('api', {})).toEqual([]);
    expect(searchEntities('api', { topology: null, flows: [], dns: null })).toEqual([]);
  });

  it('matches topology nodes by label/id/namespace/cluster → type node, href /topology', () => {
    const byLabel = searchEntities('ip-10-0-1-5', { topology: TOPO });
    expect(ofType(byLabel, 'node')).toHaveLength(1);
    expect(ofType(byLabel, 'node')[0]).toMatchObject({ label: 'ip-10-0-1-5', href: '/topology' });

    const byId = searchEntities('vpc:vpc-abc', { topology: TOPO });
    expect(ofType(byId, 'node').map((r) => r.label)).toContain('vpc-abc');

    const byNamespace = searchEntities('default', { topology: TOPO });
    expect(ofType(byNamespace, 'node').map((r) => r.label)).toContain('api-server-1');

    const byCluster = searchEntities('eks-main', { topology: TOPO });
    expect(ofType(byCluster, 'node')).toHaveLength(2);
  });

  it('matches flow pod endpoints → type pod with /flows?ns=&pod= deep link', () => {
    const results = searchEntities('api-server', { flows: FLOWS });
    const pods = ofType(results, 'pod');
    expect(pods).toHaveLength(1); // deduped across edges/endpoints
    expect(pods[0]).toMatchObject({
      label: 'api-server-1',
      href: '/flows?ns=default&pod=api-server-1',
    });
  });

  it('matches flow service/ip/subnet endpoints with their types', () => {
    const svc = ofType(searchEntities('checkout-svc', { flows: FLOWS }), 'service');
    expect(svc).toHaveLength(1);
    expect(svc[0].label).toBe('checkout-svc');
    expect(svc[0].href).toBe('/flows');

    const ip = ofType(searchEntities('10.0.2.20', { flows: FLOWS }), 'ip');
    expect(ip).toHaveLength(1);
    expect(ip[0]).toMatchObject({ label: '10.0.2.20', href: '/flows' });

    const subnet = ofType(searchEntities('subnet-aaa', { flows: FLOWS }), 'subnet');
    expect(subnet).toHaveLength(1);
    expect(subnet[0]).toMatchObject({ label: 'subnet-aaa111', href: '/topology' });
  });

  it('matches flow endpoint instanceId → type node, href /topology', () => {
    const flows = [edge({ instanceId: 'i-0abc123def456', ip: '10.0.3.30' })];
    const results = searchEntities('i-0abc', { flows });
    const nodes = ofType(results, 'node');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: 'i-0abc123def456', href: '/topology' });
  });

  it('matches the flow monitor name → type node, sublabel monitor, href /monitors (deduped)', () => {
    const flows = [
      { ...edge({ ip: '10.0.1.10' }), monitor: 'nfm-monitor-prod' },
      { ...edge({ ip: '10.0.2.20' }), monitor: 'nfm-monitor-prod' },
    ];
    const results = searchEntities('nfm', { flows });
    const monitors = results.filter((r) => r.sublabel === 'monitor');
    expect(monitors).toHaveLength(1); // deduped across flows of the same monitor
    expect(monitors[0]).toMatchObject({ type: 'node', label: 'nfm-monitor-prod', href: '/monitors' });
  });

  it('matches topology nodes by vpcId when present', () => {
    const topo: TopologySnapshot = {
      generatedAt: '2026-07-11T00:00:00Z',
      nodes: [{ id: 'node:ip-10-0-9-9', kind: 'node', label: 'ip-10-0-9-9', vpcId: 'vpc-99deadbeef' }],
      edges: [],
    };
    const nodes = ofType(searchEntities('vpc-99dead', { topology: topo }), 'node');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: 'ip-10-0-9-9', href: '/topology' });
  });

  it('matches DNS topDomains and nameFlow names → type domain, href /insights?tab=dns', () => {
    const results = searchEntities('example.com', { dns: DNS });
    const domains = ofType(results, 'domain');
    // api.example.com deduped between topDomains and nameFlow
    expect(domains.map((r) => r.label).sort()).toEqual([
      'api.example.com',
      'checkout.internal.example.com',
    ]);
    for (const d of domains) expect(d.href).toBe('/insights?tab=dns');
  });

  it('is case-insensitive', () => {
    const results = searchEntities('API-SERVER', ALL);
    expect(ofType(results, 'pod')).toHaveLength(1);
    expect(ofType(results, 'node').map((r) => r.label)).toContain('api-server-1');
  });

  it('dedupes by type+label but keeps same label under different types', () => {
    const results = searchEntities('api-server-1', ALL);
    // one topology node AND one pod share the label — both kept
    expect(ofType(results, 'node')).toHaveLength(1);
    expect(ofType(results, 'pod')).toHaveLength(1);
  });

  it('URL-encodes pod deep-link params', () => {
    const flows = [edge({ podName: 'a b&c', podNamespace: 'team/x' })];
    const [pod] = ofType(searchEntities('a b', { flows }), 'pod');
    expect(pod.href).toBe(`/flows?ns=${encodeURIComponent('team/x')}&pod=${encodeURIComponent('a b&c')}`);
  });

  it('caps results at the limit (default 30)', () => {
    const flows = Array.from({ length: 50 }, (_, i) =>
      edge({ podName: `api-pod-${i}`, podNamespace: 'default' }),
    );
    expect(searchEntities('api-pod', { flows })).toHaveLength(30);
    expect(searchEntities('api-pod', { flows }, { limit: 5 })).toHaveLength(5);
  });
});
