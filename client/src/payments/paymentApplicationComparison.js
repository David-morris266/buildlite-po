export const APPLICATION_BASES = {
  currentPeriodGross: 'current_period_gross',
  cumulativeLessPreviousApplication: 'cumulative_less_previous_application',
  cumulativeLessPreviousCertified: 'cumulative_less_previous_certified',
  netOnly: 'net_only',
};

const number = (value) => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const money = (value) => Math.round(value * 100) / 100;

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
  } else reason = 'Net-only applications are not comparable with gross assessment without a structured bridge.';
  const assessed = number(assessmentGross);
  const comparable = applied !== null && assessed !== null;
  return { comparable, comparisonBasis: comparable ? 'Current-period gross' : null, applicationCurrentGross: applied, applicationCumulativeGross: cumulative, assessmentCurrentGross: assessed, difference: comparable ? money(assessed - applied) : null, reason: comparable ? null : (reason || 'BuildLite assessment is not available.') };
}
