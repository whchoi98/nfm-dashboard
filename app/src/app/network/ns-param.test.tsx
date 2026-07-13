import { describe, it, expect } from 'vitest';
import { initialFacetSel } from './ns-param';

describe('initialFacetSel', () => {
  it('presets the namespace facet from the ns param', () => {
    expect(initialFacetSel('ecommerce')).toEqual({ namespace: 'ecommerce', category: 'all' });
  });
  it('defaults to all when ns is absent or empty', () => {
    expect(initialFacetSel(null)).toEqual({ namespace: 'all', category: 'all' });
    expect(initialFacetSel('')).toEqual({ namespace: 'all', category: 'all' });
  });
});
