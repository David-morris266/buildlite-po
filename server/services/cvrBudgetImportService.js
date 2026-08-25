/**
 * BL-037B — Authoritative Draft CVR budget import.
 *
 * Validates every imported code against the current-tenant Cost Code Master,
 * establishes missing members via addDraftCvrCostCodeMember, then applies
 * original/current budget only. Adjustments, accruals, and Master identity
 * are not overwritten. One transaction; fail closed on any invalid line.
 */

const { pool } = require("../db");
const { costCodeRowToDocument } = require("./costCodeMasterMapper");
const {
  CVR_PERIOD_AUDIT_ACTIONS,
  isCvrPeriodLocked,
  isCvrPeriodMutable,
  isValidUuid,
} = require("./cvrPeriodConstants");
const { inputRowToDocument } = require("./cvrPeriodMapper");
const {
  addDraftCvrCostCodeMember,
  parseRequestedCostCodeIdentity,
} = require("./cvrMembershipService");
const {
  developmentOr404,
  findPeriodRow,
  insertAudit,
  listCostCodeInputRowsForUpdate,
  updateCostCodeInputBudgets,
} = require("./cvrPeriodRepository");
const { normaliseCostCodeKey } = require("./cvrPeriodValidation");

const CVR_BUDGET_IMPORT_ERROR_CODES = {
  BUDGET_IMPORT_ROWS_REQUIRED: "BUDGET_IMPORT_ROWS_REQUIRED",
  BUDGET_IMPORT_INVALID_BUDGET: "BUDGET_IMPORT_INVALID_BUDGET",
  BUDGET_IMPORT_DUPLICATE_CODE: "BUDGET_IMPORT_DUPLICATE_CODE",
  BUDGET_IMPORT_MASTER_REJECTED: "BUDGET_IMPORT_MASTER_REJECTED",
  COST_CODE_NOT_FOUND: "COST_CODE_NOT_FOUND",
  COST_CODE_INACTIVE: "COST_CODE_INACTIVE",
  PERIOD_NOT_DRAFT: "PERIOD_NOT_DRAFT",
};

function fail(status, code, message, extra = {}) {
  return { ok: false, status, code, message, ...extra };
}

function periodNotDraftResult(status) {
  return fail(
    409,
    CVR_BUDGET_IMPORT_ERROR_CODES.PERIOD_NOT_DRAFT,
    isCvrPeriodLocked(status)
      ? "Locked CVR periods cannot be mutated."
      : "Only draft CVR periods can be edited.",
    { periodStatus: status }
  );
}

