// Smoke tests for the NHI striped band (monitor detail overview).
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import ko from '@/lib/i18n/translations/ko.json';
import NhiBand from './NhiBand';

// No vitest globals in this repo, so testing-library's auto-cleanup does not
// register itself — clean the DOM between tests explicitly.
afterEach(cleanup);

function wrap(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe('NhiBand', () => {
  it('renders one segment per point and a dual-encoded text legend', () => {
    wrap(
      <NhiBand
        points={[
          { t: '2026-07-10T00:00:00Z', v: 0 },
          { t: '2026-07-10T00:05:00Z', v: 1 },
          { t: '2026-07-10T00:10:00Z', v: 0 },
        ]}
      />,
    );
    const root = screen.getByTestId('nhi-band');
    // Legend labels are text, not color alone.
    expect(within(root).getByText(ko['monitors.nhiHealthy'])).toBeTruthy();
    expect(within(root).getByText(ko['monitors.nhiDegraded'])).toBeTruthy();
    // One hatched segment per point, each with a time+status tooltip.
    const band = within(root).getByRole('img');
    expect(band.children.length).toBe(3);
    expect(band.children[1].getAttribute('title')).toContain(ko['monitors.nhiDegraded']);
    expect(band.children[0].getAttribute('title')).toContain(ko['monitors.nhiHealthy']);
  });

  it('shows the empty state without points', () => {
    wrap(<NhiBand points={[]} />);
    expect(within(screen.getByTestId('nhi-band')).getByText(ko['chart.empty'])).toBeTruthy();
  });
});
