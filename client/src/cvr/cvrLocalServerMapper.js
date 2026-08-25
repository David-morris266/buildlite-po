/**
 * BL-031C — Deterministic localStorage CVR → server document mapping.
 *
 * Reads raw `buildlite_cvr_v1`. Does not call getCvrRecord/ensureCvrRecord
 * (those synthesise empty P01 for missing developments).
 *
 * Historic local createdAt/submittedAt/approvedAt/auditHistory actors are
 * commercially material locally but cannot round-trip onto server timestamps
 * (server uses NOW() + current actor). They are recorded as not migrated.
 */

import { normaliseCostCodeKey, roundMoney } from './cvrCalculations';
import { sortPeriodKeys } from './cvrPeriodStatus';

export const CVR_LOCAL_STORAGE_KEY = 'buildlite_cvr_v1';
export const CVR_LOCAL_LEGACY_PERIOD_KEY = 'current';

export const CVR_FIELDS_NOT_MIGRATED = [
  'developmentNotes (no server column)',
  'historic createdAt/createdBy on periods (server uses NOW() + migration actor)',
  'historic submittedAt/submittedBy (server sets these on submit)',
  'historic approvedAt/approvedBy (server sets these on approve/lock)',
  'full local auditHistory event log (server writes its own workflow audit)',
  'local cost-centre row ids',
];

const VALID_LOCAL_STATUSES = new Set(['draft', 'submitted', 'locked', 'approved']);

function parseJson(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return { __invalid: true };
  }
}

export function readRawLocalCvrStore(storage = globalThis.localStorage) {
  if (!storage?.getItem) return {};
  const parsed = parseJson(storage.getItem(CVR_LOCAL_STORAGE_KEY));
  if (parsed.__invalid) return { __invalid: true };
  return parsed;
}

export function listLocalCvrDevelopmentIds(storage = globalThis.localStorage) {
  const all = readRawLocalCvrStore(storage);
  if (all.__invalid) return [];
  return Object.keys(all).sort();
}

function emptyCommentary() {
  return {
    keyCommercialIssues: '',
    commercialOpportunities: '',
    financialRisks: '',
    actionsBeforeNextCvr: '',
  };
}

export function mapLocalCommentary(value) {
  const source = value && typeof value === 'object' ? value : {};
  const base = emptyCommentary();
  return {
    keyCommercialIssues: String(source.keyCommercialIssues || base.keyCommercialIssues),
    commercialOpportunities: String(source.commercialOpportunities || base.commercialOpportunities),
    financialRisks: String(source.financialRisks || base.financialRisks),
    actionsBeforeNextCvr: String(source.actionsBeforeNextCvr || base.actionsBeforeNextCvr),
  };
}

export function mapLocalPeriodStatus(status) {
  if (status === 'approved') return 'locked';
  return status || 'draft';
}

export function isLocalPeriodOpen(status) {
  const mapped = mapLocalPeriodStatus(status);
  return mapped === 'draft' || mapped === 'submitted';
}

function remapLegacyPeriodKey(periodKey) {
  if (periodKey === CVR_LOCAL_LEGACY_PERIOD_KEY) return 'P01';
  return String(periodKey || '').trim();
}

export function mapLocalCostCodeInput(centre) {
  if (!centre || typeof centre !== 'object') {
    return { ok: false, errors: ['Cost-code row is not an object.'] };
  }

  const costCodeKey = normaliseCostCodeKey(centre.costCodeKey || centre.costCode);
  if (!costCodeKey) {
    return { ok: false, errors: ['costCodeKey is required.'] };
  }

  const adjustmentHistory = Array.isArray(centre.adjustmentHistory)
    ? centre.adjustmentHistory
    : [];
  const displayMetadata =
    centre.displayMetadata && typeof centre.displayMetadata === 'object'
      ? { ...centre.displayMetadata }
      : {};
  displayMetadata.adjustmentHistory = adjustmentHistory;

  const commercialAdjustment = roundMoney(centre.commercialAdjustment ?? 0) ?? 0;
  const adjustmentReason = String(centre.commercialReason || centre.adjustmentReason || '');
  const errors = [];
  if (Math.abs(commercialAdjustment) > 0.005 && !adjustmentReason.trim()) {
    errors.push('adjustmentReason is required when commercialAdjustment is not zero.');
  }

  const manualAccrual =
    centre.manualAccrual == null || centre.manualAccrual === ''
      ? 0
      : roundMoney(centre.manualAccrual);
  if (manualAccrual == null) {
    errors.push('manualAccrual must be a finite amount when present.');
  }

  const originalBudget =
    centre.originalBudget == null || centre.originalBudget === ''
      ? null
      : roundMoney(centre.originalBudget);
  const currentBudget =
    centre.currentBudget == null || centre.currentBudget === ''
      ? originalBudget
      : roundMoney(centre.currentBudget);

  return {
    ok: errors.length === 0,
    errors,
    value: {
      costCodeKey,
      costCodeLabel: String(centre.costCodeLabel || centre.costCodeKey || costCodeKey),
      description: String(centre.description || ''),
      commercialHead: String(centre.commercialHead || ''),
      commercialFamily: String(centre.commercialFamily || ''),
      trade: String(centre.trade || ''),
      originalBudget,
      currentBudget,
      commercialAdjustment,
      adjustmentReason,
      commercialReason: adjustmentReason,
      manualAccrual: manualAccrual ?? 0,
      notes: String(centre.commercialNotes || centre.notes || ''),
      active: centre.active !== false,
      displayMetadata,
      adjustmentHistory,
    },
  };
}

