/**
 * BL-021A — Development-scoped Commercial Events store (client-side).
 */

import { generateNextCommercialEventNumber } from '../admin/numberingService';
import {
  COMMERCIAL_EVENT_CERTIFICATE_STATUSES,
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_VAT_TREATMENTS,
  canApproveCommercialEvent,
  canCloseCommercialEvent,
  canRejectCommercialEvent,
  canSubmitCommercialEvent,
  getCommercialEventCategoryMeta,
  getCommercialEventResponsibilityMeta,
  getCommercialEventTypeMeta,
  isCommercialEventEditable,
} from './commercialEventTypes';

export const COMMERCIAL_EVENTS_STORAGE_KEY = 'buildlite_commercial_events_v1';

function readAll() {
  try {
    const raw = localStorage.getItem(COMMERCIAL_EVENTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  localStorage.setItem(COMMERCIAL_EVENTS_STORAGE_KEY, JSON.stringify(data));
}

function newEventId() {
  return `ce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function newAuditId() {
  return `ce-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sessionActor() {
  return (
    localStorage.getItem('userName') ||
    localStorage.getItem('userEmail') ||
    'Commercial Manager'
  );
}

function ensureDevelopmentBucket(developmentId) {
  const all = readAll();
  if (!all[developmentId]) {
    all[developmentId] = { events: [] };
    writeAll(all);
  }
  return all[developmentId];
}

function listAllEventNumbers() {
  const all = readAll();
  const numbers = [];
  for (const bucket of Object.values(all)) {
    for (const event of bucket.events || []) {
      if (event.eventNumber) numbers.push(event.eventNumber);
    }
  }
  return numbers;
}

function appendAuditEntry(event, action, { actor, comment = '', priorStatus, newStatus } = {}) {
  const entry = {
    id: newAuditId(),
    action,
    timestamp: new Date().toISOString(),
    actor: String(actor || sessionActor()).trim() || sessionActor(),
    priorStatus: priorStatus ?? event.status,
    newStatus: newStatus ?? event.status,
    comment: String(comment || '').trim(),
  };
  event.auditHistory = [...(event.auditHistory || []), entry];
  return entry;
}

function normalizeEvent(event) {
  if (!event) return event;
  return {
    ...event,
    value: Number(event.value) || 0,
    auditHistory: Array.isArray(event.auditHistory) ? event.auditHistory : [],
  };
}

function validateEventPayload(payload, { partial = false } = {}) {
  const errors = [];
  const requiredFields = partial
    ? []
    : ['packageId', 'eventType', 'category', 'responsibility', 'description'];

  for (const field of requiredFields) {
    if (!String(payload[field] ?? '').trim()) {
      errors.push(`${field} is required`);
    }
  }

  if (!partial && payload.value == null) {
    errors.push('value is required');
  }

  if (payload.category) {
    getCommercialEventCategoryMeta(payload.category);
  }

  if (payload.eventType) {
    getCommercialEventTypeMeta(payload.eventType);
  }

  if (payload.responsibility) {
    getCommercialEventResponsibilityMeta(payload.responsibility);
  }

  if (payload.value != null && !Number.isFinite(Number(payload.value))) {
    errors.push('value must be a number');
  }

  return errors;
}

function findEventIndex(developmentId, eventId) {
  const bucket = readAll()[developmentId];
  if (!bucket) return { bucket: null, index: -1 };
  const index = (bucket.events || []).findIndex((event) => event.id === eventId);
  return { bucket, index };
}

function saveEvent(developmentId, event) {
  const all = readAll();
  const bucket = all[developmentId];
  if (!bucket) return null;
  const index = bucket.events.findIndex((item) => item.id === event.id);
  if (index === -1) return null;
  bucket.events[index] = normalizeEvent(event);
  writeAll(all);
  return bucket.events[index];
}

export function listCommercialEventsByDevelopment(developmentId) {
  if (!developmentId) return [];
  const bucket = readAll()[developmentId];
  return (bucket?.events || []).map(normalizeEvent);
}

export function listCommercialEventsByPackage(developmentId, packageId) {
  return listCommercialEventsByDevelopment(developmentId).filter(
    (event) => event.packageId === packageId
  );
}

export function getCommercialEventById(developmentId, eventId) {
  const { bucket, index } = findEventIndex(developmentId, eventId);
  if (!bucket || index === -1) return null;
  return normalizeEvent(bucket.events[index]);
}

export function createCommercialEvent(developmentId, payload, actor = sessionActor()) {
  const errors = validateEventPayload(payload);
  if (errors.length) {
    return { ok: false, errors };
  }

  if (!developmentId) {
    return { ok: false, errors: ['developmentId is required'] };
  }

  const now = new Date().toISOString();
  const eventNumber = generateNextCommercialEventNumber(listAllEventNumbers());

  const event = normalizeEvent({
    id: newEventId(),
    eventNumber,
    developmentId,
    packageId: payload.packageId,
    poNumber: payload.poNumber || '',
    supplierId: payload.supplierId || '',
    costCode: payload.costCode || '',
    eventType: payload.eventType,
    category: payload.category,
    subcategory: payload.subcategory || '',
    responsibility: payload.responsibility,
    description: String(payload.description || '').trim(),
    value: Number(payload.value),
    vatTreatment:
      payload.vatTreatment || COMMERCIAL_EVENT_VAT_TREATMENTS.standard.key,
    dateRaised: payload.dateRaised || now.slice(0, 10),
    raisedBy: payload.raisedBy || actor,
    status: COMMERCIAL_EVENT_STATUSES.draft.key,
    linkedEventId: payload.linkedEventId || null,
    recoveryPackageId: payload.recoveryPackageId || null,
    certificateStatus:
      payload.certificateStatus ||
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key,
    recoveryStatus:
      payload.recoveryStatus ||
      COMMERCIAL_EVENT_RECOVERY_STATUSES.notApplicable.key,
    createdAt: now,
    updatedAt: now,
    auditHistory: [],
  });

  appendAuditEntry(event, 'CREATED', {
    actor,
    priorStatus: null,
    newStatus: event.status,
  });

  const bucket = ensureDevelopmentBucket(developmentId);
  const all = readAll();
  all[developmentId] = {
    ...bucket,
    events: [...(bucket.events || []), event],
  };
  writeAll(all);

  return { ok: true, event: normalizeEvent(event) };
}

export function updateCommercialEventDraft(
  developmentId,
  eventId,
  patch,
  actor = sessionActor()
) {
  const event = getCommercialEventById(developmentId, eventId);
  if (!event) {
    return { ok: false, errors: ['Event not found'] };
  }

  if (!isCommercialEventEditable(event.status)) {
    return {
      ok: false,
      errors: ['Approved events are immutable. Create a reversing or correcting event.'],
    };
  }

  const merged = { ...event, ...patch };
  const errors = validateEventPayload(merged, { partial: true });
  if (errors.length) {
    return { ok: false, errors };
  }

  const priorStatus = event.status;
  const updated = {
    ...event,
    ...patch,
    id: event.id,
    eventNumber: event.eventNumber,
    status: event.status,
    value: patch.value != null ? Number(patch.value) : event.value,
    updatedAt: new Date().toISOString(),
  };

  appendAuditEntry(updated, 'UPDATED', {
    actor,
    priorStatus,
    newStatus: updated.status,
    comment: patch.auditComment || '',
  });

  const saved = saveEvent(developmentId, updated);
  return saved ? { ok: true, event: saved } : { ok: false, errors: ['Save failed'] };
}

export function submitCommercialEvent(
  developmentId,
  eventId,
  { actor = sessionActor(), comment = '' } = {}
) {
  const event = getCommercialEventById(developmentId, eventId);
  if (!event) return { ok: false, errors: ['Event not found'] };
  if (!canSubmitCommercialEvent(event.status)) {
    return { ok: false, errors: ['Only draft events can be submitted'] };
  }

  const priorStatus = event.status;
  event.status = COMMERCIAL_EVENT_STATUSES.submitted.key;
  event.updatedAt = new Date().toISOString();
  appendAuditEntry(event, 'SUBMITTED', {
    actor,
    comment,
    priorStatus,
    newStatus: event.status,
  });

  const saved = saveEvent(developmentId, event);
  return saved ? { ok: true, event: saved } : { ok: false, errors: ['Save failed'] };
}

export function approveCommercialEvent(
  developmentId,
  eventId,
  { actor = sessionActor(), comment = '' } = {}
) {
  const event = getCommercialEventById(developmentId, eventId);
  if (!event) return { ok: false, errors: ['Event not found'] };
  if (!canApproveCommercialEvent(event.status)) {
    return { ok: false, errors: ['Only submitted events can be approved'] };
  }

  const priorStatus = event.status;
  event.status = COMMERCIAL_EVENT_STATUSES.approved.key;
  event.updatedAt = new Date().toISOString();
  appendAuditEntry(event, 'APPROVED', {
    actor,
    comment,
    priorStatus,
    newStatus: event.status,
  });

  const saved = saveEvent(developmentId, event);
  return saved ? { ok: true, event: saved } : { ok: false, errors: ['Save failed'] };
}

export function rejectCommercialEvent(
  developmentId,
  eventId,
  { actor = sessionActor(), comment = '' } = {}
) {
  const event = getCommercialEventById(developmentId, eventId);
  if (!event) return { ok: false, errors: ['Event not found'] };
  if (!canRejectCommercialEvent(event.status)) {
    return { ok: false, errors: ['Only submitted events can be rejected'] };
  }

  const priorStatus = event.status;
  event.status = COMMERCIAL_EVENT_STATUSES.rejected.key;
  event.updatedAt = new Date().toISOString();
  appendAuditEntry(event, 'REJECTED', {
    actor,
    comment,
    priorStatus,
    newStatus: event.status,
  });

  const saved = saveEvent(developmentId, event);
  return saved ? { ok: true, event: saved } : { ok: false, errors: ['Save failed'] };
}

export function closeCommercialEvent(
  developmentId,
  eventId,
  { actor = sessionActor(), comment = '' } = {}
) {
  const event = getCommercialEventById(developmentId, eventId);
  if (!event) return { ok: false, errors: ['Event not found'] };
  if (!canCloseCommercialEvent(event.status)) {
    return { ok: false, errors: ['Event cannot be closed in its current status'] };
  }

  const priorStatus = event.status;
  event.status = COMMERCIAL_EVENT_STATUSES.closed.key;
  event.updatedAt = new Date().toISOString();
  appendAuditEntry(event, 'CLOSED', {
    actor,
    comment,
    priorStatus,
    newStatus: event.status,
  });

  const saved = saveEvent(developmentId, event);
  return saved ? { ok: true, event: saved } : { ok: false, errors: ['Save failed'] };
}

/** Test helper — clears all commercial events. */
export function clearCommercialEventsStore() {
  writeAll({});
}
