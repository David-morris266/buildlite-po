/**
 * BL-021B.2 — Compact register badges for commercial event links.
 */

import {
  COMMERCIAL_EVENT_RELATIONSHIP_TYPES,
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_TYPES,
  isDirectRecoveryCommercialEvent,
  isLinkedRecoveryCommercialEvent,
} from './commercialEventTypes';
import { hasLinkedRecovery, isPotentialContraChargePending } from './commercialEventRecovery';

export { isDirectRecoveryCommercialEvent, isLinkedRecoveryCommercialEvent };

export function getCommercialEventLinkBadges(event) {
  if (!event) return [];

  const badges = [];

  if (isPotentialContraChargePending(event)) {
    badges.push({
      key: 'recovery-pending',
      label: 'Recovery Pending',
      modifier: 'pending',
    });
  }

  if (event.relationshipType === COMMERCIAL_EVENT_RELATIONSHIP_TYPES.origin.key) {
    badges.push({
      key: 'recovery-linked',
      label: 'Recovery Linked',
      modifier: 'default',
    });
  }

  if (isDirectRecoveryCommercialEvent(event)) {
    badges.push({
      key: 'direct-recovery',
      label: 'Direct Recovery',
      modifier: 'accent',
    });
  } else if (event.relationshipType === COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key) {
    badges.push({
      key: 'recovery',
      label: 'Recovery',
      modifier: 'accent',
    });
  }

  return badges;
}

export function canShowPotentialContraBanner(event) {
  if (!event) return false;

  return (
    event.status === COMMERCIAL_EVENT_STATUSES.approved.key &&
    Boolean(event.potentialContraCharge) &&
    !hasLinkedRecovery(event) &&
    event.relationshipType !== COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key
  );
}

export function isRecoveryCommercialEvent(event) {
  return event?.relationshipType === COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key;
}

export function isOriginCommercialEvent(event) {
  return event?.relationshipType === COMMERCIAL_EVENT_RELATIONSHIP_TYPES.origin.key;
}

export function canEditPotentialContraFields(event, editable) {
  if (!editable || !event) return editable;
  if (isRecoveryCommercialEvent(event)) return false;
  if (event.eventType === COMMERCIAL_EVENT_TYPES.contraCharge.key) return false;
  if (event.linkedEventId && event.relationshipType) return false;
  return true;
}
