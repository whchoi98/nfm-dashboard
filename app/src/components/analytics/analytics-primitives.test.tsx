// Smoke tests for the Phase 4 Datadog primitives: Widget chrome, HoverSync
// context and the ranked Toplist.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import ko from '@/lib/i18n/translations/ko.json';
import Widget from './Widget';
import Toplist from './Toplist';
import { HoverSyncProvider, useHoverSync } from './HoverSync';

// No vitest globals in this repo, so testing-library's auto-cleanup does not
// register itself — clean the DOM between tests explicitly.
afterEach(cleanup);

function wrap(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe('Widget', () => {
  it('renders title + children under the slugged default testid', () => {
    wrap(
      <Widget title="Top Talkers (5m)">
        <p>widget body</p>
      </Widget>,
    );
    const root = screen.getByTestId('widget-top-talkers-5m');
    expect(within(root).getByRole('heading', { name: 'Top Talkers (5m)' })).toBeTruthy();
    expect(within(root).getByText('widget body')).toBeTruthy();
  });

  it('honors an explicit testId and renders the actions slot', () => {
    wrap(
      <Widget title="Traffic" testId="my-widget" actions={<button type="button">menu</button>}>
        body
      </Widget>,
    );
    const root = screen.getByTestId('my-widget');
    expect(within(root).getByRole('button', { name: 'menu' })).toBeTruthy();
    expect(screen.queryByTestId('widget-traffic')).toBeNull();
  });
});

describe('Toplist', () => {
  const rows = [
    { label: 'api-gateway', value: 200 },
    { label: 'web-frontend', value: 100, sub: 'default' },
    { label: 'db-writer', value: 50, status: 'danger' as const },
  ];

  it('renders one bar per row, widths proportional to value (max row widest)', () => {
    wrap(<Toplist rows={rows} />);
    const bars = screen.getAllByTestId('toplist-bar');
    expect(bars).toHaveLength(3);
    const widths = bars.map((b) => parseFloat((b as HTMLElement).style.width));
    expect(widths[0]).toBe(100); // max row spans full width
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
    expect(screen.getByText('web-frontend')).toBeTruthy();
    expect(screen.getByText('default')).toBeTruthy(); // sub text
  });

  it('formats values via valueFormatter (default String)', () => {
    wrap(<Toplist rows={rows} valueFormatter={(v) => `${v} GB`} />);
    expect(screen.getByText('200 GB')).toBeTruthy();
    cleanup();
    wrap(<Toplist rows={rows} />);
    expect(screen.getByText('200')).toBeTruthy();
  });

  it('a per-row display string overrides valueFormatter for that row only', () => {
    wrap(
      <Toplist
        rows={[
          { label: 'bytes-row', value: 500, display: '500 B' },
          { label: 'count-row', value: 3 },
        ]}
        valueFormatter={(v) => `${v}x`}
      />,
    );
    expect(screen.getByText('500 B')).toBeTruthy(); // display wins
    expect(screen.queryByText('500x')).toBeNull();
    expect(screen.getByText('3x')).toBeTruthy(); // others still use valueFormatter
  });

  it('dual-encodes status with an accessible text label', () => {
    wrap(<Toplist rows={rows} />);
    expect(screen.getByText(ko['toplist.status.danger'])).toBeTruthy();
  });

  it('rows become buttons when onSelect is given and report their label', () => {
    const onSelect = vi.fn();
    wrap(<Toplist rows={rows} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /api-gateway/ }));
    expect(onSelect).toHaveBeenCalledWith('api-gateway');
  });

  it('renders no buttons without onSelect', () => {
    wrap(<Toplist rows={rows} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('shows the translated empty state for []', () => {
    wrap(<Toplist rows={[]} />);
    const root = screen.getByTestId('toplist');
    expect(root.textContent).toBe(ko['toplist.empty']);
  });

  describe('sortable mode (Phase 16)', () => {
    it('renders no sort header when sortable is off (default)', () => {
      wrap(<Toplist rows={rows} />);
      expect(screen.queryByTestId('toplist-sort-label')).toBeNull();
      expect(screen.queryByTestId('toplist-sort-value')).toBeNull();
    });

    it('renders a Label/Value header with default i18n text when sortable', () => {
      wrap(<Toplist rows={rows} sortable />);
      expect(screen.getByTestId('toplist-sort-label').textContent).toContain(ko['common.name']);
      expect(screen.getByTestId('toplist-sort-value').textContent).toContain(ko['common.value']);
    });

    it('preserves the caller-provided (value-desc) order before any click', () => {
      wrap(<Toplist rows={rows} sortable testId="tl-order" />);
      const root = screen.getByTestId('tl-order');
      const labels = within(root)
        .getAllByText(/^(api-gateway|web-frontend|db-writer)$/)
        .map((el) => el.textContent);
      expect(labels).toEqual(['api-gateway', 'web-frontend', 'db-writer']);
    });

    it('clicking the value header sorts numerically (not lexically) and toggles direction', () => {
      // Values 200/100/50 sort lexically as "100" < "200" < "50" — a numeric
      // sort must NOT reproduce that order.
      wrap(<Toplist rows={rows} sortable testId="tl-value-sort" />);
      const root = screen.getByTestId('tl-value-sort');
      fireEvent.click(within(root).getByTestId('toplist-sort-value'));
      // First click on a fresh column → desc (unchanged: 200, 100, 50).
      let order = within(root)
        .getAllByText(/^(api-gateway|web-frontend|db-writer)$/)
        .map((el) => el.textContent);
      expect(order).toEqual(['api-gateway', 'web-frontend', 'db-writer']);

      fireEvent.click(within(root).getByTestId('toplist-sort-value'));
      order = within(root)
        .getAllByText(/^(api-gateway|web-frontend|db-writer)$/)
        .map((el) => el.textContent);
      expect(order).toEqual(['db-writer', 'web-frontend', 'api-gateway']);
    });

    it('clicking the label header sorts alphabetically', () => {
      wrap(<Toplist rows={rows} sortable testId="tl-label-sort" />);
      const root = screen.getByTestId('tl-label-sort');
      fireEvent.click(within(root).getByTestId('toplist-sort-label'));
      const order = within(root)
        .getAllByText(/^(api-gateway|web-frontend|db-writer)$/)
        .map((el) => el.textContent);
      // 'db-writer' < 'web-frontend' < 'api-gateway' is NOT alphabetical desc;
      // first click on a fresh column is desc: api-gateway, web-frontend, db-writer.
      expect(order).toEqual(['web-frontend', 'db-writer', 'api-gateway']);
    });

    it('bar widths stay proportional to the ALL-rows max after sorting (no rescale)', () => {
      wrap(<Toplist rows={rows} sortable testId="tl-bars" />);
      const root = screen.getByTestId('tl-bars');
      fireEvent.click(within(root).getByTestId('toplist-sort-label')); // reorder rows
      const bars = within(root)
        .getAllByTestId('toplist-bar')
        .map((b) => parseFloat((b as HTMLElement).style.width));
      // max value is still 200 (api-gateway) regardless of row order.
      expect(Math.max(...bars)).toBe(100);
    });

    it('accepts custom labelHeader/valueHeader text', () => {
      wrap(<Toplist rows={rows} sortable labelHeader="Port" valueHeader="Bytes" />);
      expect(screen.getByTestId('toplist-sort-label').textContent).toContain('Port');
      expect(screen.getByTestId('toplist-sort-value').textContent).toContain('Bytes');
    });
  });
});

describe('HoverSync', () => {
  function Probe({ id }: { id: string }) {
    const { activeT, setActiveT } = useHoverSync();
    return (
      <div>
        <span data-testid={`active-${id}`}>{activeT ?? 'none'}</span>
        <button type="button" data-testid={`set-${id}`} onClick={() => setActiveT('2026-07-08T12:00')}>
          set
        </button>
      </div>
    );
  }

  it('shares activeT across consumers inside a provider', () => {
    render(
      <HoverSyncProvider>
        <Probe id="a" />
        <Probe id="b" />
      </HoverSyncProvider>,
    );
    expect(screen.getByTestId('active-a').textContent).toBe('none');
    fireEvent.click(screen.getByTestId('set-a'));
    // Both consumers see the same hovered timestamp — crosshairs align.
    expect(screen.getByTestId('active-a').textContent).toBe('2026-07-08T12:00');
    expect(screen.getByTestId('active-b').textContent).toBe('2026-07-08T12:00');
  });

  it('returns the no-op default outside a provider without throwing', () => {
    render(<Probe id="solo" />);
    expect(screen.getByTestId('active-solo').textContent).toBe('none');
    fireEvent.click(screen.getByTestId('set-solo')); // no-op, must not throw
    expect(screen.getByTestId('active-solo').textContent).toBe('none');
  });
});
