import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, NAV_ITEMS } from './nav';

describe('nav', () => {
  it('NAV_ITEMS is the flattened groups with no dup hrefs and 17 items', () => {
    expect(NAV_ITEMS).toEqual(NAV_GROUPS.flatMap((g) => g.items));
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toContain('/');
    expect(hrefs).toContain('/settings');
    expect(hrefs).toContain('/history');
    expect(hrefs.length).toBe(17);
  });

  it('has exactly 6 groups with unique keys and labelKeys', () => {
    expect(NAV_GROUPS.length).toBe(6);
    const keys = NAV_GROUPS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    NAV_GROUPS.forEach((g) => {
      expect(g.labelKey).toBe(`nav.group.${g.key}`);
    });
  });
});
