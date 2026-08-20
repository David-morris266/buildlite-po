/**
 * BL-032C — Live CVR commercial composer.
 *
 * Combines the existing CVR cost position with the existing Revenue engine.
 * Does not duplicate Revenue formulas and does not belong in cvrEngine.
 */

import { getDevelopment } from '../developments/developmentStore';
import { getPlots } from '../developments/plotMaster';
import { isRevenueServerAuthorityEnabled } from '../revenue/revenueAuthority';
import { buildRevenueSummary } from '../revenue/revenueCalculations';
import { getPricedPlots } from '../revenue/revenueStrategy';
import { getRevenueSettingsReadiness } from '../revenue/revenueSettingsServerCache';
import { roundMoney } from './cvrCalculations';
import { CVR_HISTORIC_REVENUE_UNAVAILABLE } from './cvrHistoricConstants';

export const CVR_REVENUE_LOADING_HINT = 'Loading revenue…';
export const CVR_REVENUE_UNAVAILABLE_HINT = 'Revenue unavailable';
export const CVR_FORECAST_COST_UNAVAILABLE_HINT = 'Forecast cost unavailable';

function moneyValueExists(value) {
  if (value == null || value === '') return false;
  return roundMoney(value) != null;
}

function unavailableRevenue({ reason, hint, error = null } = {}) {
  return {
    revenueAvailable: false,
    reason: reason || 'unavailable',
    hint: hint || CVR_REVENUE_UNAVAILABLE_HINT,
    error,
    forecastRevenue: null,
    securedRevenue: null,
    remainingForecast: null,
    plotsSold: null,
    plotsRemaining: null,
  };
}

export function calculateCvrGrossProfit(forecastRevenue, forecastCost) {
  if (!moneyValueExists(forecastRevenue) || !moneyValueExists(forecastCost)) return null;
  return roundMoney(roundMoney(forecastRevenue) - roundMoney(forecastCost));
}

export function calculateCvrGrossMarginPercent(grossProfit, forecastRevenue) {
  if (!moneyValueExists(grossProfit) || !moneyValueExists(forecastRevenue)) return null;
  const revenue = roundMoney(forecastRevenue);
  if (revenue == null || Math.abs(revenue) < 0.005) return null;
  const profit = roundMoney(grossProfit);
  if (profit == null) return null;
  return (profit / revenue) * 100;
}

export function formatCvrGrossMarginPercent(value) {
  if (value == null || value === '') return '—';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `${amount.toFixed(1)}%`;
}

/**
 * Live Revenue is ready only when Plot Master is loaded and, under authority ON,
 * server settings have resolved. Unresolved/error must not become £0.
 */
export function resolveLiveCvrRevenueReadiness(developmentId) {
  if (!developmentId) {
    return {
      ready: false,
      reason: 'missing-development',
      hint: CVR_REVENUE_UNAVAILABLE_HINT,
    };
  }

  const development = getDevelopment(developmentId);
  if (!development) {
    return {
      ready: false,
      reason: 'development-not-loaded',
      hint: CVR_REVENUE_LOADING_HINT,
    };
  }

  if (isRevenueServerAuthorityEnabled()) {
    const settings = getRevenueSettingsReadiness(developmentId);
    if (!settings.ready) {
      if (settings.reason === 'error' || settings.loadState === 'error') {
        return {
          ready: false,
          reason: 'error',
          hint: CVR_REVENUE_UNAVAILABLE_HINT,
          error: settings.error || null,
        };
      }
      return {
        ready: false,
        reason: settings.reason || settings.loadState || 'loading',
        hint: CVR_REVENUE_LOADING_HINT,
        error: null,
      };
    }
  }

  return { ready: true, reason: null, hint: null, error: null };
}

export function loadLiveCvrRevenueSummary(developmentId) {
  const readiness = resolveLiveCvrRevenueReadiness(developmentId);
  if (!readiness.ready) {
    return unavailableRevenue(readiness);
  }

  try {
    const plots = getPlots(developmentId);
    const pricedPlots = getPricedPlots(developmentId);
    const summary = buildRevenueSummary({ plots, pricedPlots });
    return {
      revenueAvailable: true,
      reason: null,
      hint: null,
      error: null,
      forecastRevenue: roundMoney(summary.forecastRevenue) ?? 0,
      securedRevenue: roundMoney(summary.securedRevenue) ?? 0,
      remainingForecast: roundMoney(summary.remainingForecast) ?? 0,
      plotsSold: Number(summary.plotsSold) || 0,
      plotsRemaining: Number(summary.plotsRemaining) || 0,
    };
  } catch {
    return unavailableRevenue({
      reason: 'error',
      hint: CVR_REVENUE_UNAVAILABLE_HINT,
    });
  }
}

export function buildCvrCommercialPosition({
  developmentId,
  historic = false,
  historicUnavailable = false,
  costSummary = {},
} = {}) {
  const forecastCost = moneyValueExists(costSummary.finalForecast)
    ? roundMoney(costSummary.finalForecast)
    : null;
  const costAvailable = forecastCost != null;
  const historicRevenueUnavailable = Boolean(historic || historicUnavailable);

  const revenue = historicRevenueUnavailable
    ? unavailableRevenue({
        reason: 'historic-v1',
        hint: CVR_HISTORIC_REVENUE_UNAVAILABLE,
      })
    : loadLiveCvrRevenueSummary(developmentId);

  const grossProfit =
    revenue.revenueAvailable && costAvailable
      ? calculateCvrGrossProfit(revenue.forecastRevenue, forecastCost)
      : null;
  const grossMarginPercent =
    revenue.revenueAvailable && costAvailable
      ? calculateCvrGrossMarginPercent(grossProfit, revenue.forecastRevenue)
      : null;

  let profitHint = null;
  if (grossProfit == null) {
    if (historicRevenueUnavailable || !revenue.revenueAvailable) {
      profitHint = revenue.hint;
    } else if (!costAvailable) {
      profitHint = CVR_FORECAST_COST_UNAVAILABLE_HINT;
    }
  }

  return {
    ...revenue,
    historicRevenueUnavailable,
    costAvailable,
    forecastCost,
    grossProfit,
    grossMarginPercent,
    grossProfitAvailable: grossProfit != null,
    grossMarginAvailable: grossMarginPercent != null,
    profitHint,
  };
}

export function previousRevenueForMovement(previousCommercial, key) {
  if (!previousCommercial?.revenueAvailable) return null;
  const value = previousCommercial[key];
  return moneyValueExists(value) ? roundMoney(value) : null;
}
