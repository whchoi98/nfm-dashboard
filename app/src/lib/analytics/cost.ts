// Cost analytics lens (spec §6.1). Pure functions, no I/O.
// Consumed by /api/analytics/cost — the route exposes these shapes as JSON verbatim.
import type { DestCategory, FlowEdge } from '../types';
import { CATEGORY_ORDER } from '../chart-tokens';
import { entityKey, groupBy, type EntityKind, type Series } from './aggregate';

// Pricing assumption (spec §6.1): inter-AZ data transfer in ap-northeast-2 is billed
// $0.01/GB in EACH direction (≈ $0.02/GB round trip). INTER_VPC and INTER_REGION are
// approximated with the same per-direction rate. NFM `value` bytes are treated as an
// estimate of billable bytes — this is NOT an exact bill (UI shows an "estimate" badge).
export const AZ_TRANSFER_USD_PER_GB = 0.01;

// Internet data-transfer-out (egress) rate — AWS first-tier ~$0.09/GB in
// ap-northeast-2. INTERNET is NOT in BILLED_CATEGORIES (bytesToUsd returns 0
// for it) because inter-AZ pricing doesn't apply; egress is priced separately.
// An estimate, like AZ_TRANSFER_USD_PER_GB (UI shows an "estimate" badge).
export const INTERNET_EGRESS_USD_PER_GB = 0.09;

/** Estimated USD for internet-egress bytes. */
export function egressBytesToUsd(bytes: number): number {
  return (bytes / 1e9) * INTERNET_EGRESS_USD_PER_GB;
}

/** Categories that incur data-transfer charges; everything else costs $0. */
export const BILLED_CATEGORIES: ReadonlySet<DestCategory> = new Set<DestCategory>([
  'INTER_AZ', 'INTER_VPC', 'INTER_REGION',
]);

export interface CostRow { key: string; label: string; bytes: number; usd: number; category: DestCategory; }
export interface RegionArc { from: string; to: string; bytes: number; usd: number; }
export interface CategoryStreamPoint { t: string; values: Record<DestCategory, number>; }
export interface CostLensResult {
  totalUsd: number;
  byCategory: Record<DestCategory, { bytes: number; usd: number }>;
  top: CostRow[];
  series: Series[];
  regionArcs: RegionArc[];
  stream: CategoryStreamPoint[];
}

/** Estimated USD for `bytes` transferred under `category`; non-billed categories → 0. */
export function bytesToUsd(bytes: number, category: DestCategory): number {
  return BILLED_CATEGORIES.has(category) ? (bytes / 1e9) * AZ_TRANSFER_USD_PER_GB : 0;
}

/** Only DATA_TRANSFERRED flows carry byte counts; all cost math starts from these. */
function dataFlows(flows: FlowEdge[]): FlowEdge[] {
  return flows.filter((f) => f.metric === 'DATA_TRANSFERRED');
}

/** Direction-independent endpoint pair at the given granularity (sorted entity keys). */
function pairOf(f: FlowEdge, kind: EntityKind): [string, string] {
  const a = entityKey(f.a, kind);
  const b = entityKey(f.b, kind);
  return a <= b ? [a, b] : [b, a];
}

/** All-zero per-category record (every DestCategory key always present). */
function zeroByCategory(): Record<DestCategory, number> {
  return Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<DestCategory, number>;
}

/**
 * Top-N cost contributors: DATA_TRANSFERRED flows grouped by direction-independent
 * endpoint pair, bytes summed and priced per each flow's own category, sorted by USD desc.
 * `category` on the row is the group's dominant category by bytes.
 */
export function topCostContributors(flows: FlowEdge[], kind: EntityKind = 'service', n = 20): CostRow[] {
  const groups = groupBy(dataFlows(flows), (f) => pairOf(f, kind).join('|'));
  const rows: CostRow[] = [];
  for (const [key, group] of groups) {
    const [a, b] = pairOf(group[0], kind);
    let bytes = 0;
    let usd = 0;
    const bytesByCategory = new Map<DestCategory, number>();
    for (const f of group) {
      bytes += f.value;
      usd += bytesToUsd(f.value, f.category);
      bytesByCategory.set(f.category, (bytesByCategory.get(f.category) ?? 0) + f.value);
    }
    let category = group[0].category;
    let maxBytes = -1;
    for (const [c, catBytes] of bytesByCategory) {
      if (catBytes > maxBytes) { maxBytes = catBytes; category = c; }
    }
    rows.push({ key, label: a === b ? a : `${a} ↔ ${b}`, bytes, usd, category });
  }
  rows.sort((x, y) => y.usd - x.usd || y.bytes - x.bytes || x.key.localeCompare(y.key));
  return rows.slice(0, n);
}

/** One Series per category present in the data; points = estimated USD per bucket (0-filled). */
export function costByCategorySeries(flows: FlowEdge[]): Series[] {
  const data = dataFlows(flows);
  const buckets = [...new Set(data.map((f) => f.bucket))].sort();
  const series: Series[] = [];
  for (const category of CATEGORY_ORDER) {
    const usdByBucket = new Map<string, number>();
    let present = false;
    for (const f of data) {
      if (f.category !== category) continue;
      present = true;
      usdByBucket.set(f.bucket, (usdByBucket.get(f.bucket) ?? 0) + bytesToUsd(f.value, f.category));
    }
    if (!present) continue;
    series.push({ label: category, points: buckets.map((t) => ({ t, v: usdByBucket.get(t) ?? 0 })) });
  }
  return series;
}

/** INTER_REGION traffic grouped by a.region→b.region; same-region or missing-region flows excluded. */
export function regionArcs(flows: FlowEdge[]): RegionArc[] {
  const arcs = new Map<string, RegionArc>();
  for (const f of dataFlows(flows)) {
    if (f.category !== 'INTER_REGION') continue;
    const from = f.a.region;
    const to = f.b.region;
    if (!from || !to || from === to) continue;
    const key = `${from}→${to}`;
    const arc = arcs.get(key) ?? { from, to, bytes: 0, usd: 0 };
    arc.bytes += f.value;
    arc.usd += bytesToUsd(f.value, f.category);
    arcs.set(key, arc);
  }
  return [...arcs.values()].sort((x, y) => y.usd - x.usd || y.bytes - x.bytes);
}

/** Per-bucket byte composition by category (every DestCategory key, 0-filled) — for streamgraph/100% stack. */
export function categoryStream(flows: FlowEdge[]): CategoryStreamPoint[] {
  const perBucket = groupBy(dataFlows(flows), (f) => f.bucket);
  return [...perBucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, group]) => {
      const values = zeroByCategory();
      for (const f of group) values[f.category] = (values[f.category] ?? 0) + f.value;
      return { t, values };
    });
}

/** Spec §6.1 response for /api/analytics/cost. Only DATA_TRANSFERRED flows contribute. */
export function costLens(flows: FlowEdge[]): CostLensResult {
  const byCategory = Object.fromEntries(
    CATEGORY_ORDER.map((c) => [c, { bytes: 0, usd: 0 }]),
  ) as Record<DestCategory, { bytes: number; usd: number }>;
  let totalUsd = 0;
  for (const f of dataFlows(flows)) {
    const usd = bytesToUsd(f.value, f.category);
    const slot = byCategory[f.category] ?? (byCategory[f.category] = { bytes: 0, usd: 0 });
    slot.bytes += f.value;
    slot.usd += usd;
    totalUsd += usd;
  }
  return {
    totalUsd,
    byCategory,
    top: topCostContributors(flows),
    series: costByCategorySeries(flows),
    regionArcs: regionArcs(flows),
    stream: categoryStream(flows),
  };
}
