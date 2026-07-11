'use client';

// User-tunable app settings persisted in localStorage (`nfm-settings`).
// Mirrors the LanguageContext pattern: defaults on first render (SSR-safe),
// hydrate from localStorage in an effect, setters write back immediately.
// parseSettings is pure so corrupt/partial payloads degrade per-field.
import { useEffect, useState } from 'react';
import { TIME_RANGES, type TimeRange } from './analytics/filters';

export interface AppSettings {
  defaultRange: TimeRange;
  /** Retransmission alert threshold, events per GB (Anomalies page). */
  retransThreshold: number;
  /** Timeout alert threshold, events per GB (Anomalies page). */
  timeoutThreshold: number;
  /** Display cost rate, USD per GB transferred. */
  costPerGb: number;
  /** Anomaly detection sensitivity, standard deviations from baseline. */
  anomalySigma: number;
  /** Default monitor scope; 'all' is the no-filter sentinel. */
  monitorFilter: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultRange: '1h',
  retransThreshold: 10,
  timeoutThreshold: 5,
  costPerGb: 0.01,
  anomalySigma: 3,
  monitorFilter: 'all',
};

export const SETTINGS_KEY = 'nfm-settings';

/**
 * Coerce raw localStorage JSON into AppSettings: valid fields are merged over
 * DEFAULT_SETTINGS; missing, mistyped, or non-finite values fall back per
 * field. Corrupt / non-object JSON yields the defaults.
 */
export function parseSettings(raw: string | null): AppSettings {
  let rec: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      rec = parsed as Record<string, unknown>;
    }
  } catch {
    // Corrupt JSON — fall through to defaults.
  }
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    defaultRange: TIME_RANGES.includes(rec.defaultRange as TimeRange)
      ? (rec.defaultRange as TimeRange)
      : DEFAULT_SETTINGS.defaultRange,
    retransThreshold: num(rec.retransThreshold, DEFAULT_SETTINGS.retransThreshold),
    timeoutThreshold: num(rec.timeoutThreshold, DEFAULT_SETTINGS.timeoutThreshold),
    costPerGb: num(rec.costPerGb, DEFAULT_SETTINGS.costPerGb),
    anomalySigma: num(rec.anomalySigma, DEFAULT_SETTINGS.anomalySigma),
    monitorFilter:
      typeof rec.monitorFilter === 'string' && rec.monitorFilter.length > 0
        ? rec.monitorFilter
        : DEFAULT_SETTINGS.monitorFilter,
  };
}

/**
 * localStorage-backed settings hook. SSR-safe: renders DEFAULT_SETTINGS first,
 * hydrates from `nfm-settings` in an effect. setSetting merges one field and
 * persists immediately; reset restores defaults and clears the stored value.
 */
export function useSettings(): {
  settings: AppSettings;
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  reset: () => void;
} {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(parseSettings(localStorage.getItem(SETTINGS_KEY)));
  }, []);

  const setSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    if (typeof window !== 'undefined') localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  };

  const reset = () => {
    setSettings(DEFAULT_SETTINGS);
    if (typeof window !== 'undefined') localStorage.removeItem(SETTINGS_KEY);
  };

  return { settings, setSetting, reset };
}
