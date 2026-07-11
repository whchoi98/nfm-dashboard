// Unified entity search across the data the dashboard already holds:
// topology nodes, recent flow endpoints, monitor names, and DNS names.
// Pure — the /api/search route loads the sources and the /search page
// renders the grouped results.
import type { DnsAggregate, EndpointInfo, FlowEdge, TopologySnapshot } from './types';

export type SearchResultType = 'pod' | 'service' | 'subnet' | 'ip' | 'node' | 'domain';

export interface SearchResult {
  type: SearchResultType;
  label: string;
  sublabel?: string;
  href: string;
}

export interface SearchSources {
  topology?: TopologySnapshot | null;
  flows?: FlowEdge[];
  dns?: DnsAggregate | null;
}

export const MIN_QUERY_LENGTH = 2;
const DEFAULT_LIMIT = 30;

/** Pod deep link into the flows page's pod mode. */
function podHref(name: string, namespace?: string): string {
  return `/flows?ns=${encodeURIComponent(namespace ?? '')}&pod=${encodeURIComponent(name)}`;
}

/**
 * Case-insensitive substring search of `q` across topology node
 * label/id/namespace/cluster/vpcId, flow endpoint
 * podName/serviceName/ip/subnetId/instanceId, flow monitor names,
 * and DNS domain names. Results are deduped by type+label and capped at
 * `opts.limit` (default 30). Queries shorter than 2 chars return [].
 */
export function searchEntities(
  q: string,
  sources: SearchSources,
  opts?: { limit?: number },
): SearchResult[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < MIN_QUERY_LENGTH) return [];
  const limit = opts?.limit ?? DEFAULT_LIMIT;

  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const hit = (...fields: (string | undefined)[]) =>
    fields.some((f) => f != null && f.toLowerCase().includes(needle));
  const add = (r: SearchResult) => {
    const key = `${r.type}\u001f${r.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(r);
  };

  // Topology nodes — label/id/namespace/cluster/vpcId all searchable.
  for (const node of sources.topology?.nodes ?? []) {
    if (results.length >= limit) return results.slice(0, limit);
    if (hit(node.label, node.id, node.namespace, node.cluster, node.vpcId)) {
      add({
        type: 'node',
        label: node.label,
        sublabel: [node.kind, node.namespace ?? node.cluster].filter(Boolean).join(' · '),
        href: '/topology',
      });
    }
  }

  // Flow endpoints — each matching identifier becomes its own typed result.
  const endpoint = (e: EndpointInfo) => {
    if (e.podName != null && hit(e.podName)) {
      add({
        type: 'pod',
        label: e.podName,
        sublabel: e.podNamespace,
        href: podHref(e.podName, e.podNamespace),
      });
    }
    if (e.serviceName != null && hit(e.serviceName)) {
      add({ type: 'service', label: e.serviceName, sublabel: e.podNamespace, href: '/flows' });
    }
    if (e.ip != null && hit(e.ip)) {
      add({ type: 'ip', label: e.ip, sublabel: e.podName ?? e.instanceId, href: '/flows' });
    }
    if (e.subnetId != null && hit(e.subnetId)) {
      add({ type: 'subnet', label: e.subnetId, sublabel: [e.az, e.vpcId].filter(Boolean).join(' · '), href: '/topology' });
    }
    if (e.instanceId != null && hit(e.instanceId)) {
      add({
        type: 'node',
        label: e.instanceId,
        sublabel: [e.ip, e.az].filter(Boolean).join(' · '),
        href: '/topology',
      });
    }
  };
  for (const flow of sources.flows ?? []) {
    if (results.length >= limit) return results.slice(0, limit);
    endpoint(flow.a);
    endpoint(flow.b);
    // Monitor names are searchable too (e.g. "nfm") — deduped by type+label,
    // so each monitor surfaces once regardless of how many flows carry it.
    if (hit(flow.monitor)) {
      add({ type: 'node', label: flow.monitor, sublabel: 'monitor', href: '/monitors' });
    }
  }

  // DNS names — resolved domains from topDomains + the name↔flow join.
  for (const d of sources.dns?.topDomains ?? []) {
    if (results.length >= limit) return results.slice(0, limit);
    if (hit(d.name)) add({ type: 'domain', label: d.name, href: '/insights?tab=dns' });
  }
  for (const nf of sources.dns?.nameFlow ?? []) {
    if (results.length >= limit) return results.slice(0, limit);
    if (hit(nf.name)) add({ type: 'domain', label: nf.name, sublabel: nf.ip, href: '/insights?tab=dns' });
  }

  return results.slice(0, limit);
}
