import { describe, it, expect } from 'vitest';
import { resolveFocusNode } from './focus-param';

const nodes = [
  { id: 'ecommerce/cart-svc', label: 'cart-svc' },
  { id: 'ecommerce/api-gw', label: 'api-gw' },
];

describe('resolveFocusNode', () => {
  it('matches by exact id (case-insensitive)', () => {
    expect(resolveFocusNode(nodes, 'ecommerce/cart-svc')?.id).toBe('ecommerce/cart-svc');
    expect(resolveFocusNode(nodes, 'ECOMMERCE/CART-SVC')?.id).toBe('ecommerce/cart-svc');
  });
  it('falls back to label substring', () => {
    expect(resolveFocusNode(nodes, 'api')?.id).toBe('ecommerce/api-gw');
  });
  it('returns null for empty or no match', () => {
    expect(resolveFocusNode(nodes, '')).toBeNull();
    expect(resolveFocusNode(nodes, 'nope')).toBeNull();
  });
});
