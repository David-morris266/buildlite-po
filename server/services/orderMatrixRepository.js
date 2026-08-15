/**
 * BL-029A — Order Matrix Postgres access layer.
 */

const { query } = require("../db");
const { findPackageById, findPackageByOrderKey } = require("./packageRepository");
const { findDevelopmentById } = require("./developmentRepository");
const { rowToDocument } = require("./orderMatrixMapper");
const { validatePlotStageMatrix } = require("./orderMatrixValidation");
const { isValidPackageUuid } = require("./orderMatrixConstants");

function invalidPackageUuidResult() {
  return {
    ok: false,
    status: 400,
    message: "packageId must be a valid UUID.",
  };
}

function parseExpectedVersion(expectedVersion) {
  const parsed = Number(expectedVersion);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

async function findMatrixRowByPackageId(clientId, packageId) {
  const { rows } = await query(
    `
      SELECT *
      FROM package_order_matrices
      WHERE client_id = $1
        AND package_id = $2
      LIMIT 1
    `,
    [clientId, packageId]
  );
  return rows[0] || null;
}

async function findMatrixByPackageId(clientId, packageId) {
  const row = await findMatrixRowByPackageId(clientId, packageId);
  return rowToDocument(row);
}

async function findMatrixByOrderKey(clientId, orderKey) {
  const { rows } = await query(
    `
      SELECT *
      FROM package_order_matrices
      WHERE client_id = $1
        AND order_key = $2
      LIMIT 1
    `,
    [clientId, orderKey]
  );
  return rowToDocument(rows[0] || null);
}

async function listMatricesForDevelopment(clientId, developmentId) {
  const { rows } = await query(
    `
      SELECT *
      FROM package_order_matrices
      WHERE client_id = $1
        AND development_id = $2
      ORDER BY order_key ASC
    `,
    [clientId, developmentId]
  );
  return rows.map((row) => rowToDocument(row));
}

async function insertMatrix(clientId, pkg, normalized, actor) {
  const { rows } = await query(
    `
      INSERT INTO package_order_matrices (
        client_id, package_id, development_id, order_key, layout,
        committed_value, payload, version, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $8)
      RETURNING *
    `,
    [
      clientId,
      pkg.id,
      pkg.developmentId,
      pkg.orderKey,
      normalized.layout,
      normalized.committedValue,
      normalized.payload,
      actor,
    ]
  );
  return rowToDocument(rows[0]);
}

async function updateMatrix(clientId, existing, pkg, normalized, expectedVersion, actor) {
  const { rows, rowCount } = await query(
    `
      UPDATE package_order_matrices
      SET
        development_id = $1,
        order_key = $2,
        layout = $3,
        committed_value = $4,
        payload = $5,
        version = version + 1,
        updated_at = NOW(),
        updated_by = $6
      WHERE client_id = $7
        AND package_id = $8
        AND version = $9
      RETURNING *
    `,
    [
      pkg.developmentId,
      pkg.orderKey,
      normalized.layout,
      normalized.committedValue,
      normalized.payload,
      actor,
      clientId,
      pkg.id,
      expectedVersion,
    ]
  );

  if (!rowCount) {
    const current = await findMatrixByPackageId(clientId, pkg.id);
    return {
      ok: false,
      status: 409,
      message: "Order matrix version conflict.",
      matrix: current || existing,
    };
  }

  return { ok: true, status: 200, matrix: rowToDocument(rows[0]) };
}

async function getMatrixForPackage(clientId, packageId) {
  if (!isValidPackageUuid(packageId)) {
    return invalidPackageUuidResult();
  }

  const pkg = await findPackageById(clientId, packageId);
  if (!pkg) {
    return { ok: false, status: 404, message: "Package not found." };
  }

  const matrix = await findMatrixByPackageId(clientId, pkg.id);
  if (!matrix) {
    return { ok: false, status: 404, message: "Order matrix not found." };
  }

  return { ok: true, status: 200, matrix };
}

async function getMatrixForOrderKey(clientId, orderKey) {
  const pkg = await findPackageByOrderKey(clientId, orderKey);
  if (!pkg) {
    return { ok: false, status: 404, message: "Package not found." };
  }

  const matrix = await findMatrixByPackageId(clientId, pkg.id);
  if (!matrix) {
    return { ok: false, status: 404, message: "Order matrix not found." };
  }

  return { ok: true, status: 200, matrix };
}

async function listMatricesForDevelopmentOr404(clientId, developmentId) {
  const development = await findDevelopmentById(clientId, developmentId);
  if (!development) {
    return { ok: false, status: 404, message: "Development not found." };
  }

  const matrices = await listMatricesForDevelopment(clientId, developmentId);
  return { ok: true, status: 200, matrices };
}

async function upsertMatrixForPackage(clientId, packageId, body, expectedVersion, { actor = null } = {}) {
  if (!isValidPackageUuid(packageId)) {
    return invalidPackageUuidResult();
  }

  const pkg = await findPackageById(clientId, packageId);
  if (!pkg) {
    return { ok: false, status: 404, message: "Package not found." };
  }

  const validation = validatePlotStageMatrix(body);
  if (!validation.ok) {
    return { ok: false, status: 400, message: validation.errors.join(" ") };
  }

  const existing = await findMatrixByPackageId(clientId, pkg.id);
  if (!existing) {
    const matrix = await insertMatrix(clientId, pkg, validation.normalized, actor);
    return { ok: true, status: 201, matrix };
  }

  const parsedVersion = parseExpectedVersion(expectedVersion);
  if (parsedVersion == null) {
    return {
      ok: false,
      status: 400,
      message: "version is required and must be a positive integer.",
    };
  }

  if (existing.version !== parsedVersion) {
    return {
      ok: false,
      status: 409,
      message: "Order matrix version conflict.",
      matrix: existing,
    };
  }

  return updateMatrix(
    clientId,
    existing,
    pkg,
    validation.normalized,
    parsedVersion,
    actor
  );
}

module.exports = {
  findMatrixByPackageId,
  findMatrixByOrderKey,
  getMatrixForPackage,
  getMatrixForOrderKey,
  listMatricesForDevelopmentOr404,
  upsertMatrixForPackage,
};
