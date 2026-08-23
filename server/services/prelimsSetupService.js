/**
 * BL-033D.x.3 — Development Prelims setup from a company template.
 * Preview is read-only. Apply writes independent development rows with provenance.
 * Does not mutate the company template, Cost Code Master, classification, programme, or CVR.
 */

const { pool, query } = require("../db");
const { findDevelopmentById } = require("./developmentRepository");
const { findProgrammeRow } = require("./developmentProgrammeRepository");
const { programmeRowToDocument, seedProgrammeFromDevelopment } = require(
  "./developmentProgrammeMapper"
);
const { listClassifications } = require("./costCodeClassificationRepository");
const { getTemplate, listTemplates } = require("./prelimsTemplateRepository");
const { listPrelimsItems } = require("./prelimsItemRepository");
const { validatePrelimsItemBody, preserveCostCodeKey } = require("./prelimsItemValidation");
const { validatePrelimsSetupApplyBody } = require("./prelimsSetupValidation");
const { resolveTimeSpan } = require("./prelimsForecastEngine");
const { PRELIMS_UNRESOLVED_LABELS } = require("./prelimsConstants");
const { SEMANTIC_GROUPS } = require("./costCodeClassificationConstants");

function costCodeKeyOf(value) {
  return preserveCostCodeKey(value);
}

function sameCostCode(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase() && Boolean(String(a || "").trim());
}

function classifySetupMapping(costCodeKey, classification) {
  const key = costCodeKeyOf(costCodeKey);
  if (!key) {
    return {
      tone: "unmapped",
      semanticGroup: null,
      exists: false,
      message: "Unmapped — enter a cost code before creating this line.",
    };
  }
  const exists = Boolean(classification?.exists);
  const semanticGroup = exists
    ? classification.semanticGroup
    : SEMANTIC_GROUPS.UNCLASSIFIED;
  if (semanticGroup === SEMANTIC_GROUPS.PRELIMS) {
    return { tone: "normal", semanticGroup, exists, message: null };
  }
  return {
    tone: "warning",
    semanticGroup,
    exists,
    message: `Mapped code ${key} is currently classified ${semanticGroup} rather than PRELIMS.`,
  };
}

function durationDocument(span) {
  return {
    state: span.state,
    reason: span.reason || null,
    reasonLabel: span.reason ? PRELIMS_UNRESOLVED_LABELS[span.reason] || span.reason : null,
    resolvedStart: span.resolvedStart || null,
    resolvedEnd: span.resolvedEnd || null,
    totalMonths: span.totalMonths,
  };
}

async function developmentOr404(clientId, developmentId) {
  const development = await findDevelopmentById(clientId, developmentId);
  if (!development) {
    return { ok: false, status: 404, message: "Development not found." };
  }
  return { ok: true, development };
}

async function loadProgrammeDocument(clientId, developmentId, development) {
  const row = await findProgrammeRow(clientId, developmentId);
  return row
    ? programmeRowToDocument(row, developmentId)
    : seedProgrammeFromDevelopment(development);
}

