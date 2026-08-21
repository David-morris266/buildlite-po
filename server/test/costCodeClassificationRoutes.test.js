/**
 * BL-033B — Cost-code classification API tests (buildlite_test only).
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
const { calculateSystemForecast, calculateFinalForecast } = require(
  "../services/cvrCloseFormulas"
);
const { normalizeCostCodeKey } = require("../services/costCodeClassificationValidation");
const { listClassifications, putClassification } = require(
  "../services/costCodeClassificationRepository"
);

const app = createApp();
const MIGRATION_013 = path.join(__dirname, "..", "migrations", "013_cost_code_classifications.sql");
const testTenantIds = [];
const testKeys = [];

function trackTenant(id) {
  if (id && !testTenantIds.includes(id)) testTenantIds.push(id);
}

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_013, "utf8"));
}

async function cleanup() {
  if (testKeys.length) {
    await pool.query(
      `DELETE FROM cost_code_classifications WHERE lower(cost_code_key) = ANY($1::text[])`,
      [testKeys.map((key) => key.toLowerCase())]
    );
  }
  if (testTenantIds.length) {
    await pool.query(`DELETE FROM cost_code_classifications WHERE client_id = ANY($1::uuid[])`, [
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

function keyFor(label) {
  const key = `BL033B-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  testKeys.push(key);
  return key;
}

if (!isDbConfigured()) {
  test("BL-033B routes skipped — TEST_DATABASE_URL not configured", () => {
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

  test("unmapped GET is UNCLASSIFIED + STANDARD_CVR and creates no row", async () => {
    const key = keyFor("unmap");
    const res = await request(app).get(`/api/cost-code-classifications/${encodeURIComponent(key)}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.exists, false);
    assert.equal(res.body.semanticGroup, "UNCLASSIFIED");
    assert.equal(res.body.forecastDriver, "STANDARD_CVR");
    assert.equal(res.body.version, 0);
    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cost_code_classifications WHERE lower(cost_code_key) = lower($1)`,
      [key]
    );
    assert.equal(count.rows[0].n, 0);
  });

  test("PUT UNCLASSIFIED + STANDARD_CVR does not insert a row", async () => {
    const key = keyFor("clear-new");
    const res = await request(app)
      .put(`/api/cost-code-classifications/${encodeURIComponent(key)}`)
      .send({ version: 0, semanticGroup: "UNCLASSIFIED", forecastDriver: "STANDARD_CVR" });
    assert.equal(res.status, 200);
    assert.equal(res.body.exists, false);
    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cost_code_classifications WHERE lower(cost_code_key) = lower($1)`,
      [key]
    );
    assert.equal(count.rows[0].n, 0);
  });

  test("PRELIMS + STANDARD_CVR persists; PRELIMS + TIME stores metadata only", async () => {
    const key = keyFor("5231-like");
    const created = await request(app)
      .put(`/api/cost-code-classifications/${encodeURIComponent(key)}`)
      .send({
        version: 0,
        semanticGroup: "PRELIMS",
        forecastDriver: "STANDARD_CVR",
        actor: "Commercial Manager",
      });
    assert.equal(created.status, 201);
    assert.equal(created.body.exists, true);
    assert.equal(created.body.semanticGroup, "PRELIMS");
    assert.equal(created.body.forecastDriver, "STANDARD_CVR");
    assert.equal(created.body.version, 1);
    assert.equal(created.body.costCodeKey, key);
    assert.equal(created.body.createdBy, "Commercial Manager");

    const timed = await request(app)
      .put(`/api/cost-code-classifications/${encodeURIComponent(key)}`)
      .send({ version: 1, semanticGroup: "PRELIMS", forecastDriver: "TIME" });
    assert.equal(timed.status, 200);
    assert.equal(timed.body.forecastDriver, "TIME");
    assert.equal(timed.body.version, 2);
    assert.ok(!Object.prototype.hasOwnProperty.call(timed.body, "monthlyProfile"));
    assert.ok(!Object.prototype.hasOwnProperty.call(timed.body, "rate"));
  });

  test("OTHER is explicit and never the unmapped default", async () => {
    const unmapped = await request(app).get(
      `/api/cost-code-classifications/${encodeURIComponent(keyFor("not-other"))}`
    );
    assert.equal(unmapped.body.semanticGroup, "UNCLASSIFIED");
    assert.notEqual(unmapped.body.semanticGroup, "OTHER");

    const key = keyFor("explicit-other");
    const created = await request(app)
      .put(`/api/cost-code-classifications/${encodeURIComponent(key)}`)
      .send({ version: 0, semanticGroup: "OTHER", forecastDriver: "STANDARD_CVR" });
    assert.equal(created.status, 201);
    assert.equal(created.body.semanticGroup, "OTHER");
    assert.equal(created.body.exists, true);
  });

  test("invalid semantic group and forecast driver are rejected", async () => {
    const key = keyFor("invalid");
    const badGroup = await request(app)
      .put(`/api/cost-code-classifications/${encodeURIComponent(key)}`)
      .send({ version: 0, semanticGroup: "Preliminaries", forecastDriver: "STANDARD_CVR" });
    assert.equal(badGroup.status, 400);
    assert.match(String(badGroup.body.message || ""), /semanticGroup/i);

    const badDriver = await request(app)
      .put(`/api/cost-code-classifications/${encodeURIComponent(key)}`)
      .send({ version: 0, semanticGroup: "PRELIMS", forecastDriver: "HOURS" });
    assert.equal(badDriver.status, 400);
    assert.match(String(badDriver.body.message || ""), /forecastDriver/i);

    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cost_code_classifications WHERE lower(cost_code_key) = lower($1)`,
      [key]
    );
    assert.equal(count.rows[0].n, 0);
  });

  test("optimistic version conflict does not overwrite", async () => {
    const key = keyFor("version");
    const created = await request(app)
      .put(`/api/cost-code-classifications/${encodeURIComponent(key)}`)
      .send({ version: 0, semanticGroup: "BUILD", forecastDriver: "STANDARD_CVR" });
    assert.equal(created.status, 201);

    const stale = await request(app)
      .put(`/api/cost-code-classifications/${encodeURIComponent(key)}`)
      .send({ version: 0, semanticGroup: "LAND", forecastDriver: "STANDARD_CVR" });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.classification.semanticGroup, "BUILD");

    const loaded = await request(app).get(
      `/api/cost-code-classifications/${encodeURIComponent(key)}`
    );
    assert.equal(loaded.body.semanticGroup, "BUILD");
    assert.equal(loaded.body.version, 1);
  });

  test("tenant isolation: other client rows are not visible", async () => {
    const active = await getActiveClient();
    const key = keyFor("tenant");
    await request(app)
      .put(`/api/cost-code-classifications/${encodeURIComponent(key)}`)
      .send({ version: 0, semanticGroup: "FEES", forecastDriver: "STANDARD_CVR" });

    const other = await pool.query(
      `
        INSERT INTO clients (code, name, is_active)
        VALUES ($1, $2, false)
        RETURNING id
      `,
      [`CLASS_${Date.now()}`, "Classification Tenant B"]
    );
    trackTenant(other.rows[0].id);

    const listed = await listClassifications(other.rows[0].id);
    assert.equal(listed.classifications.length, 0);

    await putClassification(
      other.rows[0].id,
      key,
      { version: 0, semanticGroup: "SELLING", forecastDriver: "MANUAL" },
      { actor: "Other" }
    );
    const activeGet = await request(app).get(
      `/api/cost-code-classifications/${encodeURIComponent(key)}`
    );
    assert.equal(activeGet.body.semanticGroup, "FEES");
    assert.ok(active);
  });

  test("list GET does not insert rows and preserves hyphenated keys", async () => {
    const key = "P100-SM";
    testKeys.push(key);
    await pool.query(
      `DELETE FROM cost_code_classifications WHERE lower(cost_code_key) = lower($1)`,
      [key]
    );
    const created = await request(app)
      .put(`/api/cost-code-classifications/${encodeURIComponent(key)}`)
      .send({ version: 0, semanticGroup: "PRELIMS", forecastDriver: "STANDARD_CVR" });
    assert.equal(created.body.costCodeKey, "P100-SM");
    assert.equal(normalizeCostCodeKey("P100-SM — Site Manager"), "P100-SM");
    assert.equal(normalizeCostCodeKey("5231 — Cleaning"), "5231");

    const before = await pool.query(`SELECT COUNT(*)::int AS n FROM cost_code_classifications`);
    const listed = await request(app).get("/api/cost-code-classifications");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.ok, true);
    assert.equal(listed.body.unmappedDefault.semanticGroup, "UNCLASSIFIED");
    const after = await pool.query(`SELECT COUNT(*)::int AS n FROM cost_code_classifications`);
    assert.equal(after.rows[0].n, before.rows[0].n);
    assert.ok(listed.body.classifications.some((row) => row.costCodeKey === "P100-SM"));
  });

  test("Commercial Head labels are not accepted as semantic groups", async () => {
    const key = keyFor("head-label");
    const res = await request(app)
      .put(`/api/cost-code-classifications/${encodeURIComponent(key)}`)
      .send({ version: 0, semanticGroup: "Site Costs", forecastDriver: "STANDARD_CVR" });
    assert.equal(res.status, 400);
  });

  test("CVR formulas and close-engine keys remain unchanged", () => {
    assert.equal(
      calculateSystemForecast({ committed: 10000, actualCost: 4000, currentBudget: 12000 }),
      10000
    );
    assert.equal(calculateFinalForecast(10000, 1000), 11000);
    assert.ok(!CLOSE_SOURCE_KEYS.includes("classification"));
    assert.ok(!CLOSE_SOURCE_KEYS.includes("prelims"));
    const engine = fs.readFileSync(path.join(__dirname, "..", "services", "cvrCloseEngine.js"), "utf8");
    const commercial = fs.readFileSync(
      path.join(__dirname, "..", "services", "cvrCommercialClose.js"),
      "utf8"
    );
    const snapshotMapper = fs.readFileSync(
      path.join(__dirname, "..", "services", "cvrSnapshotMapper.js"),
      "utf8"
    );
    assert.doesNotMatch(engine, /costCodeClassification|semantic_group|SEMANTIC_GROUPS/);
    assert.doesNotMatch(commercial, /costCodeClassification|semanticGroup/);
    assert.doesNotMatch(snapshotMapper, /costCodeClassification|semanticGroup|forecastDriver/);
    assert.equal(CVR_SNAPSHOT_REVENUE_SCHEMA_VERSION, 2);
  });

  test("clearing PRELIMS back to UNCLASSIFIED deletes the row", async () => {
    const key = keyFor("clear-existing");
    const created = await request(app)
      .put(`/api/cost-code-classifications/${encodeURIComponent(key)}`)
      .send({ version: 0, semanticGroup: "PRELIMS", forecastDriver: "TIME" });
    assert.equal(created.status, 201);
    const cleared = await request(app)
      .put(`/api/cost-code-classifications/${encodeURIComponent(key)}`)
      .send({ version: 1, semanticGroup: "UNCLASSIFIED", forecastDriver: "STANDARD_CVR" });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.exists, false);
    assert.equal(cleared.body.semanticGroup, "UNCLASSIFIED");
    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cost_code_classifications WHERE lower(cost_code_key) = lower($1)`,
      [key]
    );
    assert.equal(count.rows[0].n, 0);
  });
}
