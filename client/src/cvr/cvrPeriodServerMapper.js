/**
 * BL-031B — Normalise CVR period/input server documents into client store shape.
 */

function emptyCommentary() {
  return {
    keyCommercialIssues: '',
    commercialOpportunities: '',
    financialRisks: '',
    actionsBeforeNextCvr: '',
  };
}

function commentaryOf(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = emptyCommentary();
  return {
    keyCommercialIssues: String(source.keyCommercialIssues || base.keyCommercialIssues),
    commercialOpportunities: String(
      source.commercialOpportunities || base.commercialOpportunities
    ),
    financialRisks: String(source.financialRisks || base.financialRisks),
    actionsBeforeNextCvr: String(source.actionsBeforeNextCvr || base.actionsBeforeNextCvr),
  };
}

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toNumber(value, fallback = 0) {
  const n = toNumberOrNull(value);
  return n == null ? fallback : n;
}

export function normalizeServerCvrPeriod(document, inputs = []) {
  if (!document) return null;
  const commentary = commentaryOf(document.commentary || document.commercialCommentary);
  return {
    id: document.id,
    developmentId: document.developmentId,
    periodKey: document.periodKey,
    periodLabel: document.periodLabel || document.periodKey,
    reportingMonth: document.reportingMonth || null,
    status: document.status || 'draft',
    version: Number(document.version) || 1,
    createdAt: document.createdAt || null,
    updatedAt: document.updatedAt || null,
    createdBy: document.createdBy ?? null,
    updatedBy: document.updatedBy ?? null,
    submittedAt: document.submittedAt || null,
    submittedBy: document.submittedBy ?? null,
    approvedAt: document.approvedAt || null,
    approvedBy: document.approvedBy ?? null,
    auditHistory: Array.isArray(document.auditHistory) ? document.auditHistory : [],
    commercialCommentary: commentary,
    developmentNotes: String(document.developmentNotes || ''),
    costCentres: Array.isArray(inputs)
      ? inputs.map(normalizeServerCvrCostCodeInput).filter(Boolean)
      : [],
    snapshot: document.snapshot ?? null,
    snapshotDeferred: document.snapshotDeferred !== false,
  };
}

export function normalizeServerCvrPeriodList(documents) {
  return (Array.isArray(documents) ? documents : [])
    .map((item) => normalizeServerCvrPeriod(item))
    .filter(Boolean)
    .sort((a, b) => String(a.periodKey).localeCompare(String(b.periodKey), undefined, {
      numeric: true,
    }));
}

export function normalizeServerCvrCostCodeInput(document) {
  if (!document) return null;
  const metadata =
    document.displayMetadata && typeof document.displayMetadata === 'object'
      ? document.displayMetadata
      : {};
  const adjustmentHistory = Array.isArray(document.adjustmentHistory)
    ? document.adjustmentHistory
    : Array.isArray(metadata.adjustmentHistory)
      ? metadata.adjustmentHistory
      : [];

  return {
    id: document.id,
    periodId: document.periodId,
    costCodeKey: document.costCodeKey,
    costCodeLabel: document.costCodeLabel || document.costCodeKey,
    description: document.description || '',
    commercialHead: document.commercialHead || '',
    commercialFamily: document.commercialFamily || '',
    trade: document.trade || '',
    originalBudget: toNumberOrNull(document.originalBudget),
    currentBudget: toNumberOrNull(document.currentBudget),
    commercialAdjustment: toNumber(document.commercialAdjustment, 0),
    commercialReason: document.adjustmentReason || document.commercialReason || '',
    adjustmentReason: document.adjustmentReason || document.commercialReason || '',
    manualAccrual: toNumber(document.manualAccrual, 0),
    commercialNotes: document.notes || document.commercialNotes || '',
    notes: document.notes || document.commercialNotes || '',
    active: document.active !== false,
    displayMetadata: metadata,
    adjustmentHistory,
    version: Number(document.version) || 1,
    createdAt: document.createdAt || null,
    updatedAt: document.updatedAt || null,
    createdBy: document.createdBy ?? null,
    updatedBy: document.updatedBy ?? null,
  };
}

export function normalizeServerCvrCostCodeInputList(documents) {
  return (Array.isArray(documents) ? documents : [])
    .map(normalizeServerCvrCostCodeInput)
    .filter(Boolean);
}
