'use client';
// Insights hub (Phase 4 Task 4a): sticky global FilterBar + tab strip over the
// active tab's bento grid of lens widgets (Datadog timeboard composition).
// Tabs live in the TABS registry so Task 4b can append latency/dependencies/dns
// entries without touching the shell; only the ACTIVE tab component mounts, so
// each lens is fetched on demand.
import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { usePolling } from '@/lib/use-polling';
import type { TopologySnapshot } from '@/lib/types';
import { useAnalyticsFilters } from '@/lib/hooks/useAnalyticsFilters';
import FilterBar from '@/components/analytics/FilterBar';
import { HoverSyncProvider } from '@/components/analytics/HoverSync';
import CostTab from './tabs/CostTab';
import ReliabilityTab from './tabs/ReliabilityTab';
import LatencyTab from './tabs/LatencyTab';
import DependenciesTab from './tabs/DependenciesTab';
import DnsTab from './tabs/DnsTab';
import EfficiencyTab from './tabs/EfficiencyTab';
import ScorecardTab from './tabs/ScorecardTab';
import MoversTab from './tabs/MoversTab';
import type { TabProps } from './tabs/shared';

interface TabDef {
  key: string;
  labelKey: string;
  Comp: React.ComponentType<TabProps>;
}

// Tab registry — only the ACTIVE tab component mounts, so each lens is
// fetched on demand.
const TABS: TabDef[] = [
  { key: 'cost', labelKey: 'insights.tab.cost', Comp: CostTab },
  { key: 'reliability', labelKey: 'insights.tab.reliability', Comp: ReliabilityTab },
  { key: 'latency', labelKey: 'insights.tab.latency', Comp: LatencyTab },
  { key: 'dependencies', labelKey: 'insights.tab.dependencies', Comp: DependenciesTab },
  { key: 'dns', labelKey: 'insights.tab.dns', Comp: DnsTab },
  { key: 'efficiency', labelKey: 'insights.tab.efficiency', Comp: EfficiencyTab },
  { key: 'scorecard', labelKey: 'insights.tab.scorecard', Comp: ScorecardTab },
  { key: 'movers', labelKey: 'insights.tab.movers', Comp: MoversTab },
];

export default function InsightsPage() {
  // useAnalyticsFilters (via useSearchParams) requires a Suspense boundary
  // above it during prerender — the fallback flashes at most one frame.
  return (
    <Suspense fallback={<HubFallback />}>
      <InsightsHub />
    </Suspense>
  );
}

function HubFallback() {
  const { t } = useLanguage();
  return (
    <p className="py-8 text-center text-sm text-ink/40 dark:text-white/40">{t('common.loading')}</p>
  );
}

function InsightsHub() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { filters, setFilter } = useAnalyticsFilters();

  // Active tab lives in ?tab= (default 'cost'); component state is the source
  // of truth after hydration, the URL is kept in sync for deep links.
  const urlTab = searchParams?.get('tab');
  const [tab, setTab] = useState<string>(
    TABS.some((x) => x.key === urlTab) ? (urlTab as string) : TABS[0].key,
  );

  // Namespace options for the FilterBar come from the topology snapshot
  // (cluster/metric are hidden — the hub does not wire them).
  const { data: topology } = usePolling<TopologySnapshot>('/api/topology');
  const namespaces = useMemo(() => {
    const set = new Set<string>();
    for (const n of topology?.nodes ?? []) if (n.namespace) set.add(n.namespace);
    return [...set].sort();
  }, [topology]);

  const selectTab = (key: string) => {
    setTab(key);
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    q.set('tab', key);
    router.replace(`${window.location.pathname}?${q.toString()}`, { scroll: false });
  };

  const active = TABS.find((x) => x.key === tab) ?? TABS[0];
  const ActiveComp = active.Comp;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t('nav.insights')}</h1>

      <FilterBar
        filters={filters}
        setFilter={setFilter}
        namespaces={namespaces}
        hide={['cluster', 'metric']}
      />

      <div className="flex flex-wrap gap-1" role="group" aria-label={t('nav.insights')}>
        {TABS.map(({ key, labelKey }) => {
          const isActive = key === active.key;
          return (
            <button
              key={key}
              type="button"
              data-testid={`insights-tab-${key}`}
              aria-pressed={isActive}
              onClick={() => selectTab(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-ink text-white dark:bg-white dark:text-ink'
                  : 'text-ink/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10'
              }`}
            >
              {t(labelKey)}
            </button>
          );
        })}
      </div>

      {/* Shared crosshair context for the active tab's timeseries widgets. */}
      <HoverSyncProvider>
        <ActiveComp filters={filters} />
      </HoverSyncProvider>
    </div>
  );
}