export function mapLocalCvrPeriod(periodKey, period) {
  const errors = [];
  const mappedKey = remapLegacyPeriodKey(periodKey);
  if (!mappedKey || mappedKey.length > 32) {
    errors.push(`Invalid local period key: ${periodKey || '(empty)'}.`);
  }
  if (!period || typeof period !== 'object') {
    return {
      ok: false,
      errors: [...errors, 'Period record is missing or not an object.'],
      periodKey: mappedKey || periodKey,
    };
  }
  const localStatus = period.status || 'draft';
  if (!VALID_LOCAL_STATUSES.has(localStatus)) {
    errors.push(`Invalid local period status: ${localStatus}.`);
  }

  const inputs = [];
  const seenKeys = new Set();
  const duplicateKeys = new Set();
  for (const centre of Array.isArray(period.costCentres) ? period.costCentres : []) {
    const mapped = mapLocalCostCodeInput(centre);
    if (!mapped.ok) {
      errors.push(...mapped.errors);
      continue;
    }
    if (seenKeys.has(mapped.value.costCodeKey)) {
      duplicateKeys.add(mapped.value.costCodeKey);
      continue;
    }
    seenKeys.add(mapped.value.costCodeKey);
    inputs.push(mapped.value);
  }
  if (duplicateKeys.size) {
    errors.push(
      `Duplicate normalised cost-code keys: ${[...duplicateKeys].sort().join(', ')}.`
    );
  }

  const status = mapLocalPeriodStatus(localStatus);
  return {
    ok: errors.length === 0,
    errors,
    value: {
      periodKey: mappedKey,
      periodLabel: String(period.periodLabel || mappedKey),
      status,
      localStatus,
      commentary: mapLocalCommentary(period.commercialCommentary),
      developmentNotes: String(period.developmentNotes || ''),
      inputs,
      snapshot: null,
      snapshotDeferred: true,
    },
  };
}

export function readLocalCvrDevelopment(developmentId, storage = globalThis.localStorage) {
  const all = readRawLocalCvrStore(storage);
  if (all.__invalid) {
    return { exists: false, invalid: true, errors: ['buildlite_cvr_v1 is not valid JSON.'], periods: [] };
  }
  if (!Object.prototype.hasOwnProperty.call(all, developmentId)) {
    return { exists: false, invalid: false, errors: [], periods: [], activePeriodKey: null };
  }
  const record = all[developmentId];
  if (!record || typeof record !== 'object') {
    return {
      exists: true,
      invalid: true,
      errors: ['Local CVR development record is not an object.'],
      periods: [],
    };
  }

  const sourcePeriods = record.periods && typeof record.periods === 'object' ? record.periods : {};
  const remapped = {};
  for (const [key, period] of Object.entries(sourcePeriods)) {
    const mappedKey = remapLegacyPeriodKey(key);
    if (remapped[mappedKey] && key === CVR_LOCAL_LEGACY_PERIOD_KEY) continue;
    remapped[mappedKey] = period;
  }

  const periods = [];
  const errors = [];
  for (const key of sortPeriodKeys(Object.keys(remapped))) {
    const mapped = mapLocalCvrPeriod(key, remapped[key]);
    if (!mapped.ok) {
      errors.push(...mapped.errors.map((message) => `${key}: ${message}`));
      periods.push({ ...mapped, periodKey: mapped.periodKey || key });
      continue;
    }
    periods.push(mapped);
  }

  return {
    exists: true,
    invalid: errors.length > 0,
    errors,
    activePeriodKey: remapLegacyPeriodKey(record.activePeriodKey || null) || null,
    periods,
  };
}

export function createPeriodPayload(mappedPeriod) {
  return {
    periodKey: mappedPeriod.periodKey,
    periodLabel: mappedPeriod.periodLabel,
    commentary: mappedPeriod.commentary,
  };
}

export function upsertInputsPayload(mappedInputs) {
  return {
    inputs: mappedInputs.map((input) => ({
      costCodeKey: input.costCodeKey,
      costCodeLabel: input.costCodeLabel,
      description: input.description,
      commercialHead: input.commercialHead,
      commercialFamily: input.commercialFamily,
      trade: input.trade,
      originalBudget: input.originalBudget,
      currentBudget: input.currentBudget,
      commercialAdjustment: input.commercialAdjustment,
      adjustmentReason: input.adjustmentReason,
      manualAccrual: input.manualAccrual,
      notes: input.notes,
      active: input.active,
      displayMetadata: input.displayMetadata,
      adjustmentHistory: input.adjustmentHistory,
    })),
  };
}
