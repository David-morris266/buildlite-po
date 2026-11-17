// Eligibility only. Money continues through paymentCertificateFinancials.
function variationOnlyError({ matrix, progress = {}, confirmation, lockedCertificates = [], valuationSnapshot }) {
  if (!confirmation || confirmation.orderedWorks !== 0 || !confirmation.confirmedAt || !confirmation.confirmedBy?.userId) {
    return 'Explicit QS confirmation of zero ordered works is required for a variation-only certificate.';
  }
  if (matrix) return 'An Order Matrix now exists. Review and remove the variation-only confirmation before using matrix valuation.';
  if (Object.keys(progress || {}).length || valuationSnapshot?.cells?.length) return 'Ordered-work progress or valuation evidence prevents variation-only certification.';
  for (const prior of lockedCertificates) {
    if (Object.keys(prior.progress || {}).length || prior.valuationSnapshot?.cells?.length || Number(prior.matrixGross || 0) !== 0) {
      return 'Previous ordered-work certification prevents variation-only treatment without an Order Matrix.';
    }
    if (prior.matrixGross == null && prior.valuationSnapshot?.valuationBasis !== 'variation_only') {
      return 'Previous ordered-work certification evidence is unavailable. An Order Matrix is required.';
    }
  }
  return null;
}
module.exports = { variationOnlyError };
