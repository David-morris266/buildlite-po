/**
 * BL-012E — Certified Value aggregation (Doc 40 commercial facts).
 * Certified Value is informational only; it does not affect forecast calculations.
 */

import {
  isApprovedCommercialCertificate,
  resolveCertificatesForPackage,
} from '../payments/paymentCertificateStore';
import { roundMoney } from './cvrCalculations.js';

export function getApprovedCertificateValue(certificate) {
  if (!isApprovedCommercialCertificate(certificate)) return 0;

  if (certificate.netValue != null && certificate.netValue !== '') {
    const net = roundMoney(certificate.netValue);
    if (net != null) return net;
  }

  if (certificate.grossValue != null && certificate.grossValue !== '') {
    const gross = roundMoney(certificate.grossValue);
    if (gross != null) return gross;
  }

  return 0;
}

export function calculatePackageCertifiedValue(orderKey, order = null) {
  const resolved = resolveCertificatesForPackage(orderKey, order);
  if (!resolved.ready) return null;

  return resolved.certificates.reduce(
    (sum, certificate) => sum + getApprovedCertificateValue(certificate),
    0
  );
}

export function calculateOutstandingCertified(certified, actualCost) {
  if (certified == null) return null;
  const certifiedValue = roundMoney(certified);
  if (certifiedValue == null) return null;
  const actual = roundMoney(actualCost) ?? 0;
  return roundMoney(Math.max(0, certifiedValue - actual));
}

export function getOutstandingCertifiedState(certified, actualCost) {
  if (certified == null) return 'neutral';
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
