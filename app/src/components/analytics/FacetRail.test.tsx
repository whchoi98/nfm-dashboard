// Smoke tests for the Phase 9 FacetRail: group/option rendering with counts,
// controlled radio selection via onChange, and the mobile collapse toggle.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import FacetRail, { type FacetGroup } from './FacetRail';

afterEach(cleanup);

const facets: FacetGroup[] = [
  {
    key: 'namespace',
    label: 'Namespace',
    options: [
      { value: 'all', label: 'All' },
      { value: 'default', label: 'default', count: 4 },
      { value: 'kube-system', label: 'kube-system', count: 12 },
    ],
  },
  {
    key: 'category',
    label: 'Category',
    options: [
      { value: 'all', label: 'All' },
      { value: 'INTRA_AZ', label: 'Intra-AZ' },
    ],
  },
];

function wrap(value: Record<string, string>, onChange = vi.fn()) {
  render(
    <LanguageProvider>
      <FacetRail facets={facets} value={value} onChange={onChange} />
    </LanguageProvider>,
  );
  return onChange;
}

describe('FacetRail', () => {
  it('renders every facet group with its options and counts', () => {
    wrap({ namespace: 'all', category: 'all' });
    const rail = screen.getByTestId('facet-rail');
    expect(within(rail).getByText('Namespace')).toBeTruthy();
    expect(within(rail).getByText('Category')).toBeTruthy();
    expect(within(rail).getByText('kube-system')).toBeTruthy();
    expect(within(rail).getByText('12')).toBeTruthy(); // option count
    expect(within(rail).getAllByRole('radio')).toHaveLength(5);
  });

  it('checks the radio matching value[key] per group', () => {
    wrap({ namespace: 'default', category: 'all' });
    const ns = screen.getByRole('radio', { name: /default/ }) as HTMLInputElement;
    expect(ns.checked).toBe(true);
    const cat = screen.getByRole('radio', { name: /Intra-AZ/ }) as HTMLInputElement;
    expect(cat.checked).toBe(false);
  });

  it('reports selections as onChange(key, value)', () => {
    const onChange = wrap({ namespace: 'all', category: 'all' });
    fireEvent.click(screen.getByRole('radio', { name: /kube-system/ }));
    expect(onChange).toHaveBeenCalledWith('namespace', 'kube-system');
    fireEvent.click(screen.getByRole('radio', { name: /Intra-AZ/ }));
    expect(onChange).toHaveBeenCalledWith('category', 'INTRA_AZ');
  });

  it('toggles the mobile panel via the aria-expanded button', () => {
    wrap({ namespace: 'all', category: 'all' });
    const toggle = screen.getByRole('button', { expanded: false });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
