/**
 * BL-031A / BL-031E.3B — CVR period and cost-code input Postgres access layer.
 *
 * Approve & Lock is one transaction: close candidate + snapshot persist +
 * submitted -> locked + audit. Either all succeed or nothing changes.
 */

const { pool, query } = require("../db");
const { findDevelopmentById } = require("./developmentRepository");
const {
  CVR_PERIOD_AUDIT_ACTIONS,
  CVR_PERIOD_STATUSES,
  CVR_CLOSE_NOT_READY_CODE,
  SNAPSHOT_CREATED_NOTE,
  isCvrPeriodLocked,
  isCvrPeriodMutable,
  isValidUuid,
  nextPeriodKey,
} = require("./cvrPeriodConstants");
const { periodRowToDocument, inputRowToDocument } = require("./cvrPeriodMapper");
const { getSnapshotForPeriod } = require("./cvrSnapshotRepository");
const {
  parseExpectedVersion,
  validateCostCodeInputBody,
  validateCreatePeriodBody,
  validatePatchPeriodBody,
} = require("./cvrPeriodValidation");

function isUniqueViolation(err) {
  return err && err.code === "23505";
}

function provisionalActor(body = {}) {
  return body.updatedBy || body.createdBy || body.actor || null;
}

async function runQuery(dbClient, text, params) {
  if (dbClient) return dbClient.query(text, params);
  return query(text, params);
}

async function developmentOr404(clientId, developmentId, dbClient = null) {
  const development = await findDevelopmentById(clientId, developmentId, dbClient);
  if (!development) {
    return { ok: false, status: 404, message: "Development not found." };
  }
  return { ok: true, development };
}

async function loadAuditRows(clientId, periodId, dbClient = null) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM cvr_period_audit
      WHERE client_id = $1 AND period_id = $2
      ORDER BY created_at DESC
    `,
    [clientId, periodId]
  );
  return rows;
}

async function insertAudit(dbClient, { clientId, periodId, action, actor, comment, priorStatus, newStatus }) {
  await runQuery(
    dbClient,
    `
      INSERT INTO cvr_period_audit (
        client_id, period_id, action, actor, comment, prior_status, new_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      clientId,
      periodId,
      action,
      actor || null,
      comment || "",
      priorStatus || null,
      newStatus || null,
    ]
  );
}

async function findPeriodRow(clientId, developmentId, periodId, dbClient = null, { forUpdate = false } = {}) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM cvr_periods
      WHERE client_id = $1
        AND development_id = $2
        AND id = $3
      ${forUpdate ? "FOR UPDATE" : ""}
    `,
    [clientId, developmentId, periodId]
  );
  return rows[0] || null;
}

async function listPeriodRows(clientId, developmentId, dbClient = null) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM cvr_periods
      WHERE client_id = $1 AND development_id = $2
      ORDER BY period_key ASC
    `,
    [clientId, developmentId]
  );
  return rows;
}

async function hydratePeriod(clientId, row, dbClient = null) {
  if (!row) return null;
  const audit = await loadAuditRows(clientId, row.id, dbClient);
  const snapshot = await getSnapshotForPeriod(clientId, row.id, dbClient);
  return periodRowToDocument(row, audit, snapshot);
}

async function listCvrPeriods(clientId, developmentId) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  const rows = await listPeriodRows(clientId, developmentId);
  const periods = [];
  for (const row of rows) {
    periods.push(await hydratePeriod(clientId, row));
  }
  return { ok: true, periods };
}

async function getCvrPeriod(clientId, developmentId, periodId, dbClient = null) {
  const scoped = await developmentOr404(clientId, developmentId, dbClient);
  if (!scoped.ok) return scoped;
  if (!isValidUuid(periodId)) {
    return { ok: false, status: 400, message: "periodId must be a valid UUID." };
  }
  const row = await findPeriodRow(clientId, developmentId, periodId, dbClient);
  if (!row) return { ok: false, status: 404, message: "CVR period not found." };
  return { ok: true, period: await hydratePeriod(clientId, row, dbClient) };
}

