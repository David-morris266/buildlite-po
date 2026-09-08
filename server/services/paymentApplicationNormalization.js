const APPLICATION_BASES = Object.freeze({
  cumulativeLessPreviousApplication: "cumulative_less_previous_application",
  cumulativeLessPreviousCertified: "cumulative_less_previous_certified",
  currentPeriodGross: "current_period_gross",
  netOnly: "net_only",
});

function moneyOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function validateApplicationBasis(application) {
  const basis = application?.applicationBasis || application?.application_basis;
  const errors = [];
  const requireMoney = (camel, snake, message) => {
    if (moneyOrNull(application?.[camel] ?? application?.[snake]) === null) errors.push({ field: camel, message });
  };
  if (basis === APPLICATION_BASES.currentPeriodGross) {
    requireMoney("currentPeriodGrossClaimed", "current_period_gross_claimed", "Current-period gross claimed is required.");
  } else if (basis === APPLICATION_BASES.cumulativeLessPreviousApplication) {
    requireMoney("cumulativeGrossClaimed", "cumulative_gross_claimed", "Cumulative gross application is required.");
    requireMoney("previousApplicationStated", "previous_application_stated", "Previous application amount is required.");
  } else if (basis === APPLICATION_BASES.cumulativeLessPreviousCertified) {
    requireMoney("cumulativeGrossClaimed", "cumulative_gross_claimed", "Cumulative gross application is required.");
    requireMoney("previousCertifiedStated", "previous_certified_stated", "Previous certified stated by the contractor/application is required.");
  } else if (basis === APPLICATION_BASES.netOnly) {
    requireMoney("netRequestedStated", "net_requested_stated", "Net amount requested is required.");
  }
  return { valid: errors.length === 0, errors };
}

function normalizeApplication(application, assessmentTotals = null) {
  const basis = application?.applicationBasis || application?.application_basis;
  const cumulative = moneyOrNull(application?.cumulativeGrossClaimed ?? application?.cumulative_gross_claimed);
  const current = moneyOrNull(application?.currentPeriodGrossClaimed ?? application?.current_period_gross_claimed);
  const previousApplication = moneyOrNull(application?.previousApplicationStated ?? application?.previous_application_stated);
  const previousCertified = moneyOrNull(application?.previousCertifiedStated ?? application?.previous_certified_stated);
  const assessmentGross = moneyOrNull(
    assessmentTotals?.grossWorksThisCertificate ?? assessmentTotals?.grossValue
  );

  let normalizedCurrentGross = null;
  let reason = null;
  if (basis === APPLICATION_BASES.currentPeriodGross) {
    normalizedCurrentGross = current;
    if (current === null) reason = "Current-period gross was not supplied.";
  } else if (basis === APPLICATION_BASES.cumulativeLessPreviousApplication) {
    if (cumulative !== null && previousApplication !== null) {
      normalizedCurrentGross = Math.round((cumulative - previousApplication) * 100) / 100;
    } else reason = "Cumulative gross and previous application are both required.";
  } else if (basis === APPLICATION_BASES.cumulativeLessPreviousCertified) {
    if (cumulative !== null && previousCertified !== null) {
      normalizedCurrentGross = Math.round((cumulative - previousCertified) * 100) / 100;
    } else reason = "Cumulative gross and previous certified are both required.";
  } else if (basis === APPLICATION_BASES.netOnly) {
    reason = "Net-only applications do not provide the gross value needed for the normal Application vs Assessment comparison.";
  } else {
    reason = "The application basis is not supported.";
  }

  const comparable = normalizedCurrentGross !== null && assessmentGross !== null;
  return {
    comparable,
    comparisonBasis: comparable ? "current_period_gross" : null,
    applicationCurrentGross: normalizedCurrentGross,
    applicationCumulativeGross: cumulative,
    assessmentCurrentGross: assessmentGross,
    difference: comparable
      ? Math.round((assessmentGross - normalizedCurrentGross) * 100) / 100
      : null,
    reason: comparable ? null : (reason || "BuildLite assessment is not available."),
  };
}

module.exports = { APPLICATION_BASES, moneyOrNull, normalizeApplication, validateApplicationBasis };
