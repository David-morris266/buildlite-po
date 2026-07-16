/**
 * BL-019C — Revenue strategy pricing calculations.
 */

import {
  getPlotNiaFt2,
  roundPlotMoney,
} from '../developments/plotCommercial';
import {
  getAffordablePercentKey,
  getPlotAffordablePercentKey,
  getPlotPricingTenure,
} from './plotPricingTenure';
import { getPlotTenureLabel } from './tenureDisplay';
import {
  DEFAULT_REVENUE_SOURCE,
  FT2_TO_M2,
  GARAGE_TYPES,
  SELLING_BASIS_OPTIONS,
} from './revenueTypes';

function normalizeHouseTypePricingRecord(record = {}) {
  return {
    garage: GARAGE_TYPES.includes(record.garage) ? record.garage : 'None',
    sellingBasis: record.sellingBasis === 'Manual' ? 'Manual' : 'Auto',
    manualForecastValue: roundPlotMoney(record.manualForecastValue || 0),
    representativeNiaFt2:
      record.representativeNiaFt2 == null || record.representativeNiaFt2 === ''
        ? null
        : roundPlotMoney(record.representativeNiaFt2),
  };
}

export { getAffordablePercentKey, getPlotPricingTenure } from './plotPricingTenure';

export function garageTypeToKey(garage = 'None') {
  const value = String(garage || 'None').trim().toLowerCase();
  if (value === 'single') return 'single';
  if (value === 'double') return 'double';
  return 'none';
}

export function getGaragePremium(garage = 'None', strategy = {}) {
  const key = garageTypeToKey(garage);
  return roundPlotMoney(strategy.garagePremiums?.[key] || 0);
}

export function resolveEffectivePlotGarage(plot = {}, houseTypePricing = {}) {
  if (plot.garageOverride) {
    return normalizePlotGarageValue(plot.garage);
  }

  const houseType = String(plot.houseType || '').trim();
  const record = houseTypePricing[houseType];
  if (record?.garage) {
    return normalizePlotGarageValue(record.garage);
  }

  return normalizePlotGarageValue(plot.garage);
}

function normalizePlotGarageValue(garage) {
  const value = String(garage || 'None').trim();
  return GARAGE_TYPES.includes(value) ? value : 'None';
}

export function calculateRatePerM2(ratePerFt2 = 0) {
  const rate = Number(ratePerFt2);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return roundPlotMoney(rate / FT2_TO_M2);
}

export function applyAffordableDiscount(omvPrice, tenureOrCategory, strategy = {}) {
  const openMarketValue = roundPlotMoney(omvPrice);
  if (!openMarketValue) return 0;
  const key = getAffordablePercentKey(tenureOrCategory);
  if (!key) return openMarketValue;
  const percent = Number(strategy.affordableHousing?.[key]);
  if (!Number.isFinite(percent) || percent <= 0) return openMarketValue;
  return roundPlotMoney(openMarketValue * (percent / 100));
}

export function calculateOpenMarketBase({ niaFt2 = 0, garage = 'None', strategy = {} } = {}) {
  const area = roundPlotMoney(niaFt2);
  const rate = roundPlotMoney(strategy.openMarket?.ratePerFt2 || 0);
  if (!area || !rate) return 0;
  return roundPlotMoney(area * rate + getGaragePremium(garage, strategy));
}

export function getRepresentativeNiaForHouseType(houseType, plots = [], override = null) {
  if (override != null && Number(override) > 0) return roundPlotMoney(override);
  const matches = plots.filter(
    (plot) => String(plot.houseType || '').trim().toLowerCase() === String(houseType || '').trim().toLowerCase()
  );
  if (!matches.length) return 0;
  const values = matches.map((plot) => getPlotNiaFt2(plot)).filter((value) => value > 0);
  if (!values.length) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return roundPlotMoney(total / values.length);
}

export function calculateHouseTypeForecast(
  houseType,
  houseTypeRecord = {},
  strategy = {},
  plots = []
) {
  const record = normalizeHouseTypePricingRecord(houseTypeRecord);
  if (record.sellingBasis === 'Manual') {
    return roundPlotMoney(record.manualForecastValue);
  }
  const niaFt2 = getRepresentativeNiaForHouseType(
    houseType,
    plots,
    record.representativeNiaFt2
  );
  return calculateOpenMarketBase({
    niaFt2,
    garage: record.garage,
    strategy,
  });
}

