import { describe, expect, it } from 'vitest';
import { buildRevenueExceptions, groupRevenueExceptions } from './plotRevenueEngine';

describe('Revenue exception relevance and grouping', () => {
  it.each([
    { revenueStatus: 'Completed', sellingPrice: 250000, pricingRequiresArea: false },
    { revenueStatus: 'Exchanged', sellingPrice: 250000, pricingRequiresArea: false },
    { revenueStatus: 'Available', effectivePrice: 250000, revenueSource: 'Manual Value', pricingRequiresArea: false },
    { revenueStatus: 'Reserved', effectivePrice: 250000, revenueSource: 'Plot Override', pricingRequiresArea: false },
  ])('does not raise missing NIA for an area-independent authority', (plot) => {
    expect(buildRevenueExceptions([{ id: 'p1', plotNumber: '1', ...plot }]).some((item) => item.type === 'missingNia')).toBe(false);
  });

  it('retains missing NIA for area pricing and groups affected plot evidence', () => {
    const exceptions = buildRevenueExceptions([
      { id: 'p1', plotNumber: '1', revenueStatus: 'Available', pricingRequiresArea: true },
      { id: 'p2', plotNumber: '2', revenueStatus: 'Available', pricingRequiresArea: true },
    ]);
    const nia = groupRevenueExceptions(exceptions).find((group) => group.type === 'missingNia');
    expect(nia).toMatchObject({ count: 2, plotNumbers: ['1', '2'] });
  });

  it('does not report missing price or NIA for a Reserved selling-price authority', () => {
    const exceptions = buildRevenueExceptions([{
      id: 'reserved-7', plotNumber: '7', revenueStatus: 'Reserved',
      sellingPrice: 330000, forecastSellingPrice: 330000, effectivePrice: 330000,
      pricingRequiresArea: false,
    }]);
    expect(exceptions).toEqual([]);
  });
});
