// Cost-explorer lens (Phase 8 Task 4). Pure functions, no I/O.
// Consumed by /api/cost-explorer — the route exposes this shape as JSON verbatim.
// Pricing is NOT redefined here: every USD figure goes through cost.ts bytesToUsd.
import type { DestCategory, FlowEdge } from '../types';
import { CATEGORY_ORDER } from '../chart-tokens';
import type { Series } from './aggregate';
import { bytesToUsd, topCostContributors } from './cost';

// Default lens window: 12 five-minute buckets (the hub's 1h default range).
const DEFAULT_WINDOW_SECONDS = 12 * 300;
// 30 days in seconds — monthlyRunRate = totalUsd × (MONTH_SECONDS / windowSeconds).
export const MONTH_SECONDS = 2_592_000;
const SAVINGS_LIMIT = 8;

export interface CostGroupRow { label: string; bytes: number; usd: number; }
export interface SavingsRow { label: string; usd: number; hint: string; }
export interface CostExplorerResult {
  totalUsd: number;
  monthlyRunRate: number; // totalUsd scaled to 30 days
  byCluster: CostGroupRow[]; // desc by usd
  byNamespace: CostGroupRow[]; // desc by usd
  byCategory: Record<DestCategory, { bytes: number; usd: number }>;
  byMonitor: CostGroupRow[]; // desc by usd
  savings: SavingsRow[]; // billed contributors only, desc by usd
  trend: Series; // billed USD per bucket over the window
}

// t()-able recommendation key per billed category (translated in ko.json/en.json).
const SAVINGS_HINT: Partial<Record<DestCategory, string>> = {
  INTER_AZ: 'costHint.colocate',
  INTER_VPC: 'costHint.vpcEndpoint',
  INTER_REGION: 'costHint.region',
};

/** Default monitor→cluster deriver (collector naming convention):
 *  `nfm-eks-<cluster>` → `<cluster>`, `nfm-vpc-*` → 'vpc', otherwise the monitor name. */
export function deriveCluster(monitor: string): string {
  if (monitor.startsWith('nfm-eks-') && monitor.length > 'nfm-eks-'.length) {
    return monitor.slice('nfm-eks-'.length);
  }
  if (monitor.startsWith('nfm-vpc')) return 'vpc';
  return monitor;
}

/** Namespaces a flow belongs to: each endpoint's podNamespace (deduped);
 *  'unknown' only when NEITHER endpoint carries one (applyFlowFilters semantics). */
function namespacesOf(f: FlowEdge): string[] {
  const set = new Set<string>();
  if (f.a.podNamespace) set.add(f.a.podNamespace);
  if (f.b.podNamespace) set.add(f.b.podNamespace);
  return set.size > 0 ? [...set] : ['unknown'];
}

/** Accumulate bytes+usd under `label`, then finish() → rows desc by usd. */
function makeAccumulator() {
  const rows = new Map<string, CostGroupRow>();
  return {
    add(label: string, bytes: number, usd: number) {
      const row = rows.get(label) ?? { label, bytes: 0, usd: 0 };
      row.bytes += bytes;
      row.usd += usd;
      rows.set(label, row);
    },
    finish(): CostGroupRow[] {
      return [...rows.values()].sort(
        (x, y) => y.usd - x.usd || y.bytes - x.bytes || x.label.localeCompare(y.label),
      );
    },
  };
}

/**
 * Deep cost-explorer lens over a flows window: billed USD (cost.ts pricing)
 * grouped by cluster / namespace / category / monitor, a 30-day run-rate,
 * savings recommendations for the top billed contributors and a per-bucket
 * billed-USD trend. Only DATA_TRANSFERRED flows carry bytes, so everything
 * derives from those; a flow spanning two namespaces counts toward both.
 */
export function costExplorerLens(
  flows: FlowEdge[],
  opts?: { windowSeconds?: number; clusterOf?: (monitor: string) => string },
): CostExplorerResult {
  const windowSeconds =
    opts?.windowSeconds && Number.isFinite(opts.windowSeconds) && opts.windowSeconds > 0
      ? opts.windowSeconds
      : DEFAULT_WINDOW_SECONDS;
  const clusterOf = opts?.clusterOf ?? deriveCluster;

  const byCategory = Object.fromEntries(
    CATEGORY_ORDER.map((c) => [c, { bytes: 0, usd: 0 }]),
  ) as Record<DestCategory, { bytes: number; usd: number }>;

  const clusters = makeAccumulator();
  const namespaces = makeAccumulator();
  const monitors = makeAccumulator();
  let totalUsd = 0;
  const usdByBucket = new Map<string, number>();
  const billedFlows: FlowEdge[] = [];

  for (const f of flows) {
    if (f.metric !== 'DATA_TRANSFERRED') continue;
    const usd = bytesToUsd(f.value, f.category);
    totalUsd += usd;
    if (usd > 0) billedFlows.push(f);

    clusters.add(clusterOf(f.monitor), f.value, usd);
    monitors.add(f.monitor, f.value, usd);
    for (const ns of namespacesOf(f)) namespaces.add(ns, f.value, usd);

    const slot = byCategory[f.category] ?? (byCategory[f.category] = { bytes: 0, usd: 0 });
    slot.bytes += f.value;
    slot.usd += usd;

    // 0-fill free-only buckets so the trend keeps a point per bucket.
    usdByBucket.set(f.bucket, (usdByBucket.get(f.bucket) ?? 0) + usd);
  }

  // Savings = top billed pairs (cost.ts CostRow) with a t()-able hint per
  // dominant category; rows are already desc by usd from topCostContributors.
  const savings: SavingsRow[] = topCostContributors(billedFlows, 'service', SAVINGS_LIMIT)
    .filter((r) => r.usd > 0)
    .map((r) => ({ label: r.label, usd: r.usd, hint: SAVINGS_HINT[r.category] ?? 'costHint.colocate' }));

  return {
    totalUsd,
    monthlyRunRate: totalUsd * (MONTH_SECONDS / windowSeconds),
    byCluster: clusters.finish(),
    byNamespace: namespaces.finish(),
    byCategory,
    byMonitor: monitors.finish(),
    savings,
    trend: {
      label: 'billed-usd',
      points: [...usdByBucket.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([t, v]) => ({ t, v })),
    },
  };
}
