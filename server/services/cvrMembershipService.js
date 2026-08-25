/**
 * BL-037A — Authoritative Draft CVR cost-code membership command.
 *
 * Establishes an empty QS overlay on an existing Draft period from Cost Code
 * Master. Does not copy budgets, proposals, or live commercial facts into the
 * overlay. Classification is not a membership gate.
 *
 * HTTP is single-key. The same function accepts an optional dbClient so
 * BL-037B can add several Master codes in one transaction without duplicating
 * validation.
 */

const { pool } = require("../db");
const { costCodeRowToDocument } = require("./costCodeMasterMapper");
const { findCostCodeRowByCode } = require("./costCodeMasterRepository");
const {
  CVR_PERIOD_AUDIT_ACTIONS,
  CVR_PERIOD_STATUSES,
  isCvrPeriodLocked,
  isCvrPeriodMutable,
  isValidUuid,
} = require("./cvrPeriodConstants");
const { inputRowToDocument } = require("./cvrPeriodMapper");
const {
  developmentOr404,
  findPeriodRow,
  insertAudit,
  insertInput,
  isUniqueViolation,
} = require("./cvrPeriodRepository");
const { normaliseCostCodeKey } = require("./cvrPeriodValidation");

const CVR_MEMBERSHIP_ERROR_CODES = {
  COST_CODE_KEY_REQUIRED: "COST_CODE_KEY_REQUIRED",
  PERIOD_NOT_DRAFT: "PERIOD_NOT_DRAFT",
  COST_CODE_NOT_FOUND: "COST_CODE_NOT_FOUND",
  COST_CODE_INACTIVE: "COST_CODE_INACTIVE",
  COST_CODE_ALREADY_MEMBER: "COST_CODE_ALREADY_MEMBER",
};

function fail(status, code, message, extra = {}) {
  return { ok: false, status, code, message, ...extra };
}

function parseRequestedCostCodeIdentity(body = {}) {
  const raw = String(body.costCodeKey || body.costCode || "").trim();
  if (!raw) return "";
  const identity = raw.split("—")[0].split(" - ")[0].split(" – ")[0].trim();
  return identity;
}

function emptyMembershipInputFromMaster(master) {
  const document = costCodeRowToDocument(master);
  const costCodeKey = normaliseCostCodeKey(document.code);
  return {
    costCodeKey,
    costCodeLabel: document.label || document.code,
    description: document.description || "",
    commercialHead: document.commercialHead || "",
    commercialFamily: document.commercialFamily || "",
    trade: document.trade || document.reportingGroup || "",
    originalBudget: null,
    currentBudget: null,
    commercialAdjustment: 0,
    adjustmentReason: "",
    manualAccrual: 0,
    notes: "",
    active: true,
    displayMetadata: {},
  };
}

async function findExistingMemberRow(dbClient, clientId, periodId, masterCode, membershipKey) {
  const { rows } = await dbClient.query(
    `
      SELECT *
      FROM cvr_cost_code_inputs
      WHERE client_id = $1
        AND period_id = $2
        AND (
          cost_code_key = $3
          OR cost_code_key = $4
          OR lower(btrim(cost_code_key)) = lower(btrim($3))
          OR lower(btrim(cost_code_key)) = lower(btrim($4))
        )
      FOR UPDATE
    `,
    [clientId, periodId, membershipKey, String(masterCode || "").trim()]
  );
  return rows[0] || null;
}

function alreadyMemberResult(row) {
  return fail(
    409,
    CVR_MEMBERSHIP_ERROR_CODES.COST_CODE_ALREADY_MEMBER,
    "A cost-code input already exists for this period.",
    {
      costCodeKey: row.cost_code_key,
      input: inputRowToDocument(row),
    }
  );
}

function periodNotDraftResult(status) {
  return fail(
    409,
    CVR_MEMBERSHIP_ERROR_CODES.PERIOD_NOT_DRAFT,
    isCvrPeriodLocked(status)
      ? "Locked CVR periods cannot be mutated."
      : "Only draft CVR periods can be edited.",
    { periodStatus: status }
  );
}

/**
 * Add one active tenant Master code as an empty Draft CVR input member.
 * Pass `dbClient` to join a caller transaction (BL-037B bulk). The caller
 * then owns BEGIN/COMMIT and must have not yet committed.
 */
