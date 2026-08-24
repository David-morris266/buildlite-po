/**
 * BL-033D.1 — Development Prelims item Postgres access.
 * GET never mutates programme, CVR, classification, or other commercial data.
 */

const { pool, query } = require("../db");
const { findDevelopmentById } = require("./developmentRepository");
const { findProgrammeRow } = require("./developmentProgrammeRepository");
const { programmeRowToDocument, seedProgrammeFromDevelopment } = require(
  "./developmentProgrammeMapper"
);
const { prelimsRowToPersisted, attachPrelimsCalculation } = require("./prelimsItemMapper");
const { validatePrelimsItemBody } = require("./prelimsItemValidation");
const { aggregatePrelimsLines } = require("./prelimsForecastEngine");
const { toYearMonth } = require("./programmeCalendar");

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
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

async function loadProgrammeDocument(clientId, developmentId, development) {
  const row = await findProgrammeRow(clientId, developmentId);
  return row
    ? programmeRowToDocument(row, developmentId)
    : seedProgrammeFromDevelopment(development);
}

async function resolveReportingMonth(clientId, developmentId, requested) {
  const explicit = toYearMonth(requested);
  if (explicit) {
    return { reportingMonth: explicit, source: "query" };
  }
  try {
    const { rows } = await query(
      `
        SELECT period_key, status, to_char(reporting_month, 'YYYY-MM') AS reporting_month
        FROM cvr_periods
        WHERE client_id = $1 AND development_id = $2
        ORDER BY period_key
      `,
      [clientId, developmentId]
    );
    const withMonth = rows.filter((row) => row.reporting_month);
    const draft = withMonth.find((row) => row.status === "draft");
    const submitted = withMonth.find((row) => row.status === "submitted");
    const chosen = draft || submitted || withMonth[withMonth.length - 1] || null;
    if (!chosen) return { reportingMonth: null, source: "none" };
    return { reportingMonth: chosen.reporting_month, source: "open-cvr" };
  } catch {
    return { reportingMonth: null, source: "none" };
  }
}

async function listItemRows(clientId, developmentId, dbClient = null) {
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT *
      FROM development_prelims_items
      WHERE client_id = $1 AND development_id = $2
      ORDER BY cost_code_key ASC, created_at ASC, id ASC
    `,
    [clientId, developmentId]
  );
  return rows;
}

async function findItemRow(clientId, developmentId, itemId, dbClient = null) {
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT *
      FROM development_prelims_items
      WHERE client_id = $1 AND development_id = $2 AND id = $3
      LIMIT 1
    `,
    [clientId, developmentId, itemId]
  );
  return rows[0] || null;
}

function decorateItems(rows, programme, reportingMonth) {
  return rows
    .map((row) => prelimsRowToPersisted(row))
    .map((item) => attachPrelimsCalculation(item, { programme, reportingMonth }));
}

function collectionDocument({
  developmentId,
  programme,
  reporting,
  items,
}) {
  return {
    developmentId,
    proposalOnly: true,
    adoptedIntoCvr: false,
    reportingMonth: reporting.reportingMonth,
    reportingMonthSource: reporting.source,
    programme: {
      exists: Boolean(programme?.exists),
      siteStart: programme?.siteStart || null,
      firstCompletion: programme?.firstCompletion || null,
      finalCompletion: programme?.finalCompletion || null,
      version: programme?.version || 0,
    },
    items,
    summary: aggregatePrelimsLines(items),
  };
}

async function listPrelimsItems(clientId, developmentId, { reportingMonth } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  const programme = await loadProgrammeDocument(clientId, developmentId, scoped.development);
  const reporting = await resolveReportingMonth(clientId, developmentId, reportingMonth);
  const rows = await listItemRows(clientId, developmentId);
  const items = decorateItems(rows, programme, reporting.reportingMonth);
  return {
    ok: true,
    collection: collectionDocument({
      developmentId,
      programme,
      reporting,
      items,
    }),
  };
}

async function getPrelimsItem(clientId, developmentId, itemId, { reportingMonth } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  if (!isUuid(itemId)) {
    return { ok: false, status: 400, message: "itemId must be a valid UUID." };
  }
  const row = await findItemRow(clientId, developmentId, itemId);
  if (!row) return { ok: false, status: 404, message: "Prelims line not found." };
  const programme = await loadProgrammeDocument(clientId, developmentId, scoped.development);
  const reporting = await resolveReportingMonth(clientId, developmentId, reportingMonth);
  return {
    ok: true,
    item: attachPrelimsCalculation(prelimsRowToPersisted(row), {
      programme,
      reportingMonth: reporting.reportingMonth,
    }),
  };
}