async function listExistingItemRows(clientId, developmentId, dbClient = null) {
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT *
      FROM development_prelims_items
      WHERE client_id = $1 AND development_id = $2
      ORDER BY created_at ASC, id ASC
    `,
    [clientId, developmentId]
  );
  return rows;
}

function findAppliedRow(existingRows, templateId, templateKey) {
  return (
    existingRows.find(
      (row) =>
        row.source_template_id === templateId && row.source_template_key === templateKey
    ) || null
  );
}

function buildPreviewLines({ template, existingRows, classificationsByKey, programme }) {
  return template.lines.map((line) => {
    const costCodeKey = costCodeKeyOf(line.costCodeKey) || null;
    const applied = findAppliedRow(existingRows, template.id, line.templateKey);
    const overlapExisting = costCodeKey
      ? existingRows.filter((row) => sameCostCode(row.cost_code_key, costCodeKey))
      : [];
    const overlapSiblings = costCodeKey
      ? template.lines.filter(
          (other) => other.id !== line.id && sameCostCode(other.costCodeKey, costCodeKey)
        )
      : [];
    const overlap = overlapExisting.length > 0 || overlapSiblings.length > 0;
    const classification = classifySetupMapping(
      costCodeKey,
      costCodeKey ? classificationsByKey.get(costCodeKey.toLowerCase()) : null
    );
    const selectable = Boolean(line.enabled) && !applied;
    const defaultSelected = selectable && Boolean(costCodeKey) && !overlap;

    return {
      templateLineId: line.id,
      templateKey: line.templateKey,
      name: line.name,
      guidance: line.description || null,
      description: line.description || null,
      category: line.category || null,
      forecastDriver: line.forecastDriver,
      startBasis: line.startBasis,
      endBasis: line.endBasis,
      costCodeKey,
      enabled: Boolean(line.enabled),
      alreadyApplied: Boolean(applied),
      alreadyAppliedItemId: applied?.id || null,
      overlap,
      overlapExistingNames: overlapExisting.map((row) => row.name),
      overlapSiblingNames: overlapSiblings.map((row) => row.name),
      classification,
      duration: durationDocument(resolveTimeSpan(line, programme)),
      selectable,
      defaultSelected,
      createBlockedReason: !line.enabled
        ? "disabled"
        : applied
          ? "already_applied"
          : null,
    };
  });
}

async function resolveTemplate(clientId, templateId) {
  if (templateId) {
    return getTemplate(clientId, templateId);
  }
  const listed = await listTemplates(clientId);
  const chosen =
    listed.templates.find((row) => row.isDefault) || listed.templates[0] || null;
  if (!chosen) {
    return { ok: false, status: 404, message: "No company Prelims template is available." };
  }
  return getTemplate(clientId, chosen.id);
}

async function previewPrelimsSetup(clientId, developmentId, { templateId, reportingMonth } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  const templateResult = await resolveTemplate(clientId, templateId);
  if (!templateResult.ok) return templateResult;

  const programme = await loadProgrammeDocument(clientId, developmentId, scoped.development);
  const items = await listPrelimsItems(clientId, developmentId, { reportingMonth });
  if (!items.ok) return items;
  const existingRows = await listExistingItemRows(clientId, developmentId);
  const classifications = await listClassifications(clientId);
  const classificationsByKey = new Map(
    (classifications.classifications || []).map((row) => [String(row.costCodeKey).toLowerCase(), row])
  );

  return {
    ok: true,
    preview: {
      developmentId,
      proposalOnly: true,
      adoptedIntoCvr: false,
      template: {
        id: templateResult.template.id,
        name: templateResult.template.name,
        origin: templateResult.template.origin,
        version: templateResult.template.version,
        isDefault: templateResult.template.isDefault,
        lineCount: templateResult.template.lines.length,
      },
      reportingMonth: items.collection.reportingMonth,
      reportingMonthSource: items.collection.reportingMonthSource,
      programme: items.collection.programme,
      existingItemCount: existingRows.length,
      existingItems: existingRows.map((row) => ({
        id: row.id,
        name: row.name,
        costCodeKey: row.cost_code_key,
        sourceTemplateKey: row.source_template_key || null,
      })),
      lines: buildPreviewLines({
        template: templateResult.template,
        existingRows,
        classificationsByKey,
        programme,
      }),
    },
  };
}

function insertSetupItemSql() {
  return `
    INSERT INTO development_prelims_items (
      client_id, development_id, cost_code_key, name, forecast_driver, status,
      monthly_rate, start_basis, start_fixed_date, end_basis, end_fixed_date,
      lump_sum_amount, version, created_by, updated_by,
      source_template_id, source_template_version, source_template_line_id, source_template_key
    )
    VALUES (
      $1, $2, $3, $4, $5, 'active',
      $6, $7, $8, $9, $10,
      $11, 1, $12, $12,
      $13, $14, $15, $16
    )
    ON CONFLICT (development_id, source_template_id, source_template_key)
      WHERE source_template_id IS NOT NULL AND source_template_key IS NOT NULL
    DO NOTHING
    RETURNING *
  `;
}

async function applyPrelimsSetup(clientId, developmentId, body = {}, { actor } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  const validated = validatePrelimsSetupApplyBody(body);
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const header = await dbClient.query(
      `
        SELECT *
        FROM client_prelims_templates
        WHERE client_id = $1 AND id = $2
        LIMIT 1
        FOR SHARE
      `,
      [clientId, validated.value.templateId]
    );
    const templateRow = header.rows[0];
    if (!templateRow) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "Prelims template not found." };
    }
    if (Number(templateRow.version) !== validated.value.templateVersion) {
      await dbClient.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "Prelims template version conflict. Reload the setup worksheet.",
      };
    }

    const lineRows = await dbClient.query(
      `
        SELECT *
        FROM client_prelims_template_lines
        WHERE client_id = $1 AND template_id = $2
        ORDER BY display_order ASC, name ASC, id ASC
      `,
      [clientId, validated.value.templateId]
    );
    const templateLinesById = new Map(lineRows.rows.map((row) => [row.id, row]));
    const existingRows = await listExistingItemRows(clientId, developmentId, dbClient);

    const toInsert = [];
    const skipped = [];
    for (const selected of validated.value.lines) {
      const templateLine = templateLinesById.get(selected.templateLineId);
      if (!templateLine) {
        await dbClient.query("ROLLBACK");
        return {
          ok: false,
          status: 400,
          message: "One of the selected template lines was not found.",
        };
      }
      if (!templateLine.enabled) {
        await dbClient.query("ROLLBACK");
        return {
          ok: false,
          status: 400,
          message: `Disabled template line "${templateLine.name}" cannot be created.`,
        };
      }
      const applied = findAppliedRow(existingRows, templateRow.id, templateLine.template_key);
      if (applied) {
        skipped.push({
          templateLineId: templateLine.id,
          templateKey: templateLine.template_key,
          name: templateLine.name,
          reason: "already_applied",
          itemId: applied.id,
        });
        continue;
      }
      const costCodeKey = selected.costCodeKey || costCodeKeyOf(templateLine.cost_code_key);
      if (!costCodeKey) {
        await dbClient.query("ROLLBACK");
        return {
          ok: false,
          status: 400,
          message: `Mapped cost code is required to create "${templateLine.name}".`,
        };
      }
      const itemBody = {
        version: 0,
        costCodeKey,
        name: templateLine.name,
        forecastDriver: templateLine.forecast_driver,
        status: "active",
        monthlyRate: selected.monthlyRate,
        startBasis: templateLine.start_basis,
        endBasis: templateLine.end_basis,
        lumpSumAmount: selected.lumpSumAmount,
      };
      const itemValidated = validatePrelimsItemBody(itemBody);
      if (!itemValidated.ok) {
        await dbClient.query("ROLLBACK");
        return {
          ok: false,
          status: 400,
          errors: itemValidated.errors,
          message: `Cannot create "${templateLine.name}": ${itemValidated.errors.join(" ")}`,
        };
      }
      toInsert.push({ templateLine, value: itemValidated.value });
    }

    const createdRows = [];
    for (const entry of toInsert) {
      const inserted = await dbClient.query(insertSetupItemSql(), [
        clientId,
        developmentId,
        entry.value.costCodeKey,
        entry.value.name,
        entry.value.forecastDriver,
        entry.value.monthlyRate,
        entry.value.startBasis,
        entry.value.startFixedDate,
        entry.value.endBasis,
        entry.value.endFixedDate,
        entry.value.lumpSumAmount,
        actor || null,
        templateRow.id,
        Number(templateRow.version),
        entry.templateLine.id,
        entry.templateLine.template_key,
      ]);
      if (inserted.rowCount) {
        createdRows.push(inserted.rows[0]);
      } else {
        skipped.push({
          templateLineId: entry.templateLine.id,
          templateKey: entry.templateLine.template_key,
          name: entry.templateLine.name,
          reason: "already_applied",
          itemId: null,
        });
      }
    }

    await dbClient.query("COMMIT");
    const collection = await listPrelimsItems(clientId, developmentId, {
      reportingMonth: body.reportingMonth,
    });
    return {
      ok: true,
      apply: {
        createdCount: createdRows.length,
        skippedCount: skipped.length,
        created: createdRows.map((row) => ({
          id: row.id,
          name: row.name,
          templateKey: row.source_template_key,
          costCodeKey: row.cost_code_key,
        })),
        skipped,
        collection: collection.ok ? collection.collection : null,
      },
    };
  } catch (err) {
    try {
      await dbClient.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    if (err && err.code === "23505") {
      const collection = await listPrelimsItems(clientId, developmentId, {
        reportingMonth: body.reportingMonth,
      });
      return {
        ok: true,
        apply: {
          createdCount: 0,
          skippedCount: validated.value.lines.length,
          created: [],
          skipped: validated.value.lines.map((line) => ({
            templateLineId: line.templateLineId,
            reason: "already_applied",
          })),
          collection: collection.ok ? collection.collection : null,
        },
      };
    }
    throw err;
  } finally {
    dbClient.release();
  }
}

module.exports = {
  previewPrelimsSetup,
  applyPrelimsSetup,
  classifySetupMapping,
};
