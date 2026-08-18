/**
 * BL-031C — Controlled localStorage → server CVR/ledger migration.
 *
 * Manual/internal only. Never runs at startup. Never runs because an
 * authority flag is ON. Live UI must not call this.
 *
 * Preflight is read-only. Execute POSTs only after `{ confirm: true }`.
 * No dual-write. No snapshots (BL-031E).
 */

import {
  CvrPeriodApiError,
  listCvrPeriodInputs,
  listCvrPeriodsForDevelopment,
} from '../api/cvrPeriods';
import {
  PurchaseLedgerApiError,
  listLedgerTransactionsForDevelopment,
} from '../api/purchaseLedger';
import { isCvrServerAuthorityEnabled } from './cvrPeriodAuthority';
import {
  CVR_FIELDS_NOT_MIGRATED,
  createPeriodPayload,
  isLocalPeriodOpen,
  listLocalCvrDevelopmentIds,
  mapLocalCommentary,
  readLocalCvrDevelopment,
  upsertInputsPayload,
} from './cvrLocalServerMapper';
import {
  approveServerCvrPeriod,
  createServerCvrPeriod,
  submitServerCvrPeriod,
  upsertServerCvrPeriodInputs,
} from './cvrPeriodServerMutations';
import { sortPeriodKeys } from './cvrPeriodStatus';
import { isLedgerServerAuthorityEnabled } from '../ledger/ledgerAuthority';
import {
  LEDGER_FIELDS_NOT_MIGRATED,
  attachLedgerFingerprints,
  groupLocalLedgerBatches,
  importBatchPayload,
  listLocalLedgerDevelopmentIds,
  readLocalLedgerDevelopment,
} from '../ledger/ledgerLocalServerMapper';
import { importServerLedgerBatch } from '../ledger/ledgerServerMutations';

export const AUTO_MIGRATE_ON_STARTUP = false;
export const MIGRATION_INVOCATION = 'manual-only';

const CLASSIFICATION = {
  MATCH: 'MATCH',
  MISSING_SERVER: 'MISSING_SERVER',
  CONFLICT: 'CONFLICT',
  INVALID_LOCAL: 'INVALID_LOCAL',
};

function moneyEqual(left, right) {
  const a = left == null || left === '' ? null : Number(left);
  const b = right == null || right === '' ? null : Number(right);
  if ((a == null || Number.isNaN(a)) && (b == null || Number.isNaN(b))) return true;
  if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.round(a * 100) === Math.round(b * 100);
}

function textEqual(left, right) {
  return String(left || '') === String(right || '');
}

function commentaryEqual(left, right) {
  return JSON.stringify(mapLocalCommentary(left)) === JSON.stringify(mapLocalCommentary(right));
}

function workflowRank(status) {
  if (status === 'locked' || status === 'approved') return 2;
  if (status === 'submitted') return 1;
  return 0;
}

function inputMaterialEqual(local, server) {
  return (
    local.costCodeKey === server.costCodeKey &&
    textEqual(local.costCodeLabel, server.costCodeLabel) &&
    textEqual(local.description, server.description) &&
    textEqual(local.commercialHead, server.commercialHead) &&
    textEqual(local.commercialFamily, server.commercialFamily) &&
    textEqual(local.trade, server.trade) &&
    moneyEqual(local.originalBudget, server.originalBudget) &&
    moneyEqual(local.currentBudget, server.currentBudget) &&
    moneyEqual(local.commercialAdjustment, server.commercialAdjustment) &&
    textEqual(local.adjustmentReason, server.adjustmentReason || server.commercialReason) &&
    moneyEqual(local.manualAccrual, server.manualAccrual) &&
    textEqual(local.notes, server.notes || server.commercialNotes) &&
    Boolean(local.active) === (server.active !== false) &&
    JSON.stringify(local.adjustmentHistory || []) ===
      JSON.stringify(server.adjustmentHistory || [])
  );
}

function periodIdentityEqual(local, server) {
  return (
    local.periodKey === server.periodKey &&
    textEqual(local.periodLabel, server.periodLabel || server.periodKey) &&
    commentaryEqual(local.commentary, server.commercialCommentary || server.commentary)
  );
}

