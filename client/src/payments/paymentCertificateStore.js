/**
 * BL-011D.01 / BL-011D.03 — Payment Certificate persistence (Doc 36).
 */

import { appendPackageActivity, ensurePackageRecord } from './subcontractPackageStore';
import { notifyCommercialChanged } from '../commercial/commercialEvents';
import {
  buildCommercialLineFromEvent,
  normalizeCommercialLines,
  validateCommercialLinesForCertificate,
} from './certificateCommercialLines';
import {
  applyRecoveryDeductionsOnCertificateApproval,
  buildRecoveryDeductionLineFromEvent,
  getRecoveryDeductionEligibilityReason,
  validateRecoveryDeductionAmount,
  validateRecoveryLinesForCertificate,
} from './certificateRecoveryLines';
import { CERTIFICATE_COMMERCIAL_LINE_TYPES } from '../commercialEvents/commercialEventCertifiability';
import { getCommercialEventById } from '../commercialEvents/commercialEventStore';
import { getCommercialEventCertifiabilityReason } from '../commercialEvents/commercialEventCertifiability';
import { resolvePackageDevelopmentId } from '../commercialEvents/commercialEventPackageValue';

const STORAGE_KEY = 'buildlite_subcontract_packages_v1';

export const CERTIFICATE_STATUSES = {
  draft: { value: 'draft', label: 'Draft', modifier: 'draft' },
  submitted: { value: 'submitted', label: 'Submitted', modifier: 'pending' },
  approved: { value: 'approved', label: 'Approved', modifier: 'approved' },
  locked: { value: 'locked', label: 'Approved', modifier: 'approved' },
};

export const CERTIFICATE_DEFAULT_STATUS = 'draft';

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function normalizePackageRecord(record) {
  if (!record) return null;
  if (!Array.isArray(record.certificates)) {
    record.certificates = [];
  }
  record.certificates = record.certificates.map(normalizeCertificate);
  return record;
}

