/**
 * BL-034B — Selling Costs proposal calculation from live Forecast Revenue.
 * Reuses buildCvrRevenueCloseCandidate (same authority as CVR Revenue close).
 * Does not persist calculated £. Does not write CVR.
 */

const { buildCvrRevenueCloseCandidate } = require("./cvrRevenueClose");
const { roundPlotMoney } = require("./cvrRevenueCloseFormulas");
const { DEFAULT_ASSUMPTION_PERCENT } = require("./sellingCostsConstants");

function calculateForecastSellingCosts(forecastRevenue, assumptionPercent) {
  const revenue = roundPlotMoney(forecastRevenue);
  const percent = Number(assumptionPercent);
  if (!Number.isFinite(percent) || percent < 0) return null;
  if (!Number.isFinite(revenue)) return null;
  return roundPlotMoney(revenue * (percent / 100));
}

function buildRevenueProposalState(candidate) {
  if (!candidate || !candidate.ready || !candidate.summary) {
    const blockers = Array.isArray(candidate?.blockers) ? candidate.blockers : [];
    const reasons = blockers.map((b) => b.reason || b.source).filter(Boolean);
    let state = "unavailable";
    if (reasons.includes("revenue-settings-missing")) state = "settings_missing";
    else if (reasons.includes("plot-master-unavailable") || reasons.includes("development-not-found")) {
      state = "plot_master_unavailable";
    } else if (reasons.includes("invalid-secured-selling-price")) {
      state = "incomplete";
    } else if (reasons.includes("revenue-calculation-failed")) {
      state = "error";
    }

    return {
      ready: false,
      complete: false,
      state,
      forecastRevenue: null,
      hint:
        state === "incomplete"
          ? "Selling Costs forecast cannot be finalised because Forecast Revenue is incomplete."
          : "Selling Costs forecast cannot be finalised because Forecast Revenue is unavailable.",
      blockers,
    };
  }

  const forecastRevenue = roundPlotMoney(candidate.summary.forecastRevenue);
  return {
    ready: true,
    complete: Boolean(candidate.complete),
    state: forecastRevenue === 0 ? "zero" : "ready",
    forecastRevenue,
    hint:
      forecastRevenue === 0
        ? "Forecast Revenue is £0.00. Selling Costs proposal is therefore £0.00."
        : null,
    blockers: [],
  };
}

async function loadLiveForecastRevenue(clientId, developmentId, { dbClient = null } = {}) {
  const candidate = await buildCvrRevenueCloseCandidate({
    clientId,
    developmentId,
    dbClient,
  });
  return {
    candidate,
    revenue: buildRevenueProposalState(candidate),
  };
}

function buildMoneyProposal(revenueState, assumptionPercent = DEFAULT_ASSUMPTION_PERCENT) {
  if (!revenueState?.ready || revenueState.forecastRevenue == null) {
    return {
      forecastRevenue: null,
      forecastSellingCosts: null,
    };
  }
  return {
    forecastRevenue: revenueState.forecastRevenue,
    forecastSellingCosts: calculateForecastSellingCosts(
      revenueState.forecastRevenue,
      assumptionPercent
    ),
  };
}

module.exports = {
  calculateForecastSellingCosts,
  buildRevenueProposalState,
  loadLiveForecastRevenue,
  buildMoneyProposal,
};
