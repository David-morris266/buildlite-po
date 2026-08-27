/**
 * BL-013 Iteration 3 — Pure certificate progress calculations.
 *
 * Commercial rule:
 *   This Certificate % = Cumulative % − Previous Approved %
 * Complete (✓) sets cumulative progress to 100%.
 */

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function roundPct(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function normalizePct(value) {
  const n = Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return 0;
  return roundPct(n);
}

/**
 * Sum incremental This Certificate % values from prior approved certificates.
 */
export function sumPreviousApprovedProgress(priorThisCertificatePcts = []) {
  let cumulativePct = 0;

  for (const raw of priorThisCertificatePcts) {
    const pct = normalizePct(raw);
    if (pct > 0) {
      cumulativePct = roundPct(Math.min(100, cumulativePct + pct));
    }
  }

  return cumulativePct;
}

/**
 * Convert user input into incremental This Certificate %.
 */
export function resolveThisCertificatePct(
  previousCumulativePct,
  rawEntry,
  { complete = false } = {}
) {
  const previous = normalizePct(previousCumulativePct);

  if (complete) {
    return Math.max(0, roundPct(100 - previous));
  }

  if (rawEntry === '' || rawEntry == null) {
    return 0;
  }

  const entry = normalizePct(rawEntry);

  // Entering 100% means complete (cumulative 100%), not incremental 100%.
  if (entry >= 99.995) {
    return Math.max(0, roundPct(100 - previous));
  }

  return entry;
}

export function validateThisCertificatePct(
  previousCumulativePct,
  rawEntry,
  options = {}
) {
  const pct = resolveThisCertificatePct(previousCumulativePct, rawEntry, options);
  const previous = normalizePct(previousCumulativePct);
  const errors = [];

  if (pct < 0) {
    errors.push('Progress cannot be negative.');
  }

  if (previous + pct > 100.005) {
    errors.push('Progress cannot exceed 100% cumulative.');
  }

  return { pct, errors, valid: errors.length === 0 };
}

/** Convert cumulative QS progress-to-date input to the incremental movement persisted on this certificate. */
export function validateProgressToDatePct(previousCumulativePct, rawEntry) {
  const previous = normalizePct(previousCumulativePct);
  const cumulativePct = normalizePct(rawEntry);
  const errors = [];

  if (cumulativePct < previous - 0.005) {
    errors.push(`Progress cannot be reduced below the previously certified ${previous}%.`);
  }
  if (cumulativePct > 100.005) {
    errors.push('Progress cannot exceed 100%.');
  }

  return {
    cumulativePct,
    pct: roundPct(cumulativePct - previous),
    errors,
    valid: errors.length === 0,
  };
}

/**
 * Derive cumulative values for a valuation cell.
 */
export function calculateCertificateCellValues({
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
