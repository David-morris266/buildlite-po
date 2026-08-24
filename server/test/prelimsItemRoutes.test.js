/**
 * BL-033D.1 — Development Prelims API tests (buildlite_test only).
 * Does not touch buildlite_clone or Test Site 1.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const createApp = require("../app");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");
const { CLOSE_SOURCE_KEYS, CVR_SNAPSHOT_REVENUE_SCHEMA_VERSION } = require(
  "../services/cvrCloseConstants"
);
const {
  calculateSystemForecast,
  calculateFinalForecast,
  calculateCostToComplete,
} = require("../services/cvrCloseFormulas");

const app = createApp();
const MIGRATION_004 = path.join(__dirname, "..", "migrations", "004_developments.sql");
const MIGRATION_009 = path.join(__dirname, "..", "migrations", "009_cvr_and_purchase_ledger.sql");
const MIGRATION_014 = path.join(__dirname, "..", "migrations", "014_development_programme.sql");
const MIGRATION_015 = path.join(
  __dirname,
  "..",
  "migrations",
  "015_development_prelims_items.sql"
);
const MIGRATION_019 = path.join(
  __dirname,
  "..",
  "migrations",
  "019_development_prelims_time_offsets.sql"
);

const testDevelopmentIds = [];
const testTenantIds = [];

function trackDevelopment(id) {
  if (id && !testDevelopmentIds.includes(id)) testDevelopmentIds.push(id);
}
function trackTenant(id) {
  if (id && !testTenantIds.includes(id)) testTenantIds.push(id);
}

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_009, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_014, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_015, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_019, "utf8"));
}

async function cleanup() {
  if (testDevelopmentIds.length) {
    await pool.query(`DELETE FROM development_prelims_items WHERE development_id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
    await pool.query(`DELETE FROM development_programme WHERE development_id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
    await pool.query(`DELETE FROM cvr_periods WHERE development_id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
    await pool.query(`DELETE FROM developments WHERE id = ANY($1::text[])`, [testDevelopmentIds]);
  }
  if (testTenantIds.length) {
    await pool.query(`DELETE FROM development_prelims_items WHERE client_id = ANY($1::uuid[])`, [
      testTenantIds,
    ]);
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

async function createDevelopment(active, overrides = {}) {
  const id = overrides.id || `dev-prelims-api-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const jobNumber = overrides.jobNumber || `PRELIMS-API-${id}`;
  const payload = {
    startDate: overrides.startDate || "2026-09-01",
    targetCompletion: overrides.targetCompletion || "2029-10-01",
    plotCount: overrides.plotCount ?? 31,
  };
  await pool.query(
    `
      INSERT INTO developments (id, client_id, job_number, development_name, status, payload)
      VALUES ($1, $2, $3, $4, 'live', $5::jsonb)
    `,
    [id, active.id, jobNumber, overrides.developmentName || "Prelims API test", JSON.stringify(payload)]
  );
  trackDevelopment(id);
  return id;
}

function timeBody(overrides = {}) {
  return {
    version: 0,
    costCodeKey: "5231",
    name: "Site management",
    forecastDriver: "TIME",
    monthlyRate: 1000,
    startBasis: "SITE_START",
    endBasis: "FINAL_COMPLETION",
    status: "active",
    ...overrides,
  };
}

if (!isDbConfigured()) {
  test("BL-033D.1 routes skipped — TEST_DATABASE_URL not configured", () => {
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

  test("P04 5231 Standard CVR money is unchanged by Prelims formulas", () => {
    const systemForecast = calculateSystemForecast({
      committed: 50280,
      actualCost: 0,
      currentBudget: 0,
    });
    assert.equal(systemForecast, 50280);
    assert.equal(calculateFinalForecast(50280, 520), 50800);
    assert.equal(calculateCostToComplete(50800, 0, 120), 50680);
    assert.ok(!CLOSE_SOURCE_KEYS.includes("prelims"));
    assert.ok(!CLOSE_SOURCE_KEYS.includes("programme"));
    const engine = fs.readFileSync(path.join(__dirname, "..", "services", "cvrCloseEngine.js"), "utf8");
    const formulas = fs.readFileSync(path.join(__dirname, "..", "services", "cvrCloseFormulas.js"), "utf8");
    const snapshotMapper = fs.readFileSync(
      path.join(__dirname, "..", "services", "cvrSnapshotMapper.js"),
      "utf8"
    );
    assert.doesNotMatch(engine, /development_prelims_items|calculateTimeLine|LUMP_SUM/);
    assert.doesNotMatch(formulas, /development_prelims_items|calculateTimeLine/);
    assert.doesNotMatch(snapshotMapper, /development_prelims_items|prelimsProposal/);
    assert.equal(CVR_SNAPSHOT_REVENUE_SCHEMA_VERSION, 2);
  });

  test("GET does not insert programme, CVR, or Prelims rows", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    const beforeProgramme = await pool.query(
      `SELECT COUNT(*)::int AS n FROM development_programme WHERE development_id = $1`,
      [developmentId]
    );
    const beforePeriods = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cvr_periods WHERE development_id = $1`,
      [developmentId]
    );
    const res = await request(app).get(`/api/developments/${developmentId}/prelims-items`);
    assert.equal(res.status, 200);
    assert.equal(res.body.adoptedIntoCvr, false);
    assert.equal(res.body.items.length, 0);
    const afterProgramme = await pool.query(
      `SELECT COUNT(*)::int AS n FROM development_programme WHERE development_id = $1`,
      [developmentId]
    );
    const afterPeriods = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cvr_periods WHERE development_id = $1`,
      [developmentId]
    );
    const afterItems = await pool.query(
      `SELECT COUNT(*)::int AS n FROM development_prelims_items WHERE development_id = $1`,
      [developmentId]
    );
    assert.equal(afterProgramme.rows[0].n, beforeProgramme.rows[0].n);
    assert.equal(afterPeriods.rows[0].n, beforePeriods.rows[0].n);
    assert.equal(afterItems.rows[0].n, 0);
  });

  test("multiple TIME and LUMP_SUM lines persist under the same customer cost code", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    await request(app)
      .put(`/api/developments/${developmentId}/programme`)
      .send({
        version: 0,
        siteStart: "2026-09-01",
        finalCompletion: "2029-10-01",
        totalPlots: 31,
      });

    const time = await request(app)
      .post(`/api/developments/${developmentId}/prelims-items`)
      .send(timeBody({ reportingMonth: "2026-08" }));
    assert.equal(time.status, 201);
    assert.equal(time.body.costCodeKey, "5231");
    assert.equal(time.body.version, 1);
    assert.equal(time.body.calculation.totalMonths, 38);
    assert.equal(time.body.calculation.elapsedMonths, 0);

    const lump = await request(app)
      .post(`/api/developments/${developmentId}/prelims-items`)
      .send({
        version: 0,
        costCodeKey: "5231",
        name: "Performance bond",
        forecastDriver: "LUMP_SUM",
        lumpSumAmount: 20000,
        status: "active",
      });
    assert.equal(lump.status, 201);
    assert.equal(lump.body.calculation.assumptionAmount, 20000);

    const listed = await request(app).get(
      `/api/developments/${developmentId}/prelims-items?reportingMonth=2026-08`
    );
    assert.equal(listed.status, 200);
    assert.equal(listed.body.items.length, 2);
    assert.equal(listed.body.reportingMonth, "2026-08");
    const group = listed.body.summary.byCostCode.find((row) => row.costCodeKey === "5231");
    assert.equal(group.activeProposal, 58000);
    assert.equal(listed.body.summary.development.activeProposal, 58000);
  });

  test("TIME and LUMP_SUM updates increment version; stale update is 409", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    await request(app)
      .put(`/api/developments/${developmentId}/programme`)
      .send({
        version: 0,
        siteStart: "2026-09-01",
        finalCompletion: "2029-10-01",
        totalPlots: 31,
      });
    const created = await request(app)
      .post(`/api/developments/${developmentId}/prelims-items`)
      .send(timeBody({ monthlyRate: 1000 }));
    const updated = await request(app)
      .put(`/api/developments/${developmentId}/prelims-items/${created.body.id}`)
      .send({ ...timeBody({ monthlyRate: 1200 }), version: 1 });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.version, 2);
    assert.equal(updated.body.monthlyRate, 1200);

    const stale = await request(app)
      .put(`/api/developments/${developmentId}/prelims-items/${created.body.id}`)
      .send({ ...timeBody({ monthlyRate: 1500 }), version: 1 });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.item.monthlyRate, 1200);

    const lump = await request(app)
      .post(`/api/developments/${developmentId}/prelims-items`)
      .send({
        version: 0,
        costCodeKey: "5231",
        name: "Bond",
        forecastDriver: "LUMP_SUM",
        lumpSumAmount: 20000,
      });
    const lumpUpdated = await request(app)
      .put(`/api/developments/${developmentId}/prelims-items/${lump.body.id}`)
      .send({
        version: 1,
        costCodeKey: "5231",
        name: "Bond",
        forecastDriver: "LUMP_SUM",
        lumpSumAmount: 20000,
        status: "complete",
      });
    assert.equal(lumpUpdated.status, 200);
    assert.equal(lumpUpdated.body.calculation.assumptionAmount, 20000);
    assert.equal(lumpUpdated.body.calculation.remainingExposure, 0);
    assert.equal(lumpUpdated.body.calculation.includedInActiveProposal, false);
  });

  test("tenant and development isolation; cancelled lines are excluded", async () => {
    const active = await getActiveClient();
    const devA = await createDevelopment(active);
    const devB = await createDevelopment(active, { startDate: "2027-01-01" });
    await request(app).post(`/api/developments/${devA}/prelims-items`).send(timeBody());
    await request(app)
      .post(`/api/developments/${devB}/prelims-items`)
      .send(timeBody({ name: "Other site", monthlyRate: 500 }));

    const a = await request(app).get(`/api/developments/${devA}/prelims-items?reportingMonth=2026-08`);
    const b = await request(app).get(`/api/developments/${devB}/prelims-items?reportingMonth=2026-08`);
    assert.equal(a.body.items.length, 1);
    assert.equal(a.body.items[0].monthlyRate, 1000);
    assert.equal(b.body.items[0].monthlyRate, 500);

    const missing = await request(app).get("/api/developments/dev-does-not-exist/prelims-items");
    assert.equal(missing.status, 404);

    const other = await pool.query(
      `INSERT INTO clients (code, name, is_active) VALUES ($1, $2, false) RETURNING id`,
      [`PRELIMSTENANT_${Date.now()}`, "Prelims Tenant B"]
    );
    trackTenant(other.rows[0].id);
    const otherDevId = `dev-prelims-other-${Date.now()}`;
    await pool.query(
      `INSERT INTO developments (id, client_id, job_number, development_name, status)
       VALUES ($1, $2, $3, $4, 'live')`,
      [otherDevId, other.rows[0].id, `PRELIMS-OTH-${Date.now()}`, "Other tenant prelims"]
    );
    trackDevelopment(otherDevId);
    const hidden = await request(app).get(`/api/developments/${otherDevId}/prelims-items`);
    assert.equal(hidden.status, 404);

    const cancelled = await request(app)
      .post(`/api/developments/${devA}/prelims-items`)
      .send({
        version: 0,
        costCodeKey: "5999",
        name: "Cancelled",
        forecastDriver: "LUMP_SUM",
        lumpSumAmount: 9000,
        status: "cancelled",
      });
    assert.equal(cancelled.body.calculation.includedInActiveProposal, false);
    const listed = await request(app).get(
      `/api/developments/${devA}/prelims-items?reportingMonth=2026-08`
    );
    const cancelledGroup = listed.body.summary.byCostCode.find((row) => row.costCodeKey === "5999");
    assert.equal(cancelledGroup.activeProposal, 0);
  });

  test("missing reporting month leaves TIME unresolved rather than inventing today", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    await request(app)
      .put(`/api/developments/${developmentId}/programme`)
      .send({
        version: 0,
        siteStart: "2026-09-01",
        finalCompletion: "2029-10-01",
        totalPlots: 31,
      });
    await request(app).post(`/api/developments/${developmentId}/prelims-items`).send(timeBody());
    const listed = await request(app).get(`/api/developments/${developmentId}/prelims-items`);
    assert.equal(listed.body.reportingMonth, null);
    assert.equal(listed.body.items[0].calculation.state, "unresolved");
    assert.equal(listed.body.items[0].calculation.reason, "MISSING_REPORTING_MONTH");
    assert.equal(listed.body.items[0].calculation.totalForecast, null);
    assert.equal(listed.body.summary.development.activeProposal, null);
    assert.equal(listed.body.summary.development.hasUnresolved, true);
  });

  test("TIME offsets persist on create/update and keep zero-default money identical", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    await request(app)
      .put(`/api/developments/${developmentId}/programme`)
      .send({
        version: 0,
        siteStart: "2026-09-01",
        finalCompletion: "2029-10-01",
        totalPlots: 31,
      });

    const baseline = await request(app)
      .post(`/api/developments/${developmentId}/prelims-items`)
      .send(timeBody({ reportingMonth: "2026-08" }));
    assert.equal(baseline.status, 201);
    assert.equal(baseline.body.startOffsetMonths, 0);
    assert.equal(baseline.body.endOffsetMonths, 0);
    assert.equal(baseline.body.calculation.totalMonths, 38);
    assert.equal(baseline.body.calculation.totalForecast, 38000);

    const offset = await request(app)
      .put(`/api/developments/${developmentId}/prelims-items/${baseline.body.id}`)
      .send({
        ...timeBody({
          monthlyRate: 5500,
          startOffsetMonths: 3,
          endOffsetMonths: 0,
          reportingMonth: "2026-08",
        }),
        version: 1,
      });
    assert.equal(offset.status, 200);
    assert.equal(offset.body.startOffsetMonths, 3);
    assert.equal(offset.body.calculation.totalMonths, 35);
    assert.equal(offset.body.calculation.totalForecast, 192500);
    assert.equal(offset.body.calculation.resolvedStart, "2026-12-01");

    const rejected = await request(app)
      .post(`/api/developments/${developmentId}/prelims-items`)
      .send(timeBody({ startOffsetMonths: 61, name: "Too large" }));
    assert.equal(rejected.status, 400);
  });

  test("programme writes and Prelims GET do not create snapshots or change close-engine sources", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    const before = await pool.query(`SELECT COUNT(*)::int AS n FROM cvr_period_snapshots`);
    await request(app)
      .put(`/api/developments/${developmentId}/programme`)
      .send({
        version: 0,
        siteStart: "2026-09-01",
        finalCompletion: "2029-10-01",
        totalPlots: 31,
      });
    await request(app).post(`/api/developments/${developmentId}/prelims-items`).send(timeBody());
    await request(app).get(`/api/developments/${developmentId}/prelims-items?reportingMonth=2026-08`);
    const after = await pool.query(`SELECT COUNT(*)::int AS n FROM cvr_period_snapshots`);
    assert.equal(after.rows[0].n, before.rows[0].n);
    assert.ok(!CLOSE_SOURCE_KEYS.includes("prelims"));
  });
}
