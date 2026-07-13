// Selection wiring: activating a row opens the shared AnomalyDetailPanel
// (Task 1) with the deep-link href built from the anomaly's label, and
// Escape (handled inside the panel) closes it again. The selection is held
// by composite id and the shown anomaly is re-derived from the LIVE polled
// array each render, so the panel follows polls and auto-closes when the
// anomaly resolves out of the list.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import AnomaliesPage from './page';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { Anomaly } from '@/lib/analytics/anomalies';

// No vitest globals in this repo, so testing-library's auto-cleanup does not
// run between tests — clean up explicitly (matches FacetRail/AnomalyDetailPanel tests).
afterEach(cleanup);

const anomalies: Anomaly[] = [
  { key: 'ecommerce/cart-svc', label: 'ecommerce/cart-svc', kind: 'retrans',
    metric: 'RETRANSMISSIONS', value: 12.3, baseline: 10, severity: 'critical',
    detail: 'retrans 12.3/GB > 10/GB' },
];

// usePolling is the page's only data source — stub it to read a mutable
// module-scope value so a test can vary what the "poll" returns between the
// initial render and a rerender (simulating the 30s refresh).
let pollData: { anomalies: Anomaly[] } = { anomalies };
vi.mock('@/lib/use-polling', () => ({
  usePolling: () => ({ data: pollData, error: null, loading: false }),
}));
// Settings hook provides thresholds/σ read into the query string.
vi.mock('@/lib/settings', () => ({
  useSettings: () => ({ settings: { defaultRange: '1h', retransThreshold: 10, timeoutThreshold: 5, anomalySigma: 3 } }),
}));

const renderPage = () =>
  render(<LanguageProvider><AnomaliesPage /></LanguageProvider>);

describe('AnomaliesPage selection', () => {
  it('opens the detail panel when a row is activated, and closes on Escape', async () => {
    pollData = { anomalies };
    renderPage();
    expect(screen.queryByTestId('anomaly-detail')).toBeNull();
    fireEvent.click(screen.getByTestId('anomaly-row-ecommerce/cart-svc'));
    expect(await screen.findByTestId('anomaly-detail')).toBeTruthy();
    expect(screen.getByTestId('anomaly-link-topology').getAttribute('href')).toBe(
      '/topology?focus=ecommerce%2Fcart-svc');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('anomaly-detail')).toBeNull());
  });

  it('auto-closes the panel when the selected anomaly resolves out of the live list', async () => {
    pollData = { anomalies };
    const { rerender } = renderPage();
    fireEvent.click(screen.getByTestId('anomaly-row-ecommerce/cart-svc'));
    expect(await screen.findByTestId('anomaly-detail')).toBeTruthy();

    // Next poll no longer contains the anomaly (it resolved). The shown
    // anomaly is re-derived from the live array, so the panel disappears.
    pollData = { anomalies: [] };
    rerender(<LanguageProvider><AnomaliesPage /></LanguageProvider>);
    await waitFor(() => expect(screen.queryByTestId('anomaly-detail')).toBeNull());
  });
});
