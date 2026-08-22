/**
 * BL-033D.x.2A.1 — Tenant Cost Code Master API tests (buildlite_test only).
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
const { putClassification } = require("../services/costCodeClassificationRepository");
const { createCostCode } = require("../services/costCodeMasterRepository");
const { looksLikeDisplayLabel, preserveCostCodeIdentity } = require(
  "../services/costCodeMasterValidation"
);

const app = createApp();
const MIGRATION_013 = path.join(__dirname, "..", "migrations", "013_cost_code_classifications.sql");
const MIGRATION_017 = path.join(__dirname, "..", "migrations", "017_cost_codes_tenant_master.sql");

const createdIds = [];
const testTenantIds = [];
const testKeys = [];

function trackId(id) {
  if (id && !createdIds.includes(id)) createdIds.push(id);
}

function payload(overrides = {}) {
  return {
    description: "Cleaning",
    commercialHead: "Preliminaries",
    commercialFamily: "",
    reportingGroup: "Cleaning",
    defaultVatTreatment: "Standard",
    defaultOrderType: "S",
    ...overrides,
  };
}

async function getActiveClient() {
  const { rows } = await pool.query(
    "SELECT id, code, name FROM clients WHERE is_active = true LIMIT 1"
  );
  return rows[0] || null;
}

async function cleanup() {
  if (createdIds.length) {
    await pool.query(`DELETE FROM cost_codes WHERE id = ANY($1::uuid[])`, [createdIds]);
  }
  if (testKeys.length) {
    await pool.query(
      `DELETE FROM cost_code_classifications WHERE lower(cost_code_key) = ANY($1::text[])`,
      [testKeys.map((key) => key.toLowerCase())]
    );
  }
  if (testTenantIds.length) {
    await pool.query(`DELETE FROM cost_codes WHERE client_id = ANY($1::uuid[])`, [testTenantIds]);
    await pool.query(`DELETE FROM cost_code_classifications WHERE client_id = ANY($1::uuid[])`, [
      testTenantIds,
    ]);
    await pool.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [testTenantIds]);
  }
}

if (!isDbConfigured()) {
  test("BL-033D.x.2A.1 routes skipped — TEST_DATABASE_URL not configured", () => {
    assert.ok(true);
  });
} else {
  test.before(async () => {
    await prepareIntegrationTestDatabase(pool);
    const db = await pool.query("SELECT current_database() AS db");
    assert.equal(db.rows[0].db, "buildlite_test");
    assert.notEqual(db.rows[0].db, "buildlite_clone");
    await pool.query(fs.readFileSync(MIGRATION_013, "utf8"));
    await pool.query(fs.readFileSync(MIGRATION_017, "utf8"));
  });

  test.after(async () => {
    await cleanup();
  });

  test("GET does not write and POST creates v1 with separate code and label", async () => {
    const before = await pool.query(`SELECT COUNT(*)::int AS n FROM cost_codes`);
    const listed = await request(app).get("/api/cost-codes");
    assert.equal(listed.status, 200);
    assert.ok(Array.isArray(listed.body.costCodes));
    const afterGet = await pool.query(`SELECT COUNT(*)::int AS n FROM cost_codes`);
    assert.equal(afterGet.rows[0].n, before.rows[0].n);

    const code = `X2A-${Date.now()}-5231`;
    const created = await request(app)
      .post("/api/cost-codes")
      .send(payload({ code, actor: "Commercial Manager" }));
    assert.equal(created.status, 201);
    trackId(created.body.id);
    assert.equal(created.body.code, code);
    assert.equal(created.body.description, "Cleaning");
    assert.equal(created.body.label, `${code} — Cleaning`);
    assert.equal(created.body.version, 1);
    assert.equal(created.body.active, true);
    assert.equal(created.body.createdBy, "Commercial Manager");
    assert.notEqual(created.body.code, created.body.label);
  });

  test("5231 and P100-SM preserve entered identity; case/trim uniqueness", async () => {
    assert.equal(preserveCostCodeIdentity("  P100-SM  "), "P100-SM");
    assert.equal(looksLikeDisplayLabel("P100-SM"), false);
    assert.equal(looksLikeDisplayLabel("5231 — Cleaning"), true);

    const hyphen = `P100-SM-${Date.now().toString(36)}`;
    const created = await request(app).post("/api/cost-codes").send(payload({ code: hyphen }));
    assert.equal(created.status, 201);
    trackId(created.body.id);
    assert.equal(created.body.code, hyphen);

    const dup = await request(app)
      .post("/api/cost-codes")
      .send(payload({ code: hyphen.toLowerCase() }));
    assert.equal(dup.status, 409);

    const numeric = `5231-${Date.now().toString(36)}`;
    const numericCreated = await request(app)
      .post("/api/cost-codes")
      .send(payload({ code: numeric }));
    assert.equal(numericCreated.status, 201);
    trackId(numericCreated.body.id);
    assert.equal(numericCreated.body.code, numeric);

    const labelRejected = await request(app)
      .post("/api/cost-codes")
      .send(payload({ code: "5231 — Cleaning" }));
    assert.equal(labelRejected.status, 400);
  });

  test("update increments version; stale version does not overwrite; code is immutable", async () => {
    const created = await request(app)
      .post("/api/cost-codes")
      .send(payload({ code: `X2A-UPD-${Date.now()}` }));
    assert.equal(created.status, 201);
    trackId(created.body.id);

    const updated = await request(app)
      .put(`/api/cost-codes/${created.body.id}`)
      .send(payload({ version: 1, description: "Site cleaning" }));
    assert.equal(updated.status, 200);
    assert.equal(updated.body.version, 2);
    assert.equal(updated.body.description, "Site cleaning");
    assert.equal(updated.body.code, created.body.code);

    const stale = await request(app)
      .put(`/api/cost-codes/${created.body.id}`)
      .send(payload({ version: 1, description: "Should not stick" }));
    assert.equal(stale.status, 409);
    assert.equal(stale.body.costCode.description, "Site cleaning");

    const loaded = await request(app).get(`/api/cost-codes/${created.body.id}`);
    assert.equal(loaded.body.description, "Site cleaning");
    assert.equal(loaded.body.version, 2);

    const renamed = await request(app)
      .put(`/api/cost-codes/${created.body.id}`)
      .send(payload({ version: 2, code: "RENAMED" }));
    assert.equal(renamed.status, 400);
    assert.match(String(renamed.body.message || ""), /cannot be changed/i);
  });

  test("deactivate retains the row and hides it from the compatibility select", async () => {
    const created = await request(app)
      .post("/api/cost-codes")
      .send(payload({ code: `X2A-OFF-${Date.now()}` }));
    trackId(created.body.id);

    const deactivated = await request(app)
      .put(`/api/cost-codes/${created.body.id}/active`)
      .send({ version: 1, active: false });
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.body.active, false);
    assert.equal(deactivated.body.version, 2);

    const all = await request(app).get("/api/cost-codes");
    assert.ok(all.body.costCodes.some((row) => row.id === created.body.id && row.active === false));

    const activeOnly = await request(app).get("/api/cost-codes?activeOnly=true");
    assert.equal(
      activeOnly.body.costCodes.some((row) => row.id === created.body.id),
      false
    );

    const compatibility = await request(app).get("/api/po/cost-codes");
    assert.equal(compatibility.status, 200);
    assert.equal(
      (compatibility.body || []).some((row) => row.code === created.body.code),
      false
    );

    const reactivated = await request(app)
      .put(`/api/cost-codes/${created.body.id}/active`)
      .send({ version: 2, active: true });
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.body.active, true);

    const compatibilityOn = await request(app).get("/api/po/cost-codes");
    assert.ok((compatibilityOn.body || []).some((row) => row.code === created.body.code));
    const compatRow = (compatibilityOn.body || []).find((row) => row.code === created.body.code);
    assert.ok(compatRow.label);
    assert.equal(compatRow.code, created.body.code);
  });

  test("tenant isolation returns 404 for another client's row", async () => {
    const other = await pool.query(
      `INSERT INTO clients (code, name, is_active) VALUES ($1, $2, false) RETURNING id`,
      [`CC-ISO-${Date.now()}`, "Cost code tenant B"]
    );
    testTenantIds.push(other.rows[0].id);
    const created = await createCostCode(other.rows[0].id, payload({ code: `ISO-${Date.now()}` }));
    assert.equal(created.ok, true);

    const hidden = await request(app).get(`/api/cost-codes/${created.costCode.id}`);
    assert.equal(hidden.status, 404);

    const listed = await request(app).get("/api/cost-codes");
    assert.equal(
      listed.body.costCodes.some((row) => row.id === created.costCode.id),
      false
    );
  });

  test("classification is unaffected by master create/deactivate", async () => {
    const key = `X2A-CL-${Date.now()}`;
    testKeys.push(key);
    const classified = await putClassification(
      (await getActiveClient()).id,
      key,
      { version: 0, semanticGroup: "PRELIMS", forecastDriver: "STANDARD_CVR" },
      { actor: "QS" }
    );
    assert.equal(classified.ok, true);
    assert.equal(classified.classification.semanticGroup, "PRELIMS");
    assert.equal(classified.classification.forecastDriver, "STANDARD_CVR");
    assert.equal(classified.classification.version, 1);

    const created = await request(app).post("/api/cost-codes").send(payload({ code: key }));
    assert.equal(created.status, 201);
    trackId(created.body.id);

    await request(app)
      .put(`/api/cost-codes/${created.body.id}/active`)
      .send({ version: 1, active: false });

    const after = await request(app).get(
      `/api/cost-code-classifications/${encodeURIComponent(key)}`
    );
    assert.equal(after.status, 200);
    assert.equal(after.body.semanticGroup, "PRELIMS");
    assert.equal(after.body.forecastDriver, "STANDARD_CVR");
    assert.equal(after.body.version, 1);
    assert.equal(after.body.costCodeKey, key);
  });

  test("master writes do not change CVR, snapshots, Prelims, or templates", async () => {
    async function countIfExists(table) {
      const exists = await pool.query(`SELECT to_regclass($1) AS name`, [`public.${table}`]);
      if (!exists.rows[0].name) return 0;
      const counted = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      return counted.rows[0].n;
    }
    const tables = [
      "cvr_periods",
      "cvr_period_snapshots",
      "development_prelims_items",
      "client_prelims_template_lines",
      "purchase_orders",
      "packages",
      "commercial_events",
    ];
    const before = {};
    for (const table of tables) before[table] = await countIfExists(table);
    const created = await request(app)
      .post("/api/cost-codes")
      .send(payload({ code: `X2A-SAFE-${Date.now()}` }));
    trackId(created.body.id);
    await request(app)
      .put(`/api/cost-codes/${created.body.id}`)
      .send(payload({ version: 1, description: "Still safe" }));
    for (const table of tables) {
      assert.equal(await countIfExists(table), before[table], table);
    }
  });

  test("DELETE is not available", async () => {
    const created = await request(app)
      .post("/api/cost-codes")
      .send(payload({ code: `X2A-DEL-${Date.now()}` }));
    trackId(created.body.id);
    const deleted = await request(app).delete(`/api/cost-codes/${created.body.id}`);
    assert.equal(deleted.status, 404);
    const loaded = await request(app).get(`/api/cost-codes/${created.body.id}`);
    assert.equal(loaded.status, 200);
  });
}
