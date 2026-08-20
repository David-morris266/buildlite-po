/**
 * BL-012B — CVR persistence (localStorage, period-ready structure).
 */

import { normaliseCostCodeKey, findMatchingCostCodeKey } from './cvrCalculations';
import { validateCommercialAdjustment } from './cvrForecastEngine';
import {
  migrateCostCentreHierarchy,
  resolveHierarchyForNewCostCentre,
  validateCostCentreHierarchy,
} from './commercialReportingHierarchy';
import { listCostCodeMasterRecords } from '../admin/costCodeMasterStore';
import {
  CVR_PERIOD_DEFAULT_STATUS,
  isCvrPeriodEditable,
} from './cvrPeriodStatus';
import { isCvrServerAuthorityEnabled } from './cvrPeriodAuthority';
import {
  getCachedCvrInputsForPeriodKey,
  getCachedCvrPeriodByKey,
  getCachedCvrPeriods,
  getCvrInputReadinessForPeriodKey,
  getCvrPeriodReadiness,
} from './cvrPeriodServerCache';
import {
  createCostCentreOnServer,
  patchCostCentreOnServer,
} from './cvrPeriodAuthorityWrites';

const STORAGE_KEY = 'buildlite_cvr_v1';
export const CVR_CURRENT_PERIOD = 'current';
export const CVR_DEFAULT_PERIOD_KEY = 'P01';

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  if (isCvrServerAuthorityEnabled()) {
    throw new Error('CVR localStorage writes are disabled while server authority is ON.');
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function newId(prefix = 'cc') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sessionActor() {
  return (
    localStorage.getItem('userName') ||
    localStorage.getItem('userEmail') ||
    'Commercial Manager'
  );
}

function normaliseCostCentreRecord(centre) {
  if (!centre) return centre;

  const migrated = migrateCostCentreHierarchy(centre);

  return {
    ...migrated,
    commercialAdjustment:
      centre.commercialAdjustment != null
        ? parseBudgetValue(centre.commercialAdjustment) ?? 0
        : 0,
    commercialReason: String(centre.commercialReason || centre.adjustmentReason || ''),
    adjustmentHistory: Array.isArray(centre.adjustmentHistory)
      ? centre.adjustmentHistory
      : [],
    manualAccrual:
      centre.manualAccrual != null ? parseBudgetValue(centre.manualAccrual) ?? 0 : 0,
  };
}

function emptyCommentary() {
  return {
    keyCommercialIssues: '',
    commercialOpportunities: '',
    financialRisks: '',
    actionsBeforeNextCvr: '',
  };
}

function normaliseCommentary(value) {
  const base = value && typeof value === 'object' ? value : {};
  return {
    keyCommercialIssues: String(base.keyCommercialIssues || ''),
    commercialOpportunities: String(base.commercialOpportunities || ''),
    financialRisks: String(base.financialRisks || ''),
    actionsBeforeNextCvr: String(base.actionsBeforeNextCvr || ''),
  };
}

function emptyPeriod(periodKey = CVR_DEFAULT_PERIOD_KEY) {
  const now = new Date().toISOString();
  const actor = sessionActor();

  return {
    periodKey,
    status: CVR_PERIOD_DEFAULT_STATUS,
    createdAt: now,
    createdBy: actor,
    submittedAt: null,
    submittedBy: null,
    approvedAt: null,
    approvedBy: null,
    auditHistory: [
      {
        id: newId('audit'),
        action: 'created',
        actor,
        at: now,
        comment: 'Initial CVR period created',
      },
    ],
    costCentres: [],
    developmentNotes: '',
    commercialCommentary: emptyCommentary(),
    snapshot: null,
    snapshotDeferred: true,
    updatedAt: now,
  };
}

function normalisePeriodRecord(period, periodKey) {
  const base = period || emptyPeriod(periodKey);
  const now = base.updatedAt || new Date().toISOString();

  return {
    ...emptyPeriod(periodKey),
    ...base,
    periodKey,
    status: base.status || CVR_PERIOD_DEFAULT_STATUS,
    auditHistory: Array.isArray(base.auditHistory) ? base.auditHistory : [],
    costCentres: (Array.isArray(base.costCentres) ? base.costCentres : []).map(
      normaliseCostCentreRecord
    ),
    developmentNotes: String(base.developmentNotes || ''),
    commercialCommentary: normaliseCommentary(base.commercialCommentary),
    updatedAt: now,
  };
}

function migrateLegacyPeriods(record) {
  const next = { ...record };
  const periods = { ...(next.periods || {}) };

  if (periods[CVR_CURRENT_PERIOD]) {
    const legacy = normalisePeriodRecord(periods[CVR_CURRENT_PERIOD], CVR_DEFAULT_PERIOD_KEY);
    if (!periods[CVR_DEFAULT_PERIOD_KEY]) {
      periods[CVR_DEFAULT_PERIOD_KEY] = legacy;
    }
    delete periods[CVR_CURRENT_PERIOD];
    if (next.activePeriodKey === CVR_CURRENT_PERIOD) {
      next.activePeriodKey = CVR_DEFAULT_PERIOD_KEY;
    }
  }

  for (const [periodKey, period] of Object.entries(periods)) {
    periods[periodKey] = normalisePeriodRecord(period, periodKey);
  }

  if (!Object.keys(periods).length) {
    periods[CVR_DEFAULT_PERIOD_KEY] = emptyPeriod(CVR_DEFAULT_PERIOD_KEY);
    next.activePeriodKey = CVR_DEFAULT_PERIOD_KEY;
  }

  next.periods = periods;
  return next;
}

function normaliseDevelopmentRecord(record) {
  if (!record) {
    return migrateLegacyPeriods({
      activePeriodKey: CVR_DEFAULT_PERIOD_KEY,
      periods: { [CVR_DEFAULT_PERIOD_KEY]: emptyPeriod(CVR_DEFAULT_PERIOD_KEY) },
      updatedAt: null,
    });
  }

  return migrateLegacyPeriods({
    activePeriodKey: record.activePeriodKey || CVR_DEFAULT_PERIOD_KEY,
    periods:
      record.periods && typeof record.periods === 'object'
        ? { ...record.periods }
        : { [CVR_DEFAULT_PERIOD_KEY]: emptyPeriod(CVR_DEFAULT_PERIOD_KEY) },
    updatedAt: record.updatedAt || null,
  });
}

function assertPeriodEditable(developmentId, periodKey) {
  const period = getPeriodData(developmentId, periodKey);
  if (!isCvrPeriodEditable({ ...period, periodKey })) {
    return { ok: false, errors: ['This CVR period is read-only.'] };
  }
  return { ok: true };
}

export function ensureCvrRecord(developmentId) {
  const all = readAll();
  if (!all[developmentId]) {
    all[developmentId] = normaliseDevelopmentRecord(null);
    writeAll(all);
  }
  return normaliseDevelopmentRecord(all[developmentId]);
}

export function getCvrRecord(developmentId) {
  if (isCvrServerAuthorityEnabled()) {
    const readiness = getCvrPeriodReadiness(developmentId);
    if (!readiness.ready) {
      return {
        activePeriodKey: null,
        periods: {},
        updatedAt: null,
        unavailable: true,
        loadState: readiness.loadState,
        error: readiness.error,
      };
    }
    const periods = {};
    for (const period of getCachedCvrPeriods(developmentId)) {
      periods[period.periodKey] = period;
    }
    const keys = Object.keys(periods);
    return {
      activePeriodKey: keys[keys.length - 1] || null,
      periods,
      updatedAt: null,
    };
  }
  return normaliseDevelopmentRecord(readAll()[developmentId]);
}

export function getActivePeriodKey(developmentId) {
  if (isCvrServerAuthorityEnabled()) {
    const record = getCvrRecord(developmentId);
    return record.activePeriodKey || null;
  }
  return getCvrRecord(developmentId).activePeriodKey || CVR_DEFAULT_PERIOD_KEY;
}

export function getPeriodData(developmentId, periodKey = CVR_DEFAULT_PERIOD_KEY) {
  if (isCvrServerAuthorityEnabled()) {
    const period = getCachedCvrPeriodByKey(developmentId, periodKey);
    if (!period) {
      return {
        periodKey,
        unavailable: !getCvrPeriodReadiness(developmentId).ready,
        status: null,
        costCentres: [],
        commercialCommentary: emptyCommentary(),
        developmentNotes: '',
      };
    }
    const inputReady = getCvrInputReadinessForPeriodKey(developmentId, periodKey);
    return {
      ...period,
      costCentres: inputReady.ready
        ? getCachedCvrInputsForPeriodKey(developmentId, periodKey)
        : [],
    };
  }
  const record = ensureCvrRecord(developmentId);
  return record.periods[periodKey] || emptyPeriod(periodKey);
}

export function listCostCentres(developmentId, periodKey = CVR_DEFAULT_PERIOD_KEY) {
  if (isCvrServerAuthorityEnabled()) {
    const inputReady = getCvrInputReadinessForPeriodKey(developmentId, periodKey);
    if (!inputReady.ready) return [];
    return getCachedCvrInputsForPeriodKey(developmentId, periodKey)
      .filter((item) => item.active !== false)
      .map(normaliseCostCentreRecord);
  }
  return [...getPeriodData(developmentId, periodKey).costCentres]
    .filter((item) => item.active !== false)
    .map(normaliseCostCentreRecord);
}

export function getCostCentre(developmentId, costCentreId, periodKey = CVR_DEFAULT_PERIOD_KEY) {
  return (
    getPeriodData(developmentId, periodKey).costCentres.find(
      (item) => item.id === costCentreId
    ) || null
  );
}

export function getCostCentreByKey(
  developmentId,
  costCodeKey,
  periodKey = CVR_DEFAULT_PERIOD_KEY
) {
  const key = normaliseCostCodeKey(costCodeKey);
  if (!key) return null;

  const centres = getPeriodData(developmentId, periodKey).costCentres.filter(
    (item) => item.active !== false
  );

  const direct = centres.find(
    (item) => normaliseCostCodeKey(item.costCodeKey) === key
  );
  if (direct) return direct;

  const knownKeys = new Set(
    centres.map((item) => normaliseCostCodeKey(item.costCodeKey)).filter(Boolean)
  );
  const matched = findMatchingCostCodeKey(key, knownKeys);
  if (!matched) return null;

  return (
    centres.find((item) => normaliseCostCodeKey(item.costCodeKey) === matched) ||
    null
  );
}

export function getDevelopmentNotes(developmentId, periodKey = CVR_DEFAULT_PERIOD_KEY) {
  return getPeriodData(developmentId, periodKey).developmentNotes || '';
}

export function updateDevelopmentNotes(
  developmentId,
  notes,
  periodKey = CVR_DEFAULT_PERIOD_KEY
) {
  const editable = assertPeriodEditable(developmentId, periodKey);
  if (!editable.ok) return editable;
  if (isCvrServerAuthorityEnabled()) {
    return {
      ok: false,
      skipped: true,
      errors: [
        'Development notes are not stored on the server. Use cost-code notes or commercial commentary.',
      ],
    };
  }
  const all = readAll();
  const record = ensureCvrRecord(developmentId);
  const now = new Date().toISOString();

  record.periods[periodKey] = {
    ...record.periods[periodKey],
    developmentNotes: String(notes || ''),
    updatedAt: now,
  };
  record.updatedAt = now;
  all[developmentId] = record;
  writeAll(all);

  return record.periods[periodKey];
}

export function getCvrPeriodCommentary(developmentId, periodKey = CVR_DEFAULT_PERIOD_KEY) {
  return normaliseCommentary(getPeriodData(developmentId, periodKey).commercialCommentary);
}

export function updateCvrPeriodCommentary(
  developmentId,
  patch,
  periodKey = CVR_DEFAULT_PERIOD_KEY
) {
  const editable = assertPeriodEditable(developmentId, periodKey);
  if (!editable.ok) return editable;

  const all = readAll();
  const record = ensureCvrRecord(developmentId);
  const period = record.periods[periodKey];
  if (!period) return { ok: false, errors: ['CVR period not found.'] };

  const now = new Date().toISOString();
  const current = normaliseCommentary(period.commercialCommentary);
  const next = normaliseCommentary({ ...current, ...patch });

  record.periods[periodKey] = {
    ...period,
    commercialCommentary: next,
    updatedAt: now,
  };
  record.updatedAt = now;
  all[developmentId] = record;
  writeAll(all);

  return { ok: true, commercialCommentary: next };
}

function resolveHierarchyForNewCostCentrePayload(payload, label) {
  const codeKey = normaliseCostCodeKey(payload.costCodeKey || label);
  const master = listCostCodeMasterRecords({ activeOnly: true }).find(
    (item) => normaliseCostCodeKey(item.code) === codeKey
  );

  if (master) {
    return resolveHierarchyForNewCostCentre({
      ...payload,
      commercialHead: master.commercialHead,
      commercialFamily: master.commercialFamily,
      trade: master.trade,
      description: payload.description || master.description,
    });
  }

  return resolveHierarchyForNewCostCentre(payload);
}

function parseBudgetValue(value) {
  if (value == null || value === '') return null;
  const n = Number.parseFloat(String(value).replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : null;
}

export function addCostCentre(developmentId, payload, periodKey = CVR_DEFAULT_PERIOD_KEY) {
  const editable = assertPeriodEditable(developmentId, periodKey);
  if (!editable.ok) return editable;
  const now = new Date().toISOString();

  const label = String(payload.costCodeLabel || '').trim();
  if (!label) {
    return { ok: false, errors: ['Cost code is required.'] };
  }

  const hierarchy = resolveHierarchyForNewCostCentrePayload(payload, label);
  const costCentre = normaliseCostCentreRecord({
    id: newId(),
    costCodeKey: normaliseCostCodeKey(payload.costCodeKey || label),
    costCodeLabel: label,
    description: String(payload.description || '').trim(),
    commercialHead: hierarchy.commercialHead,
    commercialFamily: hierarchy.commercialFamily,
    trade: hierarchy.trade,
    originalBudget: parseBudgetValue(payload.originalBudget),
    currentBudget:
      parseBudgetValue(payload.currentBudget) ??
      parseBudgetValue(payload.originalBudget),
    commercialAdjustment: parseBudgetValue(payload.commercialAdjustment) ?? 0,
    commercialReason: String(payload.commercialReason || '').trim(),
    adjustmentHistory: [],
    commercialNotes: '',
    manualAccrual: parseBudgetValue(payload.manualAccrual) ?? 0,
    active: true,
    createdAt: now,
    updatedAt: now,
  });

  if (isCvrServerAuthorityEnabled()) {
    return createCostCentreOnServer(developmentId, periodKey, costCentre);
  }

  const all = readAll();
  const record = ensureCvrRecord(developmentId);
  const period = record.periods[periodKey] || emptyPeriod();
  period.costCentres = [...period.costCentres, costCentre];
  period.updatedAt = now;
  record.periods[periodKey] = period;
  record.updatedAt = now;
  all[developmentId] = record;
  writeAll(all);

  return { ok: true, costCentre };
}

export function updateCostCentre(
  developmentId,
  costCentreId,
  patch,
  periodKey = CVR_DEFAULT_PERIOD_KEY
) {
  const editable = assertPeriodEditable(developmentId, periodKey);
  if (!editable.ok) return editable;

  const period = isCvrServerAuthorityEnabled()
    ? getPeriodData(developmentId, periodKey)
    : ensureCvrRecord(developmentId).periods[periodKey];
  if (!period) return { ok: false, errors: ['CVR period not found.'] };

  const index = (period.costCentres || []).findIndex((item) => item.id === costCentreId);
  if (index < 0) return { ok: false, errors: ['Cost code not found.'] };

  const current = period.costCentres[index];
  const now = new Date().toISOString();
  const next = { ...current, updatedAt: now };

  if (patch.costCodeLabel != null) {
    next.costCodeLabel = String(patch.costCodeLabel).trim() || current.costCodeLabel;
  }
  if (patch.description !== undefined) {
    next.description = String(patch.description || '');
    if (patch.trade === undefined && !String(current.trade || '').trim()) {
      next.trade = migrateCostCentreHierarchy({
        ...next,
        trade: '',
      }).trade;
    }
  }
  if (patch.commercialHead !== undefined) {
    next.commercialHead = String(patch.commercialHead || '').trim();
  }
  if (patch.commercialFamily !== undefined) {
    next.commercialFamily = String(patch.commercialFamily || '').trim();
  }
  if (patch.trade !== undefined) {
    next.trade = String(patch.trade || '').trim();
  }
  if (
    patch.commercialHead !== undefined ||
    patch.commercialFamily !== undefined ||
    patch.trade !== undefined
  ) {
    const hierarchyValidation = validateCostCentreHierarchy(next);
    if (!hierarchyValidation.valid) {
      return { ok: false, errors: hierarchyValidation.errors };
    }
    Object.assign(next, hierarchyValidation.hierarchy);
  }
  if (patch.originalBudget !== undefined) {
    next.originalBudget = parseBudgetValue(patch.originalBudget);
  }
  if (patch.currentBudget !== undefined) {
    next.currentBudget = parseBudgetValue(patch.currentBudget);
  }
  if (patch.commercialAdjustment !== undefined) {
    const validation = validateCommercialAdjustment(
      patch.commercialAdjustment,
      patch.commercialReason !== undefined ? patch.commercialReason : current.commercialReason
    );
    if (!validation.valid) {
      return { ok: false, errors: validation.errors };
    }

    const previousAdjustment = parseBudgetValue(current.commercialAdjustment) ?? 0;
    const nextAdjustment = validation.commercialAdjustment;
    if (Math.abs(nextAdjustment - previousAdjustment) > 0.005) {
      next.adjustmentHistory = [
        ...(Array.isArray(current.adjustmentHistory) ? current.adjustmentHistory : []),
        {
          id: newId('adj'),
          date: now,
          user: sessionActor(),
          previousAdjustment,
          newAdjustment: nextAdjustment,
          reason: validation.commercialReason,
        },
      ];
    }

    next.commercialAdjustment = nextAdjustment;
  }
  if (patch.commercialReason !== undefined) {
    const validation = validateCommercialAdjustment(
      patch.commercialAdjustment !== undefined
        ? patch.commercialAdjustment
        : current.commercialAdjustment,
      patch.commercialReason
    );
    if (!validation.valid) {
      return { ok: false, errors: validation.errors };
    }
    next.commercialReason = validation.commercialReason;
  }
  if (patch.commercialNotes !== undefined) {
    next.commercialNotes = String(patch.commercialNotes || '');
  }
  if (patch.manualAccrual !== undefined) {
    next.manualAccrual = parseBudgetValue(patch.manualAccrual) ?? 0;
  }
  if (patch.active !== undefined) {
    next.active = Boolean(patch.active);
  }

  if (isCvrServerAuthorityEnabled()) {
    return patchCostCentreOnServer(developmentId, periodKey, next);
  }

  const all = readAll();
  const record = ensureCvrRecord(developmentId);
  record.periods[periodKey].costCentres[index] = next;
  record.periods[periodKey].updatedAt = now;
  record.updatedAt = now;
  all[developmentId] = record;
  writeAll(all);

  return { ok: true, costCentre: next };
}

export function deactivateCostCentre(
  developmentId,
  costCentreId,
  periodKey = CVR_DEFAULT_PERIOD_KEY
) {
  return updateCostCentre(developmentId, costCentreId, { active: false }, periodKey);
}

export function deleteCostCentre(
  developmentId,
  costCentreId,
  periodKey = CVR_DEFAULT_PERIOD_KEY
) {
  if (isCvrServerAuthorityEnabled()) {
    return updateCostCentre(developmentId, costCentreId, { active: false }, periodKey);
  }
  const all = readAll();
  const record = ensureCvrRecord(developmentId);
  const period = record.periods[periodKey];
  if (!period) return { ok: false, errors: ['CVR period not found.'] };

  period.costCentres = period.costCentres.filter((item) => item.id !== costCentreId);
  period.updatedAt = new Date().toISOString();
  record.updatedAt = period.updatedAt;
  all[developmentId] = record;
  writeAll(all);

  return { ok: true };
}

export function upsertAutoCostCentre(
  developmentId,
  {
    costCodeKey,
    costCodeLabel,
    description = '',
    commercialHead,
    commercialFamily,
    trade,
  },
  periodKey = CVR_DEFAULT_PERIOD_KEY
) {
  const period = getPeriodData(developmentId, periodKey);
  const existing = (period.costCentres || []).find(
    (item) => item.costCodeKey === costCodeKey && item.active !== false
  );
  if (existing) return normaliseCostCentreRecord(existing);

  const result = addCostCentre(
    developmentId,
    {
      costCodeKey,
      costCodeLabel,
      description,
      commercialHead,
      commercialFamily,
      trade,
      originalBudget: null,
      currentBudget: null,
      commercialAdjustment: 0,
      commercialReason: '',
    },
    periodKey
  );

  if (result && typeof result.then === 'function') {
    return result.then((resolved) => (resolved.ok ? resolved.costCentre : null));
  }

  return result.ok ? result.costCentre : null;
}
