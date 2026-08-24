/**
 * BL-033B — Tenant-level cost-code semantic classification.
 * GET never inserts. Unmapped resolves as UNCLASSIFIED + STANDARD_CVR.
 * Does not infer from Commercial Head. Does not write CVR overlays.
 */

const { pool, query } = require("../db");
const {
  classificationRowToDocument,
  unmappedDocument,
} = require("./costCodeClassificationMapper");
const { normalizeCostCodeKey, validatePutClassificationBody } = require(
  "./costCodeClassificationValidation"
);

function provisionalActor(body = {}) {
  return body.updatedBy || body.createdBy || body.actor || null;
}

function isUniqueViolation(err) {
  return err && err.code === "23505";
}

async function findClassificationRow(clientId, costCodeKey, dbClient = null) {
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT *
      FROM cost_code_classifications
      WHERE client_id = $1 AND lower(cost_code_key) = lower($2)
      LIMIT 1
    `,
    [clientId, costCodeKey]
  );
  return rows[0] || null;
}

async function listClassifications(clientId, dbClient = null) {
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT *
      FROM cost_code_classifications
      WHERE client_id = $1
      ORDER BY cost_code_key ASC
    `,
    [clientId]
  );
  return {
    ok: true,
    classifications: rows.map((row) => classificationRowToDocument(row)),
    unmappedDefault: unmappedDocument(""),
  };
}

async function getClassification(clientId, costCodeKeyParam) {
  const costCodeKey = normalizeCostCodeKey(costCodeKeyParam);
  if (!costCodeKey) {
    return { ok: false, status: 400, message: "costCodeKey is required." };
  }
  const row = await findClassificationRow(clientId, costCodeKey);
  return {
    ok: true,
    classification: classificationRowToDocument(row, costCodeKey),
  };
}

async function putClassification(clientId, costCodeKeyParam, body = {}, { actor } = {}) {
  const validated = validatePutClassificationBody(body, costCodeKeyParam);
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }

  const { costCodeKey, semanticGroup, forecastDriver, clear } = validated.value;
  const expectedVersion = validated.expectedVersion;
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const existing = await findClassificationRow(clientId, costCodeKey, dbClient);

    if (!existing) {
      if (clear) {
        await dbClient.query("COMMIT");
        return { ok: true, status: 200, classification: unmappedDocument(costCodeKey) };
      }
      if (expectedVersion !== 0) {
        await dbClient.query("ROLLBACK");
        return {
          ok: false,
          status: 409,
          message: "Cost-code classification version conflict.",
          classification: unmappedDocument(costCodeKey),
        };
      }

      const inserted = await dbClient.query(
        `
          INSERT INTO cost_code_classifications (
            client_id, cost_code_key, semantic_group, forecast_driver,
            version, created_by, updated_by
          )
          VALUES ($1, $2, $3, $4, 1, $5, $5)
          RETURNING *
        `,
        [clientId, costCodeKey, semanticGroup, forecastDriver, actor || null]
      );
      await dbClient.query("COMMIT");
      return {
        ok: true,
        status: 201,
        classification: classificationRowToDocument(inserted.rows[0], costCodeKey),
      };
    }

    if (expectedVersion !== existing.version) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "Cost-code classification version conflict.",
        classification: classificationRowToDocument(existing, costCodeKey),
      };
    }

    if (clear) {
      await dbClient.query(
        `DELETE FROM cost_code_classifications WHERE id = $1 AND client_id = $2`,
        [existing.id, clientId]
      );
      await dbClient.query("COMMIT");
      return { ok: true, status: 200, classification: unmappedDocument(existing.cost_code_key) };
    }

    const updated = await dbClient.query(
      `
        UPDATE cost_code_classifications
        SET
          semantic_group = $1,
          forecast_driver = $2,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $3
        WHERE id = $4 AND client_id = $5 AND version = $6
        RETURNING *
      `,
      [semanticGroup, forecastDriver, actor || null, existing.id, clientId, expectedVersion]
    );
    if (!updated.rowCount) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "Cost-code classification version conflict.",
        classification: classificationRowToDocument(existing, costCodeKey),
      };
    }
    await dbClient.query("COMMIT");
    return {
      ok: true,
      status: 200,
      classification: classificationRowToDocument(updated.rows[0], costCodeKey),
    };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        status: 409,
        message: "A classification already exists for this cost code.",
      };
    }
    throw err;
  } finally {
    dbClient.release();
  }
}

module.exports = {
  listClassifications,
  getClassification,
  putClassification,
  findClassificationRow,
  provisionalActor,
};
