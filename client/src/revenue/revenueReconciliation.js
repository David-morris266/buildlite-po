/**
 * BL-019C.5.6 — Live affordable revenue reconciliation (developer diagnostics).
 * Uses the same displayPricedPlots array as dashboard and register.
 */

import { getPlotEffectivePrice } from '../developments/plotCommercial';
import {
  calculatePlotDrivenGdv,
  calculateRevenueSplitFromPlots,
  roundMoney,
} from './revenueCalculations';
import {
  classifyPlotRevenueBucket,
  getAffordablePercentKey,
  getPlotPricingTenure,
} from './plotPricingTenure';
import { getPlotTenureLabel, normalizeTenureLabel } from './tenureDisplay';

function splitPriceForPlot(plot) {
  return roundMoney(plot.effectivePrice ?? getPlotEffectivePrice(plot));
}

function tenureRevenueGroup(percentKey, registerTenure) {
  if (percentKey === 'affordableRent') return 'affordableRent';
  if (percentKey === 'sharedOwnership') return 'sharedOwnership';
  if (percentKey === 'firstHomes') return 'firstHomes';
  if (percentKey === 'additionality') return 'additionality';
  if (percentKey === 'discountMarketSale') return 'discountMarketSale';
  if (percentKey === 'other') return 'otherAffordable';
  if (registerTenure === 'Affordable Rent') return 'affordableRent';
  if (registerTenure === 'Shared Ownership') return 'sharedOwnership';
  if (registerTenure === 'First Homes') return 'firstHomes';
  if (registerTenure === 'Additionality') return 'additionality';
  if (registerTenure === 'Discount Market Sale') return 'discountMarketSale';
  if (registerTenure === 'Other') return 'otherAffordable';
  return 'otherAffordable';
}

export function buildAffordableRevenueReconciliation(displayPricedPlots = [], summary = null) {
  const rows = displayPricedPlots.map((plot) => {
    const rawTenure = plot.tenure ?? '';
    const pricingTenure = getPlotPricingTenure(plot);
    const normalizedTenure = normalizeTenureLabel(pricingTenure);
    const registerTenure = getPlotTenureLabel(plot);
    const percentKey = getAffordablePercentKey(pricingTenure);
    const bucket = classifyPlotRevenueBucket(plot);
    const effectivePrice = roundMoney(plot.effectivePrice ?? 0);
    const fallbackEffectivePrice = roundMoney(getPlotEffectivePrice(plot));
    const splitPrice = splitPriceForPlot(plot);
    const includedInSplit = splitPrice > 0;
    const includedValue = includedInSplit ? splitPrice : 0;

    return {
      plotId: plot.id,
      plotNumber: plot.plotNumber,
      rawTenure,
      normalizedTenure,
      registerTenure,
      revenueCategory: plot.revenueCategory ?? '',
      percentKey,
      forecastSellingPrice: roundMoney(plot.forecastSellingPrice ?? 0),
      effectivePrice,
      getPlotEffectivePrice: fallbackEffectivePrice,
      splitPrice,
      bucket,
      includedInSplit,
      includedValue,
      tenureGroup: tenureRevenueGroup(percentKey, registerTenure),
    };
  });

  const reconciledSplit = calculateRevenueSplitFromPlots(displayPricedPlots);
  const reconciledGdv = calculatePlotDrivenGdv(displayPricedPlots);

  const tenureTotals = {
    openMarket: 0,
    affordableRent: 0,
    sharedOwnership: 0,
    otherAffordable: 0,
  };

  for (const row of rows) {
    if (!row.includedInSplit) continue;
    if (row.bucket === 'openMarket') {
      tenureTotals.openMarket += row.includedValue;
      continue;
    }
    if (row.bucket !== 'affordable') continue;

    if (row.tenureGroup === 'affordableRent') {
      tenureTotals.affordableRent += row.includedValue;
    } else if (row.tenureGroup === 'sharedOwnership') {
      tenureTotals.sharedOwnership += row.includedValue;
    } else {
      tenureTotals.otherAffordable += row.includedValue;
    }
  }

  tenureTotals.openMarket = roundMoney(tenureTotals.openMarket);
  tenureTotals.affordableRent = roundMoney(tenureTotals.affordableRent);
  tenureTotals.sharedOwnership = roundMoney(tenureTotals.sharedOwnership);
  tenureTotals.otherAffordable = roundMoney(tenureTotals.otherAffordable);

  const totalAffordableHousingRevenue = roundMoney(
    tenureTotals.affordableRent + tenureTotals.sharedOwnership + tenureTotals.otherAffordable
  );

  const reconciledAffordablePercent =
    reconciledGdv > 0
      ? roundMoney((reconciledSplit.affordableHousingRevenue / reconciledGdv) * 100)
      : 0;

  const summaryDevelopmentRevenue = summary?.developmentRevenue ?? null;
  const summaryGdv = summary?.grossDevelopmentValue ?? null;
  const summaryAffordablePercent = summary?.affordablePercent ?? null;

  const dashboardMatchesReconciledSplit =
    summaryDevelopmentRevenue != null &&
    summaryDevelopmentRevenue.affordableHousingRevenue === reconciledSplit.affordableHousingRevenue &&
    summaryDevelopmentRevenue.openMarketRevenue === reconciledSplit.openMarketRevenue &&
    summaryDevelopmentRevenue.otherRevenue === reconciledSplit.otherRevenue;

  const excludedAffordableLabel = rows.filter(
    (row) =>
      row.registerTenure === 'Shared Ownership' &&
      row.includedInSplit &&
      row.bucket !== 'affordable'
  );
  const excludedAffordableZeroPrice = rows.filter(
    (row) =>
      row.registerTenure === 'Shared Ownership' &&
      !row.includedInSplit &&
      (row.forecastSellingPrice > 0 || row.effectivePrice > 0)
  );
  const openMarketSharedOwnership = rows.filter(
    (row) => row.registerTenure === 'Shared Ownership' && row.bucket === 'openMarket'
  );

  return {
    plotCount: rows.length,
    rows,
    totals: {
      openMarketRevenue: tenureTotals.openMarket,
      affordableRentRevenue: tenureTotals.affordableRent,
      sharedOwnershipRevenue: tenureTotals.sharedOwnership,
      otherAffordableRevenue: tenureTotals.otherAffordable,
      totalAffordableHousingRevenue,
      gdv: reconciledGdv,
      affordablePercent: reconciledAffordablePercent,
    },
    reconciledSplit,
    summaryDevelopmentRevenue,
    summaryGdv,
    summaryAffordablePercent,
    dashboardMatchesReconciledSplit,
    divergence: {
      affordableHousingRevenue:
        summaryDevelopmentRevenue != null
          ? roundMoney(
              reconciledSplit.affordableHousingRevenue -
                summaryDevelopmentRevenue.affordableHousingRevenue
            )
          : null,
      gdv:
        summaryGdv != null ? roundMoney(reconciledGdv - summaryGdv) : null,
      affordablePercent:
        summaryAffordablePercent != null
          ? roundMoney(reconciledAffordablePercent - summaryAffordablePercent)
          : null,
    },
    flags: {
      openMarketSharedOwnershipCount: openMarketSharedOwnership.length,
      sharedOwnershipZeroSplitCount: rows.filter(
        (row) => row.registerTenure === 'Shared Ownership' && !row.includedInSplit
      ).length,
      sharedOwnershipMisclassifiedCount: excludedAffordableLabel.length,
      sharedOwnershipForecastButZeroSplitCount: excludedAffordableZeroPrice.length,
    },
  };
}