async function addDraftCvrCostCodeMember(
  clientId,
  developmentId,
  periodId,
  body = {},
  { actor, dbClient } = {}
) {
  const requestedIdentity = parseRequestedCostCodeIdentity(body);
  if (!requestedIdentity) {
    return fail(
      400,
      CVR_MEMBERSHIP_ERROR_CODES.COST_CODE_KEY_REQUIRED,
      "costCodeKey is required."
    );
  }
  if (!isValidUuid(periodId)) {
    return { ok: false, status: 400, message: "periodId must be a valid UUID." };
  }

  const ownsTransaction = !dbClient;
  const tx = dbClient || (await pool.connect());
  try {
    if (ownsTransaction) await tx.query("BEGIN");

    const scoped = await developmentOr404(clientId, developmentId, tx);
    if (!scoped.ok) {
      if (ownsTransaction) await tx.query("ROLLBACK");
      return scoped;
    }

    const period = await findPeriodRow(clientId, developmentId, periodId, tx, {
      forUpdate: true,
    });
    if (!period) {
      if (ownsTransaction) await tx.query("ROLLBACK");
      return { ok: false, status: 404, message: "CVR period not found." };
    }
    if (!isCvrPeriodMutable(period.status)) {
      if (ownsTransaction) await tx.query("ROLLBACK");
      return periodNotDraftResult(period.status);
    }

    const masterRow = await findCostCodeRowByCode(clientId, requestedIdentity, tx);
    if (!masterRow) {
      if (ownsTransaction) await tx.query("ROLLBACK");
      return fail(
        404,
        CVR_MEMBERSHIP_ERROR_CODES.COST_CODE_NOT_FOUND,
        `Cost code ${requestedIdentity} was not found on Cost Code Master.`,
        { costCodeKey: requestedIdentity }
      );
    }
    if (masterRow.is_active === false) {
      if (ownsTransaction) await tx.query("ROLLBACK");
      return fail(
        400,
        CVR_MEMBERSHIP_ERROR_CODES.COST_CODE_INACTIVE,
        `Cost code ${masterRow.code} is inactive and cannot be added to a CVR.`,
        { costCodeKey: masterRow.code }
      );
    }

    const overlay = emptyMembershipInputFromMaster(masterRow);
    if (!overlay.costCodeKey) {
      if (ownsTransaction) await tx.query("ROLLBACK");
      return fail(
        400,
        CVR_MEMBERSHIP_ERROR_CODES.COST_CODE_KEY_REQUIRED,
        "costCodeKey is required."
      );
    }

    const existing = await findExistingMemberRow(
      tx,
      clientId,
      periodId,
      masterRow.code,
      overlay.costCodeKey
    );
    if (existing) {
      if (ownsTransaction) await tx.query("ROLLBACK");
      return alreadyMemberResult(existing);
    }

    let inserted;
    try {
      if (!ownsTransaction) await tx.query("SAVEPOINT cvr_member_insert");
      inserted = await insertInput(tx, clientId, periodId, overlay, actor || null);
      if (!ownsTransaction) await tx.query("RELEASE SAVEPOINT cvr_member_insert");
    } catch (err) {
      if (ownsTransaction) {
        await tx.query("ROLLBACK");
      } else {
        await tx.query("ROLLBACK TO SAVEPOINT cvr_member_insert");
      }
      if (isUniqueViolation(err)) {
        const raced = await findExistingMemberRow(
          ownsTransaction ? pool : tx,
          clientId,
          periodId,
          masterRow.code,
          overlay.costCodeKey
        );
        if (raced) return alreadyMemberResult(raced);
        return fail(
          409,
          CVR_MEMBERSHIP_ERROR_CODES.COST_CODE_ALREADY_MEMBER,
          "A cost-code input already exists for this period.",
          { costCodeKey: overlay.costCodeKey }
        );
      }
      throw err;
    }

    await insertAudit(tx, {
      clientId,
      periodId,
      action: CVR_PERIOD_AUDIT_ACTIONS.costCodeAdded,
      actor,
      comment: `Added cost code ${overlay.costCodeKey} to Draft CVR`,
      priorStatus: CVR_PERIOD_STATUSES.draft,
      newStatus: CVR_PERIOD_STATUSES.draft,
    });

    if (ownsTransaction) await tx.query("COMMIT");
    return {
      ok: true,
      status: 201,
      input: inputRowToDocument(inserted),
    };
  } catch (err) {
    if (ownsTransaction) {
      try {
        await tx.query("ROLLBACK");
      } catch {
        // Connection may already be closed.
      }
    }
    throw err;
  } finally {
    if (ownsTransaction) tx.release();
  }
}

module.exports = {
  CVR_MEMBERSHIP_ERROR_CODES,
  addDraftCvrCostCodeMember,
  emptyMembershipInputFromMaster,
  parseRequestedCostCodeIdentity,
};
