/**
 * BL-037B — Draft CVR budget import (buildlite_test only).
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
const { createCostCode, setCostCodeActive } = require("../services/costCodeMasterRepository");
const { CVR_BUDGET_IMPORT_ERROR_CODES } = require("../services/cvrBudgetImportService");

const app = createApp();
const ROOT = path.join(__dirname, "..");
const MIGRATIONS = [
  "004_developments.sql",
  "009_cvr_and_purchase_ledger.sql",
  "010_cvr_period_snapshots.sql",
  "011_development_revenue_settings.sql",
  "012_cvr_period_snapshot_revenue.sql",
  "013_cost_code_classifications.sql",
  "015_development_prelims_items.sql",
  "017_cost_codes_tenant_master.sql",
  "020_development_selling_costs_settings.sql",
];

const testDevelopmentIds = [];
const testTenantIds = [];
const testCostCodeIds = [];

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
  for (const file of MIGRATIONS) {
    await pool.query(fs.readFileSync(path.join(ROOT, "migrations", file), "utf8"));
  }
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
  if (testCostCodeIds.length) {
    await pool.query(`DELETE FROM cost_codes WHERE id = ANY($1::uuid[])`, [testCostCodeIds]);
  }
  if (testTenantIds.length) {
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

async function createDevelopment() {
  const id = `dev-bimp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const res = await request(app).post("/api/developments").send({
    id,
    jobNumber: `DEV-BIMP-${Date.now()}`,
    developmentName: "CVR Budget Import Test Dev",
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

function periodUrl(developmentId, periodId = "") {
  const base = `/api/developments/${encodeURIComponent(developmentId)}/cvr/periods`;
  return periodId ? `${base}/${periodId}` : base;
}

function importUrl(developmentId, periodId) {
  return `${periodUrl(developmentId, periodId)}/budget-import`;
}

function memberUrl(developmentId, periodId) {
  return `${periodUrl(developmentId, periodId)}/cost-code-members`;
}

async function listInputs(developmentId, periodId) {
  const res = await request(app).get(`${periodUrl(developmentId, periodId)}/inputs`);
  assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
  return res.body.inputs || [];
}

async function snapshotCount(developmentId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM cvr_period_snapshots WHERE development_id = $1`,
    [developmentId]
  );
  return rows[0].n;
}

async function masterCount(clientId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM cost_codes WHERE client_id = $1`,
    [clientId]
  );
  return rows[0].n;
}

if (!isDbConfigured()) {
  test("BL-037B budget import skipped — TEST_DATABASE_URL not configured", () => {
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

  test("new valid Master code becomes a member with imported budget", async () => {
    const client = await getActiveClient();
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const master = await createMaster(client.id, {
      code: uniqueCode("1110"),
      description: "Stamp Duty",
    });
    const beforeMasters = await masterCount(client.id);
    const beforeSnapshots = await snapshotCount(development.id);

    const res = await request(app).post(importUrl(development.id, period.id)).send({
      actor: "QS",
      rows: [{ costCodeKey: master.code, originalBudget: 25000, description: "file description ignored" }],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.created, 1);
    assert.equal(res.body.updated, 0);
    assert.equal(res.body.importedCount, 1);

    const inputs = await listInputs(development.id, period.id);
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].originalBudget, 25000);
    assert.equal(inputs[0].currentBudget, 25000);
    assert.equal(inputs[0].commercialAdjustment, 0);
    assert.equal(inputs[0].manualAccrual, 0);
    assert.equal(inputs[0].description, master.description);
    assert.notEqual(inputs[0].description, "file description ignored");
    assert.equal(inputs[0].active, true);

    const loaded = await request(app).get(periodUrl(development.id, period.id));
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.status, "draft");
    assert.equal(loaded.body.version, 1);
    assert.equal(loaded.body.snapshot, null);
    const imported = (loaded.body.auditHistory || []).filter((item) => item.action === "budget_imported");
    assert.equal(imported.length, 1);
    assert.equal(await snapshotCount(development.id), beforeSnapshots);
    assert.equal(await masterCount(client.id), beforeMasters);
    assert.equal(
      (await request(app).get(periodUrl(development.id))).body.periods.some((item) => item.periodKey === "P05"),
      false
    );
  });

  test("existing member budget is updated without duplicate membership", async () => {
    const client = await getActiveClient();
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const master = await createMaster(client.id, { code: uniqueCode("2300"), description: "Brickwork" });
    const added = await request(app).post(memberUrl(development.id, period.id)).send({
      costCodeKey: master.code,
      actor: "QS",
    });
    assert.equal(added.status, 201);
    const seeded = await request(app)
      .patch(`${periodUrl(development.id, period.id)}/inputs/${added.body.id}`)
      .send({
        version: added.body.version,
        originalBudget: 10000,
        currentBudget: 10000,
        commercialAdjustment: 7720,
        adjustmentReason: "keep me",
        manualAccrual: 120,
        displayMetadata: { note: "preserve" },
      });
    assert.equal(seeded.status, 200, seeded.body?.message || JSON.stringify(seeded.body));

    const res = await request(app).post(importUrl(development.id, period.id)).send({
      actor: "QS",
      rows: [{ costCodeKey: master.code, originalBudget: 300000, currentBudget: 310000 }],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.created, 0);
    assert.equal(res.body.updated, 1);

    const inputs = await listInputs(development.id, period.id);
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].originalBudget, 300000);
    assert.equal(inputs[0].currentBudget, 310000);
    assert.equal(inputs[0].commercialAdjustment, 7720);
    assert.equal(inputs[0].adjustmentReason, "keep me");
    assert.equal(inputs[0].manualAccrual, 120);
    assert.equal(inputs[0].displayMetadata.note, "preserve");
    assert.equal(inputs[0].version, seeded.body.version + 1);
  });

  test("mixed existing and new import succeeds", async () => {
    const client = await getActiveClient();
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const existing = await createMaster(client.id, { code: uniqueCode("1110") });
    const fresh = await createMaster(client.id, { code: uniqueCode("5400") });
    const added = await request(app).post(memberUrl(development.id, period.id)).send({
      costCodeKey: existing.code,
    });
    assert.equal(added.status, 201);

    const res = await request(app).post(importUrl(development.id, period.id)).send({
      actor: "QS",
      rows: [
        { costCodeKey: existing.code, originalBudget: 25000 },
        { costCodeKey: fresh.code, originalBudget: 180000 },
      ],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.created, 1);
    assert.equal(res.body.updated, 1);
    const inputs = await listInputs(development.id, period.id);
    assert.equal(inputs.length, 2);
  });

  test("unknown Master code fails with zero writes", async () => {
    const client = await getActiveClient();
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const valid = await createMaster(client.id, { code: uniqueCode("1110") });
    const beforeMasters = await masterCount(client.id);

    const res = await request(app).post(importUrl(development.id, period.id)).send({
      rows: [
        { costCodeKey: valid.code, originalBudget: 1 },
        { costCodeKey: uniqueCode("9999"), originalBudget: 50, description: "Miscellaneous" },
      ],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, CVR_BUDGET_IMPORT_ERROR_CODES.COST_CODE_NOT_FOUND);
    assert.match(res.body.message, /not available in your Cost Code Master/i);
    assert.equal((await listInputs(development.id, period.id)).length, 0);
    assert.equal(await masterCount(client.id), beforeMasters);
  });

  test("inactive Master code fails with zero writes", async () => {
    const client = await getActiveClient();
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const inactive = await createMaster(client.id, { code: uniqueCode("8888"), description: "Temporary" });
    const deactivated = await setCostCodeActive(
      client.id,
      inactive.id,
      { version: inactive.version, active: false },
      { actor: "QS" }
    );
    assert.equal(deactivated.ok, true, deactivated.message);

    const res = await request(app).post(importUrl(development.id, period.id)).send({
      rows: [{ costCodeKey: inactive.code, originalBudget: 10 }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, CVR_BUDGET_IMPORT_ERROR_CODES.COST_CODE_INACTIVE);
    assert.match(res.body.message, /inactive/i);
    assert.equal((await listInputs(development.id, period.id)).length, 0);
  });

  test("cross-tenant Master code fails", async () => {
    const other = await pool.query(
      `
        INSERT INTO clients (code, name, is_active)
        VALUES ($1, $2, false)
        RETURNING id
      `,
      [`BIMP_B_${Date.now()}`, "Budget Import Tenant B"]
    );
    trackTenant(other.rows[0].id);
    const foreign = await createCostCode(
      other.rows[0].id,
      masterPayload({ code: uniqueCode("X") }),
      { actor: "Other" }
    );
    assert.equal(foreign.ok, true);
    trackCostCode(foreign.costCode.id);

    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const res = await request(app).post(importUrl(development.id, period.id)).send({
      rows: [{ costCodeKey: foreign.costCode.code, originalBudget: 99 }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, CVR_BUDGET_IMPORT_ERROR_CODES.COST_CODE_NOT_FOUND);
    assert.equal((await listInputs(development.id, period.id)).length, 0);
  });

  test("one bad line in a multi-row import writes nothing", async () => {
    const client = await getActiveClient();
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const a = await createMaster(client.id, { code: uniqueCode("A") });
    const b = await createMaster(client.id, { code: uniqueCode("B") });

    const res = await request(app).post(importUrl(development.id, period.id)).send({
      rows: [
        { costCodeKey: a.code, originalBudget: 10 },
        { costCodeKey: uniqueCode("BAD"), originalBudget: 20 },
        { costCodeKey: b.code, originalBudget: 30 },
      ],
    });
    assert.equal(res.status, 400);
    assert.equal((await listInputs(development.id, period.id)).length, 0);
  });

  test("duplicate cost codes in the file are rejected without writes", async () => {
    const client = await getActiveClient();
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const master = await createMaster(client.id, { code: uniqueCode("DUP") });

    const res = await request(app).post(importUrl(development.id, period.id)).send({
      rows: [
        { costCodeKey: master.code, originalBudget: 10 },
        { costCodeKey: master.code, originalBudget: 20 },
      ],
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, CVR_BUDGET_IMPORT_ERROR_CODES.BUDGET_IMPORT_DUPLICATE_CODE);
    assert.equal((await listInputs(development.id, period.id)).length, 0);
  });

  test("explicit £0 budget remains a legitimate member", async () => {
    const client = await getActiveClient();
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const master = await createMaster(client.id, { code: uniqueCode("ZERO") });

    const res = await request(app).post(importUrl(development.id, period.id)).send({
      rows: [{ costCodeKey: master.code, originalBudget: 0, currentBudget: 0 }],
    });
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    const inputs = await listInputs(development.id, period.id);
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].originalBudget, 0);
    assert.equal(inputs[0].currentBudget, 0);
  });

  test("re-import preserves adjustment, accrual, metadata, and omitted members", async () => {
    const client = await getActiveClient();
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const kept = await createMaster(client.id, { code: uniqueCode("KEEP") });
    const omitted = await createMaster(client.id, { code: uniqueCode("OMIT") });
    const added = await request(app).post(memberUrl(development.id, period.id)).send({
      costCodeKey: omitted.code,
    });
    assert.equal(added.status, 201);
    const omittedPatch = await request(app)
      .patch(`${periodUrl(development.id, period.id)}/inputs/${added.body.id}`)
      .send({
        version: added.body.version,
        originalBudget: 5,
        currentBudget: 5,
        commercialAdjustment: 9,
        adjustmentReason: "omitted overlay",
        manualAccrual: 3,
      });
    assert.equal(omittedPatch.status, 200, omittedPatch.body?.message || JSON.stringify(omittedPatch.body));

    const first = await request(app).post(importUrl(development.id, period.id)).send({
      rows: [{ costCodeKey: kept.code, originalBudget: 100 }],
    });
    assert.equal(first.status, 200);
    const created = (await listInputs(development.id, period.id)).find(
      (item) => item.costCodeKey === first.body.inputs[0].costCodeKey
    );
    const overlay = await request(app)
      .patch(`${periodUrl(development.id, period.id)}/inputs/${created.id}`)
      .send({
        version: created.version,
        commercialAdjustment: 50,
        adjustmentReason: "overlay",
        manualAccrual: 7,
        displayMetadata: { keep: true },
      });
    assert.equal(overlay.status, 200);

    const second = await request(app).post(importUrl(development.id, period.id)).send({
      rows: [{ costCodeKey: kept.code, originalBudget: 200, currentBudget: 220 }],
    });
    assert.equal(second.status, 200, second.body?.message || JSON.stringify(second.body));
    const after = await listInputs(development.id, period.id);
    assert.equal(after.length, 2);
    const keptRow = after.find((item) => item.id === created.id);
    const omittedRow = after.find((item) => item.id === added.body.id);
    assert.equal(keptRow.originalBudget, 200);
    assert.equal(keptRow.currentBudget, 220);
    assert.equal(keptRow.commercialAdjustment, 50);
    assert.equal(keptRow.manualAccrual, 7);
    assert.equal(keptRow.displayMetadata.keep, true);
    assert.equal(omittedRow.originalBudget, 5);
    assert.equal(omittedRow.commercialAdjustment, 9);
    assert.equal(omittedRow.manualAccrual, 3);
  });

  test("submitted and locked periods reject budget import", async () => {
    const client = await getActiveClient();
    const development = await createDevelopment();
    const period = await createDraftPeriod(development.id);
    const master = await createMaster(client.id, { code: uniqueCode("LOCK") });
    const submitted = await request(app)
      .post(`${periodUrl(development.id, period.id)}/submit`)
      .send({ actor: "QS" });
    assert.equal(submitted.status, 200);

    const blocked = await request(app).post(importUrl(development.id, period.id)).send({
      rows: [{ costCodeKey: master.code, originalBudget: 1 }],
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, CVR_BUDGET_IMPORT_ERROR_CODES.PERIOD_NOT_DRAFT);
  });
}
