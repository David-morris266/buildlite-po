/**
 * BL-033D.x.2 — Tenant-owned company Prelims templates.
 * Does not write development_prelims_items, programme, classification, Cost Code
 * Master hierarchy, or CVR. Custom lines use co.prelims.* keys. Rates stay NULL.
 */

const { pool, query } = require("../db");
const {
  getBuildLiteStandardPrelimsTemplate,
} = require("./buildliteStandardPrelimsTemplate");
const { templateLineRowToDocument, templateRowToDocument } = require("./prelimsTemplateMapper");
const {
  TEMPLATE_ORIGINS,
  generateCompanyTemplateKey,
  isProductStandardTemplateKey,
  validateCreateTemplateBody,
  validateTemplateLineBody,
  validateUpdateTemplateBody,
} = require("./prelimsTemplateValidation");

function provisionalActor(body = {}) {
  return body.updatedBy || body.createdBy || body.actor || null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function isUniqueViolation(err, constraint) {
  if (!err || err.code !== "23505") return false;
  if (!constraint) return true;
  return String(err.constraint || "").includes(constraint);
}

function uniqueError(err) {
  if (isUniqueViolation(err, "uq_client_prelims_templates_client_name")) {
    return { ok: false, status: 409, message: "A Prelims template with this name already exists." };
  }
  if (isUniqueViolation(err, "uq_client_prelims_templates_one_default")) {
    return { ok: false, status: 409, message: "Only one default Prelims template is allowed per company." };
  }
  if (isUniqueViolation(err, "uq_client_prelims_template_lines_key")) {
    return { ok: false, status: 409, message: "A line with this template key already exists on the template." };
  }
  return { ok: false, status: 409, message: "Prelims template conflict." };
}

async function countTemplates(clientId, dbClient = null) {
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `SELECT COUNT(*)::int AS n FROM client_prelims_templates WHERE client_id = $1`,
    [clientId]
  );
  return rows[0].n;
}

async function findTemplateRow(clientId, templateId, dbClient = null) {
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT t.*,
             (SELECT COUNT(*)::int FROM client_prelims_template_lines l WHERE l.template_id = t.id) AS line_count
      FROM client_prelims_templates t
      WHERE t.client_id = $1 AND t.id = $2
      LIMIT 1
    `,
    [clientId, templateId]
  );
  return rows[0] || null;
}

async function listTemplateLines(clientId, templateId, dbClient = null) {
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT *
      FROM client_prelims_template_lines
      WHERE client_id = $1 AND template_id = $2
      ORDER BY display_order ASC, name ASC, id ASC
    `,
    [clientId, templateId]
  );
  return rows;
}

async function clearDefault(clientId, exceptId, dbClient) {
  await dbClient.query(
    `
      UPDATE client_prelims_templates
      SET is_default = false, updated_at = NOW()
      WHERE client_id = $1 AND is_default = true AND id IS DISTINCT FROM $2
    `,
    [clientId, exceptId || null]
  );
}

function documentWithLines(headerRow, lineRows) {
  return {
    ...templateRowToDocument(headerRow),
    lines: lineRows.map(templateLineRowToDocument),
  };
}

async function listTemplates(clientId) {
  const { rows } = await query(
    `
      SELECT t.*,
             (SELECT COUNT(*)::int FROM client_prelims_template_lines l WHERE l.template_id = t.id) AS line_count
      FROM client_prelims_templates t
      WHERE t.client_id = $1
      ORDER BY t.is_default DESC, t.name ASC
    `,
    [clientId]
  );
  return {
    ok: true,
    templates: rows.map(templateRowToDocument),
  };
}

async function getTemplate(clientId, templateId) {
  if (!isUuid(templateId)) {
    return { ok: false, status: 400, message: "templateId must be a valid UUID." };
  }
  const header = await findTemplateRow(clientId, templateId);
  if (!header) return { ok: false, status: 404, message: "Prelims template not found." };
  const lines = await listTemplateLines(clientId, templateId);
  return { ok: true, template: documentWithLines(header, lines) };
}

