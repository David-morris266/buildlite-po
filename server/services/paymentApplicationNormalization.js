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
  } else {
    reason = "Net-only applications are not comparable with gross assessment without a structured bridge.";
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

module.exports = { APPLICATION_BASES, moneyOrNull, normalizeApplication };
