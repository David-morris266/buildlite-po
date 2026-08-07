/**
 * BL-021B.1 — Pure query helpers for linked commercial recovery events.
 */

import { getCommercialEventById } from './commercialEventStore';
import {
  ACTIVE_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_RELATIONSHIP_TYPES,
  isOriginRelationshipType,
  isRecoveryRelationshipType,
  normalizeRecoveryStatusKey,
} from './commercialEventTypes';

export function hasLinkedRecovery(event) {
  if (!event) return false;

  if (isRecoveryRelationshipType(event.relationshipType)) {
    return Boolean(event.linkedEventId);
  }

  if (isOriginRelationshipType(event.relationshipType)) {
    return Boolean(event.linkedEventId);
  }

  // BL-021A legacy records may store linkedEventId without relationshipType.
  return Boolean(event.linkedEventId);
}

export function getLinkedCommercialEvent(developmentId, event) {
  if (!developmentId || !event?.linkedEventId) return null;
  return getCommercialEventById(developmentId, event.linkedEventId);
}

export function isRecoveryOutstanding(event) {
  if (!event || !isRecoveryRelationshipType(event.relationshipType)) {
    return false;
  }

  return (
    normalizeRecoveryStatusKey(event.recoveryStatus) ===
    COMMERCIAL_EVENT_RECOVERY_STATUSES.outstanding.key
  );
}

export function isActiveRecovery(event) {
  if (!event || !isRecoveryRelationshipType(event.relationshipType)) {
    return false;
  }

  return ACTIVE_RECOVERY_STATUSES.has(normalizeRecoveryStatusKey(event.recoveryStatus));
}

export function isPotentialContraChargePending(event) {
  if (!event) return false;

  return (
    Boolean(event.potentialContraCharge) &&
    !hasLinkedRecovery(event) &&
    event.relationshipType !== COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key
  );
}
