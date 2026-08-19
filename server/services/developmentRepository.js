/**
 * BL-027A.1 — Development Postgres access layer.
 */

const { query } = require("../db");

async function runQuery(dbClient, text, params) {
  if (dbClient) return dbClient.query(text, params);
  return query(text, params);
}
const {
  documentToInsertRow,
  documentToUpdateRow,
  mergeDevelopmentPatch,
  rowToDocument,
} = require("./developmentMapper");
const {
  DEFAULT_DEVELOPMENT_STATUS,
  generateDevelopmentId,
} = require("./developmentConstants");

function isUniqueViolation(err) {
  return err && err.code === "23505";
}

function defaultPayload(nowIso) {
  return {
    client: "",
    location: "",
    address: "",
    postcode: "",
    startDate: "",
    targetCompletion: "",
    plotCount: 0,
    packageCount: 0,
    purchaseOrderCount: 0,
    certificateCount: 0,
    plotMaster: {
      plots: [],
      updatedAt: nowIso,
    },
  };
}

function normalizeCreateDocument(body = {}, suppliedId = null) {
  const nowIso = new Date().toISOString();
  const basePayload = defaultPayload(nowIso);
  const explicitId = suppliedId || body.id;
  const id =
    explicitId && String(explicitId).trim()
      ? String(explicitId).trim()
      : generateDevelopmentId();

  return {
    ...basePayload,
    ...body,
    id,
    jobNumber: body.jobNumber,
    developmentName: body.developmentName,
    status: body.status || DEFAULT_DEVELOPMENT_STATUS,
    createdBy: body.createdBy ?? null,
    updatedBy: body.updatedBy ?? null,
    plotMaster: body.plotMaster || basePayload.plotMaster,
  };
}

async function listDevelopmentsForClient(clientId) {
  const { rows } = await query(
    `
      SELECT *
      FROM developments
      WHERE client_id = $1
      ORDER BY updated_at DESC, created_at DESC
    `,
    [clientId]
  );
  return rows.map(rowToDocument);
}

async function findDevelopmentById(clientId, id, dbClient = null) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM developments
      WHERE id = $1 AND client_id = $2
      LIMIT 1
    `,
    [id, clientId]
  );
  return rows[0] ? rowToDocument(rows[0]) : null;
}

async function findDevelopmentRowById(clientId, id) {
  const { rows } = await query(
    `
      SELECT *
      FROM developments
      WHERE id = $1 AND client_id = $2
      LIMIT 1
    `,
    [id, clientId]
  );
  return rows[0] || null;
}

async function createDevelopment(clientId, body = {}, { actor = null } = {}) {
  const document = normalizeCreateDocument(body, body.id || null);
  const insertRow = documentToInsertRow(document, { clientId, actor });

  try {
    const { rows } = await query(
      `
        INSERT INTO developments (
          id, client_id, job_number, development_name, status, payload,
          version, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, 1, $7, $8)
        RETURNING *
      `,
      [
        insertRow.id,
        insertRow.client_id,
        insertRow.job_number,
        insertRow.development_name,
        insertRow.status,
        JSON.stringify(insertRow.payload),
        insertRow.created_by,
        insertRow.updated_by,
      ]
    );
    return { ok: true, development: rowToDocument(rows[0]) };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const detail = String(err.detail || "").toLowerCase();
      if (detail.includes("(id)")) {
        return { ok: false, status: 409, message: "Development id already exists." };
      }
      return {
        ok: false,
        status: 409,
        message: "Development number already exists for this client.",
      };
    }
    throw err;
  }
}

async function updateDevelopment(
  clientId,
  id,
  patch = {},
  expectedVersion,
  { actor = null } = {}
) {
  const existingRow = await findDevelopmentRowById(clientId, id);
  if (!existingRow) {
    return { ok: false, status: 404, message: "Development not found." };
  }

  const existingDocument = rowToDocument(existingRow);
  const parsedVersion = Number(expectedVersion);
  if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
    return { ok: false, status: 400, message: "version is required and must be a positive integer." };
  }

  if (existingDocument.version !== parsedVersion) {
    return {
      ok: false,
      status: 409,
      message: "Development version conflict.",
      development: existingDocument,
    };
  }

  const mergedDocument = mergeDevelopmentPatch(existingDocument, patch);
  const updateRow = documentToUpdateRow(mergedDocument, { actor });

  try {
    const { rows, rowCount } = await query(
      `
        UPDATE developments
        SET
          job_number = $1,
          development_name = $2,
          status = $3,
          payload = $4::jsonb,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $5
        WHERE id = $6
          AND client_id = $7
          AND version = $8
        RETURNING *
      `,
      [
        updateRow.job_number,
        updateRow.development_name,
        updateRow.status,
        JSON.stringify(updateRow.payload),
        updateRow.updated_by,
        id,
        clientId,
        parsedVersion,
      ]
    );

    if (!rowCount) {
      const current = await findDevelopmentById(clientId, id);
      return {
        ok: false,
        status: 409,
        message: "Development version conflict.",
        development: current,
      };
    }

    return { ok: true, development: rowToDocument(rows[0]) };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        status: 409,
        message: "Development number already exists for this client.",
      };
    }
    throw err;
  }
}

module.exports = {
  listDevelopmentsForClient,
  findDevelopmentById,
  createDevelopment,
  updateDevelopment,
  normalizeCreateDocument,
};
