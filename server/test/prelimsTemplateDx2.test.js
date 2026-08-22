/**
 * BL-033D.x.2 — Company template tailoring/mapping API tests (buildlite_test only).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const createApp = require("../app");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");
const {
  getBuildLiteStandardPrelimsTemplate,
} = require("../services/buildliteStandardPrelimsTemplate");
const { putClassification } = require("../services/costCodeClassificationRepository");

const app = createApp();
const createdTemplateIds = [];
const classificationKeys = [];

function trackTemplate(id) {
  if (id && !createdTemplateIds.includes(id)) createdTemplateIds.push(id);
}

async function cleanup() {
  if (createdTemplateIds.length) {
    await pool.query(`DELETE FROM client_prelims_templates WHERE id = ANY($1::uuid[])`, [
      createdTemplateIds,
    ]);
  }
  if (classificationKeys.length) {
    await pool.query(
      `DELETE FROM cost_code_classifications WHERE lower(cost_code_key) = ANY($1::text[])`,
      [classificationKeys.map((key) => key.toLowerCase())]
    );
  }
}

if (!isDbConfigured()) {
  test("BL-033D.x.2 template mapping tests skipped — TEST_DATABASE_URL not configured", () => {
    assert.ok(true);
  });
} else {
  test.before(async () => {
    await prepareIntegrationTestDatabase(pool);
    const db = await pool.query("SELECT current_database() AS db");
    assert.equal(db.rows[0].db, "buildlite_test");
  });

  test.after(async () => {
    await cleanup();
  });

  async function blankTemplate(name) {
    const created = await request(app)
      .post("/api/prelims-templates")
      .send({ origin: "blank", name });
    assert.equal(created.status, 201);
    trackTemplate(created.body.id);
    return created.body;
  }

  test("generated custom keys are co.prelims.* and cannot use bl.prelims.", async () => {
    const template = await blankTemplate(`Dx2 custom key ${Date.now()}`);
    const created = await request(app)
      .post(`/api/prelims-templates/${template.id}/lines`)
      .send({
        name: "Custom welfare",
        description: "Company-owned extra line",
        forecastDriver: "TIME",
        startBasis: "SITE_START",
        endBasis: "FINAL_COMPLETION",
      });
    const second = await request(app)
      .post(`/api/prelims-templates/${template.id}/lines`)
      .send({
        name: "Custom hoarding",
        forecastDriver: "LUMP_SUM",
      });
    assert.equal(created.status, 201);
    assert.equal(second.status, 201);
    assert.match(created.body.templateKey, /^co\.prelims\./);
    assert.match(second.body.templateKey, /^co\.prelims\./);
    assert.notEqual(created.body.templateKey, second.body.templateKey);
    assert.equal(created.body.templateKey.startsWith("bl.prelims."), false);
    assert.equal(created.body.monthlyRate, null);
    assert.equal(created.body.lumpSumAmount, null);

    const blocked = await request(app)
      .post(`/api/prelims-templates/${template.id}/lines`)
      .send({
        templateKey: "bl.prelims.v1.forged",
        name: "Forged Standard",
        forecastDriver: "LUMP_SUM",
      });
    assert.equal(blocked.status, 400);
  });

  test("mapping persists canonical codes, allows duplicates, and rejects labels and money", async () => {
    const template = await blankTemplate(`Dx2 mapping ${Date.now()}`);
    const cls5231Before = await pool.query(
      `SELECT semantic_group, forecast_driver, version FROM cost_code_classifications
       WHERE cost_code_key = '5231' ORDER BY id`
    );
    const time = await request(app)
      .post(`/api/prelims-templates/${template.id}/lines`)
      .send({
        name: "Ongoing Site Cleaning",
        forecastDriver: "TIME",
        startBasis: "SITE_START",
        endBasis: "FINAL_COMPLETION",
        costCodeKey: "5231",
      });
    const lump = await request(app)
      .post(`/api/prelims-templates/${template.id}/lines`)
      .send({
        name: "Final Clean",
        forecastDriver: "LUMP_SUM",
        costCodeKey: "5231",
      });
    assert.equal(time.status, 201);
    assert.equal(lump.status, 201);
    assert.equal(time.body.costCodeKey, "5231");
    assert.equal(lump.body.costCodeKey, "5231");

    const hyphen = await request(app)
      .post(`/api/prelims-templates/${template.id}/lines`)
      .send({
        name: "Site manager",
        forecastDriver: "TIME",
        startBasis: "SITE_START",
        endBasis: "FINAL_COMPLETION",
        costCodeKey: "P100-SM",
      });
    assert.equal(hyphen.status, 201);
    assert.equal(hyphen.body.costCodeKey, "P100-SM");

    const label = await request(app)
      .post(`/api/prelims-templates/${template.id}/lines`)
      .send({
        name: "Label rejected",
        forecastDriver: "LUMP_SUM",
        costCodeKey: "5231 — Cleaning",
      });
    assert.equal(label.status, 400);

    const money = await request(app)
      .put(`/api/prelims-templates/${template.id}/lines/${time.body.id}`)
      .send({
        version: 1,
        templateKey: time.body.templateKey,
        name: "Ongoing Site Cleaning",
        forecastDriver: "TIME",
        startBasis: "SITE_START",
        endBasis: "FINAL_COMPLETION",
        costCodeKey: "5231",
        monthlyRate: 1000,
      });
    assert.equal(money.status, 400);

    const cleared = await request(app)
      .put(`/api/prelims-templates/${template.id}/lines/${lump.body.id}`)
      .send({
        version: 1,
        templateKey: lump.body.templateKey,
        name: "Final Clean",
        forecastDriver: "LUMP_SUM",
        costCodeKey: null,
      });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.costCodeKey, null);
    assert.equal(cleared.body.monthlyRate, null);
    const cls5231After = await pool.query(
      `SELECT semantic_group, forecast_driver, version FROM cost_code_classifications
       WHERE cost_code_key = '5231' ORDER BY id`
    );
    assert.deepEqual(cls5231After.rows, cls5231Before.rows);
  });

  test("TIME/LUMP_SUM edits, enable/disable, and stale line version 409", async () => {
    const template = await blankTemplate(`Dx2 line edit ${Date.now()}`);
    const created = await request(app)
      .post(`/api/prelims-templates/${template.id}/lines`)
      .send({
        name: "Hoarding",
        description: "Temporary site hoarding",
        forecastDriver: "TIME",
        startBasis: "SITE_START",
        endBasis: "FINAL_COMPLETION",
      });
    assert.equal(created.status, 201);

    const toLump = await request(app)
      .put(`/api/prelims-templates/${template.id}/lines/${created.body.id}`)
      .send({
        version: 1,
        templateKey: created.body.templateKey,
        name: "Hoarding install",
        description: "One-off hoarding install",
        forecastDriver: "LUMP_SUM",
      });
    assert.equal(toLump.status, 200);
    assert.equal(toLump.body.forecastDriver, "LUMP_SUM");
    assert.equal(toLump.body.startBasis, null);
    assert.equal(toLump.body.endBasis, null);
    assert.equal(toLump.body.description, "One-off hoarding install");

    const toTime = await request(app)
      .put(`/api/prelims-templates/${template.id}/lines/${created.body.id}`)
      .send({
        version: 2,
        templateKey: created.body.templateKey,
        name: "Hoarding install",
        forecastDriver: "TIME",
        startBasis: "FIRST_COMPLETION",
        endBasis: "FINAL_COMPLETION",
      });
    assert.equal(toTime.status, 200);
    assert.equal(toTime.body.startBasis, "FIRST_COMPLETION");

    const disabled = await request(app)
      .put(`/api/prelims-templates/${template.id}/lines/${created.body.id}`)
      .send({
        version: 3,
        templateKey: created.body.templateKey,
        name: "Hoarding install",
        forecastDriver: "TIME",
        startBasis: "FIRST_COMPLETION",
        endBasis: "FINAL_COMPLETION",
        enabled: false,
      });
    assert.equal(disabled.status, 200);
    assert.equal(disabled.body.enabled, false);

    const enabled = await request(app)
      .put(`/api/prelims-templates/${template.id}/lines/${created.body.id}`)
      .send({
        version: 4,
        templateKey: created.body.templateKey,
        name: "Hoarding install",
        forecastDriver: "TIME",
        startBasis: "FIRST_COMPLETION",
        endBasis: "FINAL_COMPLETION",
        enabled: true,
      });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.body.enabled, true);

    const stale = await request(app)
      .put(`/api/prelims-templates/${template.id}/lines/${created.body.id}`)
      .send({
        version: 1,
        templateKey: created.body.templateKey,
        name: "Stale",
        forecastDriver: "LUMP_SUM",
      });
    assert.equal(stale.status, 409);
  });

  test("mapping does not change classification or Cost Code Master hierarchy; Standard stays immutable", async () => {
    const active = await pool.query("SELECT id FROM clients WHERE is_active = true LIMIT 1");
    const clientId = active.rows[0].id;
    const key = `DX2-BUILD-${Date.now()}`;
    classificationKeys.push(key);
    await putClassification(
      clientId,
      key,
      { semanticGroup: "BUILD", forecastDriver: "STANDARD_CVR", version: 0 },
      { actor: "Dx2" }
    );

    const copied = await request(app)
      .post("/api/prelims-templates")
      .send({ origin: "buildlite_standard", name: `Dx2 standard copy ${Date.now()}` });
    assert.equal(copied.status, 201);
    trackTemplate(copied.body.id);
    const line = copied.body.lines.find((row) => row.templateKey === "bl.prelims.v1.cleaning_ongoing");
    const itemsBefore = await pool.query(
      "SELECT COUNT(*)::int AS n FROM development_prelims_items"
    );
    const masterBefore = await pool.query(
      `
        SELECT id::text, code, reporting_group, commercial_head, version, updated_at::text
        FROM cost_codes
        ORDER BY id
      `
    );
    const classCountBefore = await pool.query(
      "SELECT COUNT(*)::int AS n FROM cost_code_classifications"
    );
    const mapped = await request(app)
      .put(`/api/prelims-templates/${copied.body.id}/lines/${line.id}`)
      .send({
        version: 1,
        templateKey: line.templateKey,
        name: line.name,
        description: "Company guidance only",
        forecastDriver: "TIME",
        startBasis: "SITE_START",
        endBasis: "FINAL_COMPLETION",
        costCodeKey: key,
      });

    assert.equal(mapped.status, 200);
    assert.equal(mapped.body.costCodeKey, key);
    const product = getBuildLiteStandardPrelimsTemplate().lines.find(
      (row) => row.templateKey === "bl.prelims.v1.cleaning_ongoing"
    );
    assert.equal(
      product.description,
      "Recurring site cleaning through the job. Not a housebuild finishing trade."
    );
    assert.equal(mapped.body.description, "Company guidance only");

    const siteManager = copied.body.lines.find(
      (row) => row.templateKey === "bl.prelims.v1.site_manager"
    );
    assert.equal(
      siteManager.description,
      getBuildLiteStandardPrelimsTemplate().lines[0].description
    );

    const cls = await pool.query(
      `SELECT semantic_group, forecast_driver, version FROM cost_code_classifications
       WHERE client_id = $1 AND cost_code_key = $2`,
      [clientId, key]
    );
    assert.equal(cls.rows[0].semantic_group, "BUILD");
    assert.equal(cls.rows[0].forecast_driver, "STANDARD_CVR");

    const masterAfter = await pool.query(
      `
        SELECT id::text, code, reporting_group, commercial_head, version, updated_at::text
        FROM cost_codes
        ORDER BY id
      `
    );
    assert.deepEqual(masterAfter.rows, masterBefore.rows);

    const classCountAfter = await pool.query(
      "SELECT COUNT(*)::int AS n FROM cost_code_classifications"
    );
    assert.equal(classCountAfter.rows[0].n, classCountBefore.rows[0].n);

    const itemsAfter = await pool.query(
      "SELECT COUNT(*)::int AS n FROM development_prelims_items"
    );
    assert.equal(itemsAfter.rows[0].n, itemsBefore.rows[0].n);
  });

  test("product Standard remains GET-only; duplicate cost_code_key is not unique", async () => {
    const getStandard = await request(app).get("/api/prelims-templates/standard");
    assert.equal(getStandard.status, 200);
    assert.equal(getStandard.body.version, 1);

    const putStandard = await request(app)
      .put("/api/prelims-templates/standard")
      .send({ version: 1, name: "Mutated Standard" });
    assert.equal(putStandard.status, 405);

    const postLine = await request(app)
      .post("/api/prelims-templates/standard/lines")
      .send({ name: "Forged", forecastDriver: "LUMP_SUM" });
    assert.equal(postLine.status, 405);

    const indexes = await pool.query(
      `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'client_prelims_template_lines'
      `
    );
    assert.equal(
      indexes.rows.some((row) => /UNIQUE.*cost_code_key/i.test(row.indexdef)),
      false
    );
  });
}
