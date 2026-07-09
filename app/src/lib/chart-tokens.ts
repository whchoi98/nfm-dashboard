// Chart color tokens (mirrors tailwind.config.ts — keep in sync).
// Categorical hues are assigned in FIXED order and never cycled (dataviz rule).
// The pastel palette passes CVD separation (ΔE≥32) but sits below the 3:1 light-mode
// contrast bar, so every chart ships legends, direct value labels or tooltips, and
// tables/side panels as the mandated relief.
import type { DestCategory } from './types';

export type { DestCategory } from './types';

export const TOKENS = {
  ink: '#1C1C1C',
  surface: '#F7F9FB',
  accentBlue: '#E3F5FF',
  accentLav: '#E5ECF6',
  accentMint: '#BAEDBD',
  chartBlue: '#A8C5DA',
  chartViolet: '#95A4FC',
  chartSky: '#B1E3FF',
  chartAmber: '#FFE5B4',
  chartRose: '#FFD6E0',
  chartTeal: '#A1E3CB',
  chartGrey: '#C9D0DA',
} as const;

/** Fixed categorical series order for multi-series charts. */
export const SERIES_COLORS = [
  TOKENS.chartViolet,
  TOKENS.chartBlue,
  TOKENS.accentMint,
  TOKENS.chartSky,
  TOKENS.chartAmber,
  TOKENS.chartRose,
  TOKENS.chartTeal,
  TOKENS.chartGrey,
] as const;

/** Fixed color per destination category — identical on every page. */
export const CATEGORY_COLORS: Record<DestCategory, string> = {
  INTRA_AZ: TOKENS.chartViolet,
  INTER_AZ: TOKENS.chartBlue,
  INTER_VPC: TOKENS.accentMint,
  UNCLASSIFIED: TOKENS.chartGrey,
  AMAZON_S3: TOKENS.chartAmber,
  AMAZON_DYNAMODB: TOKENS.chartSky,
  INTER_REGION: TOKENS.chartRose,
};

export const CATEGORY_ORDER: DestCategory[] = [
  'INTRA_AZ',
  'INTER_AZ',
  'INTER_VPC',
  'UNCLASSIFIED',
  'AMAZON_S3',
  'AMAZON_DYNAMODB',
  'INTER_REGION',
];

/** Status colors (pastel) — always dual-encoded with an icon or text label, never color alone. */
export const STATUS = {
  ok: TOKENS.accentMint,
  warn: '#FFE5B4',
  danger: '#FFB4B4',
} as const;
