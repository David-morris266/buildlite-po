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
  const settings = settingsRowToCore(row, developmentId);
  const assumptionPercent = settings.exists
    ? settings.assumptionPercent
    : DEFAULT_ASSUMPTION_PERCENT;
  const assumptionSource = settings.exists
    ? ASSUMPTION_SOURCES.USER
    : ASSUMPTION_SOURCES.DEFAULT;

  const { revenue } = await loadLiveForecastRevenue(clientId, developmentId, { dbClient });
  const money = buildMoneyProposal(revenue, assumptionPercent);

  const destination = await resolveSellingCostsDestination(clientId, {
    overrideKey: settings.destinationCostCodeKey,
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
  });
}

async function getSellingCostsProposal(clientId, developmentId) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  const row = await findSettingsRow(clientId, developmentId);
  const proposal = await composeProposal(clientId, developmentId, row);
  return { ok: true, proposal };
}

async function putSellingCostsAssumption(clientId, developmentId, body = {}, { actor } = {}) {
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

    let nextDestinationKey;
    if (validated.value.destinationProvided) {
      const allowed = await assertDestinationAllowedForSave(
        clientId,
        validated.value.destinationCostCodeKey,
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
    } else if (existing) {
      nextDestinationKey = existing.destination_cost_code_key || null;
    } else {
      nextDestinationKey = null;
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
            destination_cost_code_key, version, created_by, updated_by
          )
          VALUES ($1, $2, $3, $4, $5, 1, $6, $6)
          RETURNING *
        `,
        [
          clientId,
          developmentId,
          SELLING_COSTS_MODES.SIMPLE,
          validated.value.assumptionPercent,
          nextDestinationKey,
          actor || null,
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
          version = version + 1,
          updated_at = NOW(),
          updated_by = $4
        WHERE client_id = $5 AND development_id = $6 AND version = $7
        RETURNING *
      `,
      [
        SELLING_COSTS_MODES.SIMPLE,
        validated.value.assumptionPercent,
        nextDestinationKey,
        actor || null,
        clientId,
        developmentId,
        validated.expectedVersion,
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
