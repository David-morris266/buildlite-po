/**
 * BL-033D.x.2A.1 — Tenant Cost Code Master Postgres access.
 * GET never writes. No DELETE. Code is immutable after insert.
 */

const { pool, query } = require("../db");
const { costCodeRowToDocument } = require("./costCodeMasterMapper");
const {
  validateActiveCostCodeBody,
  validateCreateCostCodeBody,
  validateUpdateCostCodeBody,
} = require("./costCodeMasterValidation");

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function provisionalActor(body = {}) {
  return body.updatedBy || body.createdBy || body.actor || null;
}

function isUniqueViolation(err) {
  if (!err || err.code !== "23505") return false;
  const constraint = String(err.constraint || "");
  return (
    constraint.includes("cost_codes_client_id_code_key") ||
    constraint.includes("uq_cost_codes_client_code_lower")
  );
}

function uniqueConflict() {
  return { ok: false, status: 409, message: "Cost code already exists." };
}

function notFound() {
  return { ok: false, status: 404, message: "Cost code not found." };
}

function stale(row) {
  return {
    ok: false,
    status: 409,
    message: "Cost code version conflict.",
    costCode: costCodeRowToDocument(row),
  };
}

async function findCostCodeRowByCode(clientId, code, dbClient = null) {
  const identity = String(code || "").trim();
  if (!identity) return null;
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT *
      FROM cost_codes
      WHERE client_id = $1 AND lower(btrim(code)) = lower(btrim($2))
      LIMIT 1
    `,
    [clientId, identity]
  );
  return rows[0] || null;
}

async function findCostCodeRow(clientId, id, dbClient = null) {
  if (!isUuid(id)) return null;
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT *
      FROM cost_codes
      WHERE client_id = $1 AND id = $2
      LIMIT 1
    `,
    [clientId, id]
  );
  return rows[0] || null;
}

async function listCostCodes(clientId, { activeOnly = false } = {}) {
  const { rows } = await query(
    `
      SELECT *
      FROM cost_codes
      WHERE client_id = $1
        AND ($2::boolean = false OR is_active = true)
      ORDER BY reporting_order ASC, code ASC, id ASC
    `,
    [clientId, Boolean(activeOnly)]
  );
  return {
    ok: true,
    costCodes: rows.map(costCodeRowToDocument),
  };
}

async function getCostCode(clientId, id) {
  const row = await findCostCodeRow(clientId, id);
  if (!row) return notFound();
  return { ok: true, costCode: costCodeRowToDocument(row) };
}

async function createCostCode(clientId, body = {}, { actor } = {}) {
  const validated = validateCreateCostCodeBody(body);
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }
  const value = validated.value;
  try {
    const inserted = await query(
      `
        INSERT INTO cost_codes (
          client_id, code, description, commercial_head, commercial_family,
          reporting_group, hierarchy_mode, reporting_order, default_vat_treatment,
          default_order_type, allow_budget, allow_purchase_orders, allow_ledger_import,
          allow_forecast_adjustment, notes, import_metadata, is_active, version,
          created_by, updated_by, trade
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16::jsonb, $17, 1,
          $18, $18, $6
        )
        RETURNING *
      `,
      [
        clientId,
        value.code,
        value.description,
        value.commercialHead,
        value.commercialFamily || null,
        value.reportingGroup,
        value.hierarchyMode,
        value.reportingOrder,
        value.defaultVatTreatment,
        value.defaultOrderType,
        value.allowBudget,
        value.allowPurchaseOrders,
        value.allowLedgerImport,
        value.allowForecastAdjustment,
        value.notes,
        value.importMetadata ? JSON.stringify(value.importMetadata) : null,
        value.active,
        actor || null,
      ]
    );
    return { ok: true, status: 201, costCode: costCodeRowToDocument(inserted.rows[0]) };
  } catch (err) {
    if (isUniqueViolation(err)) return uniqueConflict();
    throw err;
  }
}

async function updateCostCode(clientId, id, body = {}, { actor } = {}) {
  const existing = await findCostCodeRow(clientId, id);
  if (!existing) return notFound();

  const validated = validateUpdateCostCodeBody(body, existing.code);
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }
  if (existing.version !== validated.expectedVersion) {
    return stale(existing);
  }

  const value = validated.value;
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const updated = await dbClient.query(
      `
        UPDATE cost_codes
        SET
          description = $1,
          commercial_head = $2,
          commercial_family = $3,
          reporting_group = $4,
          hierarchy_mode = $5,
          reporting_order = $6,
          default_vat_treatment = $7,
          default_order_type = $8,
          allow_budget = $9,
          allow_purchase_orders = $10,
          allow_ledger_import = $11,
          allow_forecast_adjustment = $12,
          notes = $13,
          import_metadata = $14::jsonb,
          trade = $4,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $15
        WHERE client_id = $16 AND id = $17 AND version = $18
        RETURNING *
      `,
      [
        value.description,
        value.commercialHead,
        value.commercialFamily || null,
        value.reportingGroup,
        value.hierarchyMode,
        value.reportingOrder,
        value.defaultVatTreatment,
        value.defaultOrderType,
        value.allowBudget,
        value.allowPurchaseOrders,
        value.allowLedgerImport,
        value.allowForecastAdjustment,
        value.notes,
        value.importMetadata ? JSON.stringify(value.importMetadata) : null,
        actor || null,
        clientId,
        id,
        validated.expectedVersion,
      ]
    );
    if (!updated.rowCount) {
      await dbClient.query("ROLLBACK");
      const latest = await findCostCodeRow(clientId, id);
      return stale(latest || existing);
    }
    await dbClient.query("COMMIT");
    return { ok: true, costCode: costCodeRowToDocument(updated.rows[0]) };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    if (isUniqueViolation(err)) return uniqueConflict();
    throw err;
  } finally {
    dbClient.release();
  }
}

async function setCostCodeActive(clientId, id, body = {}, { actor } = {}) {
  const existing = await findCostCodeRow(clientId, id);
  if (!existing) return notFound();

  const validated = validateActiveCostCodeBody(body);
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }
  if (existing.version !== validated.expectedVersion) {
    return stale(existing);
  }

  const updated = await query(
    `
      UPDATE cost_codes
      SET
        is_active = $1,
        version = version + 1,
        updated_at = NOW(),
        updated_by = $2
      WHERE client_id = $3 AND id = $4 AND version = $5
      RETURNING *
    `,
    [validated.value.active, actor || null, clientId, id, validated.expectedVersion]
  );
  if (!updated.rowCount) {
    const latest = await findCostCodeRow(clientId, id);
    return stale(latest || existing);
  }
  return { ok: true, costCode: costCodeRowToDocument(updated.rows[0]) };
}

module.exports = {
  createCostCode,
  findCostCodeRowByCode,
  getCostCode,
  listCostCodes,
  provisionalActor,
  setCostCodeActive,
  updateCostCode,
};