async function createCvrPeriod(clientId, developmentId, body = {}, { actor } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;

  const validated = validateCreatePeriodBody(body);
  if (!validated.ok) {
    return { ok: false, status: 400, message: validated.errors.join(" ") };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const existing = await listPeriodRows(clientId, developmentId, dbClient);
    const open = existing.find((row) => !isCvrPeriodLocked(row.status));
    if (open) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: `Period ${open.period_key} is still ${open.status}. Complete it before creating another.`,
        period: await hydratePeriod(clientId, open),
      };
    }

    const periodKey = validated.value.periodKey || nextPeriodKey(existing.map((row) => row.period_key));
    const periodLabel = validated.value.periodLabel || periodKey;
    const inserted = await runQuery(
      dbClient,
      `
        INSERT INTO cvr_periods (
          client_id, development_id, period_key, period_label, reporting_month,
          status, commentary, version, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, 'draft', $6::jsonb, 1, $7, $7)
        RETURNING *
      `,
      [
        clientId,
        developmentId,
        periodKey,
        periodLabel,
        validated.value.reportingMonth,
        JSON.stringify(validated.value.commentary),
        actor || null,
      ]
    );

    await insertAudit(dbClient, {
      clientId,
      periodId: inserted.rows[0].id,
      action: CVR_PERIOD_AUDIT_ACTIONS.created,
      actor,
      newStatus: CVR_PERIOD_STATUSES.draft,
      comment: "CVR period created",
    });

    await dbClient.query("COMMIT");
    return {
      ok: true,
      status: 201,
      period: await hydratePeriod(clientId, inserted.rows[0]),
    };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    if (isUniqueViolation(err)) {
      return { ok: false, status: 409, message: "A CVR period with this key already exists." };
    }
    throw err;
  } finally {
    dbClient.release();
  }
}

function lockedMutationResult() {
  return {
    ok: false,
    status: 409,
    message: "Locked CVR periods cannot be mutated.",
  };
}

function notDraftMutationResult(status) {
  if (isCvrPeriodLocked(status)) return lockedMutationResult();
  return {
    ok: false,
    status: 409,
    message: "Only draft CVR periods can be edited.",
  };
}

async function patchCvrPeriod(clientId, developmentId, periodId, body = {}, { actor } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  if (!isValidUuid(periodId)) {
    return { ok: false, status: 400, message: "periodId must be a valid UUID." };
  }

  const validated = validatePatchPeriodBody(body);
  if (!validated.ok) {
    return { ok: false, status: 400, message: validated.errors.join(" ") };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const row = await findPeriodRow(clientId, developmentId, periodId, dbClient, { forUpdate: true });
    if (!row) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "CVR period not found." };
    }
    if (!isCvrPeriodMutable(row.status)) {
      await dbClient.query("ROLLBACK");
      return notDraftMutationResult(row.status);
    }
    if (row.version !== validated.version) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "CVR period version conflict.",
        period: await hydratePeriod(clientId, row),
      };
    }

    const nextLabel = validated.value.periodLabel ?? row.period_label;
    const nextMonth =
      validated.value.reportingMonth !== undefined
        ? validated.value.reportingMonth
        : row.reporting_month;
    const nextCommentary = validated.value.commentary
      ? JSON.stringify(validated.value.commentary)
      : JSON.stringify(row.commentary || {});

    const updated = await runQuery(
      dbClient,
      `
        UPDATE cvr_periods
        SET
          period_label = $1,
          reporting_month = $2,
          commentary = $3::jsonb,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $4
        WHERE client_id = $5 AND id = $6 AND version = $7
        RETURNING *
      `,
      [nextLabel, nextMonth, nextCommentary, actor || null, clientId, periodId, validated.version]
    );

    if (!updated.rowCount) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "CVR period version conflict.",
        period: await hydratePeriod(clientId, row),
      };
    }

    await insertAudit(dbClient, {
      clientId,
      periodId,
      action: CVR_PERIOD_AUDIT_ACTIONS.patched,
      actor,
      priorStatus: row.status,
      newStatus: row.status,
      comment: "CVR period patched",
    });

    await dbClient.query("COMMIT");
    return { ok: true, period: await hydratePeriod(clientId, updated.rows[0]) };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

async function submitCvrPeriod(clientId, developmentId, periodId, body = {}, { actor } = {}) {
  return transitionPeriod(clientId, developmentId, periodId, {
    actor,
    comment: body.comment || "",
    fromStatus: CVR_PERIOD_STATUSES.draft,
    toStatus: CVR_PERIOD_STATUSES.submitted,
    action: CVR_PERIOD_AUDIT_ACTIONS.submitted,
    setSubmitted: true,
  });
}

