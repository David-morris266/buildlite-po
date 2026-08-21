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
import { isCvrServerAuthorityEnabled } from './cvrPeriodAuthority';
import { migrateCostCentreHierarchy } from './commercialReportingHierarchy';
import {
  getCachedCvrPeriodByKey,
  getCachedCvrPeriods,
  getCvrPeriodReadiness,
} from './cvrPeriodServerCache';
import {
  approvePeriodOnServer,
  createDraftPeriodOnServer,
  recoverOrOpenDraftPeriodOnServer,
  rejectPeriodOnServer,
  savePeriodCommentaryOnServer,
  submitPeriodOnServer,
} from './cvrPeriodAuthorityWrites';
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
  if (isCvrServerAuthorityEnabled()) {
    throw new Error('CVR localStorage writes are disabled while server authority is ON.');
  }
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
    manualAccrual: centre.manualAccrual ?? 0,
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
    snapshot: null,
    snapshotDeferred: true,
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
  if (isCvrServerAuthorityEnabled()) {
    if (!getCvrPeriodReadiness(developmentId).ready) return [];
    return getCachedCvrPeriods(developmentId);
  }
  const record = getCvrRecord(developmentId);
  const keys = sortPeriodKeys(Object.keys(record.periods || {}));
  return keys.map((periodKey) => ({
    periodKey,
    ...getPeriodData(developmentId, periodKey),
  }));
}

export function getCvrPeriod(developmentId, periodKey) {
  if (isCvrServerAuthorityEnabled()) {
    const readiness = getCvrPeriodReadiness(developmentId);
    if (!readiness.ready) {
      return {
        periodKey,
        unavailable: true,
        loadState: readiness.loadState,
        error: readiness.error,
        status: null,
        costCentres: [],
      };
    }
    return (
      getCachedCvrPeriodByKey(developmentId, periodKey) || {
        periodKey,
        missing: true,
        status: null,
        costCentres: [],
      }
    );
  }
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
  if (isCvrServerAuthorityEnabled()) {
    const periods = listCvrPeriods(developmentId);
    return periods[periods.length - 1]?.periodKey || null;
  }
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

function assertCvrPeriodReadsReady(developmentId) {
  if (!isCvrServerAuthorityEnabled()) return { ok: true };
  const readiness = getCvrPeriodReadiness(developmentId);
  if (readiness.ready) return { ok: true };
  return {
    ok: false,
    unavailable: true,
    errors: [readiness.error?.message || 'Unable to load CVR data'],
  };
}

const draftCreateInFlight = new Map();

function withDraftCreateLock(developmentId, work) {
  const existing = draftCreateInFlight.get(developmentId);
  if (existing) return existing;
  const promise = Promise.resolve()
    .then(work)
    .finally(() => {
      if (draftCreateInFlight.get(developmentId) === promise) {
        draftCreateInFlight.delete(developmentId);
      }
    });
  draftCreateInFlight.set(developmentId, promise);
  return promise;
}

function sourcePeriodForNextDraft(developmentId) {
  const periods = listCvrPeriods(developmentId);
  return getLatestLockedCvrPeriod(developmentId) || periods[periods.length - 1] || null;
}

async function createOrOpenDraftPeriodOnServer(developmentId, options = {}) {
  const existingDraft = findDraftCvrPeriod(developmentId);
  if (existingDraft) {
    return recoverOrOpenDraftPeriodOnServer(developmentId, {
      draftPeriod: existingDraft,
      sourcePeriod: sourcePeriodForNextDraft(developmentId),
    });
  }
  const periods = listCvrPeriods(developmentId);
  return createDraftPeriodOnServer(developmentId, {
    periodKeys: periods.map((item) => item.periodKey),
    sourcePeriod: sourcePeriodForNextDraft(developmentId),
    reportingMonth: options.reportingMonth,
  });
}

export function createOrOpenDraftPeriod(developmentId, options = {}) {
  const blocked = assertCvrPeriodReadsReady(developmentId);
  if (!blocked.ok) return blocked;

  if (isCvrServerAuthorityEnabled()) {
    return withDraftCreateLock(developmentId, () =>
      createOrOpenDraftPeriodOnServer(developmentId, options)
    );
  }
  const existingDraft = findDraftCvrPeriod(developmentId);
  if (existingDraft) {
    if (!isCvrServerAuthorityEnabled()) {
      setActivePeriod(developmentId, existingDraft.periodKey);
    }
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

export function createNextCvrPeriod(developmentId, options = {}) {
  const blocked = assertCvrPeriodReadsReady(developmentId);
  if (!blocked.ok) return blocked;

  if (isCvrServerAuthorityEnabled()) {
    return withDraftCreateLock(developmentId, async () => {
      const periods = listCvrPeriods(developmentId);
      const gate = canCreateNextCvrPeriod(periods);
      if (!gate.ok && !gate.draftPeriodKey) {
        return { ok: false, errors: [gate.reason] };
      }
      return createOrOpenDraftPeriodOnServer(developmentId, options);
    });
  }
  const periods = listCvrPeriods(developmentId);
  const gate = canCreateNextCvrPeriod(periods);
  if (!gate.ok) {
    if (gate.draftPeriodKey) {
      if (!isCvrServerAuthorityEnabled()) {
        setActivePeriod(developmentId, gate.draftPeriodKey);
      }
      return { ok: true, periodKey: gate.draftPeriodKey, opened: true };
    }
    return { ok: false, errors: [gate.reason] };
  }

  return createOrOpenDraftPeriod(developmentId, options);
}

export function __resetCvrDraftCreateLockForTests() {
  draftCreateInFlight.clear();
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
  if (isCvrServerAuthorityEnabled()) {
    const blocked = assertCvrPeriodReadsReady(developmentId);
    if (!blocked.ok) return blocked;
    const period = getCvrPeriod(developmentId, periodKey);
    if (!canSubmitCvrPeriod(period)) {
      return { ok: false, errors: ['This CVR period cannot be submitted.'] };
    }
    return submitPeriodOnServer(developmentId, periodKey);
  }

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
  if (isCvrServerAuthorityEnabled()) {
    const blocked = assertCvrPeriodReadsReady(developmentId);
    if (!blocked.ok) return blocked;
    const period = getCvrPeriod(developmentId, periodKey);
    if (!canApproveCvrPeriod(period)) {
      return { ok: false, errors: ['This CVR period cannot be approved.'] };
    }
    return approvePeriodOnServer(developmentId, periodKey);
  }

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

  if (isCvrServerAuthorityEnabled()) {
    const blocked = assertCvrPeriodReadsReady(developmentId);
    if (!blocked.ok) return blocked;
    const period = getCvrPeriod(developmentId, periodKey);
    if (!canRejectCvrPeriod(period)) {
      return { ok: false, errors: ['This CVR period cannot be rejected.'] };
    }
    return rejectPeriodOnServer(developmentId, periodKey, trimmed);
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
  if (isCvrServerAuthorityEnabled()) {
    const blocked = assertCvrPeriodReadsReady(developmentId);
    if (!blocked.ok) return blocked;
    const period = getCvrPeriod(developmentId, periodKey);
    if (!isCvrPeriodEditable(period)) {
      return { ok: false, errors: ['This CVR period is read-only.'] };
    }
    const nextCommentary = {
      ...(period.commercialCommentary || {}),
      ...patch,
    };
    return savePeriodCommentaryOnServer(developmentId, periodKey, nextCommentary);
  }

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
