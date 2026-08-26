/**
 * BL-028B.1 — Normalise BL-028A Commercial Event API documents to client shape.
 *
 * Client vocabulary: event.packageId = orderKey (NOT server Package UUID).
 */

import { enrichExpectedLiabilityReadModel } from './commercialEventExpectedLiability';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableInteger(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeAuditEntry(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    action: entry.action,
    timestamp: entry.timestamp || entry.created_at || entry.createdAt || null,
    actor: entry.actor ?? null,
    priorStatus: entry.priorStatus ?? entry.prior_status ?? null,
    newStatus: entry.newStatus ?? entry.new_status ?? null,
    comment: entry.comment ?? '',
    priorRecoveryStatus: entry.priorRecoveryStatus ?? entry.prior_recovery_status ?? null,
    newRecoveryStatus: entry.newRecoveryStatus ?? entry.new_recovery_status ?? null,
    priorCertificateStatus:
      entry.priorCertificateStatus ?? entry.prior_certificate_status ?? null,
    newCertificateStatus:
      entry.newCertificateStatus ?? entry.new_certificate_status ?? null,
    priorExpectedTreatment:
      entry.priorExpectedTreatment ?? entry.prior_expected_treatment ?? null,
    newExpectedTreatment: entry.newExpectedTreatment ?? entry.new_expected_treatment ?? null,
    priorExpectedAmount: toNullableNumber(
      entry.priorExpectedAmount ?? entry.prior_expected_amount
    ),
    newExpectedAmount: toNullableNumber(entry.newExpectedAmount ?? entry.new_expected_amount),
    priorEffectiveExpected: toNullableNumber(
      entry.priorEffectiveExpected ?? entry.prior_effective_expected
    ),
    newEffectiveExpected: toNullableNumber(
      entry.newEffectiveExpected ?? entry.new_effective_expected
    ),
    ceValueAtChange: toNullableNumber(entry.ceValueAtChange ?? entry.ce_value_at_change),
    ceStatusAtChange: entry.ceStatusAtChange ?? entry.ce_status_at_change ?? null,
    priorCeVersion: toNullableInteger(entry.priorCeVersion ?? entry.prior_ce_version),
    newCeVersion: toNullableInteger(entry.newCeVersion ?? entry.new_ce_version),
  };
}

/**
 * @param {object|null} document - Raw BL-028A API commercial event document
 * @returns {object|null}
 */
export function normalizeServerCommercialEvent(document) {
  if (!document || typeof document !== 'object' || !document.id) return null;

  const orderKey = String(
    document.packageId || document.orderKey || document.order_key || ''
  ).trim();

  const packageUuid =
    document.packageUuid || document.package_uuid || document.package_id || null;

  const normalized = {
    id: document.id,
    eventNumber: document.eventNumber || document.event_number,
    developmentId: document.developmentId || document.development_id,
    packageUuid: packageUuid || null,
    packageId: orderKey,
    orderKey,
    eventType: document.eventType || document.event_type,
    category: document.category,
    subcategory: document.subcategory ?? '',
    responsibility: document.responsibility,
    description: document.description,
    value: toNumber(document.value),
    financialTreatment: document.financialTreatment ?? document.financial_treatment ?? null,
    vatTreatment: document.vatTreatment || document.vat_treatment || 'standard',
    dateRaised: document.dateRaised || document.date_raised || null,
    raisedBy: document.raisedBy ?? document.raised_by ?? null,
    status: document.status,
    linkedEventId: document.linkedEventId ?? document.linked_event_id ?? null,
    recoveryPackageId: document.recoveryPackageId ?? document.recovery_package_id ?? null,
    potentialContraCharge: Boolean(
      document.potentialContraCharge ?? document.potential_contra_charge
    ),
    potentialContraChargeNotes:
      document.potentialContraChargeNotes ??
      document.potential_contra_charge_notes ??
      '',
    relationshipType: document.relationshipType ?? document.relationship_type ?? null,
    recoveredAmount: toNumber(document.recoveredAmount ?? document.recovered_amount),
    certificateStatus:
      document.certificateStatus ?? document.certificate_status ?? 'notIncluded',
    recoveryStatus:
      document.recoveryStatus ?? document.recovery_status ?? 'notApplicable',
    poNumber: document.poNumber ?? document.po_number ?? '',
    supplierId: document.supplierId ?? document.supplier_id ?? '',
    costCode: document.costCode ?? document.cost_code ?? '',
    version: document.version,
    createdAt: document.createdAt ?? document.created_at ?? null,
    updatedAt: document.updatedAt ?? document.updated_at ?? null,
    createdBy: document.createdBy ?? document.created_by ?? null,
    updatedBy: document.updatedBy ?? document.updated_by ?? null,
    auditHistory: Array.isArray(document.auditHistory)
      ? document.auditHistory.map(normalizeAuditEntry).filter(Boolean)
      : [],
    expectedTreatment: document.expectedTreatment ?? document.expected_treatment ?? 'default',
    expectedAmount: toNullableNumber(document.expectedAmount ?? document.expected_amount),
    expectedReason: document.expectedReason ?? document.expected_reason ?? null,
    expectedUpdatedAt: document.expectedUpdatedAt ?? document.expected_updated_at ?? null,
    expectedUpdatedBy: document.expectedUpdatedBy ?? document.expected_updated_by ?? null,
  };

  return enrichExpectedLiabilityReadModel(normalized);
}

export function normalizeServerCommercialEventList(documents = []) {
  if (!Array.isArray(documents)) return [];
  return documents.map(normalizeServerCommercialEvent).filter(Boolean);
}