async function rejectCvrPeriod(clientId, developmentId, periodId, body = {}, { actor } = {}) {
  const comment = String(body.comment || "").trim();
  if (!comment) {
    return { ok: false, status: 400, message: "A rejection comment is required." };
  }
  return transitionPeriod(clientId, developmentId, periodId, {
    actor,
    comment,
    fromStatus: CVR_PERIOD_STATUSES.submitted,
    toStatus: CVR_PERIOD_STATUSES.draft,
    action: CVR_PERIOD_AUDIT_ACTIONS.rejected,
    clearSubmitted: true,
  });
}

async function approveCvrPeriod(clientId, developmentId, periodId, body = {}, options = {}) {
  const { buildWholeCvrCloseCandidate } = require("./cvrCommercialClose");
  const { persistCvrPeriodSnapshot, isUniqueViolation: isSnapshotUnique } = require("./cvrSnapshotRepository");

  const actor = options.actor;
  const failAfter = options.failAfter || null;
  const loadSources = options.loadSources;
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  if (!isValidUuid(periodId)) {
    return { ok: false, status: 400, message: "periodId must be a valid UUID." };
  }

  let expectedVersion = null;
  if (body.version != null && body.version !== "") {
    expectedVersion = parseExpectedVersion(body.version);
    if (expectedVersion == null) {
      return { ok: false, status: 400, message: "version must be a positive integer." };
    }
  }

  const dbClient = await pool.connect();
  let lockedRow = null;
  try {
    await dbClient.query("BEGIN");
    const row = await findPeriodRow(clientId, developmentId, periodId, dbClient, {
      forUpdate: true,
    });
    if (!row) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "CVR period not found." };
    }
    if (row.status !== CVR_PERIOD_STATUSES.submitted) {
      await dbClient.query("ROLLBACK");
      if (isCvrPeriodLocked(row.status)) {
        return {
          ok: false,
          status: 409,
          message: "Locked CVR periods cannot be mutated.",
        };
      }
      return {
        ok: false,
        status: 409,
        message: `CVR period must be ${CVR_PERIOD_STATUSES.submitted} to ${CVR_PERIOD_AUDIT_ACTIONS.locked}.`,
      };
    }
    if (expectedVersion != null && row.version !== expectedVersion) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "CVR period version conflict.",
        period: await hydratePeriod(clientId, row),
      };
    }

    const existingSnapshot = await getSnapshotForPeriod(clientId, periodId, dbClient);
    if (existingSnapshot) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "A CVR snapshot already exists for this period.",
      };
    }

    const candidate = await buildWholeCvrCloseCandidate({
      clientId,
      developmentId,
      periodId,
      actor,
      dbClient,
      ...(loadSources ? { loadSources } : {}),
      ...(options.loadDevelopment ? { loadDevelopment: options.loadDevelopment } : {}),
      ...(options.loadSettingsRow ? { loadSettingsRow: options.loadSettingsRow } : {}),
    });

    if (
      !candidate?.ready ||
      !candidate?.complete ||
      !candidate?.canLock ||
      !candidate?.snapshot
    ) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        code: CVR_CLOSE_NOT_READY_CODE,
        message: "CVR period is not ready to lock.",
        blockers: publicCloseBlockers(candidate?.blockers),
      };
    }

    await persistCvrPeriodSnapshot(dbClient, {
      clientId,
      developmentId,
      periodRow: row,
      candidate,
      actor,
      failAfter,
    });

    if (failAfter === "period") {
      throw new Error("forced-period-update-failure");
    }

    const updated = await runQuery(
      dbClient,
      `
        UPDATE cvr_periods
        SET
          status = $1,
          approved_at = NOW(),
          approved_by = $2,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $2
        WHERE client_id = $3
          AND development_id = $4
          AND id = $5
          AND status = $6
        RETURNING *
      `,
      [
        CVR_PERIOD_STATUSES.locked,
        actor || null,
        clientId,
        developmentId,
        periodId,
        CVR_PERIOD_STATUSES.submitted,
      ]
    );

    if (!updated.rowCount) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "CVR period version conflict.",
      };
    }

    if (failAfter === "audit") {
      throw new Error("forced-audit-failure");
    }

    const userComment = String(body.comment || "").trim();
    await insertAudit(dbClient, {
      clientId,
      periodId,
      action: CVR_PERIOD_AUDIT_ACTIONS.locked,
      actor,
      comment: userComment || SNAPSHOT_CREATED_NOTE,
      priorStatus: CVR_PERIOD_STATUSES.submitted,
      newStatus: CVR_PERIOD_STATUSES.locked,
    });
    await insertAudit(dbClient, {
      clientId,
      periodId,
      action: CVR_PERIOD_AUDIT_ACTIONS.approved,
      actor,
      comment: SNAPSHOT_CREATED_NOTE,
      priorStatus: CVR_PERIOD_STATUSES.submitted,
      newStatus: CVR_PERIOD_STATUSES.locked,
    });

    await dbClient.query("COMMIT");
    lockedRow = updated.rows[0];
  } catch (err) {
    await dbClient.query("ROLLBACK");
    if (isUniqueViolation(err) || isSnapshotUnique(err)) {
      return {
        ok: false,
        status: 409,
        message: "A CVR snapshot already exists for this period.",
      };
    }
    throw err;
  } finally {
    dbClient.release();
  }

  return { ok: true, period: await hydratePeriod(clientId, lockedRow) };
}

