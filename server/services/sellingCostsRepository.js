/**
 * BL-034B — Development Selling Costs settings + live proposal.
 * GET returns default 2.00% proposal without inserting.
 * PUT creates on first write (expected version 0). Never writes CVR.
 */

const { pool, query } = require("../db");
const { findDevelopmentById } = require("./developmentRepository");
const {
  ASSUMPTION_SOURCES,
  DEFAULT_ASSUMPTION_PERCENT,
  SELLING_COSTS_MODES,
} = require("./sellingCostsConstants");
const { assertDestinationAllowedForSave, resolveSellingCostsDestination } = require(
  "./sellingCostsDestination"
);
const { buildProposalDocument, settingsRowToCore } = require("./sellingCostsMapper");
const {
  buildMoneyProposal,
  loadLiveForecastRevenue,
} = require("./sellingCostsProposal");
const { validatePutAssumptionBody } = require("./sellingCostsValidation");
const { getDefaultTemplate } = require('./sellingCostsTemplateRepository');
const { PERMISSIONS } = require('../auth/permissions');
const { assertServicePermission } = require('../auth/authorization');
const { composeDetailed, saveDetailed } = require('./sellingCostsDetailedRepository');

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
      FROM development_selling_costs_settings
      WHERE client_id = $1 AND development_id = $2
      LIMIT 1
    `,
    [clientId, developmentId]
  );
  return rows[0] || null;
}

async function composeProposal(clientId, developmentId, row, dbClient = null) {
  if (row?.mode === SELLING_COSTS_MODES.DETAILED) {
    return composeDetailed(clientId, developmentId, dbClient);
  }
  const settings = settingsRowToCore(row, developmentId);
  const companyTemplate=await getDefaultTemplate(clientId,dbClient);
  const hasDevelopmentPercent=settings.exists&&settings.assumptionPercentOverride!=null;
  const assumptionPercent=hasDevelopmentPercent?settings.assumptionPercentOverride:companyTemplate?.simpleAssumptionPercent ?? DEFAULT_ASSUMPTION_PERCENT;
  const assumptionSource=hasDevelopmentPercent?ASSUMPTION_SOURCES.DEVELOPMENT:companyTemplate?ASSUMPTION_SOURCES.COMPANY:ASSUMPTION_SOURCES.BUILDLITE;

  const { revenue } = await loadLiveForecastRevenue(clientId, developmentId, { dbClient });
  const money = buildMoneyProposal(revenue, assumptionPercent);

  const destination = await resolveSellingCostsDestination(clientId, {
    overrideId: settings.destinationCostCodeId,
    overrideKey: settings.destinationCostCodeKey,
    companyDestination: companyTemplate?.simpleDestination || null,
    dbClient,
  });

  return buildProposalDocument({
    settings,
    assumptionPercent,
    assumptionSource,
    forecastRevenue: money.forecastRevenue,
    forecastSellingCosts: money.forecastSellingCosts,
    revenue,
    destination,
    companyTemplate,
  });
}

async function getSellingCostsProposal(clientId, developmentId) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  const row = await findSettingsRow(clientId, developmentId);
  if (row?.mode === SELLING_COSTS_MODES.DETAILED) {
    return { ok: true, proposal: await composeDetailed(clientId, developmentId) };
  }
  const proposal = await composeProposal(clientId, developmentId, row);
  return { ok: true, proposal };
}

async function putSellingCostsAssumption(clientId, developmentId, body = {}, { actor, auth } = {}) {
  if (String(body.mode || '').toLowerCase() === SELLING_COSTS_MODES.DETAILED) {
    return saveDetailed(clientId, developmentId, body, auth);
  }
  assertServicePermission(auth,PERMISSIONS.CVR_EDIT);
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;

  const validated = validatePutAssumptionBody(body);
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const existing = await findSettingsRow(clientId, developmentId, dbClient);
    const actorUserId=auth?.userId&&(await dbClient.query('SELECT 1 FROM buildlite_users WHERE id=$1',[auth.userId])).rowCount?auth.userId:null;
    const actorMembershipId=auth?.membershipId&&(await dbClient.query('SELECT 1 FROM client_user_memberships WHERE id=$1 AND client_id=$2',[auth.membershipId,clientId])).rowCount?auth.membershipId:null;
    const nextAssumptionPercent=validated.value.assumptionProvided?validated.value.assumptionPercent:(existing?existing.assumption_percent:null);

    let nextDestinationKey;
    let nextDestinationId;
    if (validated.value.destinationProvided) {
      const allowed = await assertDestinationAllowedForSave(
        clientId,
        validated.value.destinationCostCodeId,
        dbClient
      );
      if (!allowed.ok) {
        await dbClient.query("ROLLBACK");
        return {
          ok: false,
          status: allowed.status || 400,
          message: allowed.message,
          destination: allowed.destination,
        };
      }
      nextDestinationKey = validated.value.destinationCostCodeKey;
      nextDestinationId = validated.value.destinationCostCodeId;
    } else if (existing) {
      nextDestinationKey = existing.destination_cost_code_key || null;
      nextDestinationId = existing.destination_cost_code_id || null;
    } else {
      nextDestinationKey = null;
      nextDestinationId = null;
    }

    if (!existing) {
      if (validated.expectedVersion !== 0) {
        await dbClient.query("ROLLBACK");
        const proposal = await composeProposal(clientId, developmentId, null);
        return {
          ok: false,
          status: 409,
          message: "Selling Costs settings version conflict.",
          proposal,
        };
      }

      const inserted = await dbClient.query(
        `
          INSERT INTO development_selling_costs_settings (
            client_id, development_id, mode, assumption_percent,
            destination_cost_code_key, destination_cost_code_id, version, created_by, updated_by,
            updated_by_user_id,updated_by_membership_id,updated_by_provider_user_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $7, $8, $9, $10)
          RETURNING *
        `,
        [
          clientId,
          developmentId,
          SELLING_COSTS_MODES.SIMPLE,
          nextAssumptionPercent,
          nextDestinationKey,
          nextDestinationId,
          actor || null,actorUserId,actorMembershipId,auth?.providerUserId||null,
        ]
      );
      await dbClient.query("COMMIT");
      const proposal = await composeProposal(clientId, developmentId, inserted.rows[0]);
      return { ok: true, status: 201, proposal };
    }

    if (existing.version !== validated.expectedVersion) {
      await dbClient.query("ROLLBACK");
      const proposal = await composeProposal(clientId, developmentId, existing);
      return {
        ok: false,
        status: 409,
        message: "Selling Costs settings version conflict.",
        proposal,
      };
    }

    const updated = await dbClient.query(
      `
        UPDATE development_selling_costs_settings
        SET
          mode = $1,
          assumption_percent = $2,
          destination_cost_code_key = $3,
          destination_cost_code_id = $8,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $4,
          updated_by_user_id=$9,updated_by_membership_id=$10,updated_by_provider_user_id=$11
        WHERE client_id = $5 AND development_id = $6 AND version = $7
        RETURNING *
      `,
      [
        SELLING_COSTS_MODES.SIMPLE,
        nextAssumptionPercent,
        nextDestinationKey,
        actor || null,
        clientId,
        developmentId,
        validated.expectedVersion,
        nextDestinationId,actorUserId,actorMembershipId,auth?.providerUserId||null,
      ]
    );

    if (!updated.rowCount) {
      await dbClient.query("ROLLBACK");
      const proposal = await composeProposal(clientId, developmentId, existing);
      return {
        ok: false,
        status: 409,
        message: "Selling Costs settings version conflict.",
        proposal,
      };
    }

    await dbClient.query("COMMIT");
    const proposal = await composeProposal(clientId, developmentId, updated.rows[0]);
    return { ok: true, proposal };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        status: 409,
        message: "Selling Costs settings already exist for this development.",
      };
    }
    throw err;
  } finally {
    dbClient.release();
  }
}

module.exports = {
  getSellingCostsProposal,
  putSellingCostsAssumption,
  findSettingsRow,
  provisionalActor,
  composeProposal,
};
