// Render smoke tests for the 7 recharts-based chart components (Task 8).
// jsdom gives ResponsiveContainer a 0x0 box, so assertions are limited to
// "mounts without throwing + root testid present" and the empty-state text.
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import ko from '@/lib/i18n/translations/ko.json';
import StatDelta from './StatDelta';
import Scatter from './Scatter';
import StreamGraph from './StreamGraph';
import Pareto from './Pareto';
import Treemap from './Treemap';
import Distribution from './Distribution';
import Gauge from './Gauge';

const EMPTY = ko['chart.empty'];

// No vitest globals in this repo, so testing-library's auto-cleanup does not
// register itself — clean the DOM between tests explicitly.
afterEach(cleanup);

function wrap(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe('StatDelta', () => {
  it('renders value, delta badge and sparkline', () => {
    wrap(
      <StatDelta
        label="Total Bytes"
        value="1.2 GB"
        unit="GB"
        deltaPct={12.5}
        trend="up"
        spark={[1, 3, 2, 5, 4]}
        status="ok"
      />,
    );
    const root = screen.getByTestId('stat-total-bytes');
    expect(within(root).getByText('1.2 GB')).toBeTruthy();
    expect(within(root).getByText(/12\.5/)).toBeTruthy();
  });

  it('renders without optional props (no spark, no delta)', () => {
    wrap(<StatDelta label="P95 RTT" value={42} />);
    expect(screen.getByTestId('stat-p95-rtt')).toBeTruthy();
  });
});

describe('Scatter', () => {
  it('renders with points', () => {
    wrap(
      <Scatter
        points={[
          { x: 1, y: 10, label: 'a' },
          { x: 2, y: 20, label: 'b' },
          { x: 3, y: 5 },
        ]}
        xLabel="RTT"
        yLabel="Bytes"
      />,
    );
    expect(screen.getByTestId('chart-scatter')).toBeTruthy();
  });

  it('shows empty state without points', () => {
    wrap(<Scatter points={[]} xLabel="RTT" yLabel="Bytes" />);
    expect(within(screen.getByTestId('chart-scatter')).getByText(EMPTY)).toBeTruthy();
  });
});

describe('StreamGraph', () => {
  it('renders stacked stream with keys', () => {
    wrap(
      <StreamGraph
        data={[
          { t: '2026-07-08T00:00:00Z', values: { INTRA_AZ: 1, INTER_AZ: 2 } },
          { t: '2026-07-08T01:00:00Z', values: { INTRA_AZ: 3, INTER_AZ: 1 } },
        ]}
        keys={['INTRA_AZ', 'INTER_AZ']}
      />,
    );
    expect(screen.getByTestId('chart-stream')).toBeTruthy();
  });

  it('shows empty state without data', () => {
    wrap(<StreamGraph data={[]} keys={['INTRA_AZ']} />);
    expect(within(screen.getByTestId('chart-stream')).getByText(EMPTY)).toBeTruthy();
  });
});

describe('Pareto', () => {
  it('renders bars + cumulative line', () => {
    wrap(
      <Pareto
        rows={[
          { label: 'A', value: 50, cumulativePct: 50 },
          { label: 'B', value: 30, cumulativePct: 80 },
          { label: 'C', value: 20, cumulativePct: 100 },
        ]}
      />,
    );
    expect(screen.getByTestId('chart-pareto')).toBeTruthy();
  });

  it('shows empty state without rows', () => {
    wrap(<Pareto rows={[]} />);
    expect(within(screen.getByTestId('chart-pareto')).getByText(EMPTY)).toBeTruthy();
  });
});

describe('Treemap', () => {
  it('renders with data', () => {
    wrap(
      <Treemap
        data={[
          { name: 'vpc-a', value: 400 },
          { name: 'vpc-b', value: 200 },
          { name: 'vpc-c', value: 100 },
        ]}
      />,
    );
    expect(screen.getByTestId('chart-treemap')).toBeTruthy();
  });

  it('shows empty state without data', () => {
    wrap(<Treemap data={[]} />);
    expect(within(screen.getByTestId('chart-treemap')).getByText(EMPTY)).toBeTruthy();
  });
});

describe('Distribution', () => {
  it('renders histogram bins', () => {
    wrap(
      <Distribution
        bins={[
          { bucketMs: 0, count: 12 },
          { bucketMs: 10, count: 30 },
          { bucketMs: 20, count: 7 },
        ]}
      />,
    );
    expect(screen.getByTestId('chart-distribution')).toBeTruthy();
  });

  it('shows empty state without bins', () => {
    wrap(<Distribution bins={[]} />);
    expect(within(screen.getByTestId('chart-distribution')).getByText(EMPTY)).toBeTruthy();
  });
});

describe('Gauge', () => {
  it('renders semicircle with center value', () => {
    wrap(<Gauge value={75} max={100} label="Health" status="warn" />);
    const root = screen.getByTestId('chart-gauge');
    expect(within(root).getByText('75')).toBeTruthy();
    expect(within(root).getByText('Health')).toBeTruthy();
  });

  it('shows empty state when max is zero', () => {
    wrap(<Gauge value={0} max={0} label="Health" />);
    expect(within(screen.getByTestId('chart-gauge')).getByText(EMPTY)).toBeTruthy();
  });
});
