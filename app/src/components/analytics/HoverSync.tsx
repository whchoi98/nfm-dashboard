'use client';
// Shared hover context for the insights hub: multiple timeseries widgets read
// the same activeT (hovered timestamp key) to align their crosshairs. Using
// the hook outside a provider is safe — it returns a no-op default.
import { createContext, useContext, useMemo, useState } from 'react';

type HoverSyncValue = {
  activeT: string | null;
  setActiveT: (t: string | null) => void;
};

const DEFAULT: HoverSyncValue = { activeT: null, setActiveT: () => {} };
const HoverSyncContext = createContext<HoverSyncValue>(DEFAULT);

export function HoverSyncProvider({ children }: { children: React.ReactNode }) {
  const [activeT, setActiveT] = useState<string | null>(null);
  const value = useMemo(() => ({ activeT, setActiveT }), [activeT]);
  return <HoverSyncContext.Provider value={value}>{children}</HoverSyncContext.Provider>;
}

export function useHoverSync(): HoverSyncValue {
  return useContext(HoverSyncContext);
}
