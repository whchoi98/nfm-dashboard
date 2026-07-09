// Render smoke tests for the 5 custom chart components (Task 9).
// jsdom gives ResponsiveContainer a 0x0 box, so assertions are limited to
// "mounts without throwing + root testid present" and the empty-state text.
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import ko from '@/lib/i18n/translations/ko.json';
import Heatmap from './Heatmap';
import RegionArcMap from './RegionArcMap';
import Icicle from './Icicle';
import Swimlane from './Swimlane';
import Sankey from './Sankey';

const EMPTY = ko['chart.empty'];

// No vitest globals in this repo, so testing-library's auto-cleanup does not
// register itself — clean the DOM between tests explicitly.
afterEach(cleanup);

function wrap(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe('Heatmap', () => {
  it('renders grid with value labels on cells (dual-encoded)', () => {
    wrap(
      <Heatmap
        rows={['ap-northeast-2a', 'ap-northeast-2b']}
        cols={['ap-northeast-2a', 'ap-northeast-2b']}
        cells={[
          { row: 'ap-northeast-2a', col: 'ap-northeast-2b', value: 120 },
          { row: 'ap-northeast-2b', col: 'ap-northeast-2a', value: 40 },
          { row: 'ap-northeast-2a', col: 'ap-northeast-2a', value: 7 },
        ]}
        unit="GB"
      />,
    );
    const root = screen.getByTestId('chart-heatmap');
    // Values appear as text, not color alone.
    expect(within(root).getByText('120')).toBeTruthy();
    expect(within(root).getByText('40')).toBeTruthy();
    // Row/col labels present.
    expect(within(root).getAllByText('ap-northeast-2a').length).toBeGreaterThanOrEqual(2);
  });

  it('shows empty state without cells', () => {
    wrap(<Heatmap rows={['a']} cols={['x']} cells={[]} />);
    expect(within(screen.getByTestId('chart-heatmap')).getByText(EMPTY)).toBeTruthy();
  });
});

describe('RegionArcMap', () => {
  it('renders region nodes and arcs with total usd', () => {
    wrap(
      <RegionArcMap
        arcs={[
          { from: 'us-east-1', to: 'ap-northeast-2', bytes: 5_000_000_000, usd: 12.5 },
          { from: 'ap-northeast-2', to: 'eu-west-1', bytes: 800_000_000, usd: 3.1 },
          { from: 'us-east-1', to: 'us-east-1', bytes: 100, usd: 0 }, // self arc must not break
        ]}
      />,
    );
    const root = screen.getByTestId('chart-region-arc');
    expect(within(root).getByText('us-east-1')).toBeTruthy();
    expect(within(root).getByText('ap-northeast-2')).toBeTruthy();
    expect(within(root).getByText(/15\.6/)).toBeTruthy(); // total usd
  });

  it('shows empty state without arcs', () => {
    wrap(<RegionArcMap arcs={[]} />);
    expect(within(screen.getByTestId('chart-region-arc')).getByText(EMPTY)).toBeTruthy();
  });
});

describe('Icicle', () => {
  it('renders levels with labels for wide nodes', () => {
    wrap(
      <Icicle
        tree={{
          name: 'root',
          value: 100,
          children: [
            { name: 'pod-a', value: 60, children: [{ name: 'svc-x', value: 45 }] },
            { name: 'pod-b', value: 40 },
          ],
        }}
      />,
    );
    const root = screen.getByTestId('chart-icicle');
    expect(within(root).getByText('root')).toBeTruthy();
    expect(within(root).getByText('pod-a')).toBeTruthy();
  });

  it('shows empty state for a zero-value tree', () => {
    wrap(<Icicle tree={{ name: 'root', value: 0 }} />);
    expect(within(screen.getByTestId('chart-icicle')).getByText(EMPTY)).toBeTruthy();
  });
});

describe('Swimlane', () => {
  it('renders one band per monitor with legend', () => {
    wrap(
      <Swimlane
        lanes={[
          {
            monitor: 'monitor-a',
            points: [
              { t: '2026-07-08T00:00:00Z', healthy: true },
              { t: '2026-07-08T01:00:00Z', healthy: false },
              { t: '2026-07-08T02:00:00Z', healthy: true },
            ],
          },
          {
            monitor: 'monitor-b',
            points: [
              { t: '2026-07-08T00:00:00Z', healthy: true },
              { t: '2026-07-08T02:00:00Z', healthy: true },
            ],
          },
        ]}
      />,
    );
    const root = screen.getByTestId('chart-swimlane');
    expect(within(root).getByText('monitor-a')).toBeTruthy();
    expect(within(root).getByText('monitor-b')).toBeTruthy();
    // Legend + per-segment sr-only labels dual-encode status colors with text.
    expect(within(root).getAllByText(ko['status.healthy']).length).toBeGreaterThanOrEqual(1);
    expect(within(root).getAllByText(ko['status.degraded']).length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty state without lanes', () => {
    wrap(<Swimlane lanes={[]} />);
    expect(within(screen.getByTestId('chart-swimlane')).getByText(EMPTY)).toBeTruthy();
  });

  it('shows empty state when all lanes have no points', () => {
    wrap(<Swimlane lanes={[{ monitor: 'm', points: [] }]} />);
    expect(within(screen.getByTestId('chart-swimlane')).getByText(EMPTY)).toBeTruthy();
  });
});

describe('Sankey', () => {
  it('renders with a valid node/link flow', () => {
    wrap(
      <Sankey
        data={{
          nodes: [{ name: 'vpc-a' }, { name: 'tgw' }, { name: 'vpc-b' }],
          links: [
            { source: 0, target: 1, value: 10 },
            { source: 1, target: 2, value: 6 },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('chart-sankey')).toBeTruthy();
  });

  it('shows empty state (does NOT throw) with empty nodes/links', () => {
    wrap(<Sankey data={{ nodes: [], links: [] }} />);
    expect(within(screen.getByTestId('chart-sankey')).getByText(EMPTY)).toBeTruthy();
  });

  it('guards self-links: only-self-link data degrades to empty state, no throw', () => {
    wrap(
      <Sankey
        data={{
          nodes: [{ name: 'a' }, { name: 'b' }],
          links: [{ source: 0, target: 0, value: 5 }],
        }}
      />,
    );
    expect(within(screen.getByTestId('chart-sankey')).getByText(EMPTY)).toBeTruthy();
  });

  it('guards circular links without throwing', () => {
    wrap(
      <Sankey
        data={{
          nodes: [{ name: 'a' }, { name: 'b' }],
          links: [
            { source: 0, target: 1, value: 5 },
            { source: 1, target: 0, value: 3 },
          ],
        }}
      />,
    );
    // Cycle-forming link is dropped; the acyclic remainder still renders.
    expect(screen.getByTestId('chart-sankey')).toBeTruthy();
  });
});
