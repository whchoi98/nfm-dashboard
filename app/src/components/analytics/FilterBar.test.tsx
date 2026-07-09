// Render smoke tests for FilterBar (Phase 4 Task 1): sticky global filter row
// with range/cluster/namespace/category/metric selects wired to setFilter.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import ko from '@/lib/i18n/translations/ko.json';
import { DEFAULT_FILTERS } from '@/lib/analytics/filters';
import FilterBar from './FilterBar';

// No vitest globals in this repo, so testing-library's auto-cleanup does not
// register itself — clean the DOM between tests explicitly.
afterEach(cleanup);

function wrap(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe('FilterBar', () => {
  it('renders the bar with the 5 filter selects', () => {
    wrap(
      <FilterBar
        filters={DEFAULT_FILTERS}
        setFilter={vi.fn()}
        clusters={['eks-a']}
        namespaces={['default']}
      />,
    );
    const root = screen.getByTestId('filter-bar');
    expect(within(root).getAllByRole('combobox')).toHaveLength(5);
    // Category select: 'all' + the 7 fixed destination categories.
    const category = within(root).getByLabelText(ko['filter.category']) as HTMLSelectElement;
    expect(category.options).toHaveLength(8);
    expect(category.value).toBe('all');
  });

  it('calls setFilter with the right key/value when a select changes', () => {
    const setFilter = vi.fn();
    wrap(
      <FilterBar
        filters={DEFAULT_FILTERS}
        setFilter={setFilter}
        clusters={['eks-a']}
        namespaces={['default']}
      />,
    );
    fireEvent.change(screen.getByLabelText(ko['filter.range']), { target: { value: '24h' } });
    expect(setFilter).toHaveBeenCalledWith('range', '24h');
    fireEvent.change(screen.getByLabelText(ko['filter.cluster']), { target: { value: 'eks-a' } });
    expect(setFilter).toHaveBeenCalledWith('cluster', 'eks-a');
    fireEvent.change(screen.getByLabelText(ko['filter.metric']), { target: { value: 'TIMEOUTS' } });
    expect(setFilter).toHaveBeenCalledWith('metric', 'TIMEOUTS');
  });

  it('renders without optional clusters/namespaces (only "all" offered)', () => {
    wrap(<FilterBar filters={DEFAULT_FILTERS} setFilter={vi.fn()} />);
    const cluster = screen.getByLabelText(ko['filter.cluster']) as HTMLSelectElement;
    const namespace = screen.getByLabelText(ko['filter.namespace']) as HTMLSelectElement;
    expect(cluster.options).toHaveLength(1);
    expect(namespace.options).toHaveLength(1);
  });
});
