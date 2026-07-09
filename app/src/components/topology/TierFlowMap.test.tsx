// Render smoke tests for TierFlowMap (Task 4): React Flow icon tiered
// topology map built from buildTiers(topology, level), with drilldown.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import ko from '@/lib/i18n/translations/ko.json';
import type { TopologySnapshot } from '@/lib/types';
import TierFlowMap from './TierFlowMap';

// No vitest globals in this repo, so testing-library's auto-cleanup does not
// register itself — clean the DOM between tests explicitly.
afterEach(cleanup);

// reactflow needs ResizeObserver, which jsdom does not implement — install a
// no-op polyfill so <ReactFlow> can mount (it renders at 0×0 and may warn
// about container dimensions; that is fine for a smoke test).
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
  }
});

function wrap(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

const topo: TopologySnapshot = {
  generatedAt: '2026-07-08T00:00:00Z',
  nodes: [
    { id: 'pod:shop/api-7f9c4-abc12', kind: 'pod', label: 'api-7f9c4-abc12', namespace: 'shop', cluster: 'nfm-eks' },
    { id: 'pod:shop/db-0', kind: 'pod', label: 'db-0', namespace: 'shop', cluster: 'nfm-eks' },
    { id: 'pod:mon/grafana-5d8f7-xy9z8', kind: 'pod', label: 'grafana-5d8f7-xy9z8', namespace: 'mon', cluster: 'nfm-eks' },
    { id: 'node:i-0abc', kind: 'node', label: 'i-0abc', az: 'ap-northeast-2a' },
    { id: 'vpc:vpc-1', kind: 'vpc', label: 'vpc-1' },
  ],
  edges: [
    { id: 'e1', source: 'pod:shop/api-7f9c4-abc12', target: 'pod:mon/grafana-5d8f7-xy9z8', metrics: { DATA_TRANSFERRED: 1_000_000 }, category: 'INTER_AZ' },
    { id: 'e2', source: 'pod:shop/api-7f9c4-abc12', target: 'pod:shop/db-0', metrics: { DATA_TRANSFERRED: 50_000 }, category: 'INTRA_AZ' },
    { id: 'e3', source: 'pod:mon/grafana-5d8f7-xy9z8', target: 'node:i-0abc', metrics: { DATA_TRANSFERRED: 2_500 }, category: 'INTRA_AZ' },
    { id: 'e4', source: 'node:i-0abc', target: 'vpc:vpc-1', metrics: { DATA_TRANSFERRED: 700 }, category: 'INTER_VPC' },
  ],
};

describe('TierFlowMap', () => {
  it('renders the map container with tier nodes at namespace level', () => {
    wrap(<TierFlowMap topology={topo} level="namespace" />);
    const root = screen.getByTestId('tier-flow-map');
    expect(root).toBeTruthy();
    // Aggregated namespace nodes render icon + label (dual-encoded).
    expect(screen.getAllByTestId('resicon-namespace').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('shop')).toBeTruthy();
    expect(screen.getByText('mon')).toBeTruthy();
  });

  it('shows the empty state for an empty topology, keeping the testid', () => {
    wrap(
      <TierFlowMap
        topology={{ generatedAt: '', nodes: [], edges: [] }}
        level="namespace"
      />,
    );
    expect(screen.getByTestId('tier-flow-map')).toBeTruthy();
    expect(screen.getByText(ko['topology.empty'])).toBeTruthy();
  });
});
