// Chart color tokens (mirrors tailwind.config.ts — keep in sync).
// CVD separation (ΔE≥32) was validated for the original 8 tokens; the expanded
// hues are not all ≥32 apart, so dual-encoding (legends, direct value labels or
// tooltips, tables/side panels) is the mandated relief. The pastel palette also
// sits below the 3:1 light-mode contrast bar, and some charts cycle SERIES_COLORS.
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
  // WI-only "unmonitored" categories (INTERNET/TRANSIT_GATEWAY/LOCAL_ZONE/AWS_SERVICE) —
  // same pastel register, hues picked away from the original 7 (coral vs amber/rose,
  // lilac vs violet/grey, sand vs amber, aqua vs mint/sky). Dual-encoding still applies.
  chartCoral: '#FFBFA0',
  chartLilac: '#D9C2F0',
  chartSand: '#E3CE8F',
  chartAqua: '#7AD1CD',
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
  INTERNET: TOKENS.chartCoral,
  TRANSIT_GATEWAY: TOKENS.chartLilac,
  LOCAL_ZONE: TOKENS.chartSand,
  AWS_SERVICE: TOKENS.chartAqua,
};

export const CATEGORY_ORDER: DestCategory[] = [
  'INTRA_AZ',
  'INTER_AZ',
  'INTER_VPC',
  'UNCLASSIFIED',
  'AMAZON_S3',
  'AMAZON_DYNAMODB',
  'INTER_REGION',
  // WI-only categories, in the console's grouping order.
  'INTERNET',
  'TRANSIT_GATEWAY',
  'LOCAL_ZONE',
  'AWS_SERVICE',
];

/** Status colors (pastel) — always dual-encoded with an icon or text label, never color alone. */
export const STATUS = {
  ok: TOKENS.accentMint,
  warn: TOKENS.chartAmber,
  danger: '#FFB4B4', // no matching TOKENS hue — status-only pastel red, defined here
} as const;