function newAuditId() {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function sessionActor() {
  return (
    localStorage.getItem('userName') ||
    localStorage.getItem('userEmail') ||
    'Commercial Manager'
  );
}

function resolveDevelopmentIdFromOrder(order) {
  return order?.developmentId || order?.scopeId || order?.jobId || null;
}

function resolveDevelopmentIdFromOrderKey(orderKey) {
  if (!orderKey) return null;
  const [developmentId] = String(orderKey).split('::');
  return developmentId || null;
}

function notifyCertificateWorkflowChanged(orderKey, certificateId, action, order = null) {
  notifyCommercialChanged({
    source: 'certificate',
    orderKey,
    certificateId,
    action,
    developmentId:
      resolveDevelopmentIdFromOrder(order) || resolveDevelopmentIdFromOrderKey(orderKey),
  });
}

export function normalizeCertificate(certificate) {
  if (!certificate) return certificate;

  const next = { ...certificate };

  if (!Array.isArray(next.auditHistory)) {
    next.auditHistory = [];
  }

  if (
    next.auditHistory.length === 0 &&
    (next.createdAt || next.createdBy)
  ) {
    next.auditHistory.push({
      id: newAuditId(),
      action: 'created',
      actor: next.createdBy || sessionActor(),
      at: next.createdAt || new Date().toISOString(),
    });
  }

  if (next.status === 'approved') {
    next.status = 'locked';
  }

  if (!Array.isArray(next.commercialLines)) {
    next.commercialLines = [];
  }

  return next;
}

export function getCertificateStatusMeta(statusValue) {
  return (
    CERTIFICATE_STATUSES[statusValue] ||
    CERTIFICATE_STATUSES[CERTIFICATE_DEFAULT_STATUS]
  );
}

export function isApprovedCommercialCertificate(certificate) {
  const status = certificate?.status;
  return status === 'approved' || status === 'locked';
}

export function isCertificateEditable(certificate) {
  return certificate?.status === CERTIFICATE_DEFAULT_STATUS;
}

export function isCertificateSubmitted(certificate) {
  return certificate?.status === 'submitted';
}

export function canCreateNextCertificate(orderKey) {
  const certificates = listCertificates(orderKey);
  const openCertificate = certificates.find(
    (item) => item.status === 'draft' || item.status === 'submitted'
  );

  if (openCertificate) {
    return {
      ok: false,
      reason: `Certificate No. ${openCertificate.certificateNumber} must be approved before creating the next certificate.`,
    };
  }

  return { ok: true };
}

export function listCertificates(orderKey) {
  const record = normalizePackageRecord(readAll()[orderKey]);
  if (!record) return [];

  return [...record.certificates].sort(
    (a, b) => a.certificateNumber - b.certificateNumber
  );
}

export function listApprovedCertificates(orderKey) {
  return listCertificates(orderKey).filter(isApprovedCommercialCertificate);
}

export function getCertificate(orderKey, certificateId) {
  return (
    listCertificates(orderKey).find((item) => item.id === certificateId) || null
  );
}

export function getCertificateCount(orderKey) {
  return listCertificates(orderKey).length;
}

export function getNextCertificateNumber(orderKey) {
  const certificates = listCertificates(orderKey);
  if (!certificates.length) return 1;
  return Math.max(...certificates.map((item) => item.certificateNumber)) + 1;
}

function appendAuditEvent(certificate, entry) {
  const event = {
    id: newAuditId(),
    action: entry.action,
    actor: entry.actor || sessionActor(),
    at: entry.at || new Date().toISOString(),
    comment: entry.comment || '',
  };

  certificate.auditHistory = [event, ...(certificate.auditHistory || [])];
  return event;
}

function updateCertificateRecord(orderKey, certificateId, updater) {
  const all = readAll();
  const record = normalizePackageRecord(all[orderKey]);
  if (!record) {
    return { ok: false, errors: ['Package not found.'] };
  }

  const index = record.certificates.findIndex((item) => item.id === certificateId);
  if (index < 0) {
    return { ok: false, errors: ['Certificate not found.'] };
  }

  const current = record.certificates[index];
  const next = updater({ ...current });
  if (!next) {
    return { ok: false, errors: ['Certificate update failed.'] };
  }

  record.certificates[index] = {
    ...normalizeCertificate(next),
    updatedAt: new Date().toISOString(),
  };
  record.updatedAt = record.certificates[index].updatedAt;
  all[orderKey] = record;
  writeAll(all);

  return { ok: true, certificate: record.certificates[index] };
}

export function createCertificate(orderKey, order = {}) {
  const gate = canCreateNextCertificate(orderKey);
  if (!gate.ok) {
    return { ok: false, errors: [gate.reason] };
  }

  ensurePackageRecord(orderKey, order);

  const all = readAll();
  const record = normalizePackageRecord(all[orderKey]);
  if (!record) {
    return { ok: false, errors: ['Package not found.'] };
  }

  const now = new Date().toISOString();
  const actor = sessionActor();
  const certificateNumber = getNextCertificateNumber(orderKey);
  const certificate = normalizeCertificate({
    id: `cert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    certificateNumber,
    status: CERTIFICATE_DEFAULT_STATUS,
    certificateDate: now.slice(0, 10),
    createdBy: actor,
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    grossValue: null,
    netValue: null,
    progress: {},
    commercialLines: [],
    auditHistory: [],
    createdAt: now,
    updatedAt: now,
  });

  appendAuditEvent(certificate, { action: 'created', actor, at: now });

  record.certificates.push(certificate);
  record.updatedAt = now;
  all[orderKey] = record;
  writeAll(all);

  appendPackageActivity(orderKey, {
    label: `Payment Certificate ${certificateNumber} created`,
    modifier: 'certificate',
  });

  notifyCertificateWorkflowChanged(orderKey, certificate.id, 'created', order);

  return { ok: true, certificate };
}

export function deleteCertificate(orderKey, certificateId) {
  const all = readAll();
  const record = normalizePackageRecord(all[orderKey]);
  if (!record) {
    return { ok: false, errors: ['Package not found.'] };
  }

  const certificate = record.certificates.find((item) => item.id === certificateId);
  if (!certificate) {
    return { ok: false, errors: ['Certificate not found.'] };
  }

  if (certificate.status !== CERTIFICATE_DEFAULT_STATUS) {
    return { ok: false, errors: ['Only draft certificates can be deleted.'] };
  }

  record.certificates = record.certificates.filter(
    (item) => item.id !== certificateId
  );
  record.updatedAt = new Date().toISOString();
  all[orderKey] = record;
  writeAll(all);

  notifyCertificateWorkflowChanged(orderKey, certificateId, 'deleted');

  return { ok: true };
}

export function submitCertificate(orderKey, certificateId) {
  const result = updateCertificateRecord(orderKey, certificateId, (certificate) => {
    if (certificate.status !== CERTIFICATE_DEFAULT_STATUS) {
      return null;
    }

    const now = new Date().toISOString();
    const actor = sessionActor();
    appendAuditEvent(certificate, { action: 'submitted', actor, at: now });

    return {
      ...certificate,
      status: 'submitted',
      submittedBy: actor,
      submittedAt: now,
    };
  });

  if (result.ok) {
    notifyCertificateWorkflowChanged(orderKey, certificateId, 'submitted');
  }

  return result;
}

export function approveCertificate(orderKey, certificateId, totals = {}, order = null) {
  const developmentId = resolveDevelopmentIdForOrderKey(orderKey, order);
  const certificate = getCertificate(orderKey, certificateId);

  if (certificate?.status === 'submitted') {
    const recoveryValidation = validateRecoveryLinesForCertificate({
      orderKey,
      certificateId,
      developmentId,
      commercialLines: certificate.commercialLines,
      forApproval: true,
    });

    if (!recoveryValidation.valid) {
      return { ok: false, errors: recoveryValidation.errors };
    }
  }

  const result = updateCertificateRecord(orderKey, certificateId, (certificate) => {
    if (certificate.status !== 'submitted') {
      return null;
    }

    const now = new Date().toISOString();
    const actor = sessionActor();
    appendAuditEvent(certificate, { action: 'approved', actor, at: now });

    appendPackageActivity(orderKey, {
      label: `Payment Certificate ${certificate.certificateNumber} approved`,
      modifier: 'approved',
    });

    return {
      ...certificate,
      status: 'locked',
      approvedBy: actor,
      approvedAt: now,
      grossValue:
        totals.grossWorksThisCertificate ??
        totals.grossThisCertificate ??
        certificate.grossValue,
      netValue: totals.netPayment ?? certificate.netValue,
    };
  });

  if (result.ok) {
    applyRecoveryDeductionsOnCertificateApproval({
      developmentId,
      orderKey,
      certificate: result.certificate,
    });

    updateCertificateRecord(orderKey, certificateId, (certificate) => ({
      ...certificate,
      recoveryDeductionsApplied: true,
    }));

    notifyCertificateWorkflowChanged(orderKey, certificateId, 'approved', order);
  }

  return result;
}

export function rejectCertificate(orderKey, certificateId, comment = '') {
  const trimmed = String(comment || '').trim();
  if (!trimmed) {
    return { ok: false, errors: ['A rejection comment is required.'] };
  }

  const result = updateCertificateRecord(orderKey, certificateId, (certificate) => {
    if (certificate.status !== 'submitted') {
      return null;
    }

    const now = new Date().toISOString();
    const actor = sessionActor();
    appendAuditEvent(certificate, {
      action: 'rejected',
      actor,
      at: now,
      comment: trimmed,
    });

    return {
      ...certificate,
      status: CERTIFICATE_DEFAULT_STATUS,
      submittedBy: null,
      submittedAt: null,
    };
  });

  if (result.ok) {
    notifyCertificateWorkflowChanged(orderKey, certificateId, 'rejected');
  }

  return result;
}

export function updateCertificateProgress(orderKey, certificateId, progressPatch) {
  const all = readAll();
  const record = normalizePackageRecord(all[orderKey]);
  if (!record) {
    return { ok: false, errors: ['Package not found.'] };
  }

  const index = record.certificates.findIndex((item) => item.id === certificateId);
  if (index < 0) {
    return { ok: false, errors: ['Certificate not found.'] };
  }

  const certificate = record.certificates[index];
  if (!isCertificateEditable(certificate)) {
    return { ok: false, errors: ['Only draft certificates can be edited.'] };
  }

  const nextProgress = { ...(certificate.progress || {}) };

  for (const [cellKey, value] of Object.entries(progressPatch)) {
    const pct = Number.parseFloat(String(value?.thisCertificatePct ?? value));
    if (!Number.isFinite(pct) || pct === 0) {
      delete nextProgress[cellKey];
    } else {
      nextProgress[cellKey] = { thisCertificatePct: pct };
    }
  }

  record.certificates[index] = {
    ...certificate,
    progress: nextProgress,
    updatedAt: new Date().toISOString(),
  };
  record.updatedAt = record.certificates[index].updatedAt;
  all[orderKey] = record;
  writeAll(all);

  return { ok: true, certificate: record.certificates[index] };
}

export function updateCertificateCellProgress(
  orderKey,
  certificateId,
  cellKey,
  thisCertificatePct
) {
  return updateCertificateProgress(orderKey, certificateId, {
    [cellKey]: { thisCertificatePct },
  });
}

function resolveDevelopmentIdForOrderKey(orderKey, order = null) {
  return resolvePackageDevelopmentId(order) || resolveDevelopmentIdFromOrderKey(orderKey);
}

export function updateCertificateCommercialLines(
  orderKey,
  certificateId,
  commercialLines,
  order = null
) {
  const developmentId = resolveDevelopmentIdForOrderKey(orderKey, order);
  const validation = validateCommercialLinesForCertificate({
    orderKey,
    certificateId,
    developmentId,
    commercialLines,
  });

  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  const result = updateCertificateRecord(orderKey, certificateId, (certificate) => {
    if (!isCertificateEditable(certificate)) {
      return null;
    }

    return {
      ...certificate,
      commercialLines: normalizeCommercialLines(validation.commercialLines),
    };
  });

  if (result.ok) {
    notifyCertificateWorkflowChanged(orderKey, certificateId, 'commercial-lines-updated', order);
  }

  return result;
}

export function addCommercialLineToCertificate(
  orderKey,
  certificateId,
  commercialEventId,
  amountThisCertificate,
  order = null
) {
  const developmentId = resolveDevelopmentIdForOrderKey(orderKey, order);
  const certificate = getCertificate(orderKey, certificateId);
  if (!certificate) {
    return { ok: false, errors: ['Certificate not found.'] };
  }
  if (!isCertificateEditable(certificate)) {
    return { ok: false, errors: ['Only draft certificates can edit commercial lines.'] };
  }

  const event = getCommercialEventById(developmentId, commercialEventId);
  if (!event) {
    return { ok: false, errors: ['Commercial event not found.'] };
  }
  if (event.packageId !== orderKey) {
    return { ok: false, errors: ['Commercial event must belong to this package.'] };
  }

  const certifiabilityReason = getCommercialEventCertifiabilityReason(event);
  if (certifiabilityReason) {
    return { ok: false, errors: [certifiabilityReason] };
  }

  const existing = normalizeCommercialLines(certificate.commercialLines);
  if (existing.some((line) => line.commercialEventId === commercialEventId)) {
    return {
      ok: false,
      errors: ['This commercial event is already included on the certificate.'],
    };
  }

  const nextLines = [
    ...existing,
    buildCommercialLineFromEvent(event, amountThisCertificate),
  ];

  return updateCertificateCommercialLines(orderKey, certificateId, nextLines, order);
}

export function updateCommercialLineAmount(
  orderKey,
  certificateId,
  lineId,
  amountThisCertificate,
  order = null
) {
  const certificate = getCertificate(orderKey, certificateId);
  if (!certificate) {
    return { ok: false, errors: ['Certificate not found.'] };
  }

  const nextLines = normalizeCommercialLines(certificate.commercialLines).map((line) =>
    line.id === lineId
      ? { ...line, amountThisCertificate }
      : line
  );

  return updateCertificateCommercialLines(orderKey, certificateId, nextLines, order);
}

export function removeCommercialLineFromCertificate(
  orderKey,
  certificateId,
  lineId,
  order = null
) {
  const certificate = getCertificate(orderKey, certificateId);
  if (!certificate) {
    return { ok: false, errors: ['Certificate not found.'] };
  }

  const nextLines = normalizeCommercialLines(certificate.commercialLines).filter(
    (line) => line.id !== lineId
  );

  return updateCertificateCommercialLines(orderKey, certificateId, nextLines, order);
}

export function addRecoveryLineToCertificate(
  orderKey,
  certificateId,
  commercialEventId,
  rawAmount,
  order = null
) {
  const developmentId = resolveDevelopmentIdForOrderKey(orderKey, order);
  const certificate = getCertificate(orderKey, certificateId);
  if (!certificate) {
    return { ok: false, errors: ['Certificate not found.'] };
  }
  if (!isCertificateEditable(certificate)) {
    return { ok: false, errors: ['Only draft certificates can edit recovery deductions.'] };
  }

  const event = getCommercialEventById(developmentId, commercialEventId);
  if (!event) {
    return { ok: false, errors: ['Commercial event not found.'] };
  }
  if (event.packageId !== orderKey) {
    return { ok: false, errors: ['Recovery event must belong to this package.'] };
  }

  const eligibilityReason = getRecoveryDeductionEligibilityReason(event);
  if (eligibilityReason) {
    return { ok: false, errors: [eligibilityReason] };
  }

  const amountCheck = validateRecoveryDeductionAmount(rawAmount, event, orderKey, {
    excludeCertificateId: certificateId,
  });
  if (!amountCheck.valid) {
    return { ok: false, errors: amountCheck.errors };
  }

  const existing = normalizeCommercialLines(certificate.commercialLines);
  if (
    existing.some(
      (line) =>
        line.commercialEventId === commercialEventId &&
        line.lineType === CERTIFICATE_COMMERCIAL_LINE_TYPES.recoveryDeduction
    )
  ) {
    return {
      ok: false,
      errors: ['This recovery event is already included on the certificate.'],
    };
  }

  const nextLines = [
    ...existing,
    buildRecoveryDeductionLineFromEvent(event, amountCheck.amount),
  ];

  return updateCertificateCommercialLines(orderKey, certificateId, nextLines, order);
}

export function updateRecoveryLineAmount(
  orderKey,
  certificateId,
  lineId,
  rawAmount,
  order = null
) {
  const developmentId = resolveDevelopmentIdForOrderKey(orderKey, order);
  const certificate = getCertificate(orderKey, certificateId);
  if (!certificate) {
    return { ok: false, errors: ['Certificate not found.'] };
  }

  const line = normalizeCommercialLines(certificate.commercialLines).find(
    (item) => item.id === lineId
  );
  if (!line || line.lineType !== CERTIFICATE_COMMERCIAL_LINE_TYPES.recoveryDeduction) {
    return { ok: false, errors: ['Recovery line not found.'] };
  }

  const event = getCommercialEventById(developmentId, line.commercialEventId);
  if (!event) {
    return { ok: false, errors: ['Recovery event not found.'] };
  }

  const amountCheck = validateRecoveryDeductionAmount(rawAmount, event, orderKey, {
    excludeCertificateId: certificateId,
  });
  if (!amountCheck.valid) {
    return { ok: false, errors: amountCheck.errors };
  }

  const nextLines = normalizeCommercialLines(certificate.commercialLines).map((item) =>
    item.id === lineId ? { ...item, amountThisCertificate: amountCheck.amount } : item
  );

  return updateCertificateCommercialLines(orderKey, certificateId, nextLines, order);
}

export function removeRecoveryLineFromCertificate(
  orderKey,
  certificateId,
  lineId,
  order = null
) {
  const certificate = getCertificate(orderKey, certificateId);
  if (!certificate) {
    return { ok: false, errors: ['Certificate not found.'] };
  }

  const line = normalizeCommercialLines(certificate.commercialLines).find(
    (item) => item.id === lineId
  );
  if (!line || line.lineType !== CERTIFICATE_COMMERCIAL_LINE_TYPES.recoveryDeduction) {
    return { ok: false, errors: ['Recovery line not found.'] };
  }

  const nextLines = normalizeCommercialLines(certificate.commercialLines).filter(
    (item) => item.id !== lineId
  );

  return updateCertificateCommercialLines(orderKey, certificateId, nextLines, order);
}