function ledgerEvidenceEqual(local, server) {
  return (
    textEqual(local.supplier, server.supplier) &&
    textEqual(local.supplierCode, server.supplierCode) &&
    textEqual(local.invoiceNumber, server.invoiceNumber) &&
    textEqual(local.transactionDate, String(server.transactionDate || '').slice(0, 10)) &&
    moneyEqual(local.netAmount, server.netAmount) &&
    moneyEqual(local.vatAmount, server.vatAmount ?? server.vat) &&
    moneyEqual(local.grossAmount, server.grossAmount) &&
    textEqual(local.description, server.description) &&
    textEqual(local.source, server.source) &&
    textEqual(local.documentType, server.documentType) &&
    textEqual(local.reference, server.reference) &&
    textEqual(local.costCodeKey, server.costCodeKey || server.costCode)
  );
}

function apiErrorMessage(error) {
  if (error instanceof CvrPeriodApiError || error instanceof PurchaseLedgerApiError) {
    return error.body?.message || error.message;
  }
  return error?.message || 'Server request failed';
}

export function listLocalCvrLedgerDevelopmentIds(storage = globalThis.localStorage) {
  return [
    ...new Set([
      ...listLocalCvrDevelopmentIds(storage),
      ...listLocalLedgerDevelopmentIds(storage),
    ]),
  ].sort();
}

function periodExecuteOrder(periodKeys, localByKey) {
  const locked = [];
  const open = [];
  for (const key of sortPeriodKeys(periodKeys)) {
    if (isLocalPeriodOpen(localByKey.get(key)?.status)) open.push(key);
    else locked.push(key);
  }
  return [...locked, ...open];
}

function classifyCvrPeriod(localMapped, serverPeriod, serverInputs) {
  if (!localMapped.ok) {
    return {
      classification: CLASSIFICATION.INVALID_LOCAL,
      periodKey: localMapped.periodKey,
      errors: localMapped.errors,
      actions: [],
    };
  }
  const local = localMapped.value;
  if (!serverPeriod) {
    return {
      classification: CLASSIFICATION.MISSING_SERVER,
      periodKey: local.periodKey,
      localStatus: local.status,
      serverStatus: null,
      actions: [
        'create',
        local.inputs.length ? 'upsertInputs' : null,
        local.status === 'submitted' || local.status === 'locked' ? 'submit' : null,
        local.status === 'locked' ? 'approve' : null,
      ].filter(Boolean),
      inputsToCreate: local.inputs,
      snapshotDeferred: true,
      snapshot: null,
    };
  }

  if (!periodIdentityEqual(local, serverPeriod)) {
    return {
      classification: CLASSIFICATION.CONFLICT,
      periodKey: local.periodKey,
      reason: 'Period identity/commentary/label differs between localStorage and server.',
      localStatus: local.status,
      serverStatus: serverPeriod.status,
      actions: [],
    };
  }

  const serverStatus = serverPeriod.status === 'approved' ? 'locked' : serverPeriod.status;
  if (workflowRank(serverStatus) > workflowRank(local.status)) {
    return {
      classification: CLASSIFICATION.CONFLICT,
      periodKey: local.periodKey,
      reason: `Server status ${serverStatus} is ahead of local ${local.status}.`,
      actions: [],
    };
  }

  const serverByKey = new Map((serverInputs || []).map((item) => [item.costCodeKey, item]));
  const localByKey = new Map(local.inputs.map((item) => [item.costCodeKey, item]));
  const inputConflicts = [];
  const inputsToCreate = [];
  for (const input of local.inputs) {
    const serverInput = serverByKey.get(input.costCodeKey);
    if (!serverInput) {
      inputsToCreate.push(input);
      continue;
    }
    if (!inputMaterialEqual(input, serverInput)) {
      inputConflicts.push({
        costCodeKey: input.costCodeKey,
        reason: 'Same cost-code key has different server data.',
      });
    }
  }
  const extraServer = [...serverByKey.keys()].filter((key) => !localByKey.has(key));
  if (extraServer.length) {
    inputConflicts.push({
      costCodeKey: extraServer.sort().join(', '),
      reason: 'Server has cost-code inputs that are not in localStorage.',
    });
  }
  if (inputConflicts.length) {
    return {
      classification: CLASSIFICATION.CONFLICT,
      periodKey: local.periodKey,
      reason: 'Cost-code input conflict.',
      conflicts: inputConflicts,
      actions: [],
    };
  }

  if (inputsToCreate.length && serverStatus !== 'draft') {
    return {
      classification: CLASSIFICATION.CONFLICT,
      periodKey: local.periodKey,
      reason: 'Missing inputs cannot be written because the server period is no longer draft.',
      actions: [],
    };
  }

  const actions = [];
  if (inputsToCreate.length) actions.push('upsertInputs');
  if (workflowRank(serverStatus) < 1 && workflowRank(local.status) >= 1) actions.push('submit');
  if (workflowRank(serverStatus) < 2 && workflowRank(local.status) >= 2) actions.push('approve');

  if (!actions.length) {
    return {
      classification: CLASSIFICATION.MATCH,
      periodKey: local.periodKey,
      localStatus: local.status,
      serverStatus,
      serverPeriodId: serverPeriod.id,
      actions: [],
      snapshotDeferred: true,
      snapshot: serverPeriod.snapshot ?? null,
    };
  }

  return {
    classification: CLASSIFICATION.MISSING_SERVER,
    periodKey: local.periodKey,
    reason: 'partial-recovery',
    localStatus: local.status,
    serverStatus,
    serverPeriodId: serverPeriod.id,
    actions,
    inputsToCreate,
    snapshotDeferred: true,
    snapshot: null,
  };
}