function publicCloseBlockers(blockers) {
  return (blockers || []).map((item) => ({
    source: item.source || null,
    reason: item.reason || "not-ready",
    certificateId: item.certificateId || null,
    orderKey: item.orderKey || null,
    plotNumbers: Array.isArray(item.plotNumbers) ? item.plotNumbers : undefined,
    message: item.message || undefined,
    costCodeKey: item.costCodeKey || null,
  }));
}

async function transitionPeriod(clientId, developmentId, periodId, options) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  if (!isValidUuid(periodId)) {
    return { ok: false, status: 400, message: "periodId must be a valid UUID." };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const row = await findPeriodRow(clientId, developmentId, periodId, dbClient, { forUpdate: true });
    if (!row) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "CVR period not found." };
    }
    if (row.status !== options.fromStatus) {
      await dbClient.query("ROLLBACK");
      if (isCvrPeriodLocked(row.status)) return lockedMutationResult();
      return {
        ok: false,
        status: 409,
        message: `CVR period must be ${options.fromStatus} to ${options.action}.`,
      };
    }

    const submittedAt = options.setSubmitted ? new Date() : options.clearSubmitted ? null : row.submitted_at;
    const submittedBy = options.setSubmitted
      ? options.actor || null
      : options.clearSubmitted
        ? null
        : row.submitted_by;
    const approvedAt = options.setApproved ? new Date() : row.approved_at;
    const approvedBy = options.setApproved ? options.actor || null : row.approved_by;

    const updated = await runQuery(
      dbClient,
      `
        UPDATE cvr_periods
        SET
          status = $1,
          submitted_at = $2,
          submitted_by = $3,
          approved_at = $4,
          approved_by = $5,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $6
        WHERE client_id = $7 AND id = $8
        RETURNING *
      `,
      [
        options.toStatus,
        submittedAt,
        submittedBy,
        approvedAt,
        approvedBy,
        options.actor || null,
        clientId,
        periodId,
      ]
    );

    await insertAudit(dbClient, {
      clientId,
      periodId,
      action: options.action,
      actor: options.actor,
      comment: options.comment,
      priorStatus: row.status,
      newStatus: options.toStatus,
    });

    await dbClient.query("COMMIT");
    return { ok: true, period: await hydratePeriod(clientId, updated.rows[0]) };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

async function listCostCodeInputs(clientId, developmentId, periodId, dbClient = null) {
  const scoped = await developmentOr404(clientId, developmentId, dbClient);
  if (!scoped.ok) return scoped;
  if (!isValidUuid(periodId)) {
    return { ok: false, status: 400, message: "periodId must be a valid UUID." };
  }
  const period = await findPeriodRow(clientId, developmentId, periodId, dbClient);
  if (!period) return { ok: false, status: 404, message: "CVR period not found." };

  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM cvr_cost_code_inputs
      WHERE client_id = $1 AND period_id = $2
      ORDER BY cost_code_key ASC
    `,
    [clientId, periodId]
  );
  return { ok: true, inputs: rows.map(inputRowToDocument) };
}

async function findInputRow(clientId, periodId, inputId, dbClient = null, { forUpdate = false } = {}) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM cvr_cost_code_inputs
      WHERE client_id = $1 AND period_id = $2 AND id = $3
      ${forUpdate ? "FOR UPDATE" : ""}
    `,
    [clientId, periodId, inputId]
  );
  return rows[0] || null;
}

