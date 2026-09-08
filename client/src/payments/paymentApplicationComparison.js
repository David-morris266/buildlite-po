export const APPLICATION_BASES = {
  currentPeriodGross: 'current_period_gross',
  cumulativeLessPreviousApplication: 'cumulative_less_previous_application',
  cumulativeLessPreviousCertified: 'cumulative_less_previous_certified',
  netOnly: 'net_only',
};

const number = (value) => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const money = (value) => Math.round(value * 100) / 100;

export function validatePaymentApplicationBasis(application) {
  const errors = {};
  const requireMoney = (field, message) => { if (number(application?.[field]) === null) errors[field] = message; };
  if (application?.applicationBasis === APPLICATION_BASES.currentPeriodGross) {
    requireMoney('currentPeriodGrossClaimed', 'Enter the current-period gross claimed.');
  } else if (application?.applicationBasis === APPLICATION_BASES.cumulativeLessPreviousApplication) {
    requireMoney('cumulativeGrossClaimed', 'Enter the cumulative gross application.');
    requireMoney('previousApplicationStated', 'Enter the previous application amount.');
  } else if (application?.applicationBasis === APPLICATION_BASES.cumulativeLessPreviousCertified) {
    requireMoney('cumulativeGrossClaimed', 'Enter the cumulative gross application.');
    requireMoney('previousCertifiedStated', 'Enter the previous certified amount stated by the contractor/application.');
  } else if (application?.applicationBasis === APPLICATION_BASES.netOnly) {
    requireMoney('netRequestedStated', 'Enter the net amount requested.');
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export function comparePaymentApplication(application, assessmentGross) {
  if (!application) return { comparable: false, reason: 'No subcontractor application recorded.' };
  let applied = null;
  let reason = null;
  const cumulative = number(application.cumulativeGrossClaimed);
  if (application.applicationBasis === APPLICATION_BASES.currentPeriodGross) {
    applied = number(application.currentPeriodGrossClaimed);
    if (applied === null) reason = 'Current-period gross was not supplied.';
  } else if (application.applicationBasis === APPLICATION_BASES.cumulativeLessPreviousApplication) {
    const previous = number(application.previousApplicationStated);
    if (cumulative !== null && previous !== null) applied = money(cumulative - previous);
    else reason = 'Cumulative gross and previous application are both required.';
  } else if (application.applicationBasis === APPLICATION_BASES.cumulativeLessPreviousCertified) {
    const previous = number(application.previousCertifiedStated);
    if (cumulative !== null && previous !== null) applied = money(cumulative - previous);
    else reason = 'Cumulative gross and previous certified are both required.';
  } else if (application.applicationBasis === APPLICATION_BASES.netOnly) reason = 'Net-only applications do not provide the gross value needed for the normal Application vs Assessment comparison.';
  else reason = 'The application basis is not supported.';
  const assessed = number(assessmentGross);
  const comparable = applied !== null && assessed !== null;
  return {
    comparable,
    comparisonBasis: comparable ? 'Current-period gross' : null,
    applicationBasis: application.applicationBasis,
    applicationCurrentGross: applied,
    applicationCumulativeGross: cumulative,
    applicationNetRequested: application.applicationBasis === APPLICATION_BASES.netOnly
      ? number(application.netRequestedStated)
      : null,
    assessmentCurrentGross: assessed,
    difference: comparable ? money(assessed - applied) : null,
    reason: comparable ? null : (reason || 'BuildLite assessment is not available.'),
  };
}
