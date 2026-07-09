// collector/src/categories.ts
import type { DestCategory } from './types.js';
export const CORE: DestCategory[] = ['INTRA_AZ', 'INTER_AZ', 'INTER_VPC'];
export const EXTENDED: DestCategory[] = ['UNCLASSIFIED', 'AMAZON_S3', 'AMAZON_DYNAMODB', 'INTER_REGION'];
export function categoriesForCycle(cycle: number, everyN = 3): DestCategory[] {
  return everyN > 0 && cycle % everyN === 0 ? [...CORE, ...EXTENDED] : [...CORE];
}