export function buildHouseTypePricingMap(plots = [], existing = {}) {
  const houseTypes = [...new Set(plots.map((plot) => String(plot.houseType || '').trim()).filter(Boolean))];
  const next = { ...existing };

  for (const houseType of houseTypes) {
    if (!next[houseType]) {
      next[houseType] = normalizeHouseTypePricingRecord({
        garage: 'None',
        sellingBasis: 'Auto',
      });
    } else {
      next[houseType] = normalizeHouseTypePricingRecord(next[houseType]);
    }
  }

  return next;
}

export function buildHouseTypePricingRows(plots = [], strategy = {}, houseTypePricing = {}) {
  const map = buildHouseTypePricingMap(plots, houseTypePricing);
  return Object.keys(map)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map((houseType) => {
      const record = map[houseType];
      const niaFt2 = getRepresentativeNiaForHouseType(
        houseType,
        plots,
        record.representativeNiaFt2
      );
      const forecastValue = calculateHouseTypeForecast(houseType, record, strategy, plots);
      return {
        houseType,
        niaFt2,
        garage: record.garage,
        sellingBasis: record.sellingBasis,
        manualForecastValue: record.manualForecastValue,
        forecastValue,
        representativeNiaFt2: record.representativeNiaFt2,
      };
    });
}

export function recalculateHouseTypePricing(houseTypePricing = {}, plots = [], strategy = {}) {
  const map = buildHouseTypePricingMap(plots, houseTypePricing);
  const next = { ...map };

  for (const [houseType, record] of Object.entries(next)) {
    if (record.sellingBasis === 'Manual') continue;
    next[houseType] = {
      ...record,
      representativeNiaFt2: getRepresentativeNiaForHouseType(houseType, plots, null),
    };
  }

  return next;
}

export function resolvePlotOpenMarketBase(plot = {}, strategy = {}, houseTypePricing = {}, plots = []) {
  const source = plot.revenueSource || DEFAULT_REVENUE_SOURCE;
  const garage = resolveEffectivePlotGarage(plot, houseTypePricing);

  if (source === 'Manual Value') {
    return roundPlotMoney(plot.manualForecastValue || 0);
  }

  if (source === 'Plot Override') {
    return roundPlotMoney(plot.plotOverrideValue || 0);
  }

  if (source === 'Development Strategy') {
    return calculateOpenMarketBase({
      niaFt2: getPlotNiaFt2(plot),
      garage,
      strategy,
    });
  }

  const houseType = String(plot.houseType || '').trim();
  const record = houseTypePricing[houseType] || { garage: 'None', sellingBasis: 'Auto' };
  const houseTypeValue = calculateHouseTypeForecast(
    houseType,
    { ...record, garage },
    strategy,
    plots
  );
  return houseTypeValue;
}

export function resolvePlotForecastPrice(plot = {}, strategy = {}, houseTypePricing = {}, plots = []) {
  const source = plot.revenueSource || DEFAULT_REVENUE_SOURCE;

  if (source === 'Manual Value') {
    return roundPlotMoney(plot.manualForecastValue || 0);
  }

  const openMarketBase = resolvePlotOpenMarketBase(plot, strategy, houseTypePricing, plots);
  const withPremium = roundPlotMoney(openMarketBase + roundPlotMoney(plot.plotPremium || 0));
  return applyAffordableDiscount(withPremium, getPlotPricingTenure(plot), strategy);
}

export function enrichPlotWithPricing(plot = {}, strategy = {}, houseTypePricing = {}, plots = []) {
  const effectiveGarage = resolveEffectivePlotGarage(plot, houseTypePricing);
  const forecastSellingPrice = resolvePlotForecastPrice(plot, strategy, houseTypePricing, plots);
  const effectivePrice =
    plot.revenueStatus === 'Completed' && roundPlotMoney(plot.sellingPrice) > 0
      ? roundPlotMoney(plot.sellingPrice)
      : forecastSellingPrice;

  const niaFt2 = getPlotNiaFt2(plot);
  const perFt2 = niaFt2 > 0 && effectivePrice > 0 ? roundPlotMoney(effectivePrice / niaFt2) : 0;

  return {
    ...plot,
    effectiveGarage,
    garageInherited: !plot.garageOverride,
    forecastSellingPrice,
    effectivePrice,
    perFt2,
    pricingSource: plot.revenueSource || DEFAULT_REVENUE_SOURCE,
    isManualOverride: (plot.revenueSource || DEFAULT_REVENUE_SOURCE) === 'Manual Value',
  };
}