async function insertHeader(clientId, { name, origin, sourceStandardVersion, isDefault }, actor, dbClient) {
  const { rows } = await dbClient.query(
    `
      INSERT INTO client_prelims_templates (
        client_id, name, origin, source_standard_version, is_default, version, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, 1, $6, $6)
      RETURNING *
    `,
    [clientId, name, origin, sourceStandardVersion, isDefault, actor || null]
  );
  return rows[0];
}

async function createTemplate(clientId, body = {}, { actor } = {}) {
  const validated = validateCreateTemplateBody(body);
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const existingCount = await countTemplates(clientId, dbClient);
    const wantDefault = existingCount === 0 ? true : validated.value.isDefault === true;
    if (wantDefault) await clearDefault(clientId, null, dbClient);

    const header = await insertHeader(
      clientId,
      {
        name: validated.value.name,
        origin: validated.value.origin,
        sourceStandardVersion:
          validated.value.origin === TEMPLATE_ORIGINS.BUILDLITE_STANDARD
            ? getBuildLiteStandardPrelimsTemplate().version
            : null,
        isDefault: wantDefault,
      },
      actor,
      dbClient
    );

    if (validated.value.origin === TEMPLATE_ORIGINS.BUILDLITE_STANDARD) {
      const standard = getBuildLiteStandardPrelimsTemplate();
      for (const line of standard.lines) {
        await dbClient.query(
          `
            INSERT INTO client_prelims_template_lines (
              client_id, template_id, template_key, name, description, category,
              cost_code_key, forecast_driver, start_basis, end_basis,
              monthly_rate, lump_sum_amount, display_order, enabled, version,
              created_by, updated_by
            )
            VALUES (
              $1, $2, $3, $4, $5, $6,
              NULL, $7, $8, $9,
              NULL, NULL, $10, true, 1,
              $11, $11
            )
          `,
          [
            clientId,
            header.id,
            line.templateKey,
            line.name,
            line.description,
            line.category,
            line.suggestedDriver,
            line.suggestedStartBasis,
            line.suggestedEndBasis,
            line.displayOrder,
            actor || null,
          ]
        );
      }
    }

    await dbClient.query("COMMIT");
    const created = await findTemplateRow(clientId, header.id);
    const lines = await listTemplateLines(clientId, header.id);
    return { ok: true, status: 201, template: documentWithLines(created, lines) };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    if (err.code === "23505") return uniqueError(err);
    throw err;
  } finally {
    dbClient.release();
  }
}

async function updateTemplate(clientId, templateId, body = {}, { actor } = {}) {
  if (!isUuid(templateId)) {
    return { ok: false, status: 400, message: "templateId must be a valid UUID." };
  }
  const validated = validateUpdateTemplateBody(body);
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const existing = await findTemplateRow(clientId, templateId, dbClient);
    if (!existing) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "Prelims template not found." };
    }
    if (Number(existing.version) !== validated.expectedVersion) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "Prelims template version conflict.",
        template: documentWithLines(existing, await listTemplateLines(clientId, templateId, dbClient)),
      };
    }

    const nextName = validated.value.name === undefined ? existing.name : validated.value.name;
    const nextDefault =
      validated.value.isDefault === undefined ? existing.is_default : validated.value.isDefault;
    if (nextDefault) await clearDefault(clientId, templateId, dbClient);

    const updated = await dbClient.query(
      `
        UPDATE client_prelims_templates
        SET name = $3,
            is_default = $4,
            version = version + 1,
            updated_at = NOW(),
            updated_by = $5
        WHERE client_id = $1 AND id = $2
        RETURNING *
      `,
      [clientId, templateId, nextName, nextDefault, actor || null]
    );
    await dbClient.query("COMMIT");
    const header = await findTemplateRow(clientId, templateId);
    const lines = await listTemplateLines(clientId, templateId);
    return { ok: true, template: documentWithLines(header || updated.rows[0], lines) };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    if (err.code === "23505") return uniqueError(err);
    throw err;
  } finally {
    dbClient.release();
  }
}

