'use client';
import { useCallback, useEffect, useState } from 'react';

export interface Polling<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Fetch `url` as JSON on mount and every `ms` milliseconds (default 30s).
 * Each effect run owns a `cancelled` flag and an AbortController, so a
 * response belonging to a superseded url/interval (or an unmounted
 * component) is discarded instead of overwriting the current url's data.
 * `enabled=false` pauses polling entirely (no fetch, no interval) while
 * keeping the last received data — used by the topology LIVE/pause toggle.
 */
export function usePolling<T>(url: string, ms = 30000, enabled = true): Polling<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumping this restarts the polling effect (used by refresh()).
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();

    const load = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
        const body = (await res.json()) as T & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error ?? `HTTP ${res.status}`);
        } else {
          setData(body);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'fetch failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    load();
    const id = setInterval(load, ms);
    return () => {
      cancelled = true;
      ctrl.abort();
      clearInterval(id);
    };
  }, [url, ms, tick, enabled]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { data, error, loading, refresh };
}
