// Edge-health adjacency matrix (Task 8) — Datadog-CNM-style source→dest grid
// colored by connection health (retransmission/timeout rate per GB), rather
// than by raw metric magnitude. Pure, no I/O. Consumed by
// components/topology/AdjacencyMatrix.tsx in 'health' mode.
import type { EndpointInfo, FlowEdge } from '../types';
import {
  ratePerGb,
  RETRANS_RATE_WARN, RETRANS_RATE_DANGER,
  TIMEOUT_RATE_WARN, TIMEOUT_RATE_DANGER,
} from './aggregate';

export type HealthStatus = 'ok' | 'warn' | 'danger';
/** Endpoint-field granularities buildHealthMatrix understands (distinct from
 *  topology.ts's TierLevel — az/vpc have no tier-map analog, service/namespace
 *  key directly off the raw FlowEdge endpoint field, not the aggregated tier id). */
export type HealthLevel = 'service' | 'namespace' | 'az' | 'vpc';

export interface HealthCell {
  row: string;
  col: string;
  status: HealthStatus;
  retransRate: number;
  timeoutRate: number;
  bytes: number;
}

export interface HealthMatrix {
  rows: string[];
  cols: string[];
  cells: HealthCell[];
}

export interface HealthThresholds {
  retransWarn?: number;
  retransDanger?: number;
  timeoutWarn?: number;
  timeoutDanger?: number;
}

/** Endpoint field for the given level; undefined when the flow doesn't carry it (never falls back to 'unknown'). */
function levelKey(e: EndpointInfo, level: HealthLevel): string | undefined {
  switch (level) {
    case 'service':
      return e.serviceName;
    case 'namespace':
      return e.podNamespace;
    case 'az':
      return e.az;
    case 'vpc':
      return e.vpcId;
  }
}

/** Composite (row, col) map key; the unit-separator escape avoids collisions with label text. */
const pairKey = (row: string, col: string) => `${row}\x1f${col}`;

/**
 * Per source→dest (at `level`) sums of bytes/retransmissions/timeouts, reduced
 * to a worst-of-retrans/timeout HealthStatus. Flows missing either side's
 * `level` key are skipped entirely (not bucketed under 'unknown'). Thresholds
 * default to the shared per-GB rate consts (aggregate.ts) — NOT the
 * overview-metrics.ts count thresholds. rows/cols are unique, ascending.
 */
export function buildHealthMatrix(
  flows: FlowEdge[],
  level: HealthLevel,
  opts: HealthThresholds = {},
): HealthMatrix {
  const retransWarn = opts.retransWarn ?? RETRANS_RATE_WARN;
  const retransDanger = opts.retransDanger ?? RETRANS_RATE_DANGER;
  const timeoutWarn = opts.timeoutWarn ?? TIMEOUT_RATE_WARN;
  const timeoutDanger = opts.timeoutDanger ?? TIMEOUT_RATE_DANGER;

  const acc = new Map<string, { row: string; col: string; bytes: number; retrans: number; timeouts: number }>();
  const rowSet = new Set<string>();
  const colSet = new Set<string>();

  for (const f of flows) {
    const row = levelKey(f.a, level);
    const col = levelKey(f.b, level);
    if (!row || !col) continue; // missing either side's key for this level → skip
    let slot = acc.get(pairKey(row, col));
    if (!slot) {
      slot = { row, col, bytes: 0, retrans: 0, timeouts: 0 };
      acc.set(pairKey(row, col), slot);
    }
    if (f.metric === 'DATA_TRANSFERRED') slot.bytes += f.value;
    else if (f.metric === 'RETRANSMISSIONS') slot.retrans += f.value;
    else if (f.metric === 'TIMEOUTS') slot.timeouts += f.value;
    rowSet.add(row);
    colSet.add(col);
  }

  const cells: HealthCell[] = [...acc.values()].map((s) => {
    const retransRate = ratePerGb(s.retrans, s.bytes);
    const timeoutRate = ratePerGb(s.timeouts, s.bytes);
    const status: HealthStatus =
      retransRate >= retransDanger || timeoutRate >= timeoutDanger
        ? 'danger'
        : retransRate >= retransWarn || timeoutRate >= timeoutWarn
          ? 'warn'
          : 'ok';
    return { row: s.row, col: s.col, status, retransRate, timeoutRate, bytes: s.bytes };
  });

  return { rows: [...rowSet].sort(), cols: [...colSet].sort(), cells };
}
