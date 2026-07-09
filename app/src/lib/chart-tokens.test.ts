// app/src/lib/chart-tokens.test.ts
import { it, expect } from 'vitest';
import { CATEGORY_COLORS, CATEGORY_ORDER, SERIES_COLORS, STATUS } from './chart-tokens';
import type { DestCategory } from './types';

it('every DestCategory has a color', () => {
  const cats: DestCategory[] = ['INTRA_AZ','INTER_AZ','INTER_VPC','UNCLASSIFIED','AMAZON_S3','AMAZON_DYNAMODB','INTER_REGION'];
  for (const c of cats) expect(CATEGORY_COLORS[c]).toMatch(/^#[0-9A-Fa-f]{6}$/);
  expect(CATEGORY_ORDER).toHaveLength(7);
});
it('status + 8 series colors', () => {
  expect(STATUS.ok).toMatch(/^#/); expect(STATUS.warn).toMatch(/^#/); expect(STATUS.danger).toMatch(/^#/);
  expect(SERIES_COLORS.length).toBeGreaterThanOrEqual(8);
});
