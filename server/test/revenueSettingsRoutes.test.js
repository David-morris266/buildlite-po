/**
 * BL-032A — Revenue settings API tests (buildlite_test only).
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
const { CLOSE_SOURCE_KEYS, CVR_SNAPSHOT_SCHEMA_VERSION } = require("../services/cvrCloseConstants");

const app = createApp();
const MIGRATION_004 = path.join(__dirname, "..", "migrations", "004_developments.sql");
const MIGRATION_011 = path.join(
  __dirname,
  "..",
  "migrations",
  "011_development_revenue_settings.sql"
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
  await pool.query(fs.readFileSync(MIGRATION_011, "utf8"));
}

async function cleanup() {
  if (testDevelopmentIds.length) {
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
  const id = overrides.id || `dev-rev-api-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const jobNumber = overrides.jobNumber || `REV-API-${id}`;
  await pool.query(
    `
      INSERT INTO developments (id, client_id, job_number, development_name, status)
      VALUES ($1, $2, $3, $4, 'live')
    `,
    [id, active.id, jobNumber, overrides.developmentName || "Revenue API test"]
  );
  trackDevelopment(id);
  return id;
}

if (!isDbConfigured()) {
  test("BL-032A revenue settings routes skipped — TEST_DATABASE_URL not configured", () => {
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

  test("CVR close-engine source keys remain cost-only (no revenue)", () => {
    assert.deepEqual(CLOSE_SOURCE_KEYS, [
      "development",
      "period",
      "inputs",
      "purchaseOrders",
      "commercialEvents",
      "certificates",
      "ledger",
    ]);
    assert.ok(!CLOSE_SOURCE_KEYS.includes("revenue"));
    assert.equal(CVR_SNAPSHOT_SCHEMA_VERSION, 1);
  });

  test("GET returns unsaved completion defaults without inserting a row", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);

    const res = await request(app).get(`/api/developments/${developmentId}/revenue/settings`);
    assert.equal(res.status, 200);
    assert.equal(res.body.exists, false);
    assert.equal(res.body.version, 0);
    assert.equal(res.body.recognitionPolicy, "completion");
    assert.equal(res.body.revenueStrategy.openMarket.ratePerFt2, 350);
    assert.deepEqual(res.body.revenueAdjustments, []);
    assert.deepEqual(res.body.recognitionSettings, {});

    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM development_revenue_settings WHERE development_id = $1`,
      [developmentId]
    );
    assert.equal(count.rows[0].n, 0);
  });

  test("PUT creates settings at version 1 and GET returns persisted strategy", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);

    const payload = {
      version: 0,
      actor: "Commercial Manager",
      recognitionPolicy: "completion",
      revenueStrategy: {
        openMarket: { ratePerFt2: 375, effectiveDate: "2026-04-01" },
        affordableHousing: { affordableRent: 60, sharedOwnership: 72, firstHomes: 70, additionality: 65, discountMarketSale: 70, other: 100 },
        garagePremiums: { none: 0, single: 13000, double: 22000 },
      },
      houseTypePricing: {
        "Type A": {
          garage: "Single",
          sellingBasis: "Auto",
          manualForecastValue: 0,
          representativeNiaFt2: 950,
        },
      },
      revenueAdjustments: [],
      recognitionSettings: {},
    };

    const created = await request(app)
      .put(`/api/developments/${developmentId}/revenue/settings`)
      .send(payload);
    assert.equal(created.status, 201);
    assert.equal(created.body.exists, true);
    assert.equal(created.body.version, 1);
    assert.equal(created.body.recognitionPolicy, "completion");
    assert.equal(created.body.revenueStrategy.openMarket.ratePerFt2, 375);
    assert.equal(created.body.houseTypePricing["Type A"].representativeNiaFt2, 950);
    assert.equal(created.body.createdBy, "Commercial Manager");

    const loaded = await request(app).get(`/api/developments/${developmentId}/revenue/settings`);
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.version, 1);
    assert.equal(loaded.body.revenueStrategy.openMarket.ratePerFt2, 375);
    assert.equal(loaded.body.revenueStrategy.garagePremiums.single, 13000);
  });

  test("PUT increments version and stale version returns 409", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);

    const created = await request(app)
      .put(`/api/developments/${developmentId}/revenue/settings`)
      .send({ version: 0, recognitionPolicy: "completion" });
    assert.equal(created.status, 201);
    assert.equal(created.body.version, 1);

    const updated = await request(app)
      .put(`/api/developments/${developmentId}/revenue/settings`)
      .send({
        version: 1,
        recognitionPolicy: "exchange",
        revenueStrategy: { openMarket: { ratePerFt2: 400, effectiveDate: "" } },
      });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.version, 2);
    assert.equal(updated.body.recognitionPolicy, "exchange");

    const stale = await request(app)
      .put(`/api/developments/${developmentId}/revenue/settings`)
      .send({ version: 1, recognitionPolicy: "completion" });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.settings.version, 2);
  });

  test("invalid recognition policy is rejected; exchange and completion persist", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);

    const invalid = await request(app)
      .put(`/api/developments/${developmentId}/revenue/settings`)
      .send({ version: 0, recognitionPolicy: "reservation" });
    assert.equal(invalid.status, 400);
    assert.match(String(invalid.body.message || invalid.body.errors?.[0] || ""), /recognitionPolicy/);

    const exchange = await request(app)
      .put(`/api/developments/${developmentId}/revenue/settings`)
      .send({ version: 0, recognitionPolicy: "exchange" });
    assert.equal(exchange.status, 201);
    assert.equal(exchange.body.recognitionPolicy, "exchange");

    const completion = await request(app)
      .put(`/api/developments/${developmentId}/revenue/settings`)
      .send({ version: 1, recognitionPolicy: "completion" });
    assert.equal(completion.status, 200);
    assert.equal(completion.body.recognitionPolicy, "completion");
  });

  test("settings are isolated per development and unknown development is 404", async () => {
    const active = await getActiveClient();
    const devA = await createDevelopment(active, { developmentName: "Rev A" });
    const devB = await createDevelopment(active, { developmentName: "Rev B" });

    await request(app)
      .put(`/api/developments/${devA}/revenue/settings`)
      .send({
        version: 0,
        revenueStrategy: { openMarket: { ratePerFt2: 111, effectiveDate: "" } },
      });
    await request(app)
      .put(`/api/developments/${devB}/revenue/settings`)
      .send({
        version: 0,
        revenueStrategy: { openMarket: { ratePerFt2: 222, effectiveDate: "" } },
      });

    const a = await request(app).get(`/api/developments/${devA}/revenue/settings`);
    const b = await request(app).get(`/api/developments/${devB}/revenue/settings`);
    assert.equal(a.body.revenueStrategy.openMarket.ratePerFt2, 111);
    assert.equal(b.body.revenueStrategy.openMarket.ratePerFt2, 222);

    const missing = await request(app).get(
      "/api/developments/dev-does-not-exist/revenue/settings"
    );
    assert.equal(missing.status, 404);
  });

  test("client isolation: other tenant development is not visible", async () => {
    const active = await getActiveClient();
    const other = await pool.query(
      `
        INSERT INTO clients (code, name, is_active)
        VALUES ($1, $2, false)
        RETURNING id
      `,
      [`REVTENANT_${Date.now()}`, "Revenue Tenant B"]
    );
    trackTenant(other.rows[0].id);
    const otherDevId = `dev-rev-other-${Date.now()}`;
    await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, $4, 'live')
      `,
      [otherDevId, other.rows[0].id, `REV-OTH-${Date.now()}`, "Other tenant rev"]
    );
    trackDevelopment(otherDevId);

    const res = await request(app).get(`/api/developments/${otherDevId}/revenue/settings`);
    assert.equal(res.status, 404);
    assert.ok(active);
  });

  test("PUT without recognitionPolicy defaults to completion; adjustments persist", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);

    const created = await request(app)
      .put(`/api/developments/${developmentId}/revenue/settings`)
      .send({
        version: 0,
        revenueStrategy: { openMarket: { ratePerFt2: 355, effectiveDate: "2026-08-01" } },
        revenueAdjustments: [{ id: "adj-1", amount: 1000, note: "compat" }],
        recognitionSettings: { legacy: true },
      });
    assert.equal(created.status, 201);
    assert.equal(created.body.recognitionPolicy, "completion");
    assert.equal(created.body.revenueAdjustments[0].id, "adj-1");
    assert.equal(created.body.recognitionSettings.legacy, true);

    const loaded = await request(app).get(`/api/developments/${developmentId}/revenue/settings`);
    assert.equal(loaded.body.recognitionPolicy, "completion");
    assert.deepEqual(loaded.body.revenueAdjustments, [{ id: "adj-1", amount: 1000, note: "compat" }]);
    assert.equal(loaded.body.recognitionSettings.legacy, true);
  });

  test("create with non-zero version is 409 and does not insert", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);

    const staleCreate = await request(app)
      .put(`/api/developments/${developmentId}/revenue/settings`)
      .send({ version: 1, recognitionPolicy: "completion" });
    assert.equal(staleCreate.status, 409);

    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM development_revenue_settings WHERE development_id = $1`,
      [developmentId]
    );
    assert.equal(count.rows[0].n, 0);
  });
}
