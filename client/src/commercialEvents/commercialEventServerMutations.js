/**
 * BL-028B.3 — Server-authoritative Commercial Event mutations.
 *
 * Patches in-memory server cache after each successful API call.
 * Never writes to localStorage.
 */

import {
  createCommercialEvent as apiCreateCommercialEvent,
  updateCommercialEvent as apiUpdateCommercialEvent,
  submitCommercialEvent as apiSubmitCommercialEvent,
  approveCommercialEvent as apiApproveCommercialEvent,
  rejectCommercialEvent as apiRejectCommercialEvent,
  closeCommercialEvent as apiCloseCommercialEvent,
  dismissPotentialContra as apiDismissPotentialContra,
  createLinkedRecovery as apiCreateLinkedRecovery,
  CommercialEventApiError,
} from '../api/commercialEvents';
import {
  normalizeServerCommercialEvent,
  normalizeServerCommercialEventList,
} from './commercialEventServerMapper';
import {
  patchCachedCommercialEvent,
  refreshCommercialEventsForDevelopment,
} from './commercialEventServerCache';

const VERSION_CONFLICT_MESSAGE =
  'This Commercial Event was updated by another user. Refresh and try again.';

function sessionActor() {
  if (typeof localStorage === 'undefined') return 'Commercial Manager';
  return (
    localStorage.getItem('userName') ||
    localStorage.getItem('userEmail') ||
    'Commercial Manager'
  );
}

function mapApiError(error) {
  if (error instanceof CommercialEventApiError) {
    if (error.status === 409) {
      return { ok: false, errors: [VERSION_CONFLICT_MESSAGE], status: 409 };
    }
    const message =
      error.body?.message || error.message || 'Commercial Event server request failed';
    return { ok: false, errors: [message], status: error.status };
  }
  return {
    ok: false,
    errors: [error?.message || 'Commercial Event server request failed'],
  };
}

function normalizeOne(document, developmentId) {
  const event = normalizeServerCommercialEvent(document);
  if (!event) return null;
  return { ...event, developmentId: event.developmentId || developmentId };
}

function patchOne(developmentId, document, detail = {}) {
  const event = normalizeOne(document, developmentId);
  if (!event) {
    return { ok: false, errors: ['Server returned an invalid Commercial Event document'] };
  }
  patchCachedCommercialEvent(developmentId, event, detail);
  return { ok: true, event };
}

function patchPair(developmentId, originDoc, recoveryDoc, detail = {}) {
  const originResult = patchOne(developmentId, originDoc, {
    ...detail,
    action: detail.action || 'linked-recovery-created',
  });
  if (!originResult.ok) return originResult;

  const recoveryResult = patchOne(developmentId, recoveryDoc, detail);
  if (!recoveryResult.ok) return recoveryResult;

  return {
    ok: true,
    origin: originResult.event,
    recovery: recoveryResult.event,
    event: originResult.event,
  };
}

function buildCreatePayload(developmentId, payload) {
  return {
    developmentId,
    packageId: payload.packageId,
    orderKey: payload.packageId,
    poNumber: payload.poNumber || '',
    supplierId: payload.supplierId || '',
    costCode: payload.costCode || '',
    eventType: payload.eventType,
    category: payload.category,
    subcategory: payload.subcategory || '',
    responsibility: payload.responsibility,
    description: payload.description,
    value: payload.value,
    financialTreatment: payload.financialTreatment ?? null,
    vatTreatment: payload.vatTreatment || 'standard',
    dateRaised: payload.dateRaised,
    raisedBy: payload.raisedBy,
    potentialContraCharge: payload.potentialContraCharge,
    potentialContraChargeNotes: payload.potentialContraChargeNotes,
  };
}

function buildUpdatePayload(event, patch) {
  const merged = { ...event, ...patch };
  return {
    version: event.version,
    packageId: merged.packageId,
    orderKey: merged.packageId,
    poNumber: merged.poNumber,
    supplierId: merged.supplierId,
    costCode: merged.costCode,
    eventType: merged.eventType,
    category: merged.category,
    subcategory: merged.subcategory,
    responsibility: merged.responsibility,
    description: merged.description,
    value: merged.value,
    financialTreatment: merged.financialTreatment,
    vatTreatment: merged.vatTreatment,
    dateRaised: merged.dateRaised,
    raisedBy: merged.raisedBy,
    potentialContraCharge: merged.potentialContraCharge,
    potentialContraChargeNotes: merged.potentialContraChargeNotes,
    comment: patch.auditComment || patch.comment || '',
  };
}

