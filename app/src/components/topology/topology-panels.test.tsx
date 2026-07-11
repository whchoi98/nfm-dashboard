// Render smoke tests for the Task 5 topology panels: AdjacencyMatrix
// (buildMatrix → Heatmap) and TopEdgesPanel (rankEdges list).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import ko from '@/lib/i18n/translations/ko.json';
import type { FlowEdge, TopologySnapshot } from '@/lib/types';
import AdjacencyMatrix from './AdjacencyMatrix';
import TopEdgesPanel from './TopEdgesPanel';

// No vitest globals in this repo, so testing-library's auto-cleanup does not
// register itself — clean the DOM between tests explicitly.
afterEach(cleanup);

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

const EMPTY_TOPO: TopologySnapshot = { generatedAt: '', nodes: [], edges: [] };

// Task 8 — edge-health matrix fixtures: raw FlowEdge[], not a TopologySnapshot.
const hf = (src: string, dst: string, metric: FlowEdge['metric'], value: number): FlowEdge => ({
  edgeHash: `${src}-${dst}`, monitor: 'm', metric, category: 'INTER_AZ', bucket: 'b', value, unit: 'x',
  a: { serviceName: src }, b: { serviceName: dst }, traversedConstructs: [],
});
const healthFlows: FlowEdge[] = [
  hf('svcA', 'svcB', 'DATA_TRANSFERRED', 1e9), hf('svcA', 'svcB', 'RETRANSMISSIONS', 100), // → danger
  hf('svcC', 'svcD', 'DATA_TRANSFERRED', 1e9), hf('svcC', 'svcD', 'RETRANSMISSIONS', 0),   // → ok
];

describe('AdjacencyMatrix', () => {
  it('renders the reused Heatmap from buildMatrix at namespace level', () => {
    wrap(<AdjacencyMatrix topology={topo} metric="DATA_TRANSFERRED" level="namespace" />);
    const root = screen.getByTestId('adjacency-matrix');
    expect(within(root).getByTestId('chart-heatmap')).toBeTruthy();
    // shop → mon aggregate (1 MB) is printed on its cell (dual-encoded).
    expect(within(root).getAllByText('1 MB').length).toBeGreaterThanOrEqual(1);
    // Row/col labels are the aggregated namespace entities.
    expect(within(root).getAllByText('shop').length).toBeGreaterThanOrEqual(1);
  });

  it('reports (row, col) via onCellSelect when a value cell is clicked', () => {
    const onCellSelect = vi.fn();
    wrap(
      <AdjacencyMatrix
        topology={topo}
        metric="DATA_TRANSFERRED"
        level="namespace"
        onCellSelect={onCellSelect}
      />,
    );
    fireEvent.click(screen.getByTitle('shop × mon: 1 MB'));
    expect(onCellSelect).toHaveBeenCalledWith('shop', 'mon');
  });

  it('shows the empty state for an empty topology, keeping the testid', () => {
    wrap(<AdjacencyMatrix topology={EMPTY_TOPO} metric="DATA_TRANSFERRED" level="namespace" />);
    const root = screen.getByTestId('adjacency-matrix');
    expect(within(root).getByText(ko['topology.empty'])).toBeTruthy();
  });

  // Task 8 — health mode: RED/AMBER/GREEN by connection health, not raw magnitude.
  it('health mode: colors cells by connection health (STATUS) via buildHealthMatrix, dual-encoded', () => {
    wrap(
      <AdjacencyMatrix
        topology={topo}
        metric="DATA_TRANSFERRED"
        level="namespace"
        mode="health"
        flows={healthFlows}
        healthLevel="service"
      />,
    );
    const root = screen.getByTestId('adjacency-matrix-health');
    // Dual-encoded: the per-GB rate is printed on the cell, never color alone.
    expect(within(root).getByText('100/GB')).toBeTruthy();
    expect(within(root).getByText('0/GB')).toBeTruthy();
    expect(within(root).getAllByText('svcA').length).toBeGreaterThanOrEqual(1);
    // Metric-mode's own testid/heatmap must not appear in health mode.
    expect(screen.queryByTestId('adjacency-matrix')).toBeNull();
  });

  it('health mode: empty flows shows the empty state, keeping the health testid', () => {
    wrap(
      <AdjacencyMatrix topology={topo} metric="DATA_TRANSFERRED" level="namespace" mode="health" flows={[]} />,
    );
    const root = screen.getByTestId('adjacency-matrix-health');
    expect(within(root).getByText(ko['topology.empty'])).toBeTruthy();
  });
});

describe('TopEdgesPanel', () => {
  it('renders ranked edges with formatted values and category chips', () => {
    wrap(<TopEdgesPanel topology={topo} metric="DATA_TRANSFERRED" />);
    const root = screen.getByTestId('top-edges-panel');
    // Top-ranked edge e1's metric value, formatted via formatMetricValue.
    expect(within(root).getByText('1 MB')).toBeTruthy();
    // Category chips render translated labels (two INTRA_AZ edges).
    expect(within(root).getAllByText(ko['category.INTRA_AZ']).length).toBe(2);
  });

  it('reports the edge id via onEdgeSelect when a row is clicked', () => {
    const onEdgeSelect = vi.fn();
    wrap(<TopEdgesPanel topology={topo} metric="DATA_TRANSFERRED" onEdgeSelect={onEdgeSelect} />);
    fireEvent.click(screen.getByText('1 MB')); // top-ranked row = e1
    expect(onEdgeSelect).toHaveBeenCalledWith('e1');
  });

  it('shows the empty state for an empty topology, keeping the testid', () => {
    wrap(<TopEdgesPanel topology={EMPTY_TOPO} metric="DATA_TRANSFERRED" />);
    const root = screen.getByTestId('top-edges-panel');
    expect(within(root).getByText(ko['topology.noEdges'])).toBeTruthy();
  });
});
