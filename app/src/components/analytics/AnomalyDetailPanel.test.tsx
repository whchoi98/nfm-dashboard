import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import AnomalyDetailPanel from './AnomalyDetailPanel';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { Anomaly } from '@/lib/analytics/anomalies';

// No vitest globals in this repo, so testing-library's auto-cleanup does not
// run between tests — clean up explicitly (matches FacetRail/FilterBar tests).
afterEach(cleanup);

const retrans: Anomaly = {
  key: 'ecommerce/cart-svc', label: 'ecommerce/cart-svc', kind: 'retrans',
  metric: 'RETRANSMISSIONS', value: 12.3, baseline: 10, severity: 'critical',
  detail: 'retrans 12.3/GB > 10/GB',
};

const renderPanel = (anomaly: Anomaly, onClose = vi.fn()) => {
  render(
    <LanguageProvider>
      <AnomalyDetailPanel anomaly={anomaly} onClose={onClose} />
    </LanguageProvider>,
  );
  return onClose;
};

describe('AnomalyDetailPanel', () => {
  it('renders the entity, metric, current-vs-baseline, overshoot and detail', () => {
    renderPanel(retrans);
    expect(screen.getByTestId('anomaly-detail')).toBeTruthy();
    expect(screen.getByText('ecommerce/cart-svc')).toBeTruthy();
    // Metric renders TRANSLATED (ko). Scope to the metric row's value <dd> via
    // its "지표" <dt> label — the kind badge also renders "재전송"
    // (anomalies.kind.retrans), so a bare getByText('재전송') is ambiguous.
    expect(screen.getByText('지표').nextElementSibling?.textContent).toBe('재전송'); // metric.RETRANSMISSIONS (ko)
    expect(screen.getByText('12.3/GB')).toBeTruthy(); // current
    expect(screen.getByText('10.0/GB')).toBeTruthy(); // baseline
    expect(screen.getByText('×1.2')).toBeTruthy();    // overshoot value/baseline
    expect(screen.getByText('retrans 12.3/GB > 10/GB')).toBeTruthy();
  });

  it('builds deep-link hrefs to topology (focus) and network (namespace)', () => {
    renderPanel(retrans);
    expect(screen.getByTestId('anomaly-link-topology').getAttribute('href')).toBe(
      '/topology?focus=ecommerce%2Fcart-svc');
    expect(screen.getByTestId('anomaly-link-network').getAttribute('href')).toBe(
      '/network?ns=ecommerce');
  });

  it('calls onClose on the close button and on Escape', () => {
    const onClose = renderPanel(retrans);
    fireEvent.click(screen.getByTestId('anomaly-detail-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
