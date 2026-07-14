// Port/service traffic mix (Datadog/Hubble parity, feasible stand-in for a
// protocol view since NFM flows carry targetPort but no L4 protocol). Pure.
import type { FlowEdge } from '../types';

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

export interface PortMixRow {
  port: number | null;
  label: string;
  bytes: number;
  retransmissions: number;
}

/** Group flows by targetPort: bytes from DATA_TRANSFERRED, retransmissions from
 *  RETRANSMISSIONS; sorted desc by bytes then port. undefined port → key null. */
export function portMix(flows: FlowEdge[]): PortMixRow[] {
  const acc = new Map<number | null, PortMixRow>();
  for (const f of flows) {
    const port = f.targetPort ?? null;
    const row = acc.get(port) ?? { port, label: portLabel(f.targetPort), bytes: 0, retransmissions: 0 };
    if (f.metric === 'DATA_TRANSFERRED') row.bytes += f.value;
    else if (f.metric === 'RETRANSMISSIONS') row.retransmissions += f.value;
    acc.set(port, row);
  }
  return [...acc.values()].sort(
    (x, y) => y.bytes - x.bytes || (y.port ?? -1) - (x.port ?? -1),
  );
}
