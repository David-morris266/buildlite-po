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
const { PERMISSIONS } = require("../auth/permissions");

let authenticatedClientId = null;
const authenticatedPrincipal = () => ({
  userId: "00000000-0000-0000-0000-000000000001",
  membershipId: "00000000-0000-0000-0000-000000000002",
  providerUserId: "programme-test-user",
  displayName: "Authenticated Programme QS",
  roleKey: "qs",
  clientId: authenticatedClientId,
  permissions: [PERMISSIONS.COMMERCIAL_READ, PERMISSIONS.CVR_EDIT],
});
const app = createApp({ testPrincipal: authenticatedPrincipal });
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
    authenticatedClientId = (await getActiveClient()).id;
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
      "variationOrders",
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
        actor: "Spoofed actor",
        siteStart: "2027-03-01",
        finalCompletion: "2030-08-31",
        totalPlots: 31,
      });
    assert.equal(created.status, 201);
    assert.equal(created.body.exists, true);
    assert.equal(created.body.version, 1);
    assert.equal(created.body.firstCompletion, null);
    assert.equal(created.body.siteStart, "2027-03-01");
    assert.equal(created.body.finalCompletion, "2030-08-31");
    assert.equal(created.body.durationMonths, 42);
    const roundTrip = await request(app).get(`/api/developments/${developmentId}/programme`);
    assert.equal(roundTrip.status, 200);
    assert.equal(roundTrip.body.siteStart, "2027-03-01");
    assert.equal(roundTrip.body.finalCompletion, "2030-08-31");
    const provenance = await pool.query(
      `SELECT created_by, updated_by FROM development_programme WHERE development_id = $1`,
      [developmentId]
    );
    assert.equal(provenance.rows[0].created_by, "Authenticated Programme QS");
    assert.equal(provenance.rows[0].updated_by, "Authenticated Programme QS");

    const updated = await request(app)
      .put(`/api/developments/${developmentId}/programme`)
      .send({
        version: 1,
        siteStart: "2027-03-01",
        firstCompletion: "2027-06-15",
        finalCompletion: "2030-08-31",
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

  test("tenant and permission authority are server-derived for GET and PUT", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active, testSite1Payload());
    const deniedRead = createApp({ testPrincipal: { ...authenticatedPrincipal(), permissions: [] } });
    assert.equal((await request(deniedRead).get(`/api/developments/${developmentId}/programme`)).status, 403);

    const readOnly = createApp({
      testPrincipal: { ...authenticatedPrincipal(), permissions: [PERMISSIONS.COMMERCIAL_READ] },
    });
    assert.equal((await request(readOnly).get(`/api/developments/${developmentId}/programme`)).status, 200);
    assert.equal((await request(readOnly).put(`/api/developments/${developmentId}/programme`).send({
      version: 0, siteStart: "2026-09-01", finalCompletion: "2029-10-01", totalPlots: 31,
    })).status, 403);

    const other = await pool.query(
      `INSERT INTO clients (code, name, is_active) VALUES ($1, $2, false) RETURNING id`,
      [`PROGSPOOF_${Date.now()}`, "Programme spoof tenant"]
    );
    trackTenant(other.rows[0].id);
    const spoofed = await request(app).put(`/api/developments/${developmentId}/programme`).send({
      clientId: other.rows[0].id,
      actor: "Spoofed actor",
      version: 0,
      siteStart: "2026-09-01",
      finalCompletion: "2029-10-01",
      totalPlots: 31,
    });
    assert.equal(spoofed.status, 201);
    const row = (await pool.query(
      `SELECT client_id, created_by FROM development_programme WHERE development_id = $1`,
      [developmentId]
    )).rows[0];
    assert.equal(row.client_id, active.id);
    assert.equal(row.created_by, "Authenticated Programme QS");
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
