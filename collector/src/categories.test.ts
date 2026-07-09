// collector/src/categories.test.ts
import { it, expect } from 'vitest';
import { categoriesForCycle, CORE, EXTENDED } from './categories.js';

it('core categories every cycle', () => {
  expect(categoriesForCycle(1, 3)).toEqual(CORE);
  expect(categoriesForCycle(2, 3)).toEqual(CORE);
});
it('extended categories appended every Nth cycle', () => {
  expect(categoriesForCycle(3, 3)).toEqual([...CORE, ...EXTENDED]);
  expect(categoriesForCycle(6, 3)).toEqual([...CORE, ...EXTENDED]);
});
it('CORE=3, EXTENDED=4, all 7 distinct', () => {
  expect(CORE).toHaveLength(3);
  expect(EXTENDED).toHaveLength(4);
  expect(new Set([...CORE, ...EXTENDED]).size).toBe(7);
});