async function createTemplateLine(clientId, templateId, body = {}, { actor } = {}) {
  if (!isUuid(templateId)) {
    return { ok: false, status: 400, message: "templateId must be a valid UUID." };
  }
  const validated = validateTemplateLineBody(body, { allowMissingKey: true });
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }
  if (validated.expectedVersion !== 0) {
    return { ok: false, status: 409, message: "Prelims template line version conflict." };
  }

  const header = await findTemplateRow(clientId, templateId);
  if (!header) return { ok: false, status: 404, message: "Prelims template not found." };

  const templateKey = validated.value.templateKey || generateCompanyTemplateKey();
  if (isProductStandardTemplateKey(templateKey)) {
    return {
      ok: false,
      status: 400,
      message: "Custom company lines cannot use bl.prelims. keys.",
    };
  }

  try {
    const inserted = await query(
      `
        INSERT INTO client_prelims_template_lines (
          client_id, template_id, template_key, name, description, category,
          cost_code_key, forecast_driver, start_basis, end_basis,
          monthly_rate, lump_sum_amount, display_order, enabled, version,
          created_by, updated_by
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14, 1,
          $15, $15
        )
        RETURNING *
      `,
      [
        clientId,
        templateId,
        templateKey,
        validated.value.name,
        validated.value.description,
        validated.value.category,
        validated.value.costCodeKey,
        validated.value.forecastDriver,
        validated.value.startBasis,
        validated.value.endBasis,
        null,
        null,
        validated.value.displayOrder,
        validated.value.enabled,
        actor || null,
      ]
    );
    return { ok: true, status: 201, line: templateLineRowToDocument(inserted.rows[0]) };
  } catch (err) {
    if (err.code === "23505") return uniqueError(err);
    throw err;
  }
}

async function updateTemplateLine(clientId, templateId, lineId, body = {}, { actor } = {}) {
  if (!isUuid(templateId) || !isUuid(lineId)) {
    return { ok: false, status: 400, message: "templateId and lineId must be valid UUIDs." };
  }
  const validated = validateTemplateLineBody(body, { requireVersion: true });
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }

  const existing = await query(
    `
      SELECT *
      FROM client_prelims_template_lines
      WHERE client_id = $1 AND template_id = $2 AND id = $3
      LIMIT 1
    `,
    [clientId, templateId, lineId]
  );
  const row = existing.rows[0];
  if (!row) return { ok: false, status: 404, message: "Prelims template line not found." };
  if (Number(row.version) !== validated.expectedVersion) {
    return {
      ok: false,
      status: 409,
      message: "Prelims template line version conflict.",
      line: templateLineRowToDocument(row),
    };
  }

  try {
    const updated = await query(
      `
        UPDATE client_prelims_template_lines
        SET name = $4,
            description = $5,
            category = $6,
            cost_code_key = $7,
            forecast_driver = $8,
            start_basis = $9,
            end_basis = $10,
            monthly_rate = $11,
            lump_sum_amount = $12,
            display_order = $13,
            enabled = $14,
            version = version + 1,
            updated_at = NOW(),
            updated_by = $15
        WHERE client_id = $1 AND template_id = $2 AND id = $3
        RETURNING *
      `,
      [
        clientId,
        templateId,
        lineId,
        validated.value.name,
        validated.value.description,
        validated.value.category,
        validated.value.costCodeKey,
        validated.value.forecastDriver,
        validated.value.startBasis,
        validated.value.endBasis,
        null,
        null,
        validated.value.displayOrder,
        validated.value.enabled,
        actor || null,
      ]
    );
    return { ok: true, line: templateLineRowToDocument(updated.rows[0]) };
  } catch (err) {
    if (err.code === "23505") return uniqueError(err);
    throw err;
  }
}

module.exports = {
  provisionalActor,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  createTemplateLine,
  updateTemplateLine,
};
