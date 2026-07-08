// Chart color tokens (mirrors tailwind.config.ts — keep in sync).
// Categorical hues are assigned in FIXED order and never cycled (dataviz rule).
// The pastel palette passes CVD separation (ΔE≥32) but sits below the 3:1 light-mode
// contrast bar, so every chart ships legends, direct value labels or tooltips, and
// tables/side panels as the mandated relief.
export const TOKENS = {
  ink: '#1C1C1C',
  surface: '#F7F9FB',
  accentBlue: '#E3F5FF',
  accentLav: '#E5ECF6',
  accentMint: '#BAEDBD',
  chartBlue: '#A8C5DA',
  chartViolet: '#95A4FC',
  chartSky: '#B1E3FF',
} as const;

/** Fixed categorical series order for multi-series charts. */
export const SERIES_COLORS = [
  TOKENS.chartViolet,
  TOKENS.chartBlue,
  TOKENS.accentMint,
  TOKENS.chartSky,
] as const;

export type DestCategory = 'INTRA_AZ' | 'INTER_AZ' | 'INTER_VPC';

/** Fixed color per destination category — identical on every page. */
export const CATEGORY_COLORS: Record<DestCategory, string> = {
  INTRA_AZ: TOKENS.chartViolet,
  INTER_AZ: TOKENS.chartBlue,
  INTER_VPC: TOKENS.accentMint,
};

export const CATEGORY_ORDER: DestCategory[] = ['INTRA_AZ', 'INTER_AZ', 'INTER_VPC'];
