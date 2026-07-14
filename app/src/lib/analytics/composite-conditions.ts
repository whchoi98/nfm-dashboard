// Composite-condition view (G5). Datadog composite-alarm pattern applied as a
// dashboard SIGNAL on /alerts — NOT a CloudWatch alarm. Pure, no I/O. Flags
// service entities breaching >=2 of: high retransmission rate, and a large
// window-over-window volume drop.
import type { FlowEdge } from '../types';
import { ratePer } from './reliability';
import { RETRANS_RATE_DANGER } from './aggregate';
import { moversLens } from './movers';

export interface CompositeRow {
  label: string;
  conditions: string[];
  severity: 'critical' | 'warn';
}

/**
 * The one new threshold this feature introduces (everything else reuses
 * RETRANS_RATE_DANGER from aggregate.ts). A window-over-window
 * DATA_TRANSFERRED deltaPct (from moversLens; negative = decline) at or below
 * this cutoff counts as the "volume drop" condition — a -50% or worse change
 * in bytes transferred vs the prior window.
 */
export const VOLUME_DROP_PCT = -50;

/**
 * Flags service entities breaching >=2 of:
 *  1) retransRate > RETRANS_RATE_DANGER (reliability lens, ratePer('service'))
 *  2) a >= 50% window-over-window drop in DATA_TRANSFERRED (movers lens)
 * Both lenses attribute bilaterally (each flow counts toward both endpoint
 * entities), so a single noisy edge can flag both sides — expected, mirrors
 * ratePer/moversLens themselves. Rows sorted by condition count desc, then
 * label asc.
 */
export function compositeConditions(current: FlowEdge[], prior: FlowEdge[]): CompositeRow[] {
  // Condition 1: high retransmission rate per service entity.
  const retrans = new Map<string, number>();
  for (const r of ratePer(current, 'service')) retrans.set(r.label, r.retransRate);

  // Condition 2: large volume drop (deltaPct <= VOLUME_DROP_PCT) from the
  // DATA_TRANSFERRED movers list — NOT `.movers`, which does not exist on
  // MoversResult ({ dataTransferred, retransmissions, timeouts, silent }).
  const drop = new Map<string, number>();
  for (const m of moversLens(current, prior).dataTransferred) {
    if (m.deltaPct != null && m.deltaPct <= VOLUME_DROP_PCT) drop.set(m.label, m.deltaPct);
  }

  const labels = new Set<string>([...retrans.keys(), ...drop.keys()]);
  const rows: CompositeRow[] = [];
  for (const label of labels) {
    const conditions: string[] = [];
    const rr = retrans.get(label) ?? 0;
    if (rr > RETRANS_RATE_DANGER) conditions.push(`retrans ${rr.toFixed(1)}/GB`);
    if (drop.has(label)) conditions.push(`volume ${drop.get(label)!.toFixed(0)}%`);
    if (conditions.length >= 2) {
      rows.push({ label, conditions, severity: rr > 2 * RETRANS_RATE_DANGER ? 'critical' : 'warn' });
    }
  }
  return rows.sort((x, y) => y.conditions.length - x.conditions.length || x.label.localeCompare(y.label));
}
