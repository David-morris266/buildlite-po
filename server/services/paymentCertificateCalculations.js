/**
 * BL-030A — Pure certificate progress calculations.
 * Port of client/src/payments/paymentCertificateCalculations.js — do not redesign.
 *
 * Commercial rule:
 *   This Certificate % = Cumulative % − Previous Approved %
 * Complete (✓) sets cumulative progress to 100%.
 */

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundPct(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizePct(value) {
  const n = Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return 0;
  return roundPct(n);
}

function sumPreviousApprovedProgress(priorThisCertificatePcts = []) {
  let cumulativePct = 0;

  for (const raw of priorThisCertificatePcts) {
    const pct = normalizePct(raw);
    if (pct > 0) {
      cumulativePct = roundPct(Math.min(100, cumulativePct + pct));
    }
  }

  return cumulativePct;
}

function resolveThisCertificatePct(
  previousCumulativePct,
  rawEntry,
  { complete = false } = {}
) {
  const previous = normalizePct(previousCumulativePct);

  if (complete) {
    return Math.max(0, roundPct(100 - previous));
  }

  if (rawEntry === "" || rawEntry == null) {
    return 0;
  }

  const entry = normalizePct(rawEntry);

  if (entry >= 99.995) {
    return Math.max(0, roundPct(100 - previous));
  }

  return entry;
}

function validateThisCertificatePct(
  previousCumulativePct,
  rawEntry,
  options = {}
) {
  const pct = resolveThisCertificatePct(previousCumulativePct, rawEntry, options);
  const previous = normalizePct(previousCumulativePct);
  const errors = [];

  if (pct < 0) {
    errors.push("Progress cannot be negative.");
  }

  if (previous + pct > 100.005) {
    errors.push("Progress cannot exceed 100% cumulative.");
  }

  return { pct, errors, valid: errors.length === 0 };
}

function calculateCertificateCellValues({
  previousCumulativePct,
  thisCertificatePct,
  contractValue,
}) {
  const previous = normalizePct(previousCumulativePct);
  const pct = normalizePct(thisCertificatePct);
  const contract = roundMoney(contractValue) ?? 0;
  const cumulativePct = roundPct(Math.min(100, previous + pct));
  const previousValue = roundMoney((contract * previous) / 100);
  const thisCertificateValue = roundMoney((contract * pct) / 100);
  const certifiedToDateValue = roundMoney((contract * cumulativePct) / 100);
  const remainingValue = roundMoney(Math.max(0, contract - certifiedToDateValue));

  return {
    previousCumulativePct: previous,
    thisCertificatePct: pct,
    cumulativePct,
    previousValue,
    thisCertificateValue,
    certifiedToDateValue,
    remainingValue,
  };
}

module.exports = {
  roundMoney,
  roundPct,
  normalizePct,
  sumPreviousApprovedProgress,
  resolveThisCertificatePct,
  validateThisCertificatePct,
  calculateCertificateCellValues,
};