export function enrichPlotsWithPricing(plots = [], strategy = {}, houseTypePricing = {}) {
  return plots.map((plot) => enrichPlotWithPricing(plot, strategy, houseTypePricing, plots));
}

const PROTECTED_REVENUE_SOURCES = new Set(['Manual Value', 'Plot Override']);

export function applyStrategyToPlots(
  plots = [],
  strategy = {},
  houseTypePricing = {},
  { revenueSource = DEFAULT_REVENUE_SOURCE, skipManual = true } = {}
) {
  return plots.map((plot) => {
    if (skipManual && PROTECTED_REVENUE_SOURCES.has(plot.revenueSource)) return plot;
    const next = {
      ...plot,
      revenueSource,
    };
    return {
      ...next,
      forecastSellingPrice: resolvePlotForecastPrice(next, strategy, houseTypePricing, plots),
    };
  });
}

export function buildStrategySummaryMetrics(plots = [], strategy = {}, houseTypePricing = {}) {
  const enriched = enrichPlotsWithPricing(plots, strategy, houseTypePricing);
  const priced = enriched.filter((plot) => roundPlotMoney(plot.effectivePrice) > 0);
  const autoPriced = enriched.filter((plot) => !plot.isManualOverride && plot.effectivePrice > 0);
  const manualOverrides = enriched.filter((plot) => plot.isManualOverride);
  const openMarketPlots = enriched.filter((plot) => !getPlotAffordablePercentKey(plot));

  const totalGaragePremium = enriched.reduce((sum, plot) => {
    const source = plot.revenueSource || DEFAULT_REVENUE_SOURCE;
    if (source === 'Manual Value') return sum;
    const garage = plot.effectiveGarage || resolveEffectivePlotGarage(plot, houseTypePricing);
    return sum + getGaragePremium(garage, strategy);
  }, 0);

  const totalPlotPremium = enriched.reduce(
    (sum, plot) => sum + roundPlotMoney(plot.plotPremium || 0),
    0
  );

  const manualAdjustmentValue = manualOverrides.reduce(
    (sum, plot) => sum + roundPlotMoney(plot.manualForecastValue || plot.effectivePrice),
    0
  );

  const averageOmPerFt2 =
    openMarketPlots.length > 0
      ? roundPlotMoney(
          openMarketPlots.reduce((sum, plot) => sum + (plot.perFt2 || 0), 0) / openMarketPlots.length
        )
      : roundPlotMoney(strategy.openMarket?.ratePerFt2 || 0);

  const affordablePlots = enriched.filter((plot) => getPlotAffordablePercentKey(plot));
  const averageAhPercentOfOm =
    affordablePlots.length > 0
      ? roundPlotMoney(
          affordablePlots.reduce((sum, plot) => {
            const key = getPlotAffordablePercentKey(plot);
            return sum + (strategy.affordableHousing?.[key] || 0);
          }, 0) / affordablePlots.length
        )
      : 0;

  return {
    autoPricedPlotCount: autoPriced.length,
    manualOverrideCount: manualOverrides.length,
    averageOmPerFt2,
    averageAhPercentOfOm,
    totalGaragePremium: roundPlotMoney(totalGaragePremium),
    totalPlotPremium: roundPlotMoney(totalPlotPremium),
    manualAdjustmentValue: roundPlotMoney(manualAdjustmentValue),
    pricedPlotCount: priced.length,
  };
}

