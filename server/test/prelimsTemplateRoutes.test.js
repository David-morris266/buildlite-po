/**
 * BL-033D.x.1 — Company Prelims template API tests (buildlite_test only).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const createApp = require("../app");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");
const {
  getBuildLiteStandardPrelimsTemplate,
} = require("../services/buildliteStandardPrelimsTemplate");
const { calculateFinalForecast, calculateSystemForecast } = require(
  "../services/cvrCloseFormulas"
);

const app = createApp();
const MIGRATION_015 = path.join(
  __dirname,
  "..",
  "migrations",
  "015_development_prelims_items.sql"
);
const MIGRATION_016 = path.join(__dirname, "..", "migrations", "016_client_prelims_templates.sql");

const testTenantIds = [];
const createdTemplateIds = [];

function trackTenant(id) {
  if (id && !testTenantIds.includes(id)) testTenantIds.push(id);
}

async function cleanup() {
  if (createdTemplateIds.length) {
    await pool.query(`DELETE FROM client_prelims_templates WHERE id = ANY($1::uuid[])`, [
      createdTemplateIds,
    ]);
  }
  if (testTenantIds.length) {
    await pool.query(`DELETE FROM client_prelims_templates WHERE client_id = ANY($1::uuid[])`, [
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

function trackTemplate(id) {
  if (id && !createdTemplateIds.includes(id)) createdTemplateIds.push(id);
}

if (!isDbConfigured()) {
  test("BL-033D.x.1 routes skipped — TEST_DATABASE_URL not configured", () => {
    assert.ok(true);
  });
} else {
  test.before(async () => {
    await prepareIntegrationTestDatabase(pool);
    const db = await pool.query("SELECT current_database() AS db");
    assert.equal(db.rows[0].db, "buildlite_test");
    assert.notEqual(db.rows[0].db, "buildlite_clone");
    await pool.query(fs.readFileSync(MIGRATION_015, "utf8"));
    await pool.query(fs.readFileSync(MIGRATION_016, "utf8"));
  });

  test.after(async () => {
    await cleanup();
  });

  test("GET Standard does not require tenant template rows and is immutable", async () => {
    const before = await pool.query("SELECT COUNT(*)::int AS n FROM client_prelims_templates");
    const res = await request(app).get("/api/prelims-templates/standard");
    assert.equal(res.status, 200);
    assert.equal(res.body.version, 1);
    assert.equal(res.body.lines.length, 25);
    assert.equal(res.body.lines.some((line) => line.costCodeKey), false);
    const after = await pool.query("SELECT COUNT(*)::int AS n FROM client_prelims_templates");
    assert.equal(after.rows[0].n, before.rows[0].n);
    const product = getBuildLiteStandardPrelimsTemplate();
    assert.equal(product.lines[0].name, "Site Manager");
  });

  test("create from Standard copies lines, records version, and does not map cost codes or rates", async () => {
    const prelimsBefore = await pool.query("SELECT COUNT(*)::int AS n FROM development_prelims_items");
    const res = await request(app)
      .post("/api/prelims-templates")
      .send({
        origin: "buildlite_standard",
        name: `BuildLite Standard Prelims ${Date.now()}`,
        actor: "Commercial Manager",
      });
    assert.equal(res.status, 201);
    trackTemplate(res.body.id);
    assert.equal(res.body.origin, "buildlite_standard");
    assert.equal(res.body.sourceStandardVersion, 1);
    assert.equal(typeof res.body.isDefault, "boolean");
    assert.equal(res.body.lines.length, 25);
    assert.ok(res.body.lines.every((line) => line.costCodeKey == null));
    assert.ok(res.body.lines.every((line) => line.monthlyRate == null && line.lumpSumAmount == null));
    assert.ok(res.body.lines.some((line) => line.templateKey === "bl.prelims.v1.site_manager"));

    const product = getBuildLiteStandardPrelimsTemplate();
    res.body.lines[0].name = "MUTATED COPY";
    assert.equal(product.lines[0].name, "Site Manager");

    const prelimsAfter = await pool.query("SELECT COUNT(*)::int AS n FROM development_prelims_items");
    assert.equal(prelimsAfter.rows[0].n, prelimsBefore.rows[0].n);
  });

  test("editing a copied line does not mutate Standard; blank templates have zero lines", async () => {
    const copied = await request(app)
      .post("/api/prelims-templates")
      .send({ origin: "buildlite_standard", name: `Copied for edit ${Date.now()}` });
    assert.equal(copied.status, 201);
    trackTemplate(copied.body.id);
    const line = copied.body.lines.find((row) => row.templateKey === "bl.prelims.v1.site_manager");
    const updated = await request(app)
      .put(`/api/prelims-templates/${copied.body.id}/lines/${line.id}`)
      .send({
        version: 1,
        templateKey: line.templateKey,
        name: "Site Manager (company)",
        description: "Company guidance only",
        forecastDriver: "TIME",
        startBasis: "SITE_START",
        endBasis: "FINAL_COMPLETION",
      });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.name, "Site Manager (company)");
    assert.equal(updated.body.description, "Company guidance only");
    assert.equal(updated.body.monthlyRate, null);
    assert.equal(updated.body.lumpSumAmount, null);
    assert.equal(getBuildLiteStandardPrelimsTemplate().lines[0].name, "Site Manager");
    assert.match(
      getBuildLiteStandardPrelimsTemplate().lines[0].description,
      /site manager for the duration/i
    );

    const blank = await request(app)
      .post("/api/prelims-templates")
      .send({ origin: "blank", name: `Small Sites ${Date.now()}` });
    assert.equal(blank.status, 201);
    trackTemplate(blank.body.id);
    assert.equal(blank.body.origin, "blank");
    assert.equal(blank.body.sourceStandardVersion, null);
    assert.equal(blank.body.lines.length, 0);
    assert.equal(blank.body.isDefault, false);
  });

  test("multiple named templates, duplicate names, and atomic default swap", async () => {
    const stamp = Date.now();
    const first = await request(app)
      .post("/api/prelims-templates")
      .send({ origin: "blank", name: `Default Housebuilding ${stamp}`, isDefault: true });
    assert.equal(first.status, 201);
    trackTemplate(first.body.id);
    assert.equal(first.body.isDefault, true);

    const dup = await request(app)
      .post("/api/prelims-templates")
      .send({ origin: "blank", name: `Default Housebuilding ${stamp}` });
    assert.equal(dup.status, 409);

    const second = await request(app)
      .post("/api/prelims-templates")
      .send({ origin: "blank", name: `Partnership ${stamp}`, isDefault: true });
    assert.equal(second.status, 201);
    trackTemplate(second.body.id);
    assert.equal(second.body.isDefault, true);

    const listed = await request(app).get("/api/prelims-templates");
    const ours = listed.body.templates.filter((row) =>
      [first.body.id, second.body.id].includes(row.id)
    );
    const defaults = ours.filter((row) => row.isDefault);
    assert.ok(ours.length >= 2);
    assert.equal(
      listed.body.templates.filter((row) => row.isDefault).length,
      1
    );
    assert.equal(defaults[0].id, second.body.id);

    const stale = await request(app)
      .put(`/api/prelims-templates/${first.body.id}`)
      .send({ version: 1, name: `Renamed first ${stamp}` });
    assert.equal(stale.status, 200);
    const conflict = await request(app)
      .put(`/api/prelims-templates/${first.body.id}`)
      .send({ version: 1, name: "Stale" });
    assert.equal(conflict.status, 409);
  });

  test("same cost code on two lines is valid; unmapped NULL is valid; no name mapping", async () => {
    const blank = await request(app)
      .post("/api/prelims-templates")
      .send({ origin: "blank", name: `Shared cost code proof ${Date.now()}` });
    assert.equal(blank.status, 201);
    trackTemplate(blank.body.id);
    const one = await request(app)
      .post(`/api/prelims-templates/${blank.body.id}/lines`)
      .send({
        templateKey: "custom.time",
        name: "TIME UAT",
        forecastDriver: "TIME",
        startBasis: "SITE_START",
        endBasis: "FINAL_COMPLETION",
        costCodeKey: "5231",
      });
    const two = await request(app)
      .post(`/api/prelims-templates/${blank.body.id}/lines`)
      .send({
        templateKey: "custom.lump",
        name: "LUMP UAT",
        forecastDriver: "LUMP_SUM",
        costCodeKey: "5231",
      });
    assert.equal(one.status, 201);
    assert.equal(two.status, 201);
    assert.equal(one.body.costCodeKey, "5231");
    assert.equal(two.body.costCodeKey, "5231");

    const staleLine = await request(app)
      .put(`/api/prelims-templates/${blank.body.id}/lines/${one.body.id}`)
      .send({
        version: 1,
        templateKey: "custom.time",
        name: "TIME UAT",
        forecastDriver: "TIME",
        startBasis: "SITE_START",
        endBasis: "FINAL_COMPLETION",
      });
    assert.equal(staleLine.status, 200);
    assert.equal(staleLine.body.monthlyRate, null);
    const lineConflict = await request(app)
      .put(`/api/prelims-templates/${blank.body.id}/lines/${one.body.id}`)
      .send({
        version: 1,
        templateKey: "custom.time",
        name: "Stale",
        forecastDriver: "TIME",
        startBasis: "SITE_START",
        endBasis: "FINAL_COMPLETION",
      });
    assert.equal(lineConflict.status, 409);
  });

  test("other tenant cannot read a company template; D.1 5231 money and Review & Adopt stay absent", async () => {
    const active = await getActiveClient();
    const created = await request(app)
      .post("/api/prelims-templates")
      .send({ origin: "blank", name: `Isolation proof ${Date.now()}` });
    assert.equal(created.status, 201);
    trackTemplate(created.body.id);

    const other = await pool.query(
      `INSERT INTO clients (code, name, is_active) VALUES ($1, $2, false) RETURNING id`,
      [`TPL-ISO-${Date.now()}`, "Other tenant"]
    );
    trackTenant(other.rows[0].id);
    const { getTemplate } = require("../services/prelimsTemplateRepository");
    const hidden = await getTemplate(other.rows[0].id, created.body.id);
    assert.equal(hidden.ok, false);
    assert.equal(hidden.status, 404);

    const visible = await getTemplate(active.id, created.body.id);
    assert.equal(visible.ok, true);

    const { createTemplate } = require("../services/prelimsTemplateRepository");
    const isolated = await pool.query(
      `INSERT INTO clients (code, name, is_active) VALUES ($1, $2, false) RETURNING id`,
      [`TPL-DEF-${Date.now()}`, "Default semantics tenant"]
    );
    trackTenant(isolated.rows[0].id);
    const first = await createTemplate(isolated.rows[0].id, { origin: "blank", name: "First" });
    const second = await createTemplate(isolated.rows[0].id, { origin: "blank", name: "Second" });
    assert.equal(first.template.isDefault, true);
    assert.equal(second.template.isDefault, false);

    assert.equal(calculateSystemForecast({ committed: 50280, actualCost: 0, currentBudget: 0 }), 50280);
    assert.equal(calculateFinalForecast(50280, 520), 50800);

    const engine = fs.readFileSync(
      path.join(__dirname, "..", "services", "cvrCloseFormulas.js"),
      "utf8"
    );
    const routes = fs.readFileSync(
      path.join(__dirname, "..", "routes", "prelimsTemplateRoutes.js"),
      "utf8"
    );
    assert.equal(/Review & Adopt/.test(engine), false);
    assert.equal(/development_prelims_items/.test(routes), false);
  });
}
