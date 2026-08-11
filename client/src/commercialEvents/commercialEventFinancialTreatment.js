/**
 * BL-026.1 — Financial treatment for Contra Charge events.
 *
 * contractAmendment — affects Current Contract Value (legacy manual contra default).
 * recoverableDeduction — recovery-classified; excluded from CCV; certificate net deduction.
 */

import { isRecoveryCommercialEvent } from './commercialEventRegisterBadges';
import { COMMERCIAL_EVENT_RELATIONSHIP_TYPES, COMMERCIAL_EVENT_TYPES } from './commercialEventTypes';

export const COMMERCIAL_EVENT_FINANCIAL_TREATMENTS = {
  contractAmendment: {
    key: 'contractAmendment',
    label: 'Contract Amendment',
    description: "Reduce or change this subcontract's contractual value.",
  },
  recoverableDeduction: {
    key: 'recoverableDeduction',
    label: 'Recoverable Deduction',
    description: 'Does not change the subcontract value. Recovered from payment certificates.',
  },
};

export function normalizeFinancialTreatmentKey(treatmentKey) {
  if (!treatmentKey) return null;
  if (COMMERCIAL_EVENT_FINANCIAL_TREATMENTS[treatmentKey]) {
    return COMMERCIAL_EVENT_FINANCIAL_TREATMENTS[treatmentKey].key;
  }
  return treatmentKey;
}

export function listCommercialEventFinancialTreatmentOptions() {
  return Object.values(COMMERCIAL_EVENT_FINANCIAL_TREATMENTS);
}

export function isRecoverableDeductionFinancialTreatment(eventOrKey) {
  if (typeof eventOrKey === 'string') {
    return (
      normalizeFinancialTreatmentKey(eventOrKey) ===
      COMMERCIAL_EVENT_FINANCIAL_TREATMENTS.recoverableDeduction.key
    );
  }
  const event = eventOrKey;
  if (!event) return false;
  if (isRecoveryCommercialEvent(event)) return true;
  return (
    normalizeFinancialTreatmentKey(event.financialTreatment) ===
    COMMERCIAL_EVENT_FINANCIAL_TREATMENTS.recoverableDeduction.key
  );
}

export function normalizeRecoverableDeductionStoredValue(rawValue) {
  const magnitude = Math.abs(Number(rawValue) || 0);
  if (magnitude === 0) return 0;
  return -magnitude;
}

export function formatRecoverableDeductionDisplayValue(storedValue) {
  return Math.abs(Number(storedValue) || 0);
}

/**
 * Resolve contra charge create/update fields from UI financial treatment.
 * Legacy records without financialTreatment must not pass through here on read-normalize.
 */
export function resolveContraChargeFinancialFields({
  eventType,
  financialTreatment,
  value,
  relationshipType = null,
  linkedEventId = null,
  isCreate = false,
} = {}) {
  if (eventType !== COMMERCIAL_EVENT_TYPES.contraCharge.key) {
    return {
      financialTreatment: financialTreatment || null,
      relationshipType: relationshipType || null,
      linkedEventId: linkedEventId || null,
      value: Number(value) || 0,
    };
  }

  const treatment =
    normalizeFinancialTreatmentKey(financialTreatment) ||
    (isCreate ? COMMERCIAL_EVENT_FINANCIAL_TREATMENTS.recoverableDeduction.key : null);

  if (!treatment) {
    return {
      financialTreatment: null,
      relationshipType: relationshipType || null,
      linkedEventId: linkedEventId || null,
      value: Number(value) || 0,
    };
  }

  if (treatment === COMMERCIAL_EVENT_FINANCIAL_TREATMENTS.recoverableDeduction.key) {
    return {
      financialTreatment: COMMERCIAL_EVENT_FINANCIAL_TREATMENTS.recoverableDeduction.key,
      relationshipType: COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key,
      linkedEventId: null,
      value: normalizeRecoverableDeductionStoredValue(value),
    };
  }

  return {
    financialTreatment: COMMERCIAL_EVENT_FINANCIAL_TREATMENTS.contractAmendment.key,
    relationshipType: null,
    linkedEventId: null,
    value: Number(value) || 0,
  };
}

export function shouldApplyContraChargeFinancialTreatment(payload, { isCreate = false } = {}) {
  if (payload?.eventType !== COMMERCIAL_EVENT_TYPES.contraCharge.key) return false;
  if (normalizeFinancialTreatmentKey(payload?.financialTreatment)) return true;
  if (isCreate && !String(payload?.linkedEventId || '').trim()) return true;
  return false;
}
