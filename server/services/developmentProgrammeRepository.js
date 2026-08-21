/**
 * BL-033C — Development programme Postgres access.
 * GET returns payload-seeded defaults without inserting. PUT creates on first write (version 0).
 */

const { pool, query } = require("../db");
const { findDevelopmentById } = require("./developmentRepository");
const {
  programmeRowToDocument,
  seedProgrammeFromDevelopment,
} = require("./developmentProgrammeMapper");
const { validatePutProgrammeBody } = require("./developmentProgrammeValidation");

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

async function findProgrammeRow(clientId, developmentId, dbClient = null) {
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT *
      FROM development_programme
      WHERE client_id = $1 AND development_id = $2
      LIMIT 1
    `,
    [clientId, developmentId]
  );
  return rows[0] || null;
}

async function getDevelopmentProgramme(clientId, developmentId) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  const row = await findProgrammeRow(clientId, developmentId);
  return {
    ok: true,
    programme: row
      ? programmeRowToDocument(row, developmentId)
      : seedProgrammeFromDevelopment(scoped.development),
  };
}

async function putDevelopmentProgramme(clientId, developmentId, body = {}, { actor } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;

  const validated = validatePutProgrammeBody(body);
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const existing = await findProgrammeRow(clientId, developmentId, dbClient);

    if (!existing) {
      if (validated.expectedVersion !== 0) {
        await dbClient.query("ROLLBACK");
        return {
          ok: false,
          status: 409,
          message: "Programme version conflict.",
          programme: seedProgrammeFromDevelopment(scoped.development),
        };
      }

      const inserted = await dbClient.query(
        `
          INSERT INTO development_programme (
            client_id, development_id, site_start, first_completion,
            final_completion, total_plots, version, created_by, updated_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $7)
          RETURNING *
        `,
        [
          clientId,
          developmentId,
          validated.value.siteStart,
          validated.value.firstCompletion,
          validated.value.finalCompletion,
          validated.value.totalPlots,
          actor || null,
        ]
      );
      await dbClient.query("COMMIT");
      return {
        ok: true,
        status: 201,
        programme: programmeRowToDocument(inserted.rows[0], developmentId),
      };
    }

    if (existing.version !== validated.expectedVersion) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "Programme version conflict.",
        programme: programmeRowToDocument(existing, developmentId),
      };
    }

    const updated = await dbClient.query(
      `
        UPDATE development_programme
        SET
          site_start = $1,
          first_completion = $2,
          final_completion = $3,
          total_plots = $4,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $5
        WHERE client_id = $6 AND development_id = $7 AND version = $8
        RETURNING *
      `,
      [
        validated.value.siteStart,
        validated.value.firstCompletion,
        validated.value.finalCompletion,
        validated.value.totalPlots,
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
        message: "Programme version conflict.",
        programme: programmeRowToDocument(existing, developmentId),
      };
    }

    await dbClient.query("COMMIT");
    return { ok: true, programme: programmeRowToDocument(updated.rows[0], developmentId) };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    if (isUniqueViolation(err)) {
      return { ok: false, status: 409, message: "Programme already exists for this development." };
    }
    throw err;
  } finally {
    dbClient.release();
  }
}

module.exports = {
  getDevelopmentProgramme,
  putDevelopmentProgramme,
  findProgrammeRow,
  provisionalActor,
};
