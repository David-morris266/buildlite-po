/**
 * BL-019C.4 — Tenure display helpers for Revenue workspace.
 */

import { getPlotPricingTenure } from './plotPricingTenure';

export const ACCEPTED_TENURE_VALUES = [
  'Open Market',
  'Affordable Rent',
  'Shared Ownership',
  'First Homes',
  'Additionality',
  'Discount Market Sale',
  'Other',
];

const TENURE_ALIASES = {
  private: 'Open Market',
  market: 'Open Market',
  dms: 'Discount Market Sale',
  'discount market sale': 'Discount Market Sale',
  'affordable housing': 'Affordable Rent',
  'social rent': 'Affordable Rent',
  'social shared': 'Shared Ownership',
};

export function normalizeTenureLabel(tenure = '') {
  const raw = String(tenure || '').trim();
  if (!raw) return 'Open Market';

  const lower = raw.toLowerCase();
  if (TENURE_ALIASES[lower]) return TENURE_ALIASES[lower];

  const matched = ACCEPTED_TENURE_VALUES.find(
    (value) => value.toLowerCase() === lower
  );
  if (matched) return matched;

  if (lower.includes('shared ownership')) return 'Shared Ownership';
  if (lower.includes('first homes')) return 'First Homes';
  if (lower.includes('additionality')) return 'Additionality';
  if (lower.includes('affordable rent') || lower.includes('social rent')) return 'Affordable Rent';
  if (lower.includes('discount market')) return 'Discount Market Sale';
  if (lower === 'other') return 'Other';
  if (lower.includes('open market')) return 'Open Market';

  return raw;
}

export function getPlotTenureLabel(plot = {}) {
  return normalizeTenureLabel(getPlotPricingTenure(plot));
}

export function getTenureBadgeTone(tenure = '') {
  const label = normalizeTenureLabel(tenure).toLowerCase();

  if (label === 'open market') return 'open-market';
  if (label === 'affordable rent') return 'affordable-rent';
  if (label === 'shared ownership') return 'shared-ownership';
  if (label === 'first homes') return 'first-homes';
  if (label === 'additionality') return 'additionality';
  if (label === 'discount market sale') return 'discount-market-sale';
  return 'other';
}
