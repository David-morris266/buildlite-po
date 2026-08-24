/**
 * BL-033D.x.3 — Development Prelims setup preview/apply (buildlite_test only).
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

const app = createApp();
const ROOT = path.join(__dirname, "..");
const MIGRATION_004 = path.join(ROOT, "migrations", "004_developments.sql");
const MIGRATION_009 = path.join(ROOT, "migrations", "009_cvr_and_purchase_ledger.sql");
const MIGRATION_013 = path.join(ROOT, "migrations", "013_cost_code_classifications.sql");
const MIGRATION_014 = path.join(ROOT, "migrations", "014_development_programme.sql");
const MIGRATION_015 = path.join(ROOT, "migrations", "015_development_prelims_items.sql");
const MIGRATION_016 = path.join(ROOT, "migrations", "016_client_prelims_templates.sql");
const MIGRATION_018 = path.join(ROOT, "migrations", "018_development_prelims_item_provenance.sql");
const MIGRATION_019 = path.join(ROOT, "migrations", "019_development_prelims_time_offsets.sql");

const testDevelopmentIds = [];
const createdTemplateIds = [];
const classificationKeys = [];

function trackDevelopment(id) {
  if (id && !testDevelopmentIds.includes(id)) testDevelopmentIds.push(id);
}
function trackTemplate(id) {
  if (id && !createdTemplateIds.includes(id)) createdTemplateIds.push(id);
}

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_009, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_013, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_014, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_015, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_016, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_018, "utf8"));
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

async function getActiveClient() {
  const { rows } = await pool.query(
    "SELECT id, code, name FROM clients WHERE is_active = true LIMIT 1"
  );
  return rows[0] || null;
}

async function createDevelopment(active) {
  const id = `dev-prelims-setup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await pool.query(
    `
      INSERT INTO developments (id, client_id, job_number, development_name, status, payload)
      VALUES ($1, $2, $3, $4, 'live', $5::jsonb)
    `,
    [
      id,
      active.id,
      `PRELIMS-SETUP-${id}`,
      "Prelims setup test",
      JSON.stringify({
        startDate: "2026-09-01",
        targetCompletion: "2029-10-01",
        plotCount: 31,
      }),
    ]
  );
  trackDevelopment(id);
  await request(app).put(`/api/developments/${id}/programme`).send({
    version: 0,
    siteStart: "2026-09-01",
    finalCompletion: "2029-10-01",
    totalPlots: 31,
  });
  return id;
}

async function createTemplate() {
  const created = await request(app)
    .post("/api/prelims-templates")
    .send({ origin: "blank", name: `Dx3 setup ${Date.now()}` });
  assert.equal(created.status, 201);
  trackTemplate(created.body.id);
  const siteManager = await request(app)
    .post(`/api/prelims-templates/${created.body.id}/lines`)
    .send({
      name: "Site Manager",
      description: "Full-time site management",
      forecastDriver: "TIME",
      startBasis: "SITE_START",
      endBasis: "FINAL_COMPLETION",
      costCodeKey: "5210",
    });
  const cleaning = await request(app)
    .post(`/api/prelims-templates/${created.body.id}/lines`)
    .send({
      name: "Ongoing Site Cleaning",
      forecastDriver: "TIME",
      startBasis: "SITE_START",
      endBasis: "FINAL_COMPLETION",
      costCodeKey: "5231",
    });
  const finalClean = await request(app)
    .post(`/api/prelims-templates/${created.body.id}/lines`)
    .send({
      name: "Final Clean",
      forecastDriver: "LUMP_SUM",
      costCodeKey: "5231",
    });
  const custom = await request(app)
    .post(`/api/prelims-templates/${created.body.id}/lines`)
    .send({
      name: "Custom UAT",
      forecastDriver: "LUMP_SUM",
    });
  const unresolved = await request(app)
    .post(`/api/prelims-templates/${created.body.id}/lines`)
    .send({
      name: "First completion staff",
      forecastDriver: "TIME",
      startBasis: "FIRST_COMPLETION",
      endBasis: "FINAL_COMPLETION",
      costCodeKey: "5212",
    });
  const disabledCreated = await request(app)
    .post(`/api/prelims-templates/${created.body.id}/lines`)
    .send({
      name: "Disabled welfare",
      forecastDriver: "LUMP_SUM",
      costCodeKey: "5218",
    });
  assert.equal(disabledCreated.status, 201);
  const disabledOff = await request(app)
    .put(`/api/prelims-templates/${created.body.id}/lines/${disabledCreated.body.id}`)
    .send({
      version: disabledCreated.body.version,
      templateKey: disabledCreated.body.templateKey,
      name: disabledCreated.body.name,
      forecastDriver: "LUMP_SUM",
      costCodeKey: "5218",
      enabled: false,
    });
  assert.equal(disabledOff.status, 200);
  const disabled = disabledOff.body;
  assert.equal(siteManager.status, 201);
  assert.equal(cleaning.status, 201);
  assert.equal(finalClean.status, 201);
  assert.equal(custom.status, 201);
  assert.equal(unresolved.status, 201);
  const header = await request(app).get(`/api/prelims-templates/${created.body.id}`);
  return {
    template: header.body,
    siteManager: siteManager.body,
    cleaning: cleaning.body,
    finalClean: finalClean.body,
    custom: custom.body,
    unresolved: unresolved.body,
    disabled,
  };
}

if (!isDbConfigured()) {
  test("BL-033D.x.3 setup routes skipped — TEST_DATABASE_URL not configured", () => {
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

  test("preview is read-only and shows duration, overlap, unmapped, and disabled flags", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    await request(app)
      .post(`/api/developments/${developmentId}/prelims-items`)
      .send({
        version: 0,
        costCodeKey: "5231",
        name: "BL-033D.1 TIME UAT",
        forecastDriver: "TIME",
        monthlyRate: 1000,
        startBasis: "SITE_START",
        endBasis: "FINAL_COMPLETION",
      });
    const { template, siteManager, cleaning, custom, disabled } = await createTemplate();
    const itemsBefore = await pool.query(
      `SELECT COUNT(*)::int AS n FROM development_prelims_items WHERE development_id = $1`,
      [developmentId]
    );
    const templatesBefore = await pool.query(
      `SELECT version FROM client_prelims_templates WHERE id = $1`,
      [template.id]
    );

    const preview = await request(app).get(
      `/api/developments/${developmentId}/prelims-setup/preview?templateId=${template.id}`
    );
    assert.equal(preview.status, 200);
    assert.equal(preview.body.adoptedIntoCvr, false);
    const sm = preview.body.lines.find((row) => row.templateLineId === siteManager.id);
    const clean = preview.body.lines.find((row) => row.templateLineId === cleaning.id);
    const customLine = preview.body.lines.find((row) => row.templateLineId === custom.id);
    const disabledLine = preview.body.lines.find((row) => row.templateLineId === disabled.id);
    assert.equal(sm.duration.totalMonths, 38);
    assert.equal(sm.defaultSelected, true);
    assert.equal(clean.overlap, true);
    assert.equal(clean.defaultSelected, false);
    assert.ok(clean.overlapExistingNames.includes("BL-033D.1 TIME UAT"));
    assert.equal(customLine.costCodeKey, null);
    assert.equal(customLine.classification.tone, "unmapped");
    assert.equal(customLine.defaultSelected, false);
    assert.equal(customLine.selectable, true);
    assert.equal(disabledLine.selectable, false);
    assert.equal(disabledLine.createBlockedReason, "disabled");
    assert.match(custom.templateKey, /^co\.prelims\./);

    const itemsAfter = await pool.query(
      `SELECT COUNT(*)::int AS n FROM development_prelims_items WHERE development_id = $1`,
      [developmentId]
    );
    const templatesAfter = await pool.query(
      `SELECT version FROM client_prelims_templates WHERE id = $1`,
      [template.id]
    );
    assert.equal(itemsAfter.rows[0].n, itemsBefore.rows[0].n);
    assert.equal(templatesAfter.rows[0].version, templatesBefore.rows[0].version);
  });

  test("apply is transactional, idempotent, and does not write template/classification/CVR", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    const manual = await request(app)
      .post(`/api/developments/${developmentId}/prelims-items`)
      .send({
        version: 0,
        costCodeKey: "5231",
        name: "BL-033D.1 LUMP SUM UAT",
        forecastDriver: "LUMP_SUM",
        lumpSumAmount: 20000,
      });
    assert.equal(manual.status, 201);
    assert.equal(manual.body.sourceTemplateId, null);
    assert.equal(manual.body.sourceTemplateKey, null);

    const { template, siteManager, cleaning, custom, unresolved, disabled } = await createTemplate();
    const buildKey = `DX3-BUILD-${Date.now()}`;
    classificationKeys.push(buildKey);
    await putClassification(
      active.id,
      buildKey,
      { semanticGroup: "BUILD", forecastDriver: "STANDARD_CVR", version: 0 },
      { actor: "Dx3" }
    );

    const classCountBefore = await pool.query(
      "SELECT COUNT(*)::int AS n FROM cost_code_classifications"
    );
    const periodsBefore = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cvr_periods WHERE development_id = $1`,
      [developmentId]
    );
    const moneyBefore = await pool.query(
      `SELECT monthly_rate, lump_sum_amount FROM client_prelims_template_lines WHERE template_id = $1`,
      [template.id]
    );

    const unmapped = await request(app)
      .post(`/api/developments/${developmentId}/prelims-setup/apply`)
      .send({
        templateId: template.id,
        templateVersion: template.version,
        lines: [{ templateLineId: custom.id, selected: true, lumpSumAmount: 250 }],
      });
    assert.equal(unmapped.status, 400);

    const disabledApply = await request(app)
      .post(`/api/developments/${developmentId}/prelims-setup/apply`)
      .send({
        templateId: template.id,
        templateVersion: template.version,
        lines: [{ templateLineId: disabled.id, selected: true, costCodeKey: "5218", lumpSumAmount: 1 }],
      });
    assert.equal(disabledApply.status, 400);

    const stale = await request(app)
      .post(`/api/developments/${developmentId}/prelims-setup/apply`)
      .send({
        templateId: template.id,
        templateVersion: template.version + 1,
        lines: [
          {
            templateLineId: siteManager.id,
            selected: true,
            costCodeKey: "5210",
            monthlyRate: 5500,
          },
        ],
      });
    assert.equal(stale.status, 409);

    const applied = await request(app)
      .post(`/api/developments/${developmentId}/prelims-setup/apply`)
      .send({
        templateId: template.id,
        templateVersion: template.version,
        reportingMonth: "2026-08",
        lines: [
          {
            templateLineId: siteManager.id,
            selected: true,
            costCodeKey: "5210",
            monthlyRate: 5500,
            startBasis: "SITE_START",
            startOffsetMonths: 3,
            endBasis: "FINAL_COMPLETION",
            endOffsetMonths: 0,
          },
          {
            templateLineId: cleaning.id,
            selected: true,
            costCodeKey: "5231",
            monthlyRate: 100,
          },
          {
            templateLineId: custom.id,
            selected: true,
            costCodeKey: buildKey,
            lumpSumAmount: 250,
          },
          {
            templateLineId: unresolved.id,
            selected: true,
            costCodeKey: "5212",
            monthlyRate: 900,
          },
        ],
      });
    assert.equal(applied.status, 200);
    assert.equal(applied.body.createdCount, 4);
    const createdSite = applied.body.collection.items.find((row) => row.name === "Site Manager");
    assert.equal(createdSite.sourceTemplateId, template.id);
    assert.equal(createdSite.sourceTemplateKey, siteManager.templateKey);
    assert.equal(createdSite.monthlyRate, 5500);
    assert.equal(createdSite.startOffsetMonths, 3);
    assert.equal(createdSite.endOffsetMonths, 0);
    assert.equal(createdSite.calculation.totalMonths, 35);
    assert.equal(createdSite.calculation.totalForecast, 192500);
    assert.equal(createdSite.calculation.resolvedStart, "2026-12-01");
    const createdCustom = applied.body.collection.items.find((row) => row.name === "Custom UAT");
    assert.match(createdCustom.sourceTemplateKey, /^co\.prelims\./);
    assert.equal(createdCustom.costCodeKey, buildKey);
    assert.equal(createdCustom.lumpSumAmount, 250);
    const createdUnresolved = applied.body.collection.items.find(
      (row) => row.name === "First completion staff"
    );
    assert.equal(createdUnresolved.calculation.state, "unresolved");
    assert.equal(createdUnresolved.calculation.reason, "MISSING_FIRST_COMPLETION");

    const retry = await request(app)
      .post(`/api/developments/${developmentId}/prelims-setup/apply`)
      .send({
        templateId: template.id,
        templateVersion: template.version,
        lines: [
          {
            templateLineId: siteManager.id,
            selected: true,
            costCodeKey: "5210",
            monthlyRate: 5500,
          },
        ],
      });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.createdCount, 0);
    assert.equal(retry.body.skippedCount, 1);

    const listed = await request(app).get(`/api/developments/${developmentId}/prelims-items`);
    const siteRows = listed.body.items.filter((row) => row.name === "Site Manager");
    assert.equal(siteRows.length, 1);
    const code5231 = listed.body.items.filter((row) => row.costCodeKey === "5231");
    assert.ok(code5231.length >= 2);

    const stillManual = listed.body.items.find((row) => row.id === manual.body.id);
    assert.equal(stillManual.sourceTemplateId, null);
    assert.equal(stillManual.lumpSumAmount, 20000);

    const disabledCreated = listed.body.items.find((row) => row.name === "Disabled welfare");
    assert.equal(disabledCreated, undefined);

    const moneyAfter = await pool.query(
      `SELECT monthly_rate, lump_sum_amount FROM client_prelims_template_lines WHERE template_id = $1`,
      [template.id]
    );
    assert.equal(moneyAfter.rows.every((row) => row.monthly_rate == null && row.lump_sum_amount == null), true);
    assert.equal(moneyBefore.rows.length, moneyAfter.rows.length);
    const classCountAfter = await pool.query(
      "SELECT COUNT(*)::int AS n FROM cost_code_classifications"
    );
    assert.equal(classCountAfter.rows[0].n, classCountBefore.rows[0].n);
    const periodsAfter = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cvr_periods WHERE development_id = $1`,
      [developmentId]
    );
    assert.equal(periodsAfter.rows[0].n, periodsBefore.rows[0].n);
    const templateLineAfter = await pool.query(
      `SELECT cost_code_key FROM client_prelims_template_lines WHERE id = $1`,
      [custom.id]
    );
    assert.equal(templateLineAfter.rows[0].cost_code_key, null);

    const previewAfter = await request(app).get(
      `/api/developments/${developmentId}/prelims-setup/preview?templateId=${template.id}`
    );
    const smAfter = previewAfter.body.lines.find((row) => row.templateLineId === siteManager.id);
    assert.equal(smAfter.alreadyApplied, true);
    assert.equal(smAfter.selectable, false);
  });

  test("apply persists development-selected forecast driver override without changing template", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    const { template, siteManager, custom } = await createTemplate();

    const applied = await request(app)
      .post(`/api/developments/${developmentId}/prelims-setup/apply`)
      .send({
        templateId: template.id,
        templateVersion: template.version,
        reportingMonth: "2026-08",
        lines: [
          {
            templateLineId: siteManager.id,
            selected: true,
            costCodeKey: "5210",
            forecastDriver: "LUMP_SUM",
            lumpSumAmount: 75000,
          },
          {
            templateLineId: custom.id,
            selected: true,
            costCodeKey: "UAT-CC-001",
            forecastDriver: "TIME",
            monthlyRate: 1000,
            startBasis: "SITE_START",
            endBasis: "FINAL_COMPLETION",
            startOffsetMonths: 0,
            endOffsetMonths: 0,
          },
        ],
      });
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.equal(applied.body.createdCount, 2);

    const createdSite = applied.body.collection.items.find((row) => row.name === "Site Manager");
    assert.equal(createdSite.forecastDriver, "LUMP_SUM");
    assert.equal(createdSite.lumpSumAmount, 75000);
    assert.equal(createdSite.monthlyRate, null);
    assert.equal(createdSite.startBasis, null);

    const createdCustom = applied.body.collection.items.find((row) => row.name === "Custom UAT");
    assert.equal(createdCustom.forecastDriver, "TIME");
    assert.equal(createdCustom.monthlyRate, 1000);
    assert.equal(createdCustom.lumpSumAmount, null);
    assert.equal(createdCustom.startBasis, "SITE_START");
    assert.equal(createdCustom.calculation.totalMonths, 38);

    const templateDrivers = await pool.query(
      `SELECT id::text, forecast_driver, monthly_rate, lump_sum_amount, cost_code_key
         FROM client_prelims_template_lines WHERE id = ANY($1::uuid[])`,
      [[siteManager.id, custom.id]]
    );
    const tmplSm = templateDrivers.rows.find((row) => row.id === siteManager.id);
    const tmplCustom = templateDrivers.rows.find((row) => row.id === custom.id);
    assert.equal(tmplSm.forecast_driver, "TIME");
    assert.equal(tmplCustom.forecast_driver, "LUMP_SUM");
    assert.equal(tmplSm.monthly_rate, null);
    assert.equal(tmplCustom.lump_sum_amount, null);
  });

  test("setup source files do not adopt into CVR or rewrite company money", () => {
    const setup = fs.readFileSync(path.join(ROOT, "services", "prelimsSetupService.js"), "utf8");
    assert.doesNotMatch(setup, /Review & Adopt/);
    assert.doesNotMatch(setup, /UPDATE client_prelims_template_lines/);
    assert.doesNotMatch(setup, /INSERT INTO cost_code_classifications/);
    assert.doesNotMatch(setup, /INSERT INTO cvr_periods/);
    assert.doesNotMatch(setup, /UPDATE cost_codes/);
    const engine = fs.readFileSync(path.join(ROOT, "services", "cvrCloseEngine.js"), "utf8");
    assert.doesNotMatch(engine, /prelims-setup|source_template_key/);
  });
}
