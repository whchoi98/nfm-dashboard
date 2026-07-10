// Pure helpers for the /workload page: distill the WI#latest snapshot
// (WiResult[] per metric×category) into selector options and ranked
// contributor rows. No I/O — mirrors flow-aggregates.ts.
import type { WiResult, WiRow } from './types';
import { CATEGORY_ORDER } from './chart-tokens';

/** A WI contributor row tagged with the category of its parent WiResult. */
export type WiContributor = WiRow & { category: string };

/**
 * Distinct categories that actually carry contributor rows, in CATEGORY_ORDER.
 * Categories the app does not know yet (future collector additions) are
 * appended alphabetically instead of being dropped.
 */
export function presentCategories(results: WiResult[]): string[] {
  const present = new Set<string>();
  for (const r of results) if (r.rows.length > 0) present.add(r.category);
  const known = CATEGORY_ORDER.filter((c) => present.has(c)) as string[];
  const unknown = [...present].filter((c) => !(CATEGORY_ORDER as string[]).includes(c)).sort();
  return [...known, ...unknown];
}

/**
 * Contributor rows for one metric, each tagged with its category, sorted by
 * value desc. An empty `category` ('' or 'all') concatenates every category.
 */
export function contributorRows(
  results: WiResult[],
  metric: string,
  category = '',
): WiContributor[] {
  const all = category === '' || category === 'all';
  return results
    .filter((r) => r.metric === metric && (all || r.category === category))
    .flatMap((r) => r.rows.map((row) => ({ ...row, category: r.category })))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

/** Readable contributor label: subnet > remote resource > account > '—'. */
export function contributorLabel(row: WiRow): string {
  return row.localSubnetId ?? row.remoteIdentifier ?? row.accountId ?? '—';
}

/**
 * Region derived from an AZ *name* (ap-northeast-2a → ap-northeast-2,
 * us-gov-west-1a → us-gov-west-1). AZ IDs (apne2-az1) are not derivable
 * without a lookup table → undefined.
 */
export function regionFromAz(az?: string): string | undefined {
  const m = az?.match(/^([a-z]{2,4}(?:-[a-z]+)+-\d+)[a-z]$/);
  return m?.[1];
}
