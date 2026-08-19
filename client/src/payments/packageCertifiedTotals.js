/**
 * BL-025.1 — Package-level certified gross/net totals (Doc 64 / Doc 65).
 *
 * CVR uses cvrCertifiedValue.calculatePackageCertifiedValue() as
 * gross works + signed recovery (not netValue). These helpers remain
 * explicit package-display gross/net totals.
 */

import { roundMoney } from './paymentCertificateCalculations';
import { summarizeCertificateProgress } from './paymentCertificateProgress';
import {
  isApprovedCommercialCertificate,
  resolveCertificatesForPackage,
} from './paymentCertificateStore';

function readStoredMoney(value) {
  if (value == null || value === '') return null;
  return roundMoney(value);
}

function recomputeFromProgress(orderKey, certificate, order, field) {
  if (!orderKey || !certificate?.id) return null;
  if (!certificate.progress || Object.keys(certificate.progress).length === 0) {
    return null;
  }

  const summary = summarizeCertificateProgress(orderKey, certificate.id, order);
  const totals = summary?.totals;
  if (!totals) return null;

  if (field === 'grossThisCertificate' || field === 'grossWorksThisCertificate') {
    return (
      readStoredMoney(totals.grossWorksThisCertificate) ??
      readStoredMoney(totals.grossThisCertificate)
    );
  }

  return readStoredMoney(totals[field]);
}

export function getApprovedCertificateGrossValue(certificate, orderKey = null, order = null) {
  if (!isApprovedCommercialCertificate(certificate)) return 0;

  const stored = readStoredMoney(certificate.grossValue);
  if (stored != null) return stored;

  return recomputeFromProgress(orderKey, certificate, order, 'grossThisCertificate') ?? 0;
}

export function getApprovedCertificateNetPayment(certificate, orderKey = null, order = null) {
  if (!isApprovedCommercialCertificate(certificate)) return 0;

  const stored = readStoredMoney(certificate.netValue);
  if (stored != null) return stored;

  return recomputeFromProgress(orderKey, certificate, order, 'netPayment') ?? 0;
}

export function calculatePackageCertifiedGross(orderKey, order = null) {
  const resolved = resolveCertificatesForPackage(orderKey, order);
  if (!resolved.ready) return null;

  return resolved.certificates.reduce(
    (sum, certificate) =>
      sum + getApprovedCertificateGrossValue(certificate, orderKey, order),
    0
  );
}

export function calculatePackageCertifiedNet(orderKey, order = null) {
  const resolved = resolveCertificatesForPackage(orderKey, order);
  if (!resolved.ready) return null;

  return resolved.certificates.reduce(
    (sum, certificate) =>
      sum + getApprovedCertificateNetPayment(certificate, orderKey, order),
    0
  );
}

export function calculateCommercialProgressPct(grossCertified, currentContractValue) {
  if (currentContractValue == null || grossCertified == null) return null;
  const contract = roundMoney(currentContractValue);
  const gross = roundMoney(grossCertified);
  if (gross == null) return null;
  if (contract <= 0) return 0;
  return Math.round((gross / contract) * 100);
}

export function calculateRemainingContractValue(currentContractValue, certifiedGrossToDate) {
  if (currentContractValue == null || certifiedGrossToDate == null) return null;
  const contract = roundMoney(currentContractValue);
  const gross = roundMoney(certifiedGrossToDate);
  if (gross == null) return null;
  return roundMoney(contract - gross);
}
