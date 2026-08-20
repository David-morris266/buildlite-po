/**
 * BL-019B — Plot revenue register, insights, and exceptions.
 */

import {
  getPlotEffectivePrice,
  getPlotNiaFt2,
  getPlotPerFt2,
  getPlotPerM2,
  plotsToCommercialModels,
  roundPlotMoney,
} from '../developments/plotCommercial';
import { getPlotTenureLabel } from './tenureDisplay';

export function buildPlotRevenueRegisterRows(plots = []) {
  return plots.map((plot) => ({
    plotId: plot.id,
    plotNumber: plot.plotNumber,
    houseType: plot.houseType,
    tenure: getPlotTenureLabel(plot),
    revenueStatus: plot.revenueStatus,
    revenueCategory: plot.revenueCategory,
    revenueSource: plot.revenueSource,
    pricingSource: plot.pricingSource || plot.revenueSource,
    isManualOverride: plot.isManualOverride,
    sellingPrice: roundPlotMoney(plot.sellingPrice),
    forecastSellingPrice: roundPlotMoney(plot.forecastSellingPrice || plot.effectivePrice),
    effectivePrice: roundPlotMoney(plot.effectivePrice),
    perFt2: plot.perFt2 ?? getPlotPerFt2(plot),
    perM2: plot.perM2 ?? getPlotPerM2(plot),
    niaFt2: getPlotNiaFt2(plot),
    niaM2: plot.niaM2,
  }));
}

export function sortPlotRevenueRows(rows = [], { key = 'plotNumber', direction = 'asc' } = {}) {
  const factor = direction === 'desc' ? -1 : 1;
  return [...rows].sort((left, right) => {
    const leftValue = left[key];
    const rightValue = right[key];
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return (leftValue - rightValue) * factor;
    }
    return String(leftValue ?? '').localeCompare(String(rightValue ?? ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    }) * factor;
  });
}

export function filterPlotRevenueRows(rows = [], { query = '', status = '', category = '' } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  return rows.filter((row) => {
    if (status && row.revenueStatus !== status) return false;
    if (category && row.revenueCategory !== category) return false;
    if (!needle) return true;
    const haystack = [
      row.plotNumber,
      row.houseType,
      row.tenure,
      row.revenueStatus,
      row.revenueCategory,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function buildCommercialInsights(plots = []) {
  const models = plotsToCommercialModels(plots).filter(
    (plot) => roundPlotMoney(plot.effectivePrice) > 0
  );

  if (!models.length) {
    return {
      available: false,
      items: [],
      emptyMessage: 'Commercial insights will appear once plots include selling or forecast prices.',
    };
  }

  const byPrice = [...models].sort((a, b) => b.effectivePrice - a.effectivePrice);
  const byFt2 = [...models].filter((p) => p.perFt2 > 0).sort((a, b) => b.perFt2 - a.perFt2);
  const averageSellingPrice = roundPlotMoney(
    models.reduce((sum, plot) => sum + plot.effectivePrice, 0) / models.length
  );

  const items = [
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
    },
    {
      key: 'average-price',
      label: 'Average Selling Price',
      value: `£${averageSellingPrice.toLocaleString('en-GB')}`,
      plotId: null,
    },
  ];

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

  return { available: true, items, emptyMessage: null };
}

export function buildRevenueExceptions(plots = []) {
  const exceptions = [];

  for (const plot of plots) {
    const price = getPlotEffectivePrice(plot);
    const selling = roundPlotMoney(plot.sellingPrice);
    const forecast = roundPlotMoney(plot.forecastSellingPrice);
    const niaFt2 = getPlotNiaFt2(plot);
    const status = String(plot.revenueStatus || 'Available');

    if (!price) {
      exceptions.push({
        id: `missing-price:${plot.id}`,
        type: 'missingSellingPrice',
        label: 'Missing Selling Price',
        message: `Plot ${plot.plotNumber} has no selling or forecast price.`,
        plotId: plot.id,
        plotNumber: plot.plotNumber,
      });
    }

    if (!niaFt2) {
      exceptions.push({
        id: `missing-nia:${plot.id}`,
        type: 'missingNia',
        label: 'Missing NIA',
        message: `Plot ${plot.plotNumber} has no NIA ft² recorded.`,
        plotId: plot.id,
        plotNumber: plot.plotNumber,
      });
    }

    if (forecast > 0 && selling > 0 && forecast < selling && status !== 'Exchanged' && status !== 'Completed') {
      exceptions.push({
        id: `forecast-low:${plot.id}`,
        type: 'forecastLowerThanPrice',
        label: 'Forecast lower than current price',
        message: `Plot ${plot.plotNumber} forecast is below the current selling price.`,
        plotId: plot.id,
        plotNumber: plot.plotNumber,
      });
    }

    if ((status === 'Completed' || status === 'Exchanged') && !selling) {
      exceptions.push({
        id: `secured-no-price:${plot.id}`,
        type: status === 'Exchanged' ? 'exchangedNoPrice' : 'completedNoPrice',
        label:
          status === 'Exchanged'
            ? 'Exchanged plot with no selling price'
            : 'Completed plot with no selling price',
        message: `Plot ${plot.plotNumber} is ${status.toLowerCase()} but has no selling price.`,
        plotId: plot.id,
        plotNumber: plot.plotNumber,
      });
    }
  }

  return exceptions;
}
