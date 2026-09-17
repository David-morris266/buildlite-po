/**
 * BL-032A — Development revenue settings Postgres access.
 * GET returns defaults without inserting. PUT creates on first write (version 0).
 */

const { pool, query } = require("../db");
const { findDevelopmentById } = require("./developmentRepository");
const { emptyDocument, settingsRowToDocument } = require("./revenueSettingsMapper");
const { validatePutSettingsBody } = require("./revenueSettingsValidation");
const { assertServicePermission } = require("../auth/authorization");
const { PERMISSIONS } = require("../auth/permissions");

function withRevenueAuthority(clientId, developmentId, development, settings) {
  const { buildRevenueAuthorityFromDocuments } = require("./cvrRevenueClose");
  return {
    ...settings,
    revenueAuthority: buildRevenueAuthorityFromDocuments({
      clientId,
      developmentId,
      development,
      settingsDocument: settings,
    }),
  };
}

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

async function findSettingsRow(clientId, developmentId, dbClient = null, { forShare = false } = {}) {
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT *
      FROM development_revenue_settings
      WHERE client_id = $1 AND development_id = $2
      LIMIT 1
      ${forShare && dbClient ? "FOR SHARE" : ""}
    `,
    [clientId, developmentId]
  );
  return rows[0] || null;
}

async function getRevenueSettings(clientId, developmentId) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  const row = await findSettingsRow(clientId, developmentId);
  const settings = settingsRowToDocument(row, developmentId);
  return {
    ok: true,
    settings: withRevenueAuthority(clientId, developmentId, scoped.development, settings),
  };
}

async function putRevenueSettings(clientId, developmentId, body = {}, { actor, auth } = {}) {
  assertServicePermission(auth, PERMISSIONS.REVENUE_MANAGE);
  if (auth && String(auth.clientId) !== String(clientId)) return { ok:false, status:403, message:"Tenant boundary violation." };
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
    const submitted = await dbClient.query(`SELECT 1 FROM cvr_periods WHERE client_id=$1 AND development_id=$2 AND status='submitted' LIMIT 1`, [clientId, developmentId]);
    if (submitted.rowCount && (existing?.revenue_mode === 'summary' || validated.value.revenueMode === 'summary' || existing?.revenue_mode !== validated.value.revenueMode)) {
      await dbClient.query("ROLLBACK");
      return { ok:false, status:409, message:"Revenue cannot be changed while a CVR is Submitted." };
    }
    if (existing?.revenue_mode === 'summary' && validated.value.revenueMode === 'sales_register') {
      const proposedSettings = {
        ...settingsRowToDocument(existing, developmentId),
        ...validated.value,
        exists: true,
        id: existing.id,
        version: existing.version,
      };
      const { buildRevenueAuthorityFromDocuments } = require('./cvrRevenueClose');
      const salesRegisterAuthority = buildRevenueAuthorityFromDocuments({
        clientId, developmentId, development: scoped.development, settingsDocument: proposedSettings,
      });
      if (!salesRegisterAuthority.ready || !salesRegisterAuthority.canLock) {
        await dbClient.query("ROLLBACK");
        return { ok:false, status:409, message:"Sales Register must be ready before it can become the active Revenue mode.", blockers:salesRegisterAuthority.blockers };
      }
    }

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
            revenue_adjustments, recognition_settings, revenue_mode, summary_revenue_lines, version, created_by, updated_by,
            updated_by_user_id, updated_by_membership_id, updated_by_provider_user_id
          )
          VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9::jsonb, 1, $10, $10, $11, $12, $13)
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
          validated.value.revenueMode, JSON.stringify(validated.value.summaryRevenueLines), auth?.displayName || actor || null,
          auth?.userId || null, auth?.membershipId || null, auth?.providerUserId || null,
        ]
      );
      await dbClient.query("COMMIT");
      const settings = settingsRowToDocument(inserted.rows[0], developmentId);
      return { ok: true, status: 201, settings: withRevenueAuthority(clientId, developmentId, scoped.development, settings) };
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
          revenue_mode = $6,
          summary_revenue_lines = $7::jsonb,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $8, updated_by_user_id=$9, updated_by_membership_id=$10, updated_by_provider_user_id=$11
        WHERE client_id = $12 AND development_id = $13 AND version = $14
        RETURNING *
      `,
      [
        validated.value.recognitionPolicy,
        JSON.stringify(validated.value.revenueStrategy),
        JSON.stringify(validated.value.houseTypePricing),
        JSON.stringify(validated.value.revenueAdjustments),
        JSON.stringify(validated.value.recognitionSettings),
        validated.value.revenueMode, JSON.stringify(validated.value.summaryRevenueLines), auth?.displayName || actor || null,
        auth?.userId || null, auth?.membershipId || null, auth?.providerUserId || null,
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
    const settings = settingsRowToDocument(updated.rows[0], developmentId);
    return { ok: true, settings: withRevenueAuthority(clientId, developmentId, scoped.development, settings) };
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
  findSettingsRow,
  provisionalActor,
};
