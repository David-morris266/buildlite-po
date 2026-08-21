/**
 * BL-033C — Development programme API tests (buildlite_test only).
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
const { CLOSE_SOURCE_KEYS } = require("../services/cvrCloseConstants");
const { calculateSystemForecast, calculateFinalForecast } = require("../services/cvrCloseFormulas");

const app = createApp();
const MIGRATION_004 = path.join(__dirname, "..", "migrations", "004_developments.sql");
const MIGRATION_009 = path.join(__dirname, "..", "migrations", "009_cvr_and_purchase_ledger.sql");
const MIGRATION_014 = path.join(__dirname, "..", "migrations", "014_development_programme.sql");

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
}

async function cleanup() {
  if (testDevelopmentIds.length) {
    await pool.query(`DELETE FROM cvr_periods WHERE development_id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
    await pool.query(`DELETE FROM developments WHERE id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
  }
  if (testTenantIds.length) {
    await pool.query(`DELETE FROM developments WHERE client_id = ANY($1::uuid[])`, [
      testTenantIds,
    ]);
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
  const id = overrides.id || `dev-prog-api-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const jobNumber = overrides.jobNumber || `PROG-API-${id}`;
  const payload = {
    startDate: overrides.startDate || "",
    targetCompletion: overrides.targetCompletion || "",
    plotCount: overrides.plotCount ?? 0,
  };
  await pool.query(
    `
      INSERT INTO developments (id, client_id, job_number, development_name, status, payload)
      VALUES ($1, $2, $3, $4, 'live', $5::jsonb)
    `,
    [id, active.id, jobNumber, overrides.developmentName || "Programme API test", JSON.stringify(payload)]
  );
  trackDevelopment(id);
  return id;
}

function testSite1Payload() {
  return {
    startDate: "2026-09-01",
    targetCompletion: "2029-10-01",
    plotCount: 31,
  };
}

if (!isDbConfigured()) {
  test("BL-033C programme routes skipped — TEST_DATABASE_URL not configured", () => {
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

  test("CVR formulas remain committed + QS adjustment with no programme input", () => {
    assert.deepEqual(CLOSE_SOURCE_KEYS, [
      "development",
      "period",
      "inputs",
      "purchaseOrders",
      "commercialEvents",
      "certificates",
      "ledger",
    ]);
    assert.ok(!CLOSE_SOURCE_KEYS.includes("programme"));
    assert.equal(calculateSystemForecast({ committed: 50250, actualCost: 0, currentBudget: 0 }), 50250);
    assert.equal(calculateFinalForecast(50250, 500), 50750);
  });

  test("GET with no programme row returns seeded values without inserting", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active, testSite1Payload());

    const res = await request(app).get(`/api/developments/${developmentId}/programme`);
    assert.equal(res.status, 200);
    assert.equal(res.body.exists, false);
    assert.equal(res.body.version, 0);
    assert.equal(res.body.siteStart, "2026-09-01");
    assert.equal(res.body.finalCompletion, "2029-10-01");
    assert.equal(res.body.totalPlots, 31);
    assert.equal(res.body.firstCompletion, null);
    assert.equal(res.body.durationMonths, 38);

    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM development_programme WHERE development_id = $1`,
      [developmentId]
    );
    assert.equal(count.rows[0].n, 0);

    const payload = await pool.query(`SELECT payload FROM developments WHERE id = $1`, [
      developmentId,
    ]);
    assert.equal(payload.rows[0].payload.startDate, "2026-09-01");
    assert.equal(payload.rows[0].payload.plotCount, 31);
  });

  test("GET creates no row on a second read", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active, testSite1Payload());
    await request(app).get(`/api/developments/${developmentId}/programme`);
    await request(app).get(`/api/developments/${developmentId}/programme`);
    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM development_programme WHERE development_id = $1`,
      [developmentId]
    );
    assert.equal(count.rows[0].n, 0);
  });

  test("PUT creates v1 and update increments version", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active, testSite1Payload());

    const created = await request(app)
      .put(`/api/developments/${developmentId}/programme`)
      .send({
        version: 0,
        actor: "Commercial Manager",
        siteStart: "2026-09-01",
        finalCompletion: "2029-10-01",
        totalPlots: 31,
      });
    assert.equal(created.status, 201);
    assert.equal(created.body.exists, true);
    assert.equal(created.body.version, 1);
    assert.equal(created.body.firstCompletion, null);
    assert.equal(created.body.durationMonths, 38);

    const updated = await request(app)
      .put(`/api/developments/${developmentId}/programme`)
      .send({
        version: 1,
        siteStart: "2026-09-01",
        firstCompletion: "2027-06-15",
        finalCompletion: "2029-10-01",
        totalPlots: 31,
      });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.version, 2);
    assert.equal(updated.body.firstCompletion, "2027-06-15");
  });

  test("stale update returns 409", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active, testSite1Payload());
    await request(app)
      .put(`/api/developments/${developmentId}/programme`)
      .send({
        version: 0,
        siteStart: "2026-09-01",
        finalCompletion: "2029-10-01",
        totalPlots: 31,
      });

    const stale = await request(app)
      .put(`/api/developments/${developmentId}/programme`)
      .send({
        version: 0,
        siteStart: "2026-09-01",
        finalCompletion: "2029-10-01",
        totalPlots: 40,
      });
    assert.equal(stale.status, 409);
    assert.match(stale.body.message, /version conflict/i);
    assert.equal(stale.body.programme.version, 1);
    assert.equal(stale.body.programme.totalPlots, 31);
  });

  test("create with non-zero version is 409 and does not insert", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active, testSite1Payload());
    const staleCreate = await request(app)
      .put(`/api/developments/${developmentId}/programme`)
      .send({
        version: 1,
        siteStart: "2026-09-01",
        finalCompletion: "2029-10-01",
        totalPlots: 31,
      });
    assert.equal(staleCreate.status, 409);
    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM development_programme WHERE development_id = $1`,
      [developmentId]
    );
    assert.equal(count.rows[0].n, 0);
  });

  test("invalid chronology and out-of-bounds firstCompletion are rejected", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active, testSite1Payload());
    const inverted = await request(app)
      .put(`/api/developments/${developmentId}/programme`)
      .send({
        version: 0,
        siteStart: "2029-10-01",
        finalCompletion: "2026-09-01",
        totalPlots: 31,
      });
    assert.equal(inverted.status, 400);

    const outside = await request(app)
      .put(`/api/developments/${developmentId}/programme`)
      .send({
        version: 0,
        siteStart: "2026-09-01",
        firstCompletion: "2029-11-01",
        finalCompletion: "2029-10-01",
        totalPlots: 31,
      });
    assert.equal(outside.status, 400);
  });

  test("development isolation: other development is 404; programmes do not leak", async () => {
    const active = await getActiveClient();
    const devA = await createDevelopment(active, testSite1Payload());
    const devB = await createDevelopment(active, {
      startDate: "2027-01-01",
      targetCompletion: "2028-01-01",
      plotCount: 10,
    });
    await request(app)
      .put(`/api/developments/${devA}/programme`)
      .send({
        version: 0,
        siteStart: "2026-09-01",
        finalCompletion: "2029-10-01",
        totalPlots: 31,
      });
    await request(app)
      .put(`/api/developments/${devB}/programme`)
      .send({
        version: 0,
        siteStart: "2027-01-01",
        finalCompletion: "2028-01-01",
        totalPlots: 10,
      });

    const a = await request(app).get(`/api/developments/${devA}/programme`);
    const b = await request(app).get(`/api/developments/${devB}/programme`);
    assert.equal(a.body.totalPlots, 31);
    assert.equal(b.body.totalPlots, 10);

    const missing = await request(app).get("/api/developments/dev-does-not-exist/programme");
    assert.equal(missing.status, 404);
  });

  test("tenant isolation: other tenant development is not visible", async () => {
    const active = await getActiveClient();
    const other = await pool.query(
      `
        INSERT INTO clients (code, name, is_active)
        VALUES ($1, $2, false)
        RETURNING id
      `,
      [`PROGTENANT_${Date.now()}`, "Programme Tenant B"]
    );
    trackTenant(other.rows[0].id);
    const otherDevId = `dev-prog-other-${Date.now()}`;
    await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, $4, 'live')
      `,
      [otherDevId, other.rows[0].id, `PROG-OTH-${Date.now()}`, "Other tenant programme"]
    );
    trackDevelopment(otherDevId);

    const res = await request(app).get(`/api/developments/${otherDevId}/programme`);
    assert.equal(res.status, 404);
    assert.ok(active);
  });

  test("new CVR periods persist reportingMonth; omitted stays null; siblings are untouched", async () => {
    const active = await getActiveClient();
    const omittedId = await createDevelopment(active, testSite1Payload());
    const omitted = await request(app)
      .post(`/api/developments/${omittedId}/cvr/periods`)
      .send({ periodKey: "P01" });
    assert.equal(omitted.status, 201);
    assert.equal(omitted.body.reportingMonth, null);

    const withMonthId = await createDevelopment(active, testSite1Payload());
    const withMonth = await request(app)
      .post(`/api/developments/${withMonthId}/cvr/periods`)
      .send({ periodKey: "P01", reportingMonth: "2026-10" });
    assert.equal(withMonth.status, 201);
    assert.equal(withMonth.body.reportingMonth, "2026-10-01");

    const siblingId = await createDevelopment(active, testSite1Payload());
    const historic = await pool.query(
      `
        INSERT INTO cvr_periods (
          client_id, development_id, period_key, period_label, reporting_month,
          status, commentary, submitted_at, submitted_by, approved_at, approved_by
        )
        VALUES
          ($1, $2, 'P01', 'P01', NULL, 'locked', '{}'::jsonb, NOW(), 'test', NOW(), 'test'),
          ($1, $2, 'P02', 'P02', NULL, 'locked', '{}'::jsonb, NOW(), 'test', NOW(), 'test'),
          ($1, $2, 'P03', 'P03', NULL, 'locked', '{}'::jsonb, NOW(), 'test', NOW(), 'test')
        RETURNING period_key, reporting_month
      `,
      [active.id, siblingId]
    );
    assert.equal(historic.rows.length, 3);
    assert.ok(historic.rows.every((row) => row.reporting_month == null));

    const next = await request(app)
      .post(`/api/developments/${siblingId}/cvr/periods`)
      .send({ periodKey: "P99", reportingMonth: "2026-11" });
    assert.equal(next.status, 201);
    assert.equal(next.body.periodKey, "P99");
    assert.equal(next.body.reportingMonth, "2026-11-01");

    const untouched = await pool.query(
      `
        SELECT period_key, reporting_month
        FROM cvr_periods
        WHERE development_id = $1 AND period_key = ANY($2::text[])
        ORDER BY period_key
      `,
      [siblingId, ["P01", "P02", "P03"]]
    );
    assert.equal(untouched.rows.length, 3);
    assert.ok(untouched.rows.every((row) => row.reporting_month == null));
  });

  test("programme writes do not create snapshot rows", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active, testSite1Payload());
    const snapshotsExist = await pool.query(
      `SELECT to_regclass('public.cvr_period_snapshots') AS name`
    );
    if (!snapshotsExist.rows[0].name) {
      assert.ok(true);
      return;
    }
    const beforeSnaps = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cvr_period_snapshots WHERE development_id = $1`,
      [developmentId]
    );
    await request(app)
      .put(`/api/developments/${developmentId}/programme`)
      .send({
        version: 0,
        siteStart: "2026-09-01",
        finalCompletion: "2029-10-01",
        totalPlots: 31,
      });
    const afterSnaps = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cvr_period_snapshots WHERE development_id = $1`,
      [developmentId]
    );
    assert.equal(afterSnaps.rows[0].n, beforeSnaps.rows[0].n);
  });
}