function insertParams(clientId, developmentId, value, actor) {
  return [
    clientId,
    developmentId,
    value.costCodeKey,
    value.name,
    value.forecastDriver,
    value.status,
    value.monthlyRate,
    value.startBasis,
    value.startFixedDate,
    value.startOffsetMonths,
    value.endBasis,
    value.endFixedDate,
    value.endOffsetMonths,
    value.lumpSumAmount,
    actor || null,
  ];
}

async function createPrelimsItem(clientId, developmentId, body = {}, { actor } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  const programme = await loadProgrammeDocument(clientId, developmentId, scoped.development);
  const validated = validatePrelimsItemBody(body, { programme });
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }
  if (validated.expectedVersion !== 0) {
    return { ok: false, status: 409, message: "Prelims line version conflict." };
  }

  const inserted = await query(
    `
      INSERT INTO development_prelims_items (
        client_id, development_id, cost_code_key, name, forecast_driver, status,
        monthly_rate, start_basis, start_fixed_date, start_offset_months,
        end_basis, end_fixed_date, end_offset_months,
        lump_sum_amount, version, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 1, $15, $15)
      RETURNING *
    `,
    insertParams(clientId, developmentId, validated.value, actor)
  );
  const reporting = await resolveReportingMonth(clientId, developmentId, body.reportingMonth);
  return {
    ok: true,
    status: 201,
    item: attachPrelimsCalculation(prelimsRowToPersisted(inserted.rows[0]), {
      programme,
      reportingMonth: reporting.reportingMonth,
    }),
  };
}

async function updatePrelimsItem(clientId, developmentId, itemId, body = {}, { actor } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  if (!isUuid(itemId)) {
    return { ok: false, status: 400, message: "itemId must be a valid UUID." };
  }
  const programmeForValidation = await loadProgrammeDocument(
    clientId,
    developmentId,
    scoped.development
  );
  const validated = validatePrelimsItemBody(body, {
    requireVersion: true,
    programme: programmeForValidation,
  });
  if (!validated.ok) {
    return { ok: false, status: 400, errors: validated.errors, message: validated.errors.join(" ") };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const existing = await findItemRow(clientId, developmentId, itemId, dbClient);
    if (!existing) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 404, message: "Prelims line not found." };
    }
    if (existing.version !== validated.expectedVersion) {
      await dbClient.query("ROLLBACK");
      const programme = await loadProgrammeDocument(clientId, developmentId, scoped.development);
      const reporting = await resolveReportingMonth(clientId, developmentId, body.reportingMonth);
      return {
        ok: false,
        status: 409,
        message: "Prelims line version conflict.",
        item: attachPrelimsCalculation(prelimsRowToPersisted(existing), {
          programme,
          reportingMonth: reporting.reportingMonth,
        }),
      };
    }

    const updated = await dbClient.query(
      `
        UPDATE development_prelims_items
        SET
          cost_code_key = $1,
          name = $2,
          forecast_driver = $3,
          status = $4,
          monthly_rate = $5,
          start_basis = $6,
          start_fixed_date = $7,
          start_offset_months = $8,
          end_basis = $9,
          end_fixed_date = $10,
          end_offset_months = $11,
          lump_sum_amount = $12,
          version = version + 1,
          updated_at = NOW(),
          updated_by = $13
        WHERE client_id = $14 AND development_id = $15 AND id = $16 AND version = $17
        RETURNING *
      `,
      [
        validated.value.costCodeKey,
        validated.value.name,
        validated.value.forecastDriver,
        validated.value.status,
        validated.value.monthlyRate,
        validated.value.startBasis,
        validated.value.startFixedDate,
        validated.value.startOffsetMonths,
        validated.value.endBasis,
        validated.value.endFixedDate,
        validated.value.endOffsetMonths,
        validated.value.lumpSumAmount,
        actor || null,
        clientId,
        developmentId,
        itemId,
        validated.expectedVersion,
      ]
    );

    if (!updated.rowCount) {
      await dbClient.query("ROLLBACK");
      return { ok: false, status: 409, message: "Prelims line version conflict." };
    }

    await dbClient.query("COMMIT");
    const programme = await loadProgrammeDocument(clientId, developmentId, scoped.development);
    const reporting = await resolveReportingMonth(clientId, developmentId, body.reportingMonth);
    return {
      ok: true,
      item: attachPrelimsCalculation(prelimsRowToPersisted(updated.rows[0]), {
        programme,
        reportingMonth: reporting.reportingMonth,
      }),
    };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

module.exports = {
  listPrelimsItems,
  getPrelimsItem,
  createPrelimsItem,
  updatePrelimsItem,
  provisionalActor,
  resolveReportingMonth,
};
