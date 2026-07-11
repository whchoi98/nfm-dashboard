// Efficiency & cost-optimization lens (Phase 7 Task 1). Pure functions, no I/O.
// Consumed by /api/analytics/efficiency — the route exposes this shape as JSON verbatim.
// Pricing is NOT redefined here: every USD figure goes through cost.ts bytesToUsd.
import type { DestCategory, FlowEdge } from '../types';
import { CATEGORY_ORDER } from '../chart-tokens';
import type { Series } from './aggregate';
import { bytesToUsd, topCostContributors, type CostRow } from './cost';

// Default lens window: 12 five-minute buckets (the hub's 1h default range).
const DEFAULT_WINDOW_SECONDS = 12 * 300;
// 30 days in seconds — monthlyUsdRunRate = windowUsd × (MONTH_SECONDS / windowSeconds).
const MONTH_SECONDS = 2_592_000;

export interface EfficiencyResult {
  totalBytes: number;
  billedBytes: number;
  freeBytes: number;
  billedRatio: number; // 0..1 (0 when totalBytes is 0)
  byCategory: Record<DestCategory, { bytes: number; usd: number }>;
  windowUsd: number;
  monthlyUsdRunRate: number; // windowUsd scaled to 30 days
  topCrossAz: CostRow[]; // billed contributors only, desc by usd
  trend: Series; // billed USD per bucket over the window
}

/** Billed-category test derived from the single pricing source of truth
 *  (cost.ts bytesToUsd): a category is billed iff it prices bytes above $0. */
function isBilled(category: DestCategory): boolean {
  return bytesToUsd(1e9, category) > 0;
}

/**
 * Cost-efficiency lens over a flows window: billed vs free byte split,
 * estimated USD for the window, a 30-day run-rate extrapolation, the top
 * billed (cross-AZ/VPC/Region) talkers and a per-bucket billed-USD trend.
 * Only DATA_TRANSFERRED flows carry bytes, so everything derives from those.
 */
export function efficiencyLens(
  flows: FlowEdge[],
  opts?: { windowSeconds?: number },
): EfficiencyResult {
  const windowSeconds =
    opts?.windowSeconds && Number.isFinite(opts.windowSeconds) && opts.windowSeconds > 0
      ? opts.windowSeconds
      : DEFAULT_WINDOW_SECONDS;

  const byCategory = Object.fromEntries(
    CATEGORY_ORDER.map((c) => [c, { bytes: 0, usd: 0 }]),
  ) as Record<DestCategory, { bytes: number; usd: number }>;

  let totalBytes = 0;
  let billedBytes = 0;
  let windowUsd = 0;
  const usdByBucket = new Map<string, number>();

  for (const f of flows) {
    if (f.metric !== 'DATA_TRANSFERRED') continue;
    const usd = bytesToUsd(f.value, f.category);
    const slot = byCategory[f.category] ?? (byCategory[f.category] = { bytes: 0, usd: 0 });
    slot.bytes += f.value;
    slot.usd += usd;
    totalBytes += f.value;
    windowUsd += usd;
    if (isBilled(f.category)) billedBytes += f.value;
    // 0-fill free-only buckets so the trend keeps a point per bucket.
    usdByBucket.set(f.bucket, (usdByBucket.get(f.bucket) ?? 0) + usd);
  }

  const billedFlows = flows.filter(
    (f) => f.metric === 'DATA_TRANSFERRED' && isBilled(f.category),
  );

  return {
    totalBytes,
    billedBytes,
    freeBytes: totalBytes - billedBytes,
    billedRatio: totalBytes > 0 ? billedBytes / totalBytes : 0,
    byCategory,
    windowUsd,
    monthlyUsdRunRate: windowUsd * (MONTH_SECONDS / windowSeconds),
    topCrossAz: topCostContributors(billedFlows, 'service', 8),
    trend: {
      label: 'billed-usd',
      points: [...usdByBucket.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([t, v]) => ({ t, v })),
    },
  };
}
