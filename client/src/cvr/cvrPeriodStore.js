/**
 * BL-014 — CVR period workflow and governance.
 */

import {
  CVR_CURRENT_PERIOD,
  ensureCvrRecord,
  getCvrRecord,
  getPeriodData,
  updateCvrPeriodCommentary as persistCvrPeriodCommentary,
} from './costCentreStore';
import { migrateCostCentreHierarchy } from './commercialReportingHierarchy';
import {
  canApproveCvrPeriod,
  canCreateNextCvrPeriod,
  canRejectCvrPeriod,
  canSubmitCvrPeriod,
  formatNextPeriodKey,
  getCvrPeriodStatusMeta,
  isCvrPeriodDraft,
  isCvrPeriodEditable,
  isCvrPeriodLocked,
  isCvrPeriodSubmitted,
  sortPeriodKeys,
} from './cvrPeriodStatus';

function readAll() {
  try {
    const raw = localStorage.getItem('buildlite_cvr_v1');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  localStorage.setItem('buildlite_cvr_v1', JSON.stringify(data));
}

function newId(prefix = 'audit') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sessionActor() {
  return (
    localStorage.getItem('userName') ||
    localStorage.getItem('userEmail') ||
    'Commercial Manager'
  );
}

function appendAuditEvent(period, entry) {
  const event = {
    id: newId(),
    action: entry.action,
    actor: entry.actor || sessionActor(),
    at: entry.at || new Date().toISOString(),
    comment: entry.comment || '',
  };
  period.auditHistory = [event, ...(period.auditHistory || [])];
  return event;
}

function copyCostCentreForRollForward(centre) {
  const now = new Date().toISOString();
  const hierarchy = migrateCostCentreHierarchy(centre);

  return {
    ...hierarchy,
    id: newId('cc'),
    originalBudget: centre.originalBudget ?? null,
    currentBudget: centre.currentBudget ?? null,
    commercialAdjustment: centre.commercialAdjustment ?? 0,
    commercialReason: centre.commercialReason || '',
    adjustmentHistory: [],
    commercialNotes: centre.commercialNotes || '',
    active: centre.active !== false,
    createdAt: now,
    updatedAt: now,
  };
}

function copyPeriodManualData(sourcePeriod, periodKey) {
  const now = new Date().toISOString();
  const actor = sessionActor();

  return {
    periodKey,
    status: 'draft',
    createdAt: now,
    createdBy: actor,
    submittedAt: null,
    submittedBy: null,
    approvedAt: null,
    approvedBy: null,
    auditHistory: [
      {
        id: newId(),
        action: 'created',
        actor,
        at: now,
        comment: sourcePeriod
          ? `Rolled forward from ${sourcePeriod.periodKey}`
          : 'Initial CVR period created',
      },
    ],
    costCentres: (sourcePeriod?.costCentres || [])
      .filter((item) => item.active !== false)
      .map(copyCostCentreForRollForward),
    developmentNotes: sourcePeriod?.developmentNotes || '',
    commercialCommentary: {
      keyCommercialIssues: String(
        sourcePeriod?.commercialCommentary?.keyCommercialIssues || ''
      ),
      commercialOpportunities: String(
        sourcePeriod?.commercialCommentary?.commercialOpportunities || ''
      ),
      financialRisks: String(sourcePeriod?.commercialCommentary?.financialRisks || ''),
      actionsBeforeNextCvr: String(
        sourcePeriod?.commercialCommentary?.actionsBeforeNextCvr || ''
      ),
    },
    updatedAt: now,
  };
}

export function listCvrPeriods(developmentId) {
  const record = getCvrRecord(developmentId);
  const keys = sortPeriodKeys(Object.keys(record.periods || {}));
  return keys.map((periodKey) => ({
    periodKey,
    ...getPeriodData(developmentId, periodKey),
  }));
}

export function getCvrPeriod(developmentId, periodKey) {
  return {
    periodKey,
    ...getPeriodData(developmentId, periodKey),
  };
}

export function findDraftCvrPeriod(developmentId) {
  return listCvrPeriods(developmentId).find((period) => isCvrPeriodDraft(period)) || null;
}

export function getEditablePeriodKey(developmentId) {
  const draft = findDraftCvrPeriod(developmentId);
  if (draft) return draft.periodKey;
  return getCvrRecord(developmentId).activePeriodKey;
}

export function getLatestLockedCvrPeriod(developmentId) {
  const periods = listCvrPeriods(developmentId).filter((period) =>
    isCvrPeriodLocked(period)
  );
  return periods[periods.length - 1] || null;
}

function setActivePeriod(developmentId, periodKey) {
  const all = readAll();
  const record = ensureCvrRecord(developmentId);
  record.activePeriodKey = periodKey;
  record.updatedAt = new Date().toISOString();
  all[developmentId] = record;
  writeAll(all);
}

export function createOrOpenDraftPeriod(developmentId) {
  const existingDraft = findDraftCvrPeriod(developmentId);
  if (existingDraft) {
    setActivePeriod(developmentId, existingDraft.periodKey);
    return { ok: true, periodKey: existingDraft.periodKey, opened: true };
  }

  const all = readAll();
  const record = ensureCvrRecord(developmentId);
  const periodKeys = Object.keys(record.periods || {});
  const nextKey = formatNextPeriodKey(periodKeys);
  const latestLocked = getLatestLockedCvrPeriod(developmentId);
  const source =
    latestLocked ||
    listCvrPeriods(developmentId)[listCvrPeriods(developmentId).length - 1] ||
    null;

  record.periods[nextKey] = copyPeriodManualData(source, nextKey);
  record.activePeriodKey = nextKey;
  record.updatedAt = new Date().toISOString();
  all[developmentId] = record;
  writeAll(all);

  return { ok: true, periodKey: nextKey, opened: false };
}

export function createNextCvrPeriod(developmentId) {
  const periods = listCvrPeriods(developmentId);
  const gate = canCreateNextCvrPeriod(periods);
  if (!gate.ok) {
    if (gate.draftPeriodKey) {
      setActivePeriod(developmentId, gate.draftPeriodKey);
      return { ok: true, periodKey: gate.draftPeriodKey, opened: true };
    }
    return { ok: false, errors: [gate.reason] };
  }

  return createOrOpenDraftPeriod(developmentId);
}

function updatePeriodRecord(developmentId, periodKey, updater) {
  const all = readAll();
  const record = ensureCvrRecord(developmentId);
  const period = record.periods[periodKey];
  if (!period) {
    return { ok: false, errors: ['CVR period not found.'] };
  }

  const next = updater({ ...period });
  if (!next) {
    return { ok: false, errors: ['CVR period update failed.'] };
  }

  next.updatedAt = new Date().toISOString();
  record.periods[periodKey] = next;
  record.updatedAt = next.updatedAt;
  all[developmentId] = record;
  writeAll(all);

  return { ok: true, period: next, periodKey };
}

export function submitCvrPeriod(developmentId, periodKey) {
  return updatePeriodRecord(developmentId, periodKey, (period) => {
    if (!canSubmitCvrPeriod(period)) return null;

    const now = new Date().toISOString();
    const actor = sessionActor();
    appendAuditEvent(period, { action: 'submitted', actor, at: now });

    return {
      ...period,
      status: 'submitted',
      submittedBy: actor,
      submittedAt: now,
    };
  });
}

export function approveCvrPeriod(developmentId, periodKey) {
  return updatePeriodRecord(developmentId, periodKey, (period) => {
    if (!canApproveCvrPeriod(period)) return null;

    const now = new Date().toISOString();
    const actor = sessionActor();
    appendAuditEvent(period, { action: 'approved', actor, at: now });
    appendAuditEvent(period, { action: 'locked', actor, at: now });

    return {
      ...period,
      status: 'locked',
      approvedBy: actor,
      approvedAt: now,
    };
  });
}

export function rejectCvrPeriod(developmentId, periodKey, comment = '') {
  const trimmed = String(comment || '').trim();
  if (!trimmed) {
    return { ok: false, errors: ['A rejection comment is required.'] };
  }

  return updatePeriodRecord(developmentId, periodKey, (period) => {
    if (!canRejectCvrPeriod(period)) return null;

    const now = new Date().toISOString();
    const actor = sessionActor();
    appendAuditEvent(period, {
      action: 'rejected',
      actor,
      at: now,
      comment: trimmed,
    });

    return {
      ...period,
      status: 'draft',
      submittedBy: null,
      submittedAt: null,
    };
  });
}

export function assertCvrPeriodEditable(developmentId, periodKey) {
  const period = getPeriodData(developmentId, periodKey);
  if (!period?.periodKey && periodKey !== CVR_CURRENT_PERIOD) {
    const withKey = { ...period, periodKey };
    if (!isCvrPeriodEditable(withKey)) {
      return { ok: false, errors: ['This CVR period is read-only.'] };
    }
    return { ok: true };
  }

  if (!isCvrPeriodEditable({ ...period, periodKey })) {
    return { ok: false, errors: ['This CVR period is read-only.'] };
  }

  return { ok: true };
}

export function saveCvrPeriodCommentary(developmentId, periodKey, patch) {
  const persist = persistCvrPeriodCommentary(developmentId, patch, periodKey);
  if (!persist.ok) return persist;

  return updatePeriodRecord(developmentId, periodKey, (period) => {
    appendAuditEvent(period, {
      action: 'commentary_updated',
      comment: 'Commercial commentary updated',
    });
    return {
      ...period,
      commercialCommentary: persist.commercialCommentary,
    };
  });
}

export {
  getCvrPeriodStatusMeta,
  isCvrPeriodDraft,
  isCvrPeriodEditable,
  isCvrPeriodLocked,
  isCvrPeriodSubmitted,
};
