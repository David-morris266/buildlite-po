/**
 * BL-021A / BL-021B.1 — Development-scoped Commercial Events store (client-side).
 */

import { generateNextCommercialEventNumber } from '../admin/numberingService';
import { notifyCommercialChanged } from '../commercial/commercialEvents';
import { parseSubcontractOrderKey } from '../payments/packageKeyMigration';
import {
  COMMERCIAL_EVENT_CERTIFICATE_STATUSES,
  COMMERCIAL_EVENT_RELATIONSHIP_TYPES,
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_RESPONSIBILITIES,
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_TYPES,
  COMMERCIAL_EVENT_VAT_TREATMENTS,
  canApproveCommercialEvent,
  canCloseCommercialEvent,
  canRejectCommercialEvent,
  canSubmitCommercialEvent,
  canTransitionRecoveryStatus,
  getCommercialEventCategoryMeta,
  getCommercialEventResponsibilityMeta,
  getCommercialEventTypeMeta,
  isCommercialEventEditable,
  isOriginRelationshipType,
  isRecoveryRelationshipType,
  normalizeCertificateStatusKey,
  normalizeRecoveryStatusKey,
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

function appendAuditEntry(
  event,
  action,
  {
    actor,
    comment = '',
    priorStatus,
    newStatus,
    priorRecoveryStatus,
    newRecoveryStatus,
  } = {}
) {
  const entry = {
    id: newAuditId(),
    action,
    timestamp: new Date().toISOString(),
    actor: String(actor || sessionActor()).trim() || sessionActor(),
    priorStatus: priorStatus ?? event.status,
    newStatus: newStatus ?? event.status,
    comment: String(comment || '').trim(),
  };

  if (priorRecoveryStatus != null) {
    entry.priorRecoveryStatus = priorRecoveryStatus;
  }
  if (newRecoveryStatus != null) {
    entry.newRecoveryStatus = newRecoveryStatus;
  }

  event.auditHistory = [...(event.auditHistory || []), entry];
  return entry;
}

function toBoolean(value, fallback = false) {
  if (value == null) return fallback;
  return Boolean(value);
}

function toRecoveredAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeEvent(event) {
  if (!event) return event;

  const relationshipType = event.relationshipType || null;
  const recoveryStatus = normalizeRecoveryStatusKey(
    relationshipType === COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key
      ? event.recoveryStatus || COMMERCIAL_EVENT_RECOVERY_STATUSES.notApplicable.key
      : event.recoveryStatus || COMMERCIAL_EVENT_RECOVERY_STATUSES.notApplicable.key
  );

  return {
    ...event,
    value: Number(event.value) || 0,
    potentialContraCharge: toBoolean(event.potentialContraCharge, false),
    potentialContraChargeNotes: String(event.potentialContraChargeNotes || '').trim(),
    relationshipType,
    recoveredAmount: toRecoveredAmount(event.recoveredAmount),
    recoveryStatus:
      relationshipType === COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key
        ? recoveryStatus
        : COMMERCIAL_EVENT_RECOVERY_STATUSES.notApplicable.key,
    certificateStatus: normalizeCertificateStatusKey(event.certificateStatus),
    auditHistory: Array.isArray(event.auditHistory) ? event.auditHistory : [],
  };
}

function validateRecoveryPackageId(recoveryPackageId, developmentId, originPackageId) {
  const errors = [];

  if (!String(recoveryPackageId || '').trim()) {
    errors.push('recoveryPackageId is required');
    return errors;
  }

  const parsed = parseSubcontractOrderKey(recoveryPackageId);
  if (!parsed || parsed.legacy) {
    errors.push('recoveryPackageId must be a canonical package id');
    return errors;
  }

  if (parsed.developmentId !== developmentId) {
    errors.push('recovery package must belong to the same development');
  }

  if (recoveryPackageId === originPackageId) {
    errors.push('recovery package cannot be the same as the origin package');
  }

  return errors;
}

function validateRecoveredAmountForStatus(event, recoveryStatus, recoveredAmount) {
  const errors = [];
  const absoluteValue = Math.abs(Number(event.value) || 0);
  const amount = toRecoveredAmount(recoveredAmount);

  if (
    recoveryStatus === COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key
  ) {
    if (amount <= 0) {
      errors.push('recoveredAmount must be greater than zero for partial recovery');
    } else if (amount >= absoluteValue) {
      errors.push(
        'recoveredAmount must be less than the event value for partial recovery'
      );
    }
  }

  if (recoveryStatus === COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key) {
    if (absoluteValue > 0 && amount !== absoluteValue) {
      errors.push('recoveredAmount must equal the absolute event value when fully recovered');
    }
  }

  return errors;
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

  if (
    isRecoveryRelationshipType(payload.relationshipType) &&
    payload.value != null &&
    Number(payload.value) >= 0
  ) {
    errors.push('Recovery contra charge value must be negative');
  }

  return errors;
}

function validateRecoveryDraftPatch(event, patch) {
  const errors = [];

  if (isRecoveryRelationshipType(event.relationshipType)) {
    if (patch.value != null && Number(patch.value) >= 0) {
      errors.push('Recovery contra charge value must remain negative');
    }

    const lockedFields = [
      'linkedEventId',
      'relationshipType',
      'potentialContraCharge',
      'potentialContraChargeNotes',
      'recoveryPackageId',
      'packageId',
      'eventType',
    ];
    for (const field of lockedFields) {
      if (patch[field] != null && patch[field] !== event[field]) {
        errors.push(`${field} cannot be changed on a linked recovery event`);
      }
    }
  }

  if (
    isOriginRelationshipType(event.relationshipType) ||
    (event.potentialContraCharge && event.linkedEventId)
  ) {
    const lockedOriginFields = ['potentialContraCharge', 'potentialContraChargeNotes'];
    for (const field of lockedOriginFields) {
      if (patch[field] != null && patch[field] !== event[field]) {
        errors.push(`${field} cannot be changed after a linked recovery exists`);
      }
    }
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
    potentialContraCharge: toBoolean(payload.potentialContraCharge, false),
    potentialContraChargeNotes: String(payload.potentialContraChargeNotes || '').trim(),
    relationshipType: payload.relationshipType || null,
    recoveredAmount: toRecoveredAmount(payload.recoveredAmount),
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

  notifyCommercialChanged({ developmentId, eventId: event.id, action: 'created' });

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
  const recoveryPatchErrors = validateRecoveryDraftPatch(event, patch);
  if (recoveryPatchErrors.length) {
    errors.push(...recoveryPatchErrors);
  }
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
    potentialContraCharge:
      patch.potentialContraCharge != null
        ? toBoolean(patch.potentialContraCharge)
        : event.potentialContraCharge,
    potentialContraChargeNotes:
      patch.potentialContraChargeNotes != null
        ? String(patch.potentialContraChargeNotes || '').trim()
        : event.potentialContraChargeNotes,
    updatedAt: new Date().toISOString(),
  };

  if (isRecoveryRelationshipType(updated.relationshipType) && updated.value >= 0) {
    return { ok: false, errors: ['Recovery contra charge value must remain negative'] };
  }

  appendAuditEntry(updated, 'UPDATED', {
    actor,
    priorStatus,
    newStatus: updated.status,
    comment: patch.auditComment || '',
  });

  const saved = saveEvent(developmentId, updated);
  if (saved) {
    notifyCommercialChanged({ developmentId, eventId, action: 'updated' });
  }
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

  if (isRecoveryRelationshipType(event.relationshipType)) {
    const priorRecoveryStatus = event.recoveryStatus;
    event.recoveryStatus = COMMERCIAL_EVENT_RECOVERY_STATUSES.outstanding.key;
    appendAuditEntry(event, 'APPROVED', {
      actor,
      comment,
      priorStatus,
      newStatus: event.status,
      priorRecoveryStatus,
      newRecoveryStatus: event.recoveryStatus,
    });
  } else {
    appendAuditEntry(event, 'APPROVED', {
      actor,
      comment,
      priorStatus,
      newStatus: event.status,
    });
  }

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

export function createLinkedRecoveryFromOrigin(
  developmentId,
  originEventId,
  { recoveryPackageId, actor = sessionActor(), comment = '' } = {}
) {
  const origin = getCommercialEventById(developmentId, originEventId);
  if (!origin) {
    return { ok: false, errors: ['Origin event not found'] };
  }

  if (origin.status !== COMMERCIAL_EVENT_STATUSES.approved.key) {
    return { ok: false, errors: ['Origin event must be approved before creating a linked recovery'] };
  }

  if (!origin.potentialContraCharge) {
    return {
      ok: false,
      errors: ['Origin event is not flagged for potential contra charge'],
    };
  }

  if (origin.linkedEventId) {
    return { ok: false, errors: ['Origin event already has a linked recovery'] };
  }

  if (isRecoveryRelationshipType(origin.relationshipType)) {
    return { ok: false, errors: ['Recovery events cannot create linked recoveries'] };
  }

  const packageErrors = validateRecoveryPackageId(
    recoveryPackageId,
    developmentId,
    origin.packageId
  );
  if (packageErrors.length) {
    return { ok: false, errors: packageErrors };
  }

  const parsedPackage = parseSubcontractOrderKey(recoveryPackageId);
  const now = new Date().toISOString();
  const recoveryId = newEventId();
  const recoveryEventNumber = generateNextCommercialEventNumber(listAllEventNumbers());
  const absoluteOriginValue = Math.abs(Number(origin.value) || 0);
  const recoveryValue = absoluteOriginValue > 0 ? -absoluteOriginValue : Number(origin.value) || 0;

  const recovery = normalizeEvent({
    id: recoveryId,
    eventNumber: recoveryEventNumber,
    developmentId,
    packageId: recoveryPackageId,
    poNumber: '',
    supplierId: parsedPackage.supplierId,
    costCode: parsedPackage.costCode,
    eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
    category: origin.category,
    subcategory: origin.subcategory || 'contraCharge',
    responsibility: COMMERCIAL_EVENT_RESPONSIBILITIES.subcontractor.key,
    description: origin.description,
    value: recoveryValue,
    vatTreatment: origin.vatTreatment,
    dateRaised: now.slice(0, 10),
    raisedBy: actor,
    status: COMMERCIAL_EVENT_STATUSES.draft.key,
    linkedEventId: origin.id,
    recoveryPackageId,
    potentialContraCharge: false,
    potentialContraChargeNotes: '',
    relationshipType: COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key,
    recoveredAmount: 0,
    certificateStatus: COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key,
    recoveryStatus: COMMERCIAL_EVENT_RECOVERY_STATUSES.notApplicable.key,
    createdAt: now,
    updatedAt: now,
    auditHistory: [],
  });

  appendAuditEntry(recovery, 'CREATED', {
    actor,
    priorStatus: null,
    newStatus: recovery.status,
    comment,
  });
  appendAuditEntry(recovery, 'LINKED_TO_ORIGIN', {
    actor,
    comment,
    priorStatus: recovery.status,
    newStatus: recovery.status,
  });

  const updatedOrigin = normalizeEvent({
    ...origin,
    linkedEventId: recovery.id,
    relationshipType: COMMERCIAL_EVENT_RELATIONSHIP_TYPES.origin.key,
    recoveryPackageId,
    recoveryStatus: COMMERCIAL_EVENT_RECOVERY_STATUSES.notApplicable.key,
    updatedAt: now,
  });

  appendAuditEntry(updatedOrigin, 'LINKED_RECOVERY_CREATED', {
    actor,
    comment,
    priorStatus: updatedOrigin.status,
    newStatus: updatedOrigin.status,
  });

  const all = readAll();
  const bucket = all[developmentId];
  if (!bucket) {
    return { ok: false, errors: ['Development bucket not found'] };
  }

  const originIndex = bucket.events.findIndex((item) => item.id === origin.id);
  if (originIndex === -1) {
    return { ok: false, errors: ['Origin event not found in store'] };
  }

  bucket.events[originIndex] = updatedOrigin;
  bucket.events.push(recovery);
  writeAll(all);

  notifyCommercialChanged({
    developmentId,
    originEventId: origin.id,
    recoveryEventId: recovery.id,
    action: 'linked-recovery-created',
  });

  return {
    ok: true,
    origin: getCommercialEventById(developmentId, origin.id),
    recovery: getCommercialEventById(developmentId, recovery.id),
  };
}

export function updateRecoveryStatus(
  developmentId,
  eventId,
  nextRecoveryStatus,
  {
    actor = sessionActor(),
    comment = '',
    recoveredAmount,
  } = {}
) {
  const event = getCommercialEventById(developmentId, eventId);
  if (!event) {
    return { ok: false, errors: ['Event not found'] };
  }

  if (!isRecoveryRelationshipType(event.relationshipType)) {
    return { ok: false, errors: ['Recovery status can only be updated on recovery events'] };
  }

  const normalizedNextStatus = normalizeRecoveryStatusKey(nextRecoveryStatus);
  const priorRecoveryStatus = normalizeRecoveryStatusKey(event.recoveryStatus);

  if (!canTransitionRecoveryStatus(priorRecoveryStatus, normalizedNextStatus)) {
    return {
      ok: false,
      errors: [`Cannot transition recovery status from ${priorRecoveryStatus} to ${normalizedNextStatus}`],
    };
  }

  const nextRecoveredAmount =
    recoveredAmount != null ? toRecoveredAmount(recoveredAmount) : event.recoveredAmount;

  const amountErrors = validateRecoveredAmountForStatus(
    event,
    normalizedNextStatus,
    nextRecoveredAmount
  );
  if (amountErrors.length) {
    return { ok: false, errors: amountErrors };
  }

  if (
    normalizedNextStatus === COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key &&
    Math.abs(Number(event.value) || 0) === 0
  ) {
    event.recoveredAmount = 0;
  } else {
    event.recoveredAmount = nextRecoveredAmount;
  }

  event.recoveryStatus = normalizedNextStatus;
  event.updatedAt = new Date().toISOString();

  appendAuditEntry(event, 'RECOVERY_STATUS_CHANGED', {
    actor,
    comment,
    priorStatus: event.status,
    newStatus: event.status,
    priorRecoveryStatus,
    newRecoveryStatus: normalizedNextStatus,
  });

  const saved = saveEvent(developmentId, event);
  if (saved) {
    notifyCommercialChanged({ developmentId, eventId, action: 'recovery-status-changed' });
  }
  return saved ? { ok: true, event: saved } : { ok: false, errors: ['Save failed'] };
}

export function markPotentialContraChargeNotRequired(
  developmentId,
  eventId,
  { actor = sessionActor(), comment = '' } = {}
) {
  const event = getCommercialEventById(developmentId, eventId);
  if (!event) {
    return { ok: false, errors: ['Event not found'] };
  }

  if (!event.potentialContraCharge) {
    return { ok: false, errors: ['Event is not flagged for potential contra charge'] };
  }

  if (event.linkedEventId) {
    return { ok: false, errors: ['Linked recovery already exists for this event'] };
  }

  if (isRecoveryRelationshipType(event.relationshipType)) {
    return { ok: false, errors: ['Recovery events cannot dismiss potential contra charge'] };
  }

  event.potentialContraCharge = false;
  event.potentialContraChargeNotes = '';
  event.updatedAt = new Date().toISOString();

  appendAuditEntry(event, 'POTENTIAL_CONTRA_CHARGE_DISMISSED', {
    actor,
    comment,
    priorStatus: event.status,
    newStatus: event.status,
  });

  const saved = saveEvent(developmentId, event);
  if (saved) {
    notifyCommercialChanged({ developmentId, eventId, action: 'potential-contra-dismissed' });
  }
  return saved ? { ok: true, event: saved } : { ok: false, errors: ['Save failed'] };
}

/** Test helper — clears all commercial events. */
export function clearCommercialEventsStore() {
  writeAll({});
}