export function buildStrategyInsights(plots = [], strategy = {}, houseTypePricing = {}) {
  const enriched = enrichPlotsWithPricing(plots, strategy, houseTypePricing);
  const priced = enriched.filter((plot) => roundPlotMoney(plot.effectivePrice) > 0);

  const items = [];

  if (priced.length) {
    const byPrice = [...priced].sort((a, b) => b.effectivePrice - a.effectivePrice);
    const byFt2 = [...priced].filter((p) => p.perFt2 > 0).sort((a, b) => b.perFt2 - a.perFt2);

    items.push(
      {
        key: 'highest-value',
        label: 'Highest Value Plot',
        value: `${byPrice[0].plotNumber} — £${byPrice[0].effectivePrice.toLocaleString('en-GB')}`,
        plotId: byPrice[0].id,
      },
      {
        key: 'lowest-value',
        label: 'Lowest Value Plot',
        value: `${byPrice[byPrice.length - 1].plotNumber} — £${byPrice[byPrice.length - 1].effectivePrice.toLocaleString('en-GB')}`,
        plotId: byPrice[byPrice.length - 1].id,
      }
    );

    if (byFt2.length) {
      items.push(
        {
          key: 'highest-ft2',
          label: 'Highest £/ft²',
          value: `${byFt2[0].plotNumber} — £${byFt2[0].perFt2.toLocaleString('en-GB')}/ft²`,
          plotId: byFt2[0].id,
        },
        {
          key: 'lowest-ft2',
          label: 'Lowest £/ft²',
          value: `${byFt2[byFt2.length - 1].plotNumber} — £${byFt2[byFt2.length - 1].perFt2.toLocaleString('en-GB')}/ft²`,
          plotId: byFt2[byFt2.length - 1].id,
        }
      );
    }
  }

  const manualOverrides = enriched.filter((plot) => plot.isManualOverride);
  if (manualOverrides.length) {
    items.push({
      key: 'manual-overrides',
      label: 'Plots with Manual Overrides',
      value: `${manualOverrides.length} plot${manualOverrides.length === 1 ? '' : 's'}`,
      plotId: manualOverrides[0]?.id || null,
    });
  }

  const negativePremiums = enriched.filter((plot) => roundPlotMoney(plot.plotPremium) < 0);
  if (negativePremiums.length) {
    items.push({
      key: 'negative-premiums',
      label: 'Plots with Negative Premiums',
      value: `${negativePremiums.length} plot${negativePremiums.length === 1 ? '' : 's'}`,
      plotId: negativePremiums[0]?.id || null,
    });
  }

  const missingNia = enriched.filter((plot) => !getPlotNiaFt2(plot));
  if (missingNia.length) {
    items.push({
      key: 'missing-nia',
      label: 'Plots Missing NIA',
      value: `${missingNia.length} plot${missingNia.length === 1 ? '' : 's'}`,
      plotId: missingNia[0]?.id || null,
    });
  }

  const missingCategory = enriched.filter((plot) => !String(plot.revenueCategory || '').trim());
  if (missingCategory.length) {
    items.push({
      key: 'missing-category',
      label: 'Plots Missing Revenue Category',
      value: `${missingCategory.length} plot${missingCategory.length === 1 ? '' : 's'}`,
      plotId: missingCategory[0]?.id || null,
    });
  }

  return {
    available: items.length > 0,
    items,
    emptyMessage: 'Commercial insights will appear once plots and strategy defaults are configured.',
  };
}

export function mapPricedPlotsToOverrideRows(pricedPlots = []) {
  return pricedPlots.map((plot) => ({
    plotId: plot.id,
    plotNumber: plot.plotNumber,
    houseType: plot.houseType,
    tenure: getPlotTenureLabel(plot),
    tenureRaw: getPlotPricingTenure(plot),
    revenueSource: plot.pricingSource,
    garage: plot.effectiveGarage || 'None',
    garageInherited: Boolean(plot.garageInherited),
    plotPremium: roundPlotMoney(plot.plotPremium || 0),
    plotPremiumReason: plot.plotPremiumReason || '',
    manualForecastValue: roundPlotMoney(plot.manualForecastValue || 0),
    plotOverrideValue: roundPlotMoney(plot.plotOverrideValue || 0),
    forecastSellingPrice: roundPlotMoney(plot.forecastSellingPrice),
    effectivePrice: roundPlotMoney(plot.effectivePrice),
    isManualOverride: plot.isManualOverride,
    manualOverrideDisplay:
      plot.isManualOverride && roundPlotMoney(plot.manualForecastValue) > 0
        ? roundPlotMoney(plot.manualForecastValue)
        : 0,
  }));
}

export function buildPlotOverrideRows(plots = [], strategy = {}, houseTypePricing = {}) {
  const mergedHouseTypes = buildHouseTypePricingMap(plots, houseTypePricing);
  const pricedPlots = enrichPlotsWithPricing(plots, strategy, mergedHouseTypes);
  return mapPricedPlotsToOverrideRows(pricedPlots);
}