/**
 * Lock all cost-code inputs for a period (shared-tx primitive for multi-row writes).
 */
async function listCostCodeInputRowsForUpdate(clientId, periodId, dbClient) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM cvr_cost_code_inputs
      WHERE client_id = $1 AND period_id = $2
      ORDER BY cost_code_key ASC
      FOR UPDATE
    `,
    [clientId, periodId]
  );
  return rows;
}

/**
 * BL-033D.x.4C.1 — Minimum write set for Prelims adoption inside an open transaction.
 * Reuses Draft optimistic-version semantics from patchCostCodeInput without opening a
 * nested connection/transaction (so multi-code adoption stays atomic).
 */
async function updateCostCodeInputCommercialFields(
  dbClient,
  {
    clientId,
    inputId,
    expectedVersion,
    commercialAdjustment,
    adjustmentReason,
    displayMetadata,
    actor = null,
  } = {}
) {
  const updated = await runQuery(
    dbClient,
    `
      UPDATE cvr_cost_code_inputs
      SET
        commercial_adjustment = $1,
        adjustment_reason = $2,
        display_metadata = $3::jsonb,
        version = version + 1,
        updated_at = NOW(),
        updated_by = $4
      WHERE client_id = $5 AND id = $6 AND version = $7
      RETURNING *
    `,
    [
      commercialAdjustment,
      adjustmentReason,
      JSON.stringify(displayMetadata || {}),
      actor || null,
      clientId,
      inputId,
      expectedVersion,
    ]
  );

  if (!updated.rowCount) {
    return {
      ok: false,
      status: 409,
      code: "CVR_INPUT_CONFLICT",
      message: "Cost-code input version conflict.",
    };
  }

  return { ok: true, row: updated.rows[0], input: inputRowToDocument(updated.rows[0]) };
}

/**
 * BL-037B — Budget-only write. Does not touch adjustment, accrual, metadata,
 * or Master identity fields.
 */
async function updateCostCodeInputBudgets(
  dbClient,
  { clientId, inputId, expectedVersion, originalBudget, currentBudget, actor = null } = {}
) {
  const updated = await runQuery(
    dbClient,
    `
      UPDATE cvr_cost_code_inputs
      SET
        original_budget = $1,
        current_budget = $2,
        version = version + 1,
        updated_at = NOW(),
        updated_by = $3
      WHERE client_id = $4 AND id = $5 AND version = $6
      RETURNING *
    `,
    [originalBudget, currentBudget, actor || null, clientId, inputId, expectedVersion]
  );

  if (!updated.rowCount) {
    return {
      ok: false,
      status: 409,
      code: "CVR_INPUT_CONFLICT",
      message: "Cost-code input version conflict.",
    };
  }

  return { ok: true, row: updated.rows[0], input: inputRowToDocument(updated.rows[0]) };
}

async function insertInput(dbClient, clientId, periodId, value, actor) {
  const { rows } = await runQuery(
    dbClient,
    `
      INSERT INTO cvr_cost_code_inputs (
        client_id, period_id, cost_code_key, cost_code_label, description,
        commercial_head, commercial_family, trade, original_budget, current_budget,
        commercial_adjustment, adjustment_reason, manual_accrual, notes, active,
        display_metadata, version, created_by, updated_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, 1, $17, $17
      )
      RETURNING *
    `,
    [
      clientId,
      periodId,
      value.costCodeKey,
      value.costCodeLabel,
      value.description,
      value.commercialHead,
      value.commercialFamily,
      value.trade,
      value.originalBudget,
      value.currentBudget,
      value.commercialAdjustment,
      value.adjustmentReason,
      value.manualAccrual,
      value.notes,
      value.active,
      JSON.stringify(value.displayMetadata || {}),
      actor || null,
    ]
  );
  return rows[0];
}

async function createCostCodeInput(clientId, developmentId, periodId, body = {}, { actor } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  if (!isValidUuid(periodId)) {
    return { ok: false, status: 400, message: "periodId must be a valid UUID." };
  }
  const validated = validateCostCodeInputBody(body);
  if (!validated.ok) {
    return { ok: false, status: 400, message: validated.errors.join(" ") };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const period = await findPeriodRow(clientId, developmentId, periodId, dbClient, { forUpdate: true });
    if (!period) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "CVR period not found." };
    }
    if (!isCvrPeriodMutable(period.status)) {
      await dbClient.query("ROLLBACK");
      return notDraftMutationResult(period.status);
    }

    const inserted = await insertInput(dbClient, clientId, periodId, validated.value, actor);
    await dbClient.query("COMMIT");
    return { ok: true, status: 201, input: inputRowToDocument(inserted) };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        status: 409,
        message: "A cost-code input already exists for this period.",
      };
    }
    throw err;
  } finally {
    dbClient.release();
  }
}

async function patchCostCodeInput(clientId, developmentId, periodId, inputId, body = {}, { actor } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  if (!isValidUuid(periodId) || !isValidUuid(inputId)) {
    return { ok: false, status: 400, message: "periodId and inputId must be valid UUIDs." };
  }
  if (parseExpectedVersion(body.version) == null) {
    return { ok: false, status: 400, message: "version is required and must be a positive integer." };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const period = await findPeriodRow(clientId, developmentId, periodId, dbClient, { forUpdate: true });
    if (!period) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "CVR period not found." };
    }
    if (!isCvrPeriodMutable(period.status)) {
      await dbClient.query("ROLLBACK");
      return notDraftMutationResult(period.status);
    }

    const row = await findInputRow(clientId, periodId, inputId, dbClient, { forUpdate: true });
    if (!row) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "Cost-code input not found." };
    }

    const mergedBody = {
      costCodeKey: row.cost_code_key,
      costCodeLabel: row.cost_code_label,
      description: row.description,
      commercialHead: row.commercial_head,
      commercialFamily: row.commercial_family,
      trade: row.trade,
      originalBudget: row.original_budget,
      currentBudget: row.current_budget,
      commercialAdjustment: row.commercial_adjustment,
      adjustmentReason: row.adjustment_reason,
      manualAccrual: row.manual_accrual,
      notes: row.notes,
      active: row.active,
      displayMetadata: row.display_metadata,
      ...body,
      costCodeKey: body.costCodeKey || body.costCode || row.cost_code_key,
    };
    const merged = validateCostCodeInputBody(mergedBody, { requireVersion: true });
    if (!merged.ok) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 400, message: merged.errors.join(" ") };
    }
    if (row.version !== merged.version) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "Cost-code input version conflict.",
        input: inputRowToDocument(row),
      };
    }

    const updated = await runQuery(
      dbClient,
      `
        UPDATE cvr_cost_code_inputs
        SET
          cost_code_label = $1,
          description = $2,
          commercial_head = $3,
          commercial_family = $4,
          trade = $5,
          original_budget = $6,
          current_budget = $7,
          commercial_adjustment = $8,
          adjustment_reason = $9,
          manual_accrual = $10,
          notes = $11,
          active = $12,
          display_metadata = $13::jsonb,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $14
        WHERE client_id = $15 AND id = $16 AND version = $17
        RETURNING *
      `,
      [
        merged.value.costCodeLabel,
        merged.value.description,
        merged.value.commercialHead,
        merged.value.commercialFamily,
        merged.value.trade,
        merged.value.originalBudget,
        merged.value.currentBudget,
        merged.value.commercialAdjustment,
        merged.value.adjustmentReason,
        merged.value.manualAccrual,
        merged.value.notes,
        merged.value.active,
        JSON.stringify(merged.value.displayMetadata || {}),
        actor || null,
        clientId,
        inputId,
        merged.version,
      ]
    );

    if (!updated.rowCount) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "Cost-code input version conflict.",
        input: inputRowToDocument(row),
      };
    }

    await dbClient.query("COMMIT");
    return { ok: true, input: inputRowToDocument(updated.rows[0]) };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

async function upsertCostCodeInputs(clientId, developmentId, periodId, body = {}, { actor } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  if (!isValidUuid(periodId)) {
    return { ok: false, status: 400, message: "periodId must be a valid UUID." };
  }
  const items = Array.isArray(body.inputs) ? body.inputs : null;
  if (!items) {
    return { ok: false, status: 400, message: "inputs must be an array." };
  }

  const validatedItems = [];
  const seenKeys = new Set();
  for (const item of items) {
    const validated = validateCostCodeInputBody(item);
    if (!validated.ok) {
      return { ok: false, status: 400, message: validated.errors.join(" ") };
    }
    if (seenKeys.has(validated.value.costCodeKey)) {
      return {
        ok: false,
        status: 409,
        message: `Duplicate cost-code input in this period: ${validated.value.costCodeKey}.`,
      };
    }
    seenKeys.add(validated.value.costCodeKey);
    validatedItems.push({ item, validated });
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const period = await findPeriodRow(clientId, developmentId, periodId, dbClient, { forUpdate: true });
    if (!period) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "CVR period not found." };
    }
    if (!isCvrPeriodMutable(period.status)) {
      await dbClient.query("ROLLBACK");
      return notDraftMutationResult(period.status);
    }

    const results = [];
    for (const { item, validated } of validatedItems) {
      const { rows: existingRows } = await runQuery(
        dbClient,
        `
          SELECT *
          FROM cvr_cost_code_inputs
          WHERE client_id = $1 AND period_id = $2 AND cost_code_key = $3
          FOR UPDATE
        `,
        [clientId, periodId, validated.value.costCodeKey]
      );
      const existing = existingRows[0];
      if (!existing) {
        const inserted = await insertInput(dbClient, clientId, periodId, validated.value, actor);
        results.push(inputRowToDocument(inserted));
        continue;
      }

      const expectedVersion = parseExpectedVersion(item.version);
      if (expectedVersion == null) {
        await dbClient.query("ROLLBACK");
        return {
          ok: false,
          status: 400,
          message: `version is required to update cost code ${validated.value.costCodeKey}.`,
        };
      }
      if (existing.version !== expectedVersion) {
        await dbClient.query("ROLLBACK");
        return {
          ok: false,
          status: 409,
          message: "Cost-code input version conflict.",
          input: inputRowToDocument(existing),
        };
      }

      const updated = await runQuery(
        dbClient,
        `
          UPDATE cvr_cost_code_inputs
          SET
            cost_code_label = $1,
            description = $2,
            commercial_head = $3,
            commercial_family = $4,
            trade = $5,
            original_budget = $6,
            current_budget = $7,
            commercial_adjustment = $8,
            adjustment_reason = $9,
            manual_accrual = $10,
            notes = $11,
            active = $12,
            display_metadata = $13::jsonb,
            version = version + 1,
            updated_at = NOW(),
            updated_by = $14
          WHERE client_id = $15 AND id = $16 AND version = $17
          RETURNING *
        `,
        [
          validated.value.costCodeLabel,
          validated.value.description,
          validated.value.commercialHead,
          validated.value.commercialFamily,
          validated.value.trade,
          validated.value.originalBudget,
          validated.value.currentBudget,
          validated.value.commercialAdjustment,
          validated.value.adjustmentReason,
          validated.value.manualAccrual,
          validated.value.notes,
          validated.value.active,
          JSON.stringify(validated.value.displayMetadata || {}),
          actor || null,
          clientId,
          existing.id,
          expectedVersion,
        ]
      );
      if (!updated.rows[0]) {
        await dbClient.query("ROLLBACK");
        return {
          ok: false,
          status: 409,
          message: "Cost-code input version conflict.",
          input: inputRowToDocument(existing),
        };
      }
      results.push(inputRowToDocument(updated.rows[0]));
    }

    await insertAudit(dbClient, {
      clientId,
      periodId,
      action: CVR_PERIOD_AUDIT_ACTIONS.inputsUpserted,
      actor,
      comment: `Upserted ${results.length} cost-code input(s)`,
      priorStatus: period.status,
      newStatus: period.status,
    });

    await dbClient.query("COMMIT");
    return { ok: true, inputs: results };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    if (isUniqueViolation(err)) {
      return { ok: false, status: 409, message: "Duplicate cost-code input in this period." };
    }
    throw err;
  } finally {
    dbClient.release();
  }
}

module.exports = {
  provisionalActor,
  listCvrPeriods,
  getCvrPeriod,
  createCvrPeriod,
  patchCvrPeriod,
  submitCvrPeriod,
  rejectCvrPeriod,
  approveCvrPeriod,
  listCostCodeInputs,
  createCostCodeInput,
  patchCostCodeInput,
  upsertCostCodeInputs,
  findPeriodRow,
  listCostCodeInputRowsForUpdate,
  updateCostCodeInputCommercialFields,
  updateCostCodeInputBudgets,
  insertInput,
  insertAudit,
  developmentOr404,
  isUniqueViolation,
};
