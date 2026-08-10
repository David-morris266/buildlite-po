/**
 * BL-025.2 — Explicit certifiable Commercial Event rules (Doc 64 / Doc 65).
 *
 * Approved Commercial Event ≠ Certified Commercial Event.
 * Certifiability governs which events may appear on a payment certificate draft.
 */

import { isPotentialContraChargePending } from './commercialEventRecovery';
import { isRecoveryCommercialEvent } from './commercialEventRegisterBadges';
import {
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_TYPES,
} from './commercialEventTypes';

/** Value-increasing/decreasing subcontract CE types certifiable on certificates. */
export const CERTIFIABLE_COMMERCIAL_EVENT_TYPES = new Set([
  COMMERCIAL_EVENT_TYPES.variation.key,
  COMMERCIAL_EVENT_TYPES.credit.key,
  COMMERCIAL_EVENT_TYPES.salesUpgrade.key,
  COMMERCIAL_EVENT_TYPES.valueEngineering.key,
  COMMERCIAL_EVENT_TYPES.employerInstruction.key,
]);

export const CERTIFICATE_COMMERCIAL_LINE_TYPES = {
  valueInclusion: 'valueInclusion',
};

/**
 * Whether an approved event may be offered for certificate valuation (BL-025.2).
 * Does not check package match, remaining value, or duplicate lines — callers add those.
 */
export function isCommercialEventCertifiable(event) {
  if (!event?.id) return false;

  if (event.status !== COMMERCIAL_EVENT_STATUSES.approved.key) {
    return false;
  }

  if (isRecoveryCommercialEvent(event)) {
    return false;
  }

  if (isPotentialContraChargePending(event)) {
    return false;
  }

  if (event.eventType === COMMERCIAL_EVENT_TYPES.budgetTransfer.key) {
    return false;
  }

  return CERTIFIABLE_COMMERCIAL_EVENT_TYPES.has(event.eventType);
}

export function getCommercialEventCertifiabilityReason(event) {
  if (!event?.id) return 'Commercial event not found.';
  if (event.status !== COMMERCIAL_EVENT_STATUSES.approved.key) {
    return 'Only approved commercial events can be included on a certificate.';
  }
  if (isRecoveryCommercialEvent(event)) {
    return 'Recovery commercial events cannot be certified on a payment certificate.';
  }
  if (isPotentialContraChargePending(event)) {
    return 'Potential contra charge origins cannot be certified until resolved.';
  }
  if (event.eventType === COMMERCIAL_EVENT_TYPES.budgetTransfer.key) {
    return 'Budget transfer events are internal-only and cannot be certified.';
  }
  if (!CERTIFIABLE_COMMERCIAL_EVENT_TYPES.has(event.eventType)) {
    return 'This commercial event type cannot be certified on a payment certificate.';
  }
  return null;
}
