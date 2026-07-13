// Selection wiring: activating a row opens the shared AnomalyDetailPanel
// (Task 1) with the deep-link href built from the anomaly's label, and
// Escape (handled inside the panel) closes it again.
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

// usePolling is the page's only data source — stub it to a loaded state.
vi.mock('@/lib/use-polling', () => ({
  usePolling: () => ({ data: { anomalies }, error: null, loading: false }),
}));
// Settings hook provides thresholds/σ read into the query string.
vi.mock('@/lib/settings', () => ({
  useSettings: () => ({ settings: { defaultRange: '1h', retransThreshold: 10, timeoutThreshold: 5, anomalySigma: 3 } }),
}));

const renderPage = () =>
  render(<LanguageProvider><AnomaliesPage /></LanguageProvider>);

describe('AnomaliesPage selection', () => {
  it('opens the detail panel when a row is activated, and closes on Escape', async () => {
    renderPage();
    expect(screen.queryByTestId('anomaly-detail')).toBeNull();
    fireEvent.click(screen.getByTestId('anomaly-row-ecommerce/cart-svc'));
    expect(await screen.findByTestId('anomaly-detail')).toBeTruthy();
    expect(screen.getByTestId('anomaly-link-topology').getAttribute('href')).toBe(
      '/topology?focus=ecommerce%2Fcart-svc');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('anomaly-detail')).toBeNull());
  });
});
