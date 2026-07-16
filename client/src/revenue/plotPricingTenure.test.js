import { describe, expect, it } from 'vitest';
import {
  classifyPlotRevenueBucket,
  countPlotsByTenure,
  getAffordablePercentKey,
  getPlotAffordablePercentKey,
  getPlotPricingTenure,
} from './plotPricingTenure';
import { applyAffordableDiscount } from './revenueStrategyCalculations';
import { emptyRevenueStrategy } from './revenueStrategy';

describe('plotPricingTenure', () => {
  it('prefers Plot Master tenure over revenue category', () => {
    expect(
      getPlotPricingTenure({
        tenure: 'Affordable Rent',
        revenueCategory: 'Open Market',
      })
    ).toBe('Affordable Rent');
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
      revenueCategory: 'Open Market',
    };
    const discounted = applyAffordableDiscount(300000, getPlotPricingTenure(plot), strategy);
    expect(getPlotAffordablePercentKey(plot)).toBe('sharedOwnership');
    expect(discounted).toBe(216000);
    expect(classifyPlotRevenueBucket(plot)).toBe('affordable');
  });

  it('classifies revenue buckets from tenure', () => {
    expect(classifyPlotRevenueBucket({ tenure: 'Private' })).toBe('openMarket');
    expect(classifyPlotRevenueBucket({ tenure: 'Shared Ownership' })).toBe('affordable');
    expect(classifyPlotRevenueBucket({ tenure: 'Social Shared' })).toBe('affordable');
  });

  it('counts plots by tenure for diagnostics', () => {
    const counts = countPlotsByTenure([
      { tenure: 'Private' },
      { tenure: 'Open Market' },
      { tenure: 'Affordable Rent' },
      { tenure: 'Shared Ownership' },
      { tenure: 'Social Shared' },
      { revenueCategory: 'First Homes' },
    ]);

    expect(counts.openMarket).toBe(2);
    expect(counts.affordableRent).toBe(1);
    expect(counts.sharedOwnership).toBe(2);
    expect(counts.firstHomes).toBe(1);
  });
});
