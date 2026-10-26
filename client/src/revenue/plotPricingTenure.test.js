import { describe, expect, it } from 'vitest';
import {
  classifyPlotRevenueBucket,
  countPlotsByTenure,
  getAffordablePercentKey,
  getPlotAffordablePercentKey,
  getPlotPricingTenure,
  getPlotRevenueTenureAuthority,
} from './plotPricingTenure';
import { applyAffordableDiscount } from './revenueStrategyCalculations';
import { emptyRevenueStrategy } from './revenueStrategy';

describe('plotPricingTenure', () => {
  it.each([
    ['OPEN_MARKET', 'Open Market'],
    ['AFFORDABLE_RENT', 'Affordable Rent'],
    ['SHARED_OWNERSHIP', 'Shared Ownership'],
    ['FIRST_HOMES', 'First Homes'],
    ['ADDITIONALITY', 'Additionality'],
    ['DISCOUNT_MARKET_SALE', 'Discount Market Sale'],
    ['OTHER', 'Other'],
  ])('resolves supported governed code %s', (tenureCode, tenure) => {
    expect(getPlotRevenueTenureAuthority({ tenureCode, tenure: 'Imported source' }))
      .toMatchObject({ resolved: true, tenure, tenureCode, authoritySource: 'reviewed_tenure_code' });
  });

  it.each([
    [{}, null],
    [{ tenure: '' }, null],
    [{ tenure: 'Private' }, null],
    [{ tenure: 'Unknown classification' }, null],
    [{ tenure: 'Open Market', tenureCode: 'UNREVIEWED' }, 'UNREVIEWED'],
    [{ tenure: 'Open Market', tenureCode: 'not-a-code' }, 'not-a-code'],
  ])('keeps missing, legacy and malformed authority unresolved: %j', (plot, originalCode) => {
    expect(getPlotRevenueTenureAuthority(plot)).toMatchObject({
      resolved: false,
      tenure: null,
      tenureCode: originalCode,
      sourceTenure: plot.tenure || '',
      authoritySource: 'unresolved',
    });
  });
  it('uses reviewed tenureCode while preserving conflicting imported tenure evidence', () => {
    expect(
      getPlotPricingTenure({
        tenure: 'Open Market',
        tenureCode: 'AFFORDABLE_RENT',
        revenueCategory: 'Open Market',
      })
    ).toBe('Affordable Rent');
    expect(getPlotRevenueTenureAuthority({ tenure: 'Social Rent', tenureCode: 'AFFORDABLE_RENT' }))
      .toMatchObject({ resolved: true, tenure: 'Affordable Rent', sourceTenure: 'Social Rent' });
  });

  it('maps tenure values to affordable strategy keys', () => {
    expect(getAffordablePercentKey('Shared Ownership')).toBe('sharedOwnership');
    expect(getAffordablePercentKey('Social Shared')).toBe('sharedOwnership');
    expect(getAffordablePercentKey('First Homes')).toBe('firstHomes');
    expect(getAffordablePercentKey('Discount Market Sale')).toBe('discountMarketSale');
    expect(getAffordablePercentKey('Private')).toBeNull();
    expect(getAffordablePercentKey('Open Market')).toBeNull();
    expect(getAffordablePercentKey('Other')).toBe('other');
  });

  it('applies affordable discount from plot tenure', () => {
    const strategy = emptyRevenueStrategy();
    const plot = {
      tenure: 'Affordable Rent',
      tenureCode: 'AFFORDABLE_RENT',
      revenueCategory: 'Open Market',
    };
    const discounted = applyAffordableDiscount(300000, getPlotPricingTenure(plot), strategy);
    expect(discounted).toBe(174000);
    expect(getPlotAffordablePercentKey(plot)).toBe('affordableRent');
  });

  it('treats Social Shared as Shared Ownership for affordable pricing keys', () => {
    const strategy = emptyRevenueStrategy();
    const plot = {
      tenure: 'Social Shared',
      tenureCode: 'SHARED_OWNERSHIP',
      revenueCategory: 'Open Market',
    };
    const discounted = applyAffordableDiscount(300000, getPlotPricingTenure(plot), strategy);
    expect(getPlotAffordablePercentKey(plot)).toBe('sharedOwnership');
    expect(discounted).toBe(216000);
    expect(classifyPlotRevenueBucket(plot)).toBe('affordable');
  });

  it('classifies revenue buckets from tenure', () => {
    expect(classifyPlotRevenueBucket({ tenureCode: 'OPEN_MARKET' })).toBe('openMarket');
    expect(classifyPlotRevenueBucket({ tenureCode: 'SHARED_OWNERSHIP' })).toBe('affordable');
    expect(classifyPlotRevenueBucket({ tenureCode: 'AFFORDABLE_RENT' })).toBe('affordable');
    expect(classifyPlotRevenueBucket({ tenure: 'Open Market', tenureCode: 'UNREVIEWED' })).toBe('unresolved');
  });

  it('counts plots by tenure for diagnostics', () => {
    const counts = countPlotsByTenure([
      { tenureCode: 'OPEN_MARKET' },
      { tenure: 'Private', tenureCode: 'OPEN_MARKET' },
      { tenureCode: 'AFFORDABLE_RENT' },
      { tenureCode: 'SHARED_OWNERSHIP' },
      { tenure: 'Social Shared', tenureCode: 'SHARED_OWNERSHIP' },
      { tenureCode: 'FIRST_HOMES' },
      { tenure: 'Open Market' },
      { tenureCode: 'MALFORMED' },
    ]);

    expect(counts.openMarket).toBe(2);
    expect(counts.affordableRent).toBe(1);
    expect(counts.sharedOwnership).toBe(2);
    expect(counts.firstHomes).toBe(1);
    expect(counts.unresolved).toBe(2);
  });
});
