/**
 * BL-031E.2 — Server-side BL-031D commercial formulas.
 * Port of client cvrCalculations / cvrForecastEngine / cvrCertifiedValue.
 * Do not invent a new commercial rule here.
 */

const {
  APPROVED_CERTIFICATE_STATUSES,
  CERTIFICATE_RECOVERY_LINE_TYPE,
} = require("./cvrCloseConstants");

function roundMoney(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function moneyValueExists(value) {
  if (value == null || value === "") return false;
  const money = roundMoney(value);
  return money != null && Math.abs(money) > 0.005;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normaliseCostCodeKey(costCode) {
  const raw = String(costCode || "").trim();
  if (!raw) return "";

  let codePart = raw.split("—")[0].split(" - ")[0].split(" – ")[0].trim();
  if (codePart.includes("-") && !/\s/.test(codePart)) {
    const hyphenParts = codePart.split("-");
    if (hyphenParts.length === 2 && hyphenParts[0].length <= 12) {
      codePart = hyphenParts[0].trim();
    }
  }

  return codePart.replace(/\s+/g, "").toLowerCase();
}

function buildCostCodeLabel(costCodeKey, fallback = "") {
  const value = String(fallback || costCodeKey || "").trim();
  return value || costCodeKey || "—";
}

function calculateSystemForecast({ committed, actualCost, currentBudget }) {
  const committedValue = roundMoney(committed);

  if (committedValue != null && committedValue > 0) {
    return committedValue;
  }

  if (moneyValueExists(currentBudget)) {
    return roundMoney(currentBudget);
  }

  const actual = roundMoney(actualCost);
  if (moneyValueExists(actualCost) && actual != null && actual > 0) {
    return actual;
  }

  return 0;
}

function calculateFinalForecast(systemForecast, commercialAdjustment = 0, expectedLiability = 0, vaExposureUplift = 0) {
  const toPence = (value) => Math.round((Number(value) || 0) * 100);
  const additions = toPence(expectedLiability) + toPence(commercialAdjustment) + toPence(vaExposureUplift);

  if (systemForecast == null || systemForecast === "") {
    const forecast = additions / 100;
    return forecast === 0 ? null : forecast;
  }

  const system = roundMoney(systemForecast);
  if (system == null) {
    const forecast = additions / 100;
    return forecast === 0 ? null : forecast;
  }

  return (toPence(system) + additions) / 100;
}

function calculateIncurredCost(actualCost, manualAccrual = 0) {
  if (actualCost == null || actualCost === "") return null;
  const actual = roundMoney(actualCost);
  if (actual == null) return null;
  return roundMoney(actual + (roundMoney(manualAccrual) ?? 0));
}

function calculateCostToComplete(forecastFinalCost, actualCost, manualAccrual = 0) {
  const forecast = roundMoney(forecastFinalCost);
  if (forecast == null) return null;
  const incurred = calculateIncurredCost(actualCost, manualAccrual);
  if (incurred == null) return roundMoney(forecast - (roundMoney(actualCost) ?? 0));
  return roundMoney(forecast - incurred);
}

function calculateVariance(currentBudget, forecastFinalCost) {
  const budget = roundMoney(currentBudget) ?? 0;
  const forecast = roundMoney(forecastFinalCost);
  if (forecast == null) return null;
  return roundMoney(budget - forecast);
}

function calculateOutstandingCertified(certified, actualCost) {
  // Same commercial formula as client Summary "Certified Not in Ledger"
  // when both certified and actual exist: max(0, certified - actual).
  if (certified == null) return null;
  if (actualCost == null) return null;
  const certifiedValue = roundMoney(certified);
  if (certifiedValue == null) return null;
  const actual = roundMoney(actualCost);
  if (actual == null) return null;
  return roundMoney(Math.max(0, certifiedValue - actual));
}

function sumNullable(values) {
  let hasValue = false;
  let total = 0;

  for (const value of values) {
    const n = roundMoney(value);
    if (n == null) continue;
    hasValue = true;
    total += n;
  }

  return hasValue ? roundMoney(total) : null;
}

function readCertificateMoney(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const money = roundMoney(value);
    if (money != null) return money;
  }
  return null;
}

function isApprovedCommercialCertificate(certificate) {
  return APPROVED_CERTIFICATE_STATUSES.has(String(certificate?.status || ""));
}

function reconstructGrossWorks(certificate) {
  const snapshotTotals = certificate?.valuationSnapshot?.totals || {};
  const frozenGross = readCertificateMoney(
    certificate?.grossValue,
    snapshotTotals.grossWorksThisCertificate,
    snapshotTotals.grossThisCertificate
  );
  if (frozenGross != null) return frozenGross;

  const matrixGross = readCertificateMoney(
    certificate?.matrixGross,
    snapshotTotals.matrixGrossThisCertificate
  );
  const commercialEventGross = readCertificateMoney(
    certificate?.commercialEventGross,
    snapshotTotals.commercialEventGrossThisCertificate
  );
  if (matrixGross == null && commercialEventGross == null) return null;
  return roundMoney((matrixGross ?? 0) + (commercialEventGross ?? 0));
}

function reconstructRecoverySigned(certificate) {
  const snapshotTotals = certificate?.valuationSnapshot?.totals || {};
  const frozenHeader = readCertificateMoney(
    certificate?.recoverySigned,
    snapshotTotals.recoveryDeductionSigned
  );
  if (frozenHeader != null) return frozenHeader;

  const frozenLines =
    certificate?.commercialLines ||
    certificate?.valuationSnapshot?.commercialLines ||
    [];
  return (
    roundMoney(
      (Array.isArray(frozenLines) ? frozenLines : [])
        .filter((line) => line?.lineType === CERTIFICATE_RECOVERY_LINE_TYPE)
        .reduce((sum, line) => sum + toNumber(line.amountThisCertificate), 0)
    ) ?? 0
  );
}

function getApprovedCertificateValue(certificate) {
  if (!isApprovedCommercialCertificate(certificate)) return 0;

  const grossWorks = reconstructGrossWorks(certificate);
  if (grossWorks == null) return null;

  return roundMoney(grossWorks + reconstructRecoverySigned(certificate));
}

function enrichCvrForecastRow(row) {
  const systemForecast = calculateSystemForecast({
    committed: row.committed,
    actualCost: row.actualCost,
    currentBudget: row.currentBudget,
  });

  const commercialAdjustment = roundMoney(row.commercialAdjustment) ?? 0;
  const expectedLiability = roundMoney(row.expectedLiability) ?? 0;
  const vaExposureUplift = roundMoney(row.vaExposureUplift) ?? 0;
  const manualAccrual = roundMoney(row.manualAccrual) ?? 0;
  const finalForecast = calculateFinalForecast(
    systemForecast,
    commercialAdjustment,
    expectedLiability,
    vaExposureUplift
  );
  const currentCost = calculateIncurredCost(row.actualCost, manualAccrual);
  const costToComplete = calculateCostToComplete(
    finalForecast,
    row.actualCost,
    manualAccrual
  );
  const variance = calculateVariance(row.currentBudget, finalForecast);
  const outstandingCertified = calculateOutstandingCertified(
    row.certified,
    row.actualCost
  );

  return {
    ...row,
    manualAccrual,
    currentCost,
    systemForecast,
    expectedLiability,
    vaExposureUplift,
    commercialAdjustment,
    finalForecast,
    costToComplete,
    outstandingCertified,
    variance,
  };
}

function buildCvrTotals(rows) {
  return {
    currentBudget: sumNullable(rows.map((row) => row.currentBudget)) ?? 0,
    committed: sumNullable(rows.map((row) => row.committed)) ?? 0,
    certified: sumNullable(rows.map((row) => row.certified)) ?? 0,
    actualCost: sumNullable(rows.map((row) => row.actualCost)) ?? 0,
    systemForecast: sumNullable(rows.map((row) => row.systemForecast)) ?? 0,
    expectedLiability: sumNullable(rows.map((row) => row.expectedLiability)) ?? 0,
    vaExposureUplift: sumNullable(rows.map((row) => row.vaExposureUplift)) ?? 0,
    outstandingCertified: sumNullable(rows.map((row) => row.outstandingCertified)) ?? 0,
    commercialAdjustment: sumNullable(rows.map((row) => row.commercialAdjustment)) ?? 0,
    manualAccrual: sumNullable(rows.map((row) => row.manualAccrual)) ?? 0,
    currentCost: sumNullable(rows.map((row) => row.currentCost)) ?? 0,
    finalForecast: sumNullable(rows.map((row) => row.finalForecast)) ?? 0,
    costToComplete: sumNullable(rows.map((row) => row.costToComplete)) ?? 0,
    variance: sumNullable(rows.map((row) => row.variance)) ?? 0,
  };
}

module.exports = {
  roundMoney,
  moneyValueExists,
  toNumber,
  normaliseCostCodeKey,
  buildCostCodeLabel,
  calculateSystemForecast,
  calculateFinalForecast,
  calculateIncurredCost,
  calculateCostToComplete,
  calculateVariance,
  calculateOutstandingCertified,
  sumNullable,
  isApprovedCommercialCertificate,
  reconstructGrossWorks,
  reconstructRecoverySigned,
  getApprovedCertificateValue,
  enrichCvrForecastRow,
  buildCvrTotals,
};
