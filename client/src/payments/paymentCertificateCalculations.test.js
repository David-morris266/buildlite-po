import { describe, expect, it } from 'vitest';
import {
  calculateCertificateCellValues,
  resolveThisCertificatePct,
  sumPreviousApprovedProgress,
  validateProgressToDatePct,
  validateThisCertificatePct,
} from './paymentCertificateCalculations.js';

describe('resolveThisCertificatePct', () => {
  it('treats complete as cumulative 100% with no prior progress', () => {
    expect(resolveThisCertificatePct(0, 0, { complete: true })).toBe(100);
  });

  it('certifies only remaining progress after prior approval', () => {
    expect(resolveThisCertificatePct(40, 0, { complete: true })).toBe(60);
  });

  it('treats entering 100% as complete semantics', () => {
    expect(resolveThisCertificatePct(40, 100)).toBe(60);
  });

  it('keeps incremental entry for partial certificates', () => {
    expect(resolveThisCertificatePct(40, 25)).toBe(25);
  });

  it.each([
    [10, 90],
    [25, 75],
    [40, 60],
    [75, 25],
    [90, 10],
  ])('completes remaining progress after %s%% previously approved', (previous, expected) => {
    expect(resolveThisCertificatePct(previous, 100, { complete: true })).toBe(expected);
  });
});

describe('validateProgressToDatePct', () => {
  it.each([
    [0, 100, true, 100],
    [25, 75, true, 50],
    [25, 25, true, 0],
    [25, 20, false, -5],
    [25, 100, true, 75],
  ])('previous %s%% and cumulative %s%% returns valid=%s and movement %s%%',
    (previous, cumulative, valid, movement) => {
      const result = validateProgressToDatePct(previous, cumulative);
      expect(result.valid).toBe(valid);
      expect(result.pct).toBe(movement);
    });

  it('rejects a reduction with the approved percentage in the message', () => {
    expect(validateProgressToDatePct(25, 20).errors).toEqual([
      'Progress cannot be reduced below the previously certified 25%.',
    ]);
  });

  it('reloads a cumulative draft without compounding it', () => {
    const movement = validateProgressToDatePct(25, 75).pct;
    const reloadedProgressToDate = 25 + movement;
    expect(reloadedProgressToDate).toBe(75);
    expect(validateProgressToDatePct(25, reloadedProgressToDate).pct).toBe(50);
  });
});

describe('calculateCertificateCellValues', () => {
  const contractValue = 10000;

  it('matches UAT scenario: cert 2 complete after cert 1 at 40%', () => {
    const previous = 40;
    const thisCert = resolveThisCertificatePct(previous, 100, { complete: true });
    const values = calculateCertificateCellValues({
      previousCumulativePct: previous,
      thisCertificatePct: thisCert,
      contractValue,
    });

    expect(thisCert).toBe(60);
    expect(values.thisCertificatePct).toBe(60);
    expect(values.cumulativePct).toBe(100);
    expect(values.thisCertificateValue).toBe(6000);
    expect(values.certifiedToDateValue).toBe(10000);
    expect(values.remainingValue).toBe(0);
  });

  it('calculates certificate 1 partial progress', () => {
    const values = calculateCertificateCellValues({
      previousCumulativePct: 0,
      thisCertificatePct: 40,
      contractValue,
    });

    expect(values.thisCertificatePct).toBe(40);
    expect(values.cumulativePct).toBe(40);
    expect(values.thisCertificateValue).toBe(4000);
    expect(values.remainingValue).toBe(6000);
  });
});

describe('sumPreviousApprovedProgress', () => {
  it('sums only prior approved incremental certificates', () => {
    expect(sumPreviousApprovedProgress([40])).toBe(40);
    expect(sumPreviousApprovedProgress([40, 60])).toBe(100);
    expect(sumPreviousApprovedProgress([0, 25, 15])).toBe(40);
  });
});

describe('validateThisCertificatePct', () => {
  it('rejects incremental entry that would exceed 100% cumulative', () => {
    const result = validateThisCertificatePct(40, 70);
    expect(result.valid).toBe(false);
  });

  it('accepts complete entry after partial prior approval', () => {
    const result = validateThisCertificatePct(40, 100, { complete: true });
    expect(result.valid).toBe(true);
    expect(result.pct).toBe(60);
  });
});