export async function createCommercialEventOnServer(developmentId, payload, actor = sessionActor()) {
  try {
    const document = await apiCreateCommercialEvent(
      buildCreatePayload(developmentId, { ...payload, raisedBy: payload.raisedBy || actor })
    );
    return patchOne(developmentId, document, { action: 'created' });
  } catch (error) {
    return mapApiError(error);
  }
}

export async function updateCommercialEventDraftOnServer(
  developmentId,
  event,
  patch,
  actor = sessionActor()
) {
  try {
    const document = await apiUpdateCommercialEvent(
      event.id,
      buildUpdatePayload(event, { ...patch, raisedBy: patch.raisedBy || actor })
    );
    return patchOne(developmentId, document, { action: 'updated' });
  } catch (error) {
    return mapApiError(error);
  }
}

async function runWorkflow(developmentId, eventId, action, body = {}) {
  const handlers = {
    submit: apiSubmitCommercialEvent,
    approve: apiApproveCommercialEvent,
    reject: apiRejectCommercialEvent,
    close: apiCloseCommercialEvent,
    dismiss: apiDismissPotentialContra,
  };
  const handler = handlers[action];
  if (!handler) {
    return { ok: false, errors: [`Unknown workflow action: ${action}`] };
  }

  try {
    const document = await handler(eventId, body);
    return patchOne(developmentId, document, { action });
  } catch (error) {
    return mapApiError(error);
  }
}

export function submitCommercialEventOnServer(developmentId, eventId, options = {}) {
  return runWorkflow(developmentId, eventId, 'submit', {
    comment: options.comment || '',
    actor: options.actor || sessionActor(),
  });
}

export function approveCommercialEventOnServer(developmentId, eventId, options = {}) {
  return runWorkflow(developmentId, eventId, 'approve', {
    comment: options.comment || '',
    actor: options.actor || sessionActor(),
  });
}

export function rejectCommercialEventOnServer(developmentId, eventId, options = {}) {
  return runWorkflow(developmentId, eventId, 'reject', {
    comment: options.comment || '',
    actor: options.actor || sessionActor(),
  });
}

export function closeCommercialEventOnServer(developmentId, eventId, options = {}) {
  return runWorkflow(developmentId, eventId, 'close', {
    comment: options.comment || '',
    actor: options.actor || sessionActor(),
  });
}

export function markPotentialContraChargeNotRequiredOnServer(
  developmentId,
  eventId,
  options = {}
) {
  return runWorkflow(developmentId, eventId, 'dismiss', {
    comment: options.comment || '',
    actor: options.actor || sessionActor(),
  });
}

export async function createLinkedRecoveryFromOriginOnServer(
  developmentId,
  originEventId,
  { recoveryPackageId, actor = sessionActor(), comment = '' } = {}
) {
  try {
    const response = await apiCreateLinkedRecovery(originEventId, {
      recoveryPackageId,
      packageId: recoveryPackageId,
      orderKey: recoveryPackageId,
      comment,
      actor,
    });
    return patchPair(developmentId, response.origin, response.recovery, {
      action: 'linked-recovery-created',
      originEventId,
    });
  } catch (error) {
    return mapApiError(error);
  }
}

export async function updateRecoveryStatusOnServer(
  developmentId,
  event,
  nextRecoveryStatus,
  { actor = sessionActor(), comment = '', recoveredAmount } = {}
) {
  try {
    const document = await apiUpdateCommercialEvent(event.id, {
      version: event.version,
      recoveryStatus: nextRecoveryStatus,
      recoveredAmount:
        recoveredAmount != null ? recoveredAmount : event.recoveredAmount,
      comment,
      actor,
    });
    return patchOne(developmentId, document, { action: 'recovery-status-changed' });
  } catch (error) {
    return mapApiError(error);
  }
}

export async function refreshDevelopmentCommercialEvents(developmentId) {
  try {
    const events = await refreshCommercialEventsForDevelopment(developmentId);
    return { ok: true, events: normalizeServerCommercialEventList(events) };
  } catch (error) {
    return mapApiError(error);
  }
}

export { VERSION_CONFLICT_MESSAGE };
