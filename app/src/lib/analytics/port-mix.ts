// Well-known dest-port → service labels for the network matrix `port` dest-scope
// (Datadog/Hubble parity: a feasible stand-in for a protocol view, since NFM
// flows carry targetPort but no L4 protocol). Consumed by network-analytics.ts.

/** Well-known TCP/UDP dest ports → service label. Unknown ports render as `port N`. */
export const PORT_LABELS: Record<number, string> = {
  443: 'HTTPS (443)', 80: 'HTTP (80)', 53: 'DNS (53)', 5432: 'PostgreSQL (5432)',
  3306: 'MySQL (3306)', 6379: 'Redis (6379)', 27017: 'MongoDB (27017)',
  9092: 'Kafka (9092)', 22: 'SSH (22)', 8080: 'HTTP-alt (8080)',
};

export function portLabel(port: number | undefined): string {
  if (port == null) return 'unknown';
  return PORT_LABELS[port] ?? `port ${port}`;
}
