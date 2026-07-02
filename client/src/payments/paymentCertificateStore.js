/**
 * BL-011D.01 — Payment Certificate persistence on Subcontract Packages (Doc 36).
 */

import { appendPackageActivity, ensurePackageRecord } from './subcontractPackageStore';

const STORAGE_KEY = 'buildlite_subcontract_packages_v1';

export const CERTIFICATE_STATUSES = {
  draft: { value: 'draft', label: 'Draft', modifier: 'draft' },
  approved: { value: 'approved', label: 'Approved', modifier: 'approved' },
  locked: { value: 'locked', label: 'Locked', modifier: 'locked' },
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
  return record;
}

function newCertificateId() {
  return `cert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function sessionActor() {
  return (
    localStorage.getItem('userName') ||
    localStorage.getItem('userEmail') ||
    'Commercial Manager'
  );
}

export function getCertificateStatusMeta(statusValue) {
  return (
    CERTIFICATE_STATUSES[statusValue] ||
    CERTIFICATE_STATUSES[CERTIFICATE_DEFAULT_STATUS]
  );
}

export function listCertificates(orderKey) {
  const record = normalizePackageRecord(readAll()[orderKey]);
  if (!record) return [];

  return [...record.certificates].sort(
    (a, b) => a.certificateNumber - b.certificateNumber
  );
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

export function createCertificate(orderKey, order = {}) {
  ensurePackageRecord(orderKey, order);

  const all = readAll();
  const record = normalizePackageRecord(all[orderKey]);
  if (!record) {
    return { ok: false, errors: ['Package not found.'] };
  }

  const now = new Date().toISOString();
  const certificateNumber = getNextCertificateNumber(orderKey);
  const certificate = {
    id: newCertificateId(),
    certificateNumber,
    status: CERTIFICATE_DEFAULT_STATUS,
    certificateDate: todayIsoDate(),
    createdBy: sessionActor(),
    approvedBy: null,
    grossValue: null,
    netValue: null,
    createdAt: now,
    updatedAt: now,
  };

  record.certificates.push(certificate);
  record.updatedAt = now;
  all[orderKey] = record;
  writeAll(all);

  appendPackageActivity(orderKey, {
    label: `Payment Certificate ${certificateNumber} created`,
    modifier: 'certificate',
  });

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

  return { ok: true };
}
