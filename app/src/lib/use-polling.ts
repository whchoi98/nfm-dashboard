'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface Polling<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Fetch `url` as JSON on mount and every `ms` milliseconds (default 30s).
 * The interval and any in-flight response are discarded on unmount / url change.
 */
export function usePolling<T>(url: string, ms = 30000): Polling<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const body = (await res.json()) as T & { error?: string };
      if (!aliveRef.current) return;
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
      } else {
        setData(body);
        setError(null);
      }
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    aliveRef.current = true;
    setLoading(true);
    load();
    const id = setInterval(load, ms);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [load, ms]);

  const refresh = useCallback(() => {
    setLoading(true);
    load();
  }, [load]);

  return { data, error, loading, refresh };
}
