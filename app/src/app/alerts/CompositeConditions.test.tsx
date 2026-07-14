import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CompositeConditions } from './page';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { CompositeRow } from '@/lib/analytics/composite-conditions';

// No vitest globals / jest-dom in this repo — clean up explicitly and assert
// via plain DOM (.toBeTruthy() / .textContent), matching ResolverCompare /
// AnomalyDetailPanel.
afterEach(cleanup);

const wrap = (rows: CompositeRow[]) =>
  render(
    <LanguageProvider>
      <CompositeConditions rows={rows} />
    </LanguageProvider>,
  );

describe('CompositeConditions', () => {
  it('renders a flagged row with its condition chips and dual-encoded severity (text, not color alone)', () => {
    const rows: CompositeRow[] = [
      {
        label: 'ecommerce/cart-svc',
        conditions: ['retrans 25.0/GB', 'volume -80%'],
        severity: 'critical',
      },
    ];
    wrap(rows);
    const list = screen.getByTestId('alerts-composite-list');
    expect(list).toBeTruthy();
    expect(screen.getByText('ecommerce/cart-svc')).toBeTruthy();
    // Both condition chips render verbatim (data payload, not translated).
    expect(screen.getByText('retrans 25.0/GB')).toBeTruthy();
    expect(screen.getByText('volume -80%')).toBeTruthy();
    // Severity is dual-encoded: an always-visible text label accompanies the
    // color dot (ko default locale — alerts.severity.critical).
    expect(screen.getByText('심각')).toBeTruthy();
  });

  it('renders a warn-severity row with its own text label', () => {
    const rows: CompositeRow[] = [
      { label: 'ns/svc', conditions: ['retrans 12.0/GB', 'volume -55%'], severity: 'warn' },
    ];
    wrap(rows);
    expect(screen.getByText('경고')).toBeTruthy(); // alerts.severity.warn (ko)
  });

  it('renders the empty-state when rows is empty', () => {
    wrap([]);
    expect(screen.getByTestId('alerts-composite-empty')).toBeTruthy();
    expect(screen.getByText('복합 조건을 충족하는 엔터티가 없습니다')).toBeTruthy();
    expect(screen.queryByTestId('alerts-composite-list')).toBeNull();
  });
});
