/**
 * BL-012E — Certified Value aggregation (Doc 40 commercial facts).
 * Certified Value is informational only; it does not affect forecast calculations.
 */

import { sumRecoveryDeductionLines } from '../payments/certificateRecoveryLines';
import {
  isApprovedCommercialCertificate,
  resolveCertificatesForPackage,
} from '../payments/paymentCertificateStore';
import { roundMoney } from './cvrCalculations.js';

function readCertificateMoney(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const money = roundMoney(value);
    if (money != null) return money;
  }
  return null;
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
  return sumRecoveryDeductionLines(frozenLines) ?? 0;
}

/**
 * CVR certified cost for one approved certificate.
 * gross works + signed recovery (recoveries stored negative).
 * Does not use netValue, VAT, or retention.
 */
export function getApprovedCertificateValue(certificate) {
  if (!isApprovedCommercialCertificate(certificate)) return 0;

  const grossWorks = reconstructGrossWorks(certificate);
  if (grossWorks == null) return null;

  return roundMoney(grossWorks + reconstructRecoverySigned(certificate));
}

export function calculatePackageCertifiedValue(orderKey, order = null) {
  const resolved = resolveCertificatesForPackage(orderKey, order);
  if (!resolved.ready) return null;

  let total = 0;
  for (const certificate of resolved.certificates) {
    if (!isApprovedCommercialCertificate(certificate)) continue;
    const value = getApprovedCertificateValue(certificate);
    if (value == null) return null;
    total += value;
  }
  return roundMoney(total) ?? 0;
}

export function calculateOutstandingCertified(certified, actualCost) {
  if (certified == null) return null;
  if (actualCost == null) return null;
  const certifiedValue = roundMoney(certified);
  if (certifiedValue == null) return null;
  const actual = roundMoney(actualCost);
  if (actual == null) return null;
  return roundMoney(Math.max(0, certifiedValue - actual));
}

export function getOutstandingCertifiedState(certified, actualCost) {
  if (certified == null || actualCost == null) return 'neutral';
  const certifiedValue = roundMoney(certified) ?? 0;
  const actual = roundMoney(actualCost) ?? 0;
  const outstanding = calculateOutstandingCertified(certified, actualCost);

  if (outstanding > 0 && certifiedValue > actual) {
    return 'warning';
  }

  return 'neutral';
}

export function enrichCvrCertifiedFields(row) {
  if (row.certified == null) {
    return {
      ...row,
      outstandingCertified: null,
      outstandingCertifiedState: 'neutral',
    };
  }
  const outstandingCertified = calculateOutstandingCertified(
    row.certified,
    row.actualCost
  );

  return {
    ...row,
    outstandingCertified,
    outstandingCertifiedState: getOutstandingCertifiedState(
      row.certified,
      row.actualCost
    ),
  };
}
