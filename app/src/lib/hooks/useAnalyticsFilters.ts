'use client';
// Global analytics filter state: URL query is the source of truth, mirrored to
// sessionStorage ('nfm-analytics-filters') so the selection survives navigation.
// NOTE: useSearchParams requires a <Suspense> boundary during prerender.
import { useCallback, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  type AnalyticsFilters,
  DEFAULT_FILTERS,
  parseFilters,
} from '../analytics/filters';

const STORAGE_KEY = 'nfm-analytics-filters';

function readStored(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function useAnalyticsFilters(): {
  filters: AnalyticsFilters;
  setFilter: <K extends keyof AnalyticsFilters>(k: K, v: AnalyticsFilters[K]) => void;
} {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<AnalyticsFilters>(() => {
    // URL query wins over sessionStorage; both fall back to DEFAULT_FILTERS.
    const fromUrl: Record<string, unknown> = {};
    for (const k of Object.keys(DEFAULT_FILTERS)) {
      const v = searchParams?.get(k);
      if (v != null) fromUrl[k] = v;
    }
    return parseFilters({ ...readStored(), ...fromUrl });
  });

  // Ref keeps setFilter stable while always seeing the latest filters.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const setFilter = useCallback(
    <K extends keyof AnalyticsFilters>(k: K, v: AnalyticsFilters[K]) => {
      const next = { ...filtersRef.current, [k]: v };
      setFilters(next);
      if (typeof window === 'undefined') return;
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // sessionStorage unavailable (private mode/quota) — state still updates.
      }
      // Start from the current query so unrelated params (e.g. the hub's ?tab=)
      // survive filter changes; filter keys are then overwritten.
      const q = new URLSearchParams(window.location.search);
      for (const [key, val] of Object.entries(next)) q.set(key, String(val));
      router.replace(`${window.location.pathname}?${q.toString()}`, { scroll: false });
    },
    [router],
  );

  return { filters, setFilter };
}
