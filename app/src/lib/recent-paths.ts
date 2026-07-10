// Session-scoped "recent path lookups" for /paths: newest-first, deduped by
// edgeId, capped at MAX_RECENT_PATHS. Storage IO is best-effort (private
// mode / quota errors must never break the page), so reads parse defensively
// and writes swallow failures.

export interface RecentPath {
  edgeId: string;
  label: string;
  ts: number;
}

export const RECENT_PATHS_KEY = 'nfm-recent-paths';
export const MAX_RECENT_PATHS = 5;

/** Pure: prepend `entry`, drop any older entry with the same edgeId, cap at `max`. */
export function pushRecent(
  list: RecentPath[],
  entry: RecentPath,
  max = MAX_RECENT_PATHS,
): RecentPath[] {
  return [entry, ...list.filter((r) => r.edgeId !== entry.edgeId)].slice(0, max);
}

/** Pure: parse a stored JSON payload defensively (bad/foreign data → []). */
export function parseRecent(raw: string | null): RecentPath[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (r): r is RecentPath =>
          typeof r === 'object' &&
          r !== null &&
          typeof (r as RecentPath).edgeId === 'string' &&
          typeof (r as RecentPath).label === 'string' &&
          typeof (r as RecentPath).ts === 'number',
      )
      .slice(0, MAX_RECENT_PATHS);
  } catch {
    return [];
  }
}

export function readRecentPaths(): RecentPath[] {
  if (typeof window === 'undefined') return [];
  try {
    return parseRecent(window.sessionStorage.getItem(RECENT_PATHS_KEY));
  } catch {
    return [];
  }
}

export function saveRecentPaths(list: RecentPath[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(RECENT_PATHS_KEY, JSON.stringify(list));
  } catch {
    // sessionStorage may be unavailable — recents are a convenience only.
  }
}
