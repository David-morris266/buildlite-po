/**
 * BL-037A — Draft CVR membership command (buildlite_test only).
 * Does not write buildlite_clone / Test Site 1.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const createApp = require("../app");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");
const { buildCvrCloseCandidate } = require("../services/cvrCloseEngine");
const { putClassification } = require("../services/costCodeClassificationRepository");
const { createCostCode, setCostCodeActive } = require("../services/costCodeMasterRepository");
const {
  CVR_MEMBERSHIP_ERROR_CODES,
  parseRequestedCostCodeIdentity,
} = require("../services/cvrMembershipService");
const { FORECAST_DRIVERS, SEMANTIC_GROUPS } = require("../services/costCodeClassificationConstants");
const { normaliseCostCodeKey } = require("../services/cvrPeriodValidation");

const app = createApp();
const ROOT = path.join(__dirname, "..");
const MIGRATION_004 = path.join(ROOT, "migrations", "004_developments.sql");
const MIGRATION_009 = path.join(ROOT, "migrations", "009_cvr_and_purchase_ledger.sql");
const MIGRATION_010 = path.join(ROOT, "migrations", "010_cvr_period_snapshots.sql");
const MIGRATION_011 = path.join(ROOT, "migrations", "011_development_revenue_settings.sql");
const MIGRATION_012 = path.join(ROOT, "migrations", "012_cvr_period_snapshot_revenue.sql");
const MIGRATION_013 = path.join(ROOT, "migrations", "013_cost_code_classifications.sql");
const MIGRATION_015 = path.join(ROOT, "migrations", "015_development_prelims_items.sql");
const MIGRATION_017 = path.join(ROOT, "migrations", "017_cost_codes_tenant_master.sql");
const MIGRATION_020 = path.join(ROOT, "migrations", "020_development_selling_costs_settings.sql");

const testDevelopmentIds = [];
const testTenantIds = [];
const testCostCodeIds = [];
const testClassificationKeys = [];

function trackDevelopment(id) {
  if (id && !testDevelopmentIds.includes(id)) testDevelopmentIds.push(id);
}
function trackTenant(id) {
  if (id && !testTenantIds.includes(id)) testTenantIds.push(id);
}
function trackCostCode(id) {
  if (id && !testCostCodeIds.includes(id)) testCostCodeIds.push(id);
}

function uniqueCode(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function masterPayload(overrides = {}) {
  return {
    description: overrides.description || "Test cost code",
    commercialHead: overrides.commercialHead || "Build",
    commercialFamily: overrides.commercialFamily || "",
    reportingGroup: overrides.reportingGroup || "General",
    defaultVatTreatment: "Standard",
    defaultOrderType: "S",
    actor: "Commercial Manager",
    ...overrides,
  };
}

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_009, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_010, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_011, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_012, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_013, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_015, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_017, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_020, "utf8"));
}

async function cleanup() {
  if (testDevelopmentIds.length) {
    await pool.query(
      `DELETE FROM cvr_period_snapshot_rows WHERE snapshot_id IN (
         SELECT id FROM cvr_period_snapshots WHERE development_id = ANY($1::text[])
       )`,
      [testDevelopmentIds]
    );
    await pool.query(`DELETE FROM cvr_period_snapshots WHERE development_id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
    await pool.query(`DELETE FROM ledger_transactions WHERE development_id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
    await pool.query(`DELETE FROM ledger_import_batches WHERE development_id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
    await pool.query(
      `DELETE FROM cvr_cost_code_inputs
        WHERE period_id IN (SELECT id FROM cvr_periods WHERE development_id = ANY($1::text[]))`,
      [testDevelopmentIds]
    );
    await pool.query(
      `DELETE FROM cvr_period_audit
        WHERE period_id IN (SELECT id FROM cvr_periods WHERE development_id = ANY($1::text[]))`,
      [testDevelopmentIds]
    );
    await pool.query(`DELETE FROM cvr_periods WHERE development_id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
    await pool.query(
      `DELETE FROM development_prelims_items WHERE development_id = ANY($1::text[])`,
      [testDevelopmentIds]
    );
    await pool.query(
      `DELETE FROM development_selling_costs_settings WHERE development_id = ANY($1::text[])`,
      [testDevelopmentIds]
    );
    await pool.query(`DELETE FROM developments WHERE id = ANY($1::text[])`, [testDevelopmentIds]);
  }
  if (testClassificationKeys.length) {
    await pool.query(
      `DELETE FROM cost_code_classifications WHERE lower(cost_code_key) = ANY($1::text[])`,
      [testClassificationKeys.map((key) => String(key).toLowerCase())]
    );
  }
  if (testCostCodeIds.length) {
    await pool.query(`DELETE FROM cost_codes WHERE id = ANY($1::uuid[])`, [testCostCodeIds]);
  }
  if (testTenantIds.length) {
    await pool.query(`DELETE FROM cost_code_classifications WHERE client_id = ANY($1::uuid[])`, [
      testTenantIds,
    ]);
    await pool.query(`DELETE FROM cost_codes WHERE client_id = ANY($1::uuid[])`, [testTenantIds]);
    await pool.query(`DELETE FROM developments WHERE client_id = ANY($1::uuid[])`, [testTenantIds]);
    await pool.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [testTenantIds]);
  }
}

async function getActiveClient() {
  const { rows } = await pool.query(
    "SELECT id, code, name FROM clients WHERE is_active = true LIMIT 1"
  );
  return rows[0] || null;
}

async function createDevelopment(overrides = {}) {
  const id = overrides.id || `dev-mbr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const res = await request(app).post("/api/developments").send({
    id,
    jobNumber: overrides.jobNumber || `DEV-MBR-${Date.now()}`,
    developmentName: overrides.developmentName || "CVR Membership Test Dev",
    status: "live",
  });
  assert.equal(res.status, 201, res.body?.message || JSON.stringify(res.body));
  trackDevelopment(res.body.id);
  const settings = await request(app)
    .put(`/api/developments/${encodeURIComponent(res.body.id)}/revenue/settings`)
    .send({ version: 0, recognitionPolicy: "completion", actor: "QS" });
  assert.equal(settings.status, 201, settings.body?.message || JSON.stringify(settings.body));
  return res.body;
}

async function createDraftPeriod(developmentId) {
  const res = await request(app)
    .post(`/api/developments/${encodeURIComponent(developmentId)}/cvr/periods`)
    .send({ periodKey: "P01", actor: "Commercial Manager" });
  assert.equal(res.status, 201, res.body?.message || JSON.stringify(res.body));
  return res.body;
}

async function createMaster(clientId, overrides = {}) {
  const code = overrides.code || uniqueCode("CC");
  const created = await createCostCode(clientId, masterPayload({ ...overrides, code }), {
    actor: "Commercial Manager",
  });
  assert.equal(created.ok, true, created.message || JSON.stringify(created));
  trackCostCode(created.costCode.id);
  return created.costCode;
}

function memberUrl(developmentId, periodId) {
  return `/api/developments/${encodeURIComponent(developmentId)}/cvr/periods/${encodeURIComponent(
    periodId
  )}/cost-code-members`;
}

function periodUrl(developmentId, periodId = "") {
  const base = `/api/developments/${encodeURIComponent(developmentId)}/cvr/periods`;
  return periodId ? `${base}/${periodId}` : base;
}

function addedAudits(period) {
  return (period.auditHistory || []).filter((item) => item.action === "cost_code_added");
}

if (!isDbConfigured()) {
  test("BL-037A routes skipped — TEST_DATABASE_URL not configured", () => {
    assert.ok(true);
  });
} else {
  test.before(async () => {
    await prepareIntegrationTestDatabase(pool);
    const db = await pool.query("SELECT current_database() AS db");
    assert.equal(db.rows[0].db, "buildlite_test");
    assert.notEqual(db.rows[0].db, "buildlite_clone");
    await ensureSchema();
  });

  test.after(async () => {
    await cleanup();
  });

  test("parseRequestedCostCodeIdentity strips display labels", () => {
    assert.equal(parseRequestedCostCodeIdentity({ costCodeKey: "5400 — Selling" }), "5400");
    assert.equal(parseRequestedCostCodeIdentity({}), "");
  });

  test("happy path creates empty Draft overlay from Master with one audit", async () => {
    const client = await getActiveClient();
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const master = await createMaster(client.id, {
      code: uniqueCode("5400"),
      description: "Selling Costs — General Allowance",
      commercialHead: "Selling",
      reportingGroup: "Selling Costs",
    });

    const beforePrelims = await pool.query(
      `SELECT COUNT(*)::int AS n FROM development_prelims_items WHERE development_id = $1`,
      [development.id]
    );
    const beforeSelling = await pool.query(
      `SELECT COUNT(*)::int AS n FROM development_selling_costs_settings WHERE development_id = $1`,
      [development.id]
    );
    const beforeSnapshots = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cvr_period_snapshots WHERE development_id = $1`,
      [development.id]
    );

    const res = await request(app).post(memberUrl(development.id, period.id)).send({
      costCodeKey: `${master.code} — ignored client label`,
      actor: "Commercial Manager",
      originalBudget: 99999,
      currentBudget: 88888,
      commercialAdjustment: 777,
      manualAccrual: 66,
      adjustmentReason: "should be ignored",
      description: "client description must not win",
    });
    assert.equal(res.status, 201, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.costCodeKey, normaliseCostCodeKey(master.code));
    assert.equal(res.body.costCodeLabel, master.label);
    assert.equal(res.body.description, master.description);
    assert.equal(res.body.commercialHead, master.commercialHead);
    assert.equal(res.body.trade, master.reportingGroup);
    assert.equal(res.body.originalBudget, null);
    assert.equal(res.body.currentBudget, null);
    assert.equal(res.body.commercialAdjustment, 0);
    assert.equal(res.body.manualAccrual, 0);
    assert.equal(res.body.adjustmentReason, "");
    assert.equal(res.body.version, 1);
    assert.equal(res.body.active, true);
    assert.equal(res.body.createdBy, "Commercial Manager");
    assert.deepEqual(res.body.displayMetadata, {});
    assert.equal(Array.isArray(res.body.adjustmentHistory), true);
    assert.equal(res.body.adjustmentHistory.length, 0);

    const loaded = await request(app).get(periodUrl(development.id, period.id));
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.status, "draft");
    assert.equal(loaded.body.version, 1);
    assert.equal(loaded.body.snapshot, null);
    const added = addedAudits(loaded.body);
    assert.equal(added.length, 1);
    assert.equal(added[0].actor, "Commercial Manager");
    assert.match(added[0].comment, new RegExp(`Added cost code ${res.body.costCodeKey} to Draft CVR`));
    assert.equal(added[0].priorStatus, "draft");
    assert.equal(added[0].newStatus, "draft");

    const periods = await request(app).get(periodUrl(development.id));
    assert.equal(periods.status, 200);
    assert.equal(periods.body.periods.some((item) => item.periodKey === "P05"), false);

    const afterPrelims = await pool.query(
      `SELECT COUNT(*)::int AS n FROM development_prelims_items WHERE development_id = $1`,
      [development.id]
    );
    const afterSelling = await pool.query(
      `SELECT COUNT(*)::int AS n FROM development_selling_costs_settings WHERE development_id = $1`,
      [development.id]
    );
    const afterSnapshots = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cvr_period_snapshots WHERE development_id = $1`,
      [development.id]
    );
    assert.equal(afterPrelims.rows[0].n, beforePrelims.rows[0].n);
    assert.equal(afterSelling.rows[0].n, beforeSelling.rows[0].n);
    assert.equal(afterSnapshots.rows[0].n, beforeSnapshots.rows[0].n);
  });

  test("unknown Master is 404 COST_CODE_NOT_FOUND", async () => {
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const res = await request(app).post(memberUrl(development.id, period.id)).send({
      costCodeKey: uniqueCode("MISSING"),
      actor: "QS",
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, CVR_MEMBERSHIP_ERROR_CODES.COST_CODE_NOT_FOUND);
  });

  test("inactive Master is 400 COST_CODE_INACTIVE", async () => {
    const client = await getActiveClient();
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const master = await createMaster(client.id, { code: uniqueCode("INACT") });
    const deactivated = await setCostCodeActive(
      client.id,
      master.id,
      { version: master.version, active: false },
      { actor: "QS" }
    );
    assert.equal(deactivated.ok, true, deactivated.message);

    const res = await request(app).post(memberUrl(development.id, period.id)).send({
      costCodeKey: master.code,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, CVR_MEMBERSHIP_ERROR_CODES.COST_CODE_INACTIVE);
  });

  test("cross-tenant Master cannot join the active client's CVR", async () => {
    const other = await pool.query(
      `
        INSERT INTO clients (code, name, is_active)
        VALUES ($1, $2, false)
        RETURNING id
      `,
      [`MBR_B_${Date.now()}`, "Membership Tenant B"]
    );
    trackTenant(other.rows[0].id);
    const foreign = await createCostCode(
      other.rows[0].id,
      masterPayload({ code: uniqueCode("FOREIGN") }),
      { actor: "Other" }
    );
    assert.equal(foreign.ok, true, foreign.message);
    trackCostCode(foreign.costCode.id);

    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const res = await request(app).post(memberUrl(development.id, period.id)).send({
      costCodeKey: foreign.costCode.code,
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, CVR_MEMBERSHIP_ERROR_CODES.COST_CODE_NOT_FOUND);
  });

  test("classification is not required; PRELIMS, SELLING, and unmapped codes are accepted", async () => {
    const client = await getActiveClient();
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);

    const prelims = await createMaster(client.id, {
      code: uniqueCode("5231"),
      description: "Cleaning",
      commercialHead: "Preliminaries",
      reportingGroup: "Cleaning",
    });
    testClassificationKeys.push(prelims.code);
    const classifiedPrelims = await putClassification(
      client.id,
      prelims.code,
      { version: 0, semanticGroup: SEMANTIC_GROUPS.PRELIMS, forecastDriver: FORECAST_DRIVERS.STANDARD_CVR },
      { actor: "QS" }
    );
    assert.equal(classifiedPrelims.ok, true, classifiedPrelims.message);

    const selling = await createMaster(client.id, {
      code: uniqueCode("5400"),
      description: "Selling Costs",
      commercialHead: "Selling",
      reportingGroup: "Selling",
    });
    testClassificationKeys.push(selling.code);
    const classifiedSelling = await putClassification(
      client.id,
      selling.code,
      { version: 0, semanticGroup: SEMANTIC_GROUPS.SELLING, forecastDriver: FORECAST_DRIVERS.STANDARD_CVR },
      { actor: "QS" }
    );
    assert.equal(classifiedSelling.ok, true, classifiedSelling.message);

    const build = await createMaster(client.id, {
      code: uniqueCode("2300"),
      description: "Brickwork",
      commercialHead: "Build",
      reportingGroup: "Brickwork",
    });

    for (const code of [prelims.code, selling.code, build.code]) {
      const res = await request(app).post(memberUrl(development.id, period.id)).send({
        costCodeKey: code,
        actor: "QS",
      });
      assert.equal(res.status, 201, `${code}: ${res.body?.message || JSON.stringify(res.body)}`);
    }
  });

  test("submitted and locked periods reject membership", async () => {
    const client = await getActiveClient();
    const development = await createDevelopment();
    const submittedPeriod = await createDraftPeriod(development.id);
    const master = await createMaster(client.id, { code: uniqueCode("LOCK") });

    const submitted = await request(app)
      .post(`${periodUrl(development.id, submittedPeriod.id)}/submit`)
      .send({ actor: "QS" });
    assert.equal(submitted.status, 200, submitted.body?.message || JSON.stringify(submitted.body));

    const submitBlocked = await request(app)
      .post(memberUrl(development.id, submittedPeriod.id))
      .send({ costCodeKey: master.code });
    assert.equal(submitBlocked.status, 409);
    assert.equal(submitBlocked.body.code, CVR_MEMBERSHIP_ERROR_CODES.PERIOD_NOT_DRAFT);
    assert.equal(submitBlocked.body.periodStatus, "submitted");

    const lockedDev = await createDevelopment();
    const lockedPeriod = await createDraftPeriod(lockedDev.id);
    await pool.query(
      `
        UPDATE cvr_periods
        SET status = 'locked',
            submitted_at = NOW(),
            submitted_by = 'QS',
            approved_at = NOW(),
            approved_by = 'QS'
        WHERE id = $1
      `,
      [lockedPeriod.id]
    );
    const lockBlocked = await request(app)
      .post(memberUrl(lockedDev.id, lockedPeriod.id))
      .send({ costCodeKey: master.code });
    assert.equal(lockBlocked.status, 409);
    assert.equal(lockBlocked.body.code, CVR_MEMBERSHIP_ERROR_CODES.PERIOD_NOT_DRAFT);
    assert.equal(lockBlocked.body.periodStatus, "locked");
  });

  test("wrong development and foreign tenant period are 404", async () => {
    const client = await getActiveClient();
    const developmentA = await createDevelopment();
    const developmentB = await createDevelopment();
    const periodA = await createDraftPeriod(developmentA.id);
    const master = await createMaster(client.id, { code: uniqueCode("SCOPE") });

    const wrongDev = await request(app).post(memberUrl(developmentB.id, periodA.id)).send({
      costCodeKey: master.code,
    });
    assert.equal(wrongDev.status, 404);

    const other = await pool.query(
      `
        INSERT INTO clients (code, name, is_active)
        VALUES ($1, $2, false)
        RETURNING id
      `,
      [`MBR_C_${Date.now()}`, "Membership Tenant C"]
    );
    trackTenant(other.rows[0].id);
    const foreignDevId = `dev-mbr-b-${Date.now()}`;
    await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, $4, 'live')
      `,
      [foreignDevId, other.rows[0].id, `B-${Date.now()}`, "Tenant C Dev"]
    );
    trackDevelopment(foreignDevId);
    const foreignPeriod = await pool.query(
      `
        INSERT INTO cvr_periods (
          client_id, development_id, period_key, period_label, status, commentary
        )
        VALUES ($1, $2, 'P01', 'P01', 'draft', '{}'::jsonb)
        RETURNING id
      `,
      [other.rows[0].id, foreignDevId]
    );
    const foreign = await request(app)
      .post(memberUrl(foreignDevId, foreignPeriod.rows[0].id))
      .send({ costCodeKey: master.code });
    assert.equal(foreign.status, 404);
  });

  test("duplicate member is 409 and preserves overlay, version, and audit", async () => {
    const client = await getActiveClient();
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const master = await createMaster(client.id, { code: uniqueCode("DUP") });

    const seeded = await request(app)
      .post(`${periodUrl(development.id, period.id)}/inputs`)
      .send({
        costCodeKey: master.code,
        costCodeLabel: `${master.code} — Seeded`,
        originalBudget: 10000,
        currentBudget: 11000,
        commercialAdjustment: 250,
        adjustmentReason: "Keep me",
        manualAccrual: 40,
        actor: "QS",
      });
    assert.equal(seeded.status, 201, seeded.body?.message);
    const loaded = await request(app).get(periodUrl(development.id, period.id));
    const beforeAdded = addedAudits(loaded.body).length;

    const duplicate = await request(app).post(memberUrl(development.id, period.id)).send({
      costCodeKey: master.code,
      actor: "Commercial Manager",
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, CVR_MEMBERSHIP_ERROR_CODES.COST_CODE_ALREADY_MEMBER);
    assert.equal(duplicate.body.input.originalBudget, 10000);
    assert.equal(duplicate.body.input.currentBudget, 11000);
    assert.equal(duplicate.body.input.commercialAdjustment, 250);
    assert.equal(duplicate.body.input.manualAccrual, 40);
    assert.equal(duplicate.body.input.adjustmentReason, "Keep me");
    assert.equal(duplicate.body.input.version, seeded.body.version);

    const after = await request(app).get(periodUrl(development.id, period.id));
    assert.equal(addedAudits(after.body).length, beforeAdded);
    const listed = await request(app).get(`${periodUrl(development.id, period.id)}/inputs`);
    const row = listed.body.inputs.find(
      (item) => item.costCodeKey === seeded.body.costCodeKey
    );
    assert.equal(row.commercialAdjustment, 250);
    assert.equal(row.manualAccrual, 40);
    assert.equal(row.version, seeded.body.version);
  });

  test("membership does not copy ledger actuals into overlay or double-count forecast", async () => {
    const client = await getActiveClient();
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const master = await createMaster(client.id, {
      code: uniqueCode("5403"),
      description: "Marketing",
      commercialHead: "Selling",
      reportingGroup: "Marketing",
    });

    const imported = await request(app)
      .post(`/api/developments/${encodeURIComponent(development.id)}/ledger/batches`)
      .send({
        actor: "QS",
        originalFileName: "marketing.csv",
        sourceProfile: "Custom",
        transactions: [
          {
            supplier: "Agency Ltd",
            invoiceNumber: `INV-MBR-${Date.now()}`,
            transactionDate: "2026-08-01",
            costCodeKey: master.code,
            netAmount: 12000,
            vatAmount: 2400,
          },
        ],
      });
    assert.equal(imported.status, 201, imported.body?.message || JSON.stringify(imported.body));

    const before = await buildCvrCloseCandidate({
      clientId: client.id,
      developmentId: development.id,
      periodId: period.id,
    });
    assert.equal(before.ready, true, JSON.stringify(before.blockers || before));
    const key = normaliseCostCodeKey(master.code);
    function findActualRow(candidate) {
      const rows = candidate.snapshot?.rows || [];
      return (
        rows.find((row) => row.costCodeKey === key) ||
        rows.find((row) => Number(row.actualCost) === 12000) ||
        null
      );
    }

    const beforeRow = findActualRow(before);
    assert.ok(
      beforeRow,
      `fact-backed code should be visible before membership: ${JSON.stringify(
        (before.snapshot?.rows || []).map((row) => row.costCodeKey)
      )}`
    );
    assert.equal(beforeRow.actualCost, 12000);
    assert.equal(beforeRow.commercialAdjustment, 0);
    assert.equal(beforeRow.originalBudget, null);
    assert.equal(beforeRow.currentBudget, null);
    assert.equal(beforeRow.systemForecast, 12000);
    assert.equal(beforeRow.finalForecast, 12000);

    const added = await request(app).post(memberUrl(development.id, period.id)).send({
      costCodeKey: master.code,
      actor: "QS",
    });
    assert.equal(added.status, 201, added.body?.message);
    assert.equal(added.body.originalBudget, null);
    assert.equal(added.body.currentBudget, null);
    assert.equal(added.body.commercialAdjustment, 0);
    assert.equal(added.body.manualAccrual, 0);

    const after = await buildCvrCloseCandidate({
      clientId: client.id,
      developmentId: development.id,
      periodId: period.id,
    });
    assert.equal(after.ready, true);
    const afterRow = findActualRow(after);
    assert.ok(
      afterRow,
      `fact-backed code should remain visible after membership: ${JSON.stringify(
        (after.snapshot?.rows || []).map((row) => row.costCodeKey)
      )}`
    );
    assert.equal(afterRow.actualCost, 12000);
    assert.equal(afterRow.commercialAdjustment, 0);
    assert.equal(afterRow.originalBudget, null);
    assert.equal(afterRow.currentBudget, null);
    assert.equal(afterRow.systemForecast, 12000);
    assert.equal(afterRow.finalForecast, 12000);
    assert.equal(after.snapshot.actualCost, before.snapshot.actualCost);
  });

  test("missing costCodeKey is 400", async () => {
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const res = await request(app).post(memberUrl(development.id, period.id)).send({
      actor: "QS",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, CVR_MEMBERSHIP_ERROR_CODES.COST_CODE_KEY_REQUIRED);
  });
}