function roundMoney(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function formatMasterLine(item) {
  const key = item.costCodeKey || item.requestedKey || "";
  const description = String(item.description || "").trim();
  return description ? `${key} — ${description}` : key;
}

function buildMasterRejectedMessage(unknownCodes, inactiveCodes) {
  const parts = ["Budget cannot be imported."];
  if (unknownCodes.length) {
    parts.push(
      "The following cost codes are not available in your Cost Code Master:",
      ...unknownCodes.map((item) => formatMasterLine(item))
    );
    parts.push("Add or map these codes in Cost Code Master and retry.");
  }
  if (inactiveCodes.length) {
    parts.push(
      "The following cost codes are inactive and cannot be added to a CVR:",
      ...inactiveCodes.map((item) => formatMasterLine(item))
    );
  }
  return parts.join("\n");
}

function parseImportRows(body = {}) {
  const rawRows = Array.isArray(body.rows) ? body.rows : null;
  if (!rawRows || !rawRows.length) {
    return fail(
      400,
      CVR_BUDGET_IMPORT_ERROR_CODES.BUDGET_IMPORT_ROWS_REQUIRED,
      "At least one budget row is required."
    );
  }

  const parsed = [];
  const invalidBudget = [];
  const seen = new Map();
  const duplicateCodes = [];

  rawRows.forEach((row, index) => {
    const requestedKey = parseRequestedCostCodeIdentity(row || {});
    const description = String((row && (row.description || row.costCodeLabel)) || "").trim();
    const originalBudget = roundMoney(row && row.originalBudget);
    const currentExplicit = row && row.currentBudget;
    const currentBudget =
      currentExplicit == null || currentExplicit === ""
        ? originalBudget
        : roundMoney(currentExplicit);

    if (!requestedKey) {
      invalidBudget.push({
        rowNumber: index + 1,
        costCodeKey: "",
        description,
        reason: "costCodeKey is required.",
      });
      return;
    }
    if (originalBudget == null) {
      invalidBudget.push({
        rowNumber: index + 1,
        costCodeKey: requestedKey,
        description,
        reason: "originalBudget must be a finite amount, including £0.",
      });
      return;
    }
    if (currentBudget == null) {
      invalidBudget.push({
        rowNumber: index + 1,
        costCodeKey: requestedKey,
        description,
        reason: "currentBudget must be a finite amount, including £0.",
      });
      return;
    }

    const identityKey = normaliseCostCodeKey(requestedKey) || requestedKey.toLowerCase();
    if (seen.has(identityKey)) {
      const first = seen.get(identityKey);
      const existing = duplicateCodes.find((item) => item.costCodeKey === first.costCodeKey);
      if (existing) {
        existing.rowNumbers.push(index + 1);
      } else {
        duplicateCodes.push({
          costCodeKey: first.costCodeKey,
          rowNumbers: [first.rowNumber, index + 1],
        });
      }
      return;
    }

    seen.set(identityKey, { costCodeKey: requestedKey, rowNumber: index + 1 });
    parsed.push({
      requestedKey,
      identityKey,
      description,
      originalBudget,
      currentBudget,
      rowNumber: index + 1,
    });
  });

  if (duplicateCodes.length) {
    const listed = duplicateCodes.map((item) => item.costCodeKey).join(", ");
    return fail(
      409,
      CVR_BUDGET_IMPORT_ERROR_CODES.BUDGET_IMPORT_DUPLICATE_CODE,
      `Budget cannot be imported because the file contains duplicate cost codes: ${listed}.`,
      { duplicateCodes }
    );
  }

  if (invalidBudget.length) {
    return fail(
      400,
      CVR_BUDGET_IMPORT_ERROR_CODES.BUDGET_IMPORT_INVALID_BUDGET,
      invalidBudget[0].reason,
      { invalidBudget }
    );
  }

  return { ok: true, rows: parsed };
}

function matchMasterRow(masterRows, requestedKey, identityKey) {
  const requested = String(requestedKey || "").trim().toLowerCase();
  return (
    masterRows.find((row) => String(row.code || "").trim().toLowerCase() === requested) ||
    masterRows.find((row) => normaliseCostCodeKey(row.code) === identityKey) ||
    null
  );
}

function findExistingMember(inputRows, masterCode, identityKey) {
  const masterNorm = normaliseCostCodeKey(masterCode);
  const masterRaw = String(masterCode || "").trim().toLowerCase();
  return (
    inputRows.find((row) => {
      const key = String(row.cost_code_key || "");
      const lower = key.trim().toLowerCase();
      return (
        key === identityKey ||
        normaliseCostCodeKey(key) === identityKey ||
        lower === masterRaw ||
        normaliseCostCodeKey(key) === masterNorm
      );
    }) || null
  );
}

async function importDraftCvrBudget(clientId, developmentId, periodId, body = {}, { actor } = {}) {
  const parsed = parseImportRows(body);
  if (!parsed.ok) return parsed;
  if (!isValidUuid(periodId)) {
    return { ok: false, status: 400, message: "periodId must be a valid UUID." };
  }

  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");

    const scoped = await developmentOr404(clientId, developmentId, tx);
    if (!scoped.ok) {
      await tx.query("ROLLBACK");
      return scoped;
    }

    const period = await findPeriodRow(clientId, developmentId, periodId, tx, {
      forUpdate: true,
    });
    if (!period) {
      await tx.query("ROLLBACK");
      return { ok: false, status: 404, message: "CVR period not found." };
    }
    if (!isCvrPeriodMutable(period.status)) {
      await tx.query("ROLLBACK");
      return periodNotDraftResult(period.status);
    }

    const masters = await tx.query(`SELECT * FROM cost_codes WHERE client_id = $1`, [clientId]);
    const masterRows = masters.rows;
    const inputRows = await listCostCodeInputRowsForUpdate(clientId, periodId, tx);

    const unknownCodes = [];
    const inactiveCodes = [];
    const prepared = [];

    for (const row of parsed.rows) {
      const masterRow = matchMasterRow(masterRows, row.requestedKey, row.identityKey);
      if (!masterRow) {
        unknownCodes.push({
          costCodeKey: row.requestedKey,
          description: row.description,
          rowNumber: row.rowNumber,
        });
        continue;
      }
      if (masterRow.is_active === false) {
        const document = costCodeRowToDocument(masterRow);
        inactiveCodes.push({
          costCodeKey: document.code,
          description: document.description || row.description,
          rowNumber: row.rowNumber,
        });
        continue;
      }
      prepared.push({
        ...row,
        masterRow,
        masterDocument: costCodeRowToDocument(masterRow),
        existing: findExistingMember(inputRows, masterRow.code, row.identityKey),
      });
    }

    if (unknownCodes.length || inactiveCodes.length) {
      await tx.query("ROLLBACK");
      const code =
        unknownCodes.length && !inactiveCodes.length
          ? CVR_BUDGET_IMPORT_ERROR_CODES.COST_CODE_NOT_FOUND
          : inactiveCodes.length && !unknownCodes.length
            ? CVR_BUDGET_IMPORT_ERROR_CODES.COST_CODE_INACTIVE
            : CVR_BUDGET_IMPORT_ERROR_CODES.BUDGET_IMPORT_MASTER_REJECTED;
      return fail(
        400,
        code,
        buildMasterRejectedMessage(unknownCodes, inactiveCodes),
        { unknownCodes, inactiveCodes }
      );
    }

    let created = 0;
    let updated = 0;
    const resultInputs = [];

    for (const item of prepared) {
      let memberRow = item.existing;
      if (!memberRow) {
        const added = await addDraftCvrCostCodeMember(
          clientId,
          developmentId,
          periodId,
          { costCodeKey: item.masterDocument.code },
          { actor, dbClient: tx }
        );
        if (!added.ok) {
          await tx.query("ROLLBACK");
          return added;
        }
        memberRow = {
          id: added.input.id,
          version: added.input.version,
          cost_code_key: added.input.costCodeKey,
          commercial_adjustment: added.input.commercialAdjustment,
          manual_accrual: added.input.manualAccrual,
          display_metadata: added.input.displayMetadata,
        };
        inputRows.push(memberRow);
        created += 1;
      }

      const budgeted = await updateCostCodeInputBudgets(tx, {
        clientId,
        inputId: memberRow.id,
        expectedVersion: memberRow.version,
        originalBudget: item.originalBudget,
        currentBudget: item.currentBudget,
        actor,
      });
      if (!budgeted.ok) {
        await tx.query("ROLLBACK");
        return budgeted;
      }
      memberRow.version = budgeted.row.version;
      resultInputs.push(inputRowToDocument(budgeted.row));
      if (item.existing) updated += 1;
    }

    const totalOriginalBudget = prepared.reduce((sum, item) => sum + item.originalBudget, 0);
    const totalCurrentBudget = prepared.reduce((sum, item) => sum + item.currentBudget, 0);

    await insertAudit(tx, {
      clientId,
      periodId,
      action: CVR_PERIOD_AUDIT_ACTIONS.budgetImported,
      actor,
      comment: `Imported budget for ${prepared.length} cost code(s) (${created} new, ${updated} updated)`,
      priorStatus: period.status,
      newStatus: period.status,
    });

    await tx.query("COMMIT");
    return {
      ok: true,
      status: 200,
      created,
      updated,
      importedCount: prepared.length,
      totalOriginalBudget: roundMoney(totalOriginalBudget) ?? 0,
      totalCurrentBudget: roundMoney(totalCurrentBudget) ?? 0,
      inputs: resultInputs,
    };
  } catch (err) {
    try {
      await tx.query("ROLLBACK");
    } catch {
      // Connection may already be closed.
    }
    throw err;
  } finally {
    tx.release();
  }
}

module.exports = {
  CVR_BUDGET_IMPORT_ERROR_CODES,
  importDraftCvrBudget,
  parseImportRows,
};