async function loadServerCvr(developmentId) {
  const periods = await listCvrPeriodsForDevelopment(developmentId);
  const withInputs = [];
  for (const period of periods) {
    const inputs = period.id ? await listCvrPeriodInputs(developmentId, period.id) : [];
    withInputs.push({ period, inputs });
  }
  return withInputs;
}

async function classifyLedger(developmentId, options, localLedger) {
  const invalid = localLedger.errors.map((message) => ({
    classification: CLASSIFICATION.INVALID_LOCAL,
    message,
  }));
  const fingerprinted = await attachLedgerFingerprints(localLedger.transactions);
  const localByFingerprint = new Map();
  const duplicateFingerprints = [];
  for (const txn of fingerprinted) {
    if (localByFingerprint.has(txn.fingerprint)) {
      duplicateFingerprints.push(txn.fingerprint);
      continue;
    }
    localByFingerprint.set(txn.fingerprint, txn);
  }
  if (duplicateFingerprints.length) {
    invalid.push({
      classification: CLASSIFICATION.INVALID_LOCAL,
      message: `Duplicate local ledger fingerprints: ${[...new Set(duplicateFingerprints)].sort().join(', ')}.`,
    });
  }

  const serverTransactions = await listLedgerTransactionsForDevelopment(developmentId);
  const serverByFingerprint = new Map(
    serverTransactions.map((item) => [item.fingerprint, item])
  );

  const matches = [];
  const conflicts = [];
  const missing = [];
  for (const [fingerprint, local] of [...localByFingerprint.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const server = serverByFingerprint.get(fingerprint);
    if (!server) {
      missing.push(local);
      continue;
    }
    if (!ledgerEvidenceEqual(local, server)) {
      conflicts.push({
        classification: CLASSIFICATION.CONFLICT,
        fingerprint,
        reason: 'Same fingerprint has different money/evidence fields on the server.',
      });
      continue;
    }
    matches.push({ classification: CLASSIFICATION.MATCH, fingerprint });
  }

  const extraServer = [...serverByFingerprint.keys()]
    .filter((fingerprint) => !localByFingerprint.has(fingerprint))
    .sort();
  if (localLedger.exists && extraServer.length) {
    conflicts.push({
      classification: CLASSIFICATION.CONFLICT,
      fingerprints: extraServer,
      reason: 'Server has ledger transactions that are not in localStorage.',
    });
  }
  if (!localLedger.exists && extraServer.length) {
    conflicts.push({
      classification: CLASSIFICATION.CONFLICT,
      fingerprints: extraServer,
      reason: 'Server has ledger transactions but localStorage has no ledger record.',
    });
  }

  const remaining = missing;
  const groups = groupLocalLedgerBatches({
    transactions: remaining,
    importHistory: localLedger.importHistory,
    developmentId,
    developmentName: options.developmentName,
  }).filter((group) => group.transactions.length > 0);

  return {
    invalid,
    matches,
    conflicts,
    missing,
    groups,
    localTransactionCount: localLedger.transactions.length,
    localNetTotal: localLedger.localNetTotal || 0,
    serverTransactionCount: serverTransactions.length,
  };
}

export async function preflightCvrLedgerMigration(developmentId, options = {}) {
  const storage = options.storage || globalThis.localStorage;
  const localCvr = readLocalCvrDevelopment(developmentId, storage);
  const localLedger = readLocalLedgerDevelopment(developmentId, storage);

  const limitations = [
    'Locked local periods migrate workflow state only. No CVR snapshot is written (BL-031E).',
    'Migration actor/timestamps are the current session actor and server NOW(), not historic local values.',
    ...CVR_FIELDS_NOT_MIGRATED,
    ...LEDGER_FIELDS_NOT_MIGRATED,
  ];

  const cvrConflicts = [];
  const cvrInvalid = localCvr.errors.map((message) => ({
    classification: CLASSIFICATION.INVALID_LOCAL,
    message,
  }));
  const periodRows = [];

  let serverCvr = [];
  try {
    serverCvr = await loadServerCvr(developmentId);
  } catch (error) {
    return {
      developmentId,
      safeToExecute: false,
      complete: false,
      limitations,
      cvr: {
        localPeriodCount: localCvr.periods.filter((item) => item.ok).length,
        serverPeriodCount: 0,
        periodsToCreate: [],
        inputsToCreate: [],
        matches: [],
        conflicts: [
          {
            classification: CLASSIFICATION.CONFLICT,
            message: apiErrorMessage(error),
          },
        ],
        invalid: cvrInvalid,
      },
      ledger: {
        localTransactionCount: localLedger.transactions.length,
        localNetTotal: localLedger.localNetTotal || 0,
        serverTransactionCount: 0,
        rowsToImport: 0,
        alreadyMatched: 0,
        conflicts: [],
        invalid: localLedger.errors,
        batchesToCreate: [],
      },
      authorityFlags: {
        cvr: isCvrServerAuthorityEnabled(),
        ledger: isLedgerServerAuthorityEnabled(),
      },
    };
  }

  const serverByKey = new Map(serverCvr.map((item) => [item.period.periodKey, item]));
  const localByKey = new Map(
    localCvr.periods.filter((item) => item.ok).map((item) => [item.value.periodKey, item.value])
  );

  const openLocals = localCvr.periods
    .filter((item) => item.ok && isLocalPeriodOpen(item.value.status))
    .map((item) => item.value.periodKey);
  if (openLocals.length > 1) {
    cvrConflicts.push({
      classification: CLASSIFICATION.CONFLICT,
      periodKeys: openLocals,
      reason: 'Server allows only one open (draft/submitted) period. Local data has more than one.',
    });
  }

  for (const mapped of localCvr.periods) {
    if (!mapped.ok) {
      periodRows.push({
        classification: CLASSIFICATION.INVALID_LOCAL,
        periodKey: mapped.periodKey,
        errors: mapped.errors,
        actions: [],
      });
      continue;
    }
    const server = serverByKey.get(mapped.value.periodKey);
    periodRows.push(
      classifyCvrPeriod(mapped, server?.period || null, server?.inputs || [])
    );
  }

  const extraServerPeriods = [...serverByKey.keys()]
    .filter((key) => !localByKey.has(key))
    .sort();
  if (localCvr.exists && extraServerPeriods.length) {
    cvrConflicts.push({
      classification: CLASSIFICATION.CONFLICT,
      periodKeys: extraServerPeriods,
      reason: 'Server has CVR periods that are not in localStorage.',
    });
  }
  if (!localCvr.exists && extraServerPeriods.length) {
    cvrConflicts.push({
      classification: CLASSIFICATION.CONFLICT,
      periodKeys: extraServerPeriods,
      reason: 'Server has CVR periods but localStorage has no CVR record.',
    });
  }

  for (const row of periodRows) {
    if (row.classification === CLASSIFICATION.CONFLICT) cvrConflicts.push(row);
    if (row.classification === CLASSIFICATION.INVALID_LOCAL) {
      cvrInvalid.push({ periodKey: row.periodKey, errors: row.errors });
    }
  }

  const periodsToCreate = periodRows.filter(
    (row) => row.classification === CLASSIFICATION.MISSING_SERVER && row.actions.includes('create')
  );
  const inputsToCreate = periodRows.flatMap((row) =>
    (row.inputsToCreate || []).map((input) => ({
      periodKey: row.periodKey,
      costCodeKey: input.costCodeKey,
    }))
  );
  const matches = periodRows.filter((row) => row.classification === CLASSIFICATION.MATCH);

  const ledger = await classifyLedger(developmentId, options, localLedger);

  const safeToExecute =
    cvrConflicts.length === 0 &&
    cvrInvalid.length === 0 &&
    ledger.conflicts.length === 0 &&
    ledger.invalid.length === 0;

  const workRemaining =
    periodRows.some((row) => row.actions?.length) || ledger.groups.length > 0;

  return {
    developmentId,
    safeToExecute,
    alreadyMigrated: safeToExecute && !workRemaining,
    complete: false,
    limitations,
    cvr: {
      localPeriodCount: localCvr.periods.filter((item) => item.ok).length,
      serverPeriodCount: serverCvr.length,
      periodsToCreate: periodsToCreate.map((row) => ({
        periodKey: row.periodKey,
        localStatus: row.localStatus,
        actions: row.actions,
      })),
      inputsToCreate,
      matches: matches.map((row) => ({ periodKey: row.periodKey, status: row.serverStatus })),
      conflicts: cvrConflicts,
      invalid: cvrInvalid,
      periodRows,
    },
    ledger: {
      localTransactionCount: ledger.localTransactionCount,
      localNetTotal: ledger.localNetTotal,
      serverTransactionCount: ledger.serverTransactionCount,
      rowsToImport: ledger.missing.length,
      alreadyMatched: ledger.matches.length,
      conflicts: ledger.conflicts,
      invalid: ledger.invalid,
      batchesToCreate: ledger.groups.map((group) => ({
        originalFileName: group.originalFileName,
        sourceProfile: group.sourceProfile,
        rowCount: group.rowCount,
        totalNet: group.totalNet,
        localBatchKey: group.localBatchKey,
      })),
      groups: ledger.groups,
    },
    authorityFlags: {
      cvr: isCvrServerAuthorityEnabled(),
      ledger: isLedgerServerAuthorityEnabled(),
    },
  };
}

async function executeCvrPeriod(developmentId, row, localMapped) {
  let periodId = row.serverPeriodId || null;
  if (row.actions.includes('create')) {
    const created = await createServerCvrPeriod(developmentId, createPeriodPayload(localMapped.value));
    if (!created.ok) {
      return { ok: false, errors: created.errors, incomplete: true };
    }
    periodId = created.period?.id;
  }
  if (!periodId) {
    return { ok: false, errors: [`No server period id for ${row.periodKey}.`], incomplete: true };
  }
  if (row.actions.includes('upsertInputs') && (row.inputsToCreate || []).length) {
    const upserted = await upsertServerCvrPeriodInputs(
      developmentId,
      periodId,
      upsertInputsPayload(row.inputsToCreate)
    );
    if (!upserted.ok) {
      return { ok: false, errors: upserted.errors, incomplete: true, periodId };
    }
  }
  if (row.actions.includes('submit')) {
    const submitted = await submitServerCvrPeriod(developmentId, periodId, {
      comment: 'BL-031C localStorage migration',
    });
    if (!submitted.ok) {
      return { ok: false, errors: submitted.errors, incomplete: true, periodId };
    }
  }
  if (row.actions.includes('approve')) {
    const approved = await approveServerCvrPeriod(developmentId, periodId, {
      comment: 'BL-031C localStorage migration — workflow only, snapshot deferred',
    });
    if (!approved.ok) {
      return { ok: false, errors: approved.errors, incomplete: true, periodId };
    }
  }
  return { ok: true, periodId };
}

export async function executeCvrLedgerMigration(developmentId, options = {}) {
  if (options.confirm !== true) {
    return {
      ok: false,
      executed: false,
      errors: ['execute requires { confirm: true }.'],
    };
  }

  const preflight = await preflightCvrLedgerMigration(developmentId, options);
  if (!preflight.safeToExecute) {
    return {
      ok: false,
      executed: false,
      complete: false,
      errors: ['Preflight found conflicts or invalid local data. Migration aborted.'],
      preflight,
    };
  }

  if (preflight.alreadyMigrated) {
    return {
      ok: true,
      executed: false,
      complete: true,
      alreadyMigrated: true,
      preflight,
    };
  }

  const storage = options.storage || globalThis.localStorage;
  const localCvr = readLocalCvrDevelopment(developmentId, storage);
  const localByKey = new Map(
    localCvr.periods.filter((item) => item.ok).map((item) => [item.value.periodKey, item])
  );

  const executedPeriods = [];
  const order = periodExecuteOrder(
    preflight.cvr.periodRows.map((row) => row.periodKey).filter(Boolean),
    new Map(
      preflight.cvr.periodRows.map((row) => [row.periodKey, { status: row.localStatus }])
    )
  );

  for (const periodKey of order) {
    const row = preflight.cvr.periodRows.find((item) => item.periodKey === periodKey);
    if (!row || !row.actions?.length) continue;
    const localMapped = localByKey.get(periodKey);
    const result = await executeCvrPeriod(developmentId, row, localMapped);
    executedPeriods.push({ periodKey, ...result });
    if (!result.ok) {
      return {
        ok: false,
        executed: true,
        complete: false,
        cvrComplete: false,
        ledgerComplete: false,
        errors: result.errors,
        executedPeriods,
        preflight,
      };
    }
  }

  const executedBatches = [];
  for (const group of preflight.ledger.groups) {
    const imported = await importServerLedgerBatch(developmentId, importBatchPayload(group));
    executedBatches.push({
      originalFileName: group.originalFileName,
      ok: imported.ok,
      errors: imported.errors,
    });
    if (!imported.ok) {
      return {
        ok: false,
        executed: true,
        complete: false,
        cvrComplete: true,
        ledgerComplete: false,
        errors: imported.errors,
        executedPeriods,
        executedBatches,
        preflight,
      };
    }
  }

  const verify = await preflightCvrLedgerMigration(developmentId, options);
  return {
    ok: verify.alreadyMigrated,
    executed: true,
    complete: Boolean(verify.alreadyMigrated),
    cvrComplete: verify.cvr.conflicts.length === 0 && verify.cvr.periodsToCreate.length === 0,
    ledgerComplete: verify.ledger.conflicts.length === 0 && verify.ledger.rowsToImport === 0,
    executedPeriods,
    executedBatches,
    preflight: verify,
  };
}

export function formatMigrationReport(result) {
  const plan = result.preflight || result;
  const lines = [
    `Development: ${plan.developmentId}`,
    `Safe to execute: ${plan.safeToExecute ? 'yes' : 'no'}`,
    `Already migrated / no work: ${plan.alreadyMigrated ? 'yes' : 'no'}`,
    '',
    'CVR',
    `- local periods: ${plan.cvr.localPeriodCount}`,
    `- server periods: ${plan.cvr.serverPeriodCount}`,
    `- periods to create: ${plan.cvr.periodsToCreate.map((item) => item.periodKey).join(', ') || 'none'}`,
    `- inputs to create: ${plan.cvr.inputsToCreate.length}`,
    `- matches: ${plan.cvr.matches.length}`,
    `- conflicts: ${plan.cvr.conflicts.length}`,
    `- invalid: ${plan.cvr.invalid.length}`,
    '',
    'Ledger',
    `- local transactions: ${plan.ledger.localTransactionCount}`,
    `- local net total: ${plan.ledger.localNetTotal}`,
    `- server transactions: ${plan.ledger.serverTransactionCount}`,
    `- rows to import: ${plan.ledger.rowsToImport}`,
    `- already matched: ${plan.ledger.alreadyMatched}`,
    `- conflicts: ${plan.ledger.conflicts.length}`,
    `- batches to create: ${plan.ledger.batchesToCreate.length}`,
  ];
  if (plan.cvr.conflicts.length) {
    lines.push('', 'CVR conflicts:');
    for (const conflict of plan.cvr.conflicts) {
      lines.push(`- ${conflict.reason || conflict.message || JSON.stringify(conflict)}`);
    }
  }
  if (plan.ledger.conflicts.length) {
    lines.push('', 'Ledger conflicts:');
    for (const conflict of plan.ledger.conflicts) {
      lines.push(`- ${conflict.reason || conflict.message || JSON.stringify(conflict)}`);
    }
  }
  lines.push('', 'Limitations:');
  for (const item of plan.limitations || []) lines.push(`- ${item}`);
  return lines.join('\n');
}
