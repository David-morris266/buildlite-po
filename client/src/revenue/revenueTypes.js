/**
 * BL-019A/B/C — Commercial Revenue Engine types (Doc 48).
 */

export const REVENUE_STREAMS = [
  { key: 'openMarketRevenue', label: 'Open Market Revenue' },
  { key: 'affordableHousingRevenue', label: 'Affordable Housing Revenue' },
  { key: 'otherRevenue', label: 'Other Revenue' },
];

export const EMPTY_DEVELOPMENT_REVENUE = {
  openMarketRevenue: 0,
  affordableHousingRevenue: 0,
  otherRevenue: 0,
};

export const REVENUE_SOURCES = [
  'Development Strategy',
  'House Type',
  'Plot Override',
  'Manual Value',
];

export const DEFAULT_REVENUE_SOURCE = 'House Type';

export const GARAGE_TYPES = ['None', 'Single', 'Double'];

export const SELLING_BASIS_OPTIONS = ['Auto', 'Manual'];

export const AFFORDABLE_HOUSING_TYPES = [
  { key: 'affordableRent', label: 'Affordable Rent' },
  { key: 'sharedOwnership', label: 'Shared Ownership' },
  { key: 'firstHomes', label: 'First Homes' },
  { key: 'additionality', label: 'Additionality' },
  { key: 'discountMarketSale', label: 'Discount Market Sale' },
  { key: 'other', label: 'Other' },
];

export const DEFAULT_AFFORDABLE_PERCENTAGES = {
  affordableRent: 58,
  sharedOwnership: 72,
  firstHomes: 70,
  additionality: 65,
  discountMarketSale: 70,
  other: 100,
};

export const DEFAULT_GARAGE_PREMIUMS = {
  none: 0,
  single: 12500,
  double: 22500,
};

export const FT2_TO_M2 = 0.092903;
