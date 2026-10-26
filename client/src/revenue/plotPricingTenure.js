/**
 * BL-019C.3 — Plot tenure drives revenue pricing (Plot Master is source of truth).
 */

export const REVENUE_TENURE_BY_CODE = Object.freeze({
  OPEN_MARKET: 'Open Market',
  AFFORDABLE_RENT: 'Affordable Rent',
  SHARED_OWNERSHIP: 'Shared Ownership',
  FIRST_HOMES: 'First Homes',
  ADDITIONALITY: 'Additionality',
  DISCOUNT_MARKET_SALE: 'Discount Market Sale',
  OTHER: 'Other',
});

export function getPlotRevenueTenureAuthority(plot = {}) {
  const sourceTenureCode = plot.tenureCode ?? null;
  const normalizedTenureCode = String(sourceTenureCode || '').trim().toUpperCase();
  const tenure = REVENUE_TENURE_BY_CODE[normalizedTenureCode] || null;
  return {
    resolved: Boolean(tenure),
    tenure,
    tenureCode: sourceTenureCode,
    normalizedTenureCode,
    sourceTenure: String(plot.tenure || '').trim(),
    authoritySource: tenure ? 'reviewed_tenure_code' : 'unresolved',
  };
}

export function getPlotPricingTenure(plot = {}) {
  return getPlotRevenueTenureAuthority(plot).tenure || '';
}

export function getAffordablePercentKey(tenureOrCategory = '') {
  const value = String(tenureOrCategory || '').trim().toLowerCase();
  if (!value || value === 'open market' || value === 'private' || value === 'market') {
    return null;
  }
  if (value.includes('shared ownership') || value === 'social shared') return 'sharedOwnership';
  if (value.includes('first homes')) return 'firstHomes';
  if (value.includes('additionality')) return 'additionality';
  if (value.includes('discount market') || value === 'dms') return 'discountMarketSale';
  if (value.includes('affordable rent') || value.includes('social rent')) return 'affordableRent';
  if (value.includes('affordable housing')) return 'affordableRent';
  if (value === 'other') return 'other';
  if (value.includes('affordable')) return 'affordableRent';
  return null;
}

export function getPlotAffordablePercentKey(plot = {}) {
  return getAffordablePercentKey(getPlotPricingTenure(plot));
}

export function classifyPlotRevenueBucket(plot = {}) {
  const tenure = getPlotPricingTenure(plot);
  const key = getAffordablePercentKey(tenure);
  if (key === 'other') return 'other';
  if (key) return 'affordable';

  const normalized = String(tenure || '').trim().toLowerCase();
  if (normalized === 'open market') {
    return 'openMarket';
  }
  return 'unresolved';
}

export const TENURE_DIAGNOSTIC_LABELS = [
  { key: 'openMarket', label: 'Private', match: (tenure) => {
    const value = tenure.toLowerCase();
    return value === 'open market';
  }},
  { key: 'affordableRent', label: 'Affordable Rent', match: (tenure) => getAffordablePercentKey(tenure) === 'affordableRent' },
  { key: 'sharedOwnership', label: 'Shared Ownership', match: (tenure) => getAffordablePercentKey(tenure) === 'sharedOwnership' },
  { key: 'firstHomes', label: 'First Homes', match: (tenure) => getAffordablePercentKey(tenure) === 'firstHomes' },
  { key: 'additionality', label: 'Additionality', match: (tenure) => getAffordablePercentKey(tenure) === 'additionality' },
  { key: 'discountMarketSale', label: 'Discount Market Sale', match: (tenure) => getAffordablePercentKey(tenure) === 'discountMarketSale' },
  { key: 'other', label: 'Other', match: (tenure) => getAffordablePercentKey(tenure) === 'other' },
  { key: 'unresolved', label: 'Unreviewed', match: (tenure) => !tenure },
];

export function countPlotsByTenure(plots = []) {
  const counts = Object.fromEntries(TENURE_DIAGNOSTIC_LABELS.map((item) => [item.key, 0]));

  for (const plot of plots) {
    const tenure = getPlotPricingTenure(plot);
    const label = TENURE_DIAGNOSTIC_LABELS.find((item) => item.match(tenure));
    if (label) counts[label.key] += 1;
  }

  return counts;
}
