/**
 * BL-032A — Development revenue settings Postgres access.
 * GET returns defaults without inserting. PUT creates on first write (version 0).
 */

const { pool, query } = require("../db");
const { findDevelopmentById } = require("./developmentRepository");
const { emptyDocument, settingsRowToDocument } = require("./revenueSettingsMapper");
const { validatePutSettingsBody } = require("./revenueSettingsValidation");

function isUniqueViolation(err) {
  return err && err.code === "23505";
}

function provisionalActor(body = {}) {
  return body.updatedBy || body.createdBy || body.actor || null;
}

async function developmentOr404(clientId, developmentId) {
  const development = await findDevelopmentById(clientId, developmentId);
  if (!development) {
    return { ok: false, status: 404, message: "Development not found." };
  }
  return { ok: true, development };
}

async function findSettingsRow(clientId, developmentId, dbClient = null) {
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT *
      FROM development_revenue_settings
      WHERE client_id = $1 AND development_id = $2
      LIMIT 1
    `,
    [clientId, developmentId]
  );
  return rows[0] || null;
}

async function getRevenueSettings(clientId, developmentId) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  const row = await findSettingsRow(clientId, developmentId);
  return {
    ok: true,
    settings: settingsRowToDocument(row, developmentId),
  };
}

async function putRevenueSettings(clientId, developmentId, body = {}, { actor } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;

  const validated = validatePutSettingsBody(body);
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const existing = await findSettingsRow(clientId, developmentId, dbClient);

    if (!existing) {
      if (validated.expectedVersion !== 0) {
        await dbClient.query("ROLLBACK");
        return {
          ok: false,
          status: 409,
          message: "Revenue settings version conflict.",
          settings: emptyDocument(developmentId),
        };
      }

      const inserted = await dbClient.query(
        `
          INSERT INTO development_revenue_settings (
            client_id, development_id, recognition_policy, strategy, house_type_pricing,
            revenue_adjustments, recognition_settings, version, created_by, updated_by
          )
          VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, 1, $8, $8)
          RETURNING *
        `,
        [
          clientId,
          developmentId,
          validated.value.recognitionPolicy,
          JSON.stringify(validated.value.revenueStrategy),
          JSON.stringify(validated.value.houseTypePricing),
          JSON.stringify(validated.value.revenueAdjustments),
          JSON.stringify(validated.value.recognitionSettings),
          actor || null,
        ]
      );
      await dbClient.query("COMMIT");
      return { ok: true, status: 201, settings: settingsRowToDocument(inserted.rows[0], developmentId) };
    }

    if (existing.version !== validated.expectedVersion) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "Revenue settings version conflict.",
        settings: settingsRowToDocument(existing, developmentId),
      };
    }

    const updated = await dbClient.query(
      `
        UPDATE development_revenue_settings
        SET
          recognition_policy = $1,
          strategy = $2::jsonb,
          house_type_pricing = $3::jsonb,
          revenue_adjustments = $4::jsonb,
          recognition_settings = $5::jsonb,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $6
        WHERE client_id = $7 AND development_id = $8 AND version = $9
        RETURNING *
      `,
      [
        validated.value.recognitionPolicy,
        JSON.stringify(validated.value.revenueStrategy),
        JSON.stringify(validated.value.houseTypePricing),
        JSON.stringify(validated.value.revenueAdjustments),
        JSON.stringify(validated.value.recognitionSettings),
        actor || null,
        clientId,
        developmentId,
        validated.expectedVersion,
      ]
    );

    if (!updated.rowCount) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "Revenue settings version conflict.",
        settings: settingsRowToDocument(existing, developmentId),
      };
    }

    await dbClient.query("COMMIT");
    return { ok: true, settings: settingsRowToDocument(updated.rows[0], developmentId) };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    if (isUniqueViolation(err)) {
      return { ok: false, status: 409, message: "Revenue settings already exist for this development." };
    }
    throw err;
  } finally {
    dbClient.release();
  }
}

module.exports = {
  getRevenueSettings,
  putRevenueSettings,
  provisionalActor,
};
