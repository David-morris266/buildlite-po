/**
 * BL-031B / BL-031E.4 — Normalise CVR period/input/snapshot server documents
 * into client store shape. Snapshot money is nested under `snapshot.totals`.
 */

import { isCvrPeriodLocked } from './cvrPeriodStatus';
import { normalizeServerCvrSnapshot } from './cvrSnapshotMapper';

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

export function firstNonEmptyArray(...candidates) {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
  }
  return [];
}

export function normalizeServerCvrPeriod(document, inputs = []) {
  if (!document) return null;
  const commentary = commentaryOf(document.commentary || document.commercialCommentary);
  const snapshot = normalizeServerCvrSnapshot(document.snapshot);
  const status = document.status || 'draft';
  const snapshotDeferred = snapshot
    ? false
    : document.snapshotDeferred !== false;
  const costCentres = firstNonEmptyArray(inputs, document.costCentres, document.inputs);
  return {
    id: document.id,
    developmentId: document.developmentId,
    periodKey: document.periodKey,
    periodLabel: document.periodLabel || document.periodKey,
    reportingMonth: document.reportingMonth || null,
    status,
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
    costCentres: costCentres.map(normalizeServerCvrCostCodeInput).filter(Boolean),
    snapshot,
    snapshotDeferred,
    snapshotNote: document.snapshotNote || null,
    historicUnavailable: isCvrPeriodLocked({ status }) && !snapshot,
  };
}

export function normalizeServerCvrPeriodList(documents) {
  return (Array.isArray(documents) ? documents : [])
    .map((item) =>
      normalizeServerCvrPeriod(item, firstNonEmptyArray(item?.costCentres, item?.inputs))
    )
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
