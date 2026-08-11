/**
 * BL-024A.2 — Read-only certificate helpers for Commercial Assistant.
 */

import { listCommercialEventsByPackage } from '../commercialEvents/commercialEventStore';
import { isActiveRecovery } from '../commercialEvents/commercialEventRecovery';
import {
  buildPackageCommercialDisplayFields,
  formatSignedCommercialEventValue,
} from '../commercialEvents/commercialEventPackageValue';
import { isRecoveryCommercialEvent } from '../commercialEvents/commercialEventRegisterBadges';
import { hasCommercialEventCertificationRemaining } from '../commercialEvents/commercialEventCertificateLifecycle';
import {
  COMMERCIAL_EVENT_STATUSES,
  PACKAGE_VALUE_STATUSES,
} from '../commercialEvents/commercialEventTypes';
import {
  getCertificateStatusMeta,
  isApprovedCommercialCertificate,
  isCertificateEditable,
  isCertificateSubmitted,
  listApprovedCertificates,
  listCertificates,
} from '../payments/paymentCertificateStore';

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseWhen(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function daysBetween(fromIso, toDate = new Date()) {
  const from = parseWhen(fromIso);
  if (!from) return null;
  const diffMs = toDate.getTime() - from.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function resolveCertificateAnchorDate(certificate) {
  if (!certificate) return null;
  const anchor =
    certificate.approvedAt ||
    certificate.certificateDate ||
    certificate.createdAt ||
    null;
  const parsed = parseWhen(anchor);
  return parsed ? parsed.toISOString() : null;
}

export function getLastApprovedCertificate(orderKey) {
  const approved = listApprovedCertificates(orderKey);
  if (!approved.length) return null;

  return [...approved].sort((left, right) => {
    const leftNumber = toNumber(left.certificateNumber);
    const rightNumber = toNumber(right.certificateNumber);
    if (leftNumber !== rightNumber) return rightNumber - leftNumber;

    const leftAnchor = parseWhen(resolveCertificateAnchorDate(left));
    const rightAnchor = parseWhen(resolveCertificateAnchorDate(right));
    return (rightAnchor?.getTime() || 0) - (leftAnchor?.getTime() || 0);
  })[0];
}

export function getActiveOpenCertificate(orderKey) {
  return (
    listCertificates(orderKey).find(
      (certificate) =>
        isCertificateEditable(certificate) || isCertificateSubmitted(certificate)
    ) || null
  );
}

export function hasActiveOpenCertificate(orderKey) {
  return Boolean(getActiveOpenCertificate(orderKey));
}

export function getDaysSinceLastApprovedCertificate(orderKey, now = new Date()) {
  const lastApproved = getLastApprovedCertificate(orderKey);
  if (!lastApproved) return null;

  const anchor = resolveCertificateAnchorDate(lastApproved);
  if (!anchor) return null;

  return daysBetween(anchor, now);
}

export function isCommercialEventAwaitingValuation(event, orderKey) {
  if (!event?.id || !orderKey) return false;
  if (!PACKAGE_VALUE_STATUSES.has(event.status)) return false;
  if (event.status !== COMMERCIAL_EVENT_STATUSES.approved.key) return false;
  if (isRecoveryCommercialEvent(event)) return false;

  return hasCommercialEventCertificationRemaining(event, orderKey);
}

export function listApprovedEventsAwaitingValuation(developmentId, orderKey) {
  return listCommercialEventsByPackage(developmentId, orderKey).filter((event) =>
    isCommercialEventAwaitingValuation(event, orderKey)
  );
}

export function getOutstandingRecoveryAmount(event) {
  if (!event || !isRecoveryCommercialEvent(event)) return 0;
  if (!PACKAGE_VALUE_STATUSES.has(event.status)) return 0;
  if (!isActiveRecovery(event)) return 0;

  const absoluteValue = Math.abs(toNumber(event.value));
  const recovered = toNumber(event.recoveredAmount);
  return Math.max(0, absoluteValue - recovered);
}

export function buildPackageAssistantFacts(packageRow = {}, developmentId, now = new Date()) {
  const orderKey = packageRow?.orderKey || null;
  if (!orderKey || !developmentId) {
    return {
      orderKey: null,
      supplierLabel: packageRow?.supplierLabel || '—',
      costCode: packageRow?.costCode ?? '—',
      currentPackageValue: null,
      lastApprovedCertificate: null,
      daysSinceLastCertificate: null,
      activeOpenCertificate: null,
    };
  }

  const order = {
    orderKey,
    developmentId,
    supplierId: packageRow.supplierId,
    costCode: packageRow.costCode,
    committedValue: packageRow.committedValue,
    supplierLabel: packageRow.supplierLabel,
    projectLabel: packageRow.projectLabel,
  };

  const display = buildPackageCommercialDisplayFields(order);
  const lastApprovedCertificate = getLastApprovedCertificate(orderKey);

  return {
    orderKey,
    supplierLabel: packageRow.supplierLabel || '—',
    costCode: packageRow.costCode ?? '—',
    currentPackageValue: display.currentPackageValue,
    currentPackageValueLabel: formatSignedCommercialEventValue(display.currentPackageValue),
    lastApprovedCertificate,
    lastCertificateDate: lastApprovedCertificate
      ? resolveCertificateAnchorDate(lastApprovedCertificate)?.slice(0, 10) || '—'
      : null,
    daysSinceLastCertificate: getDaysSinceLastApprovedCertificate(orderKey, now),
    activeOpenCertificate: getActiveOpenCertificate(orderKey),
  };
}

export function formatCertificateStatusLabel(certificate) {
  if (!certificate) return '—';
  return getCertificateStatusMeta(certificate.status).label;
}

export function isPackageInDevelopment(packageRow, developmentId) {
  if (!packageRow?.orderKey || !developmentId) return false;
  if (packageRow.developmentId) {
    return packageRow.developmentId === developmentId;
  }
  return packageRow.orderKey.startsWith(`${developmentId}::`);
}
