/**
 * BL-024A.1 — Persisted user disposition overlay for Commercial Assistant.
 * Only dismiss/defer actions are stored — recommendations remain derived.
 */

import { DISPOSITION_STATUS } from './commercialAssistantTypes';

export const RECOMMENDATION_DISPOSITION_STORAGE_KEY =
  'buildlite_commercial_assistant_dispositions_v1';

function readAll() {
  try {
    const raw = localStorage.getItem(RECOMMENDATION_DISPOSITION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  localStorage.setItem(RECOMMENDATION_DISPOSITION_STORAGE_KEY, JSON.stringify(data));
}

function sessionActor() {
  return (
    localStorage.getItem('userName') ||
    localStorage.getItem('userEmail') ||
    'Commercial Manager'
  );
}

function newAuditId() {
  return `asst-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeDisposition(record) {
  if (!record) return null;
  return {
    fingerprint: record.fingerprint,
    status: record.status,
    dismissedAt: record.dismissedAt || null,
    deferredAt: record.deferredAt || null,
    deferUntil: record.deferUntil || null,
    deferReason: record.deferReason || '',
    dismissReason: record.dismissReason || '',
    actor: record.actor || sessionActor(),
    auditHistory: Array.isArray(record.auditHistory) ? record.auditHistory : [],
    updatedAt: record.updatedAt || null,
  };
}

function appendAudit(record, action, detail = {}) {
  const entry = {
    id: newAuditId(),
    action,
    timestamp: new Date().toISOString(),
    actor: detail.actor || record.actor || sessionActor(),
    ...detail,
  };
  record.auditHistory = [...(record.auditHistory || []), entry];
  record.updatedAt = entry.timestamp;
  return entry;
}

export function listRecommendationDispositions() {
  const all = readAll();
  return Object.values(all).map(normalizeDisposition);
}

export function getRecommendationDisposition(fingerprint) {
  if (!fingerprint) return null;
  return normalizeDisposition(readAll()[fingerprint]);
}

export function dismissRecommendation(
  fingerprint,
  { reason = '', actor = sessionActor() } = {}
) {
  if (!fingerprint) {
    return { ok: false, errors: ['Recommendation fingerprint is required'] };
  }

  const all = readAll();
  const now = new Date().toISOString();
  const existing = normalizeDisposition(all[fingerprint]) || {
    fingerprint,
    auditHistory: [],
  };

  existing.status = DISPOSITION_STATUS.dismissed;
  existing.dismissedAt = now;
  existing.dismissReason = String(reason || '').trim();
  existing.deferredAt = null;
  existing.deferUntil = null;
  existing.deferReason = '';
  existing.actor = actor;
  appendAudit(existing, 'DISMISSED', {
    actor,
    reason: existing.dismissReason,
  });

  all[fingerprint] = existing;
  writeAll(all);
  return { ok: true, disposition: existing };
}

export function deferRecommendation(
  fingerprint,
  {
    deferUntil = null,
    deferReason = '',
    actor = sessionActor(),
  } = {}
) {
  if (!fingerprint) {
    return { ok: false, errors: ['Recommendation fingerprint is required'] };
  }

  const trimmedReason = String(deferReason || '').trim();
  if (!deferUntil && !trimmedReason) {
    return {
      ok: false,
      errors: ['Defer requires deferUntil and/or deferReason'],
    };
  }

  const all = readAll();
  const now = new Date().toISOString();
  const existing = normalizeDisposition(all[fingerprint]) || {
    fingerprint,
    auditHistory: [],
  };

  existing.status = DISPOSITION_STATUS.deferred;
  existing.deferredAt = now;
  existing.deferUntil = deferUntil || null;
  existing.deferReason = trimmedReason;
  existing.dismissedAt = null;
  existing.dismissReason = '';
  existing.actor = actor;
  appendAudit(existing, 'DEFERRED', {
    actor,
    deferUntil: existing.deferUntil,
    reason: existing.deferReason,
  });

  all[fingerprint] = existing;
  writeAll(all);
  return { ok: true, disposition: existing };
}

export function clearRecommendationDispositionsForTests() {
  localStorage.removeItem(RECOMMENDATION_DISPOSITION_STORAGE_KEY);
}
