/**
 * BL-033D.x.4B — Read-only Prelims adoption review route (buildlite_test only).
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

const app = createApp();
const ROOT = path.join(__dirname, "..");
const MIGRATION_004 = path.join(ROOT, "migrations", "004_developments.sql");
const MIGRATION_009 = path.join(ROOT, "migrations", "009_cvr_and_purchase_ledger.sql");
const MIGRATION_013 = path.join(ROOT, "migrations", "013_cost_code_classifications.sql");
const MIGRATION_014 = path.join(ROOT, "migrations", "014_development_programme.sql");
const MIGRATION_015 = path.join(ROOT, "migrations", "015_development_prelims_items.sql");
const MIGRATION_019 = path.join(ROOT, "migrations", "019_development_prelims_time_offsets.sql");

const testDevelopmentIds = [];

function trackDevelopment(id) {
  if (id && !testDevelopmentIds.includes(id)) testDevelopmentIds.push(id);
}

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_009, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_013, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_014, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_015, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_019, "utf8"));
}

async function cleanup() {
  if (!testDevelopmentIds.length) return;
  await pool.query(`DELETE FROM development_prelims_items WHERE development_id = ANY($1::text[])`, [
    testDevelopmentIds,
  ]);
  await pool.query(`DELETE FROM development_programme WHERE development_id = ANY($1::text[])`, [
    testDevelopmentIds,
  ]);
  await pool.query(
    `DELETE FROM cvr_cost_code_inputs WHERE period_id IN (
       SELECT id FROM cvr_periods WHERE development_id = ANY($1::text[])
     )`,
    [testDevelopmentIds]
  );
  await pool.query(`DELETE FROM cvr_periods WHERE development_id = ANY($1::text[])`, [
    testDevelopmentIds,
  ]);
  await pool.query(`DELETE FROM developments WHERE id = ANY($1::text[])`, [testDevelopmentIds]);
}

async function getActiveClient() {
  const { rows } = await pool.query(
    "SELECT id, code, name FROM clients WHERE is_active = true LIMIT 1"
  );
  return rows[0] || null;
}

async function createDevelopment(active) {
  const id = `dev-prelims-review-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await pool.query(
    `
      INSERT INTO developments (id, client_id, job_number, development_name, status, payload)
      VALUES ($1, $2, $3, $4, 'live', $5::jsonb)
    `,
    [
      id,
      active.id,
      `PRELIMS-REV-${id}`,
      "Prelims review preview test",
      JSON.stringify({
        startDate: "2026-09-01",
        targetCompletion: "2029-10-01",
        plotCount: 31,
      }),
    ]
  );
  trackDevelopment(id);
  return id;
}

if (!isDbConfigured()) {
  test("BL-033D.x.4B routes skipped — TEST_DATABASE_URL not configured", () => {
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

  test("POST/PUT/PATCH prelims-adoption/preview are not available", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    const base = `/api/developments/${developmentId}/prelims-adoption/preview`;
    assert.equal((await request(app).post(base).send({})).status, 404);
    assert.equal((await request(app).put(base).send({})).status, 404);
    assert.equal((await request(app).patch(base).send({})).status, 404);
    assert.equal((await request(app).delete(base)).status, 404);
  });

  test("GET prelims-adoption/preview is read-only and returns commercial review", async () => {
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

    const period = await request(app)
      .post(`/api/developments/${developmentId}/cvr/periods`)
      .send({ reportingMonth: "2026-08-01", periodKey: "P04" });
    assert.equal(period.status, 201, period.body?.message || JSON.stringify(period.body));

    const inputs = await request(app)
      .put(`/api/developments/${developmentId}/cvr/periods/${period.body.id}/inputs`)
      .send({
        actor: "QS",
        inputs: [
          {
            costCodeKey: "5231",
            costCodeLabel: "Site Prelims",
            currentBudget: 50280,
            originalBudget: 50280,
            commercialAdjustment: 520,
            adjustmentReason: "P04 controlled adjustment",
            manualAccrual: 120,
          },
        ],
      });
    assert.equal(inputs.status, 200, inputs.body?.message || JSON.stringify(inputs.body));

    await request(app)
      .post(`/api/developments/${developmentId}/prelims-items`)
      .send({
        version: 0,
        costCodeKey: "5231",
        name: "Lump",
        forecastDriver: "LUMP_SUM",
        lumpSumAmount: 20000,
        status: "active",
      });
    await request(app)
      .post(`/api/developments/${developmentId}/prelims-items`)
      .send({
        version: 0,
        costCodeKey: "5231",
        name: "Time resolved",
        forecastDriver: "TIME",
        monthlyRate: 1000,
        startBasis: "SITE_START",
        endBasis: "FINAL_COMPLETION",
        status: "active",
        reportingMonth: "2026-08",
      });
    await request(app)
      .post(`/api/developments/${developmentId}/prelims-items`)
      .send({
        version: 0,
        costCodeKey: "5231",
        name: "Unresolved first completion",
        forecastDriver: "TIME",
        monthlyRate: 1000,
        startBasis: "FIRST_COMPLETION",
        endBasis: "FINAL_COMPLETION",
        status: "active",
        reportingMonth: "2026-08",
      });
    await request(app)
      .post(`/api/developments/${developmentId}/prelims-items`)
      .send({
        version: 0,
        costCodeKey: "UAT-CC-001",
        name: "No CVR target",
        forecastDriver: "LUMP_SUM",
        lumpSumAmount: 1000,
        status: "active",
      });

    const beforeAdj = await pool.query(
      `
        SELECT commercial_adjustment::float8 AS adj, display_metadata
        FROM cvr_cost_code_inputs
        WHERE period_id = $1 AND cost_code_key = '5231'
      `,
      [period.body.id]
    );
    const beforePrelims = await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(version),0)::int AS versions
       FROM development_prelims_items WHERE development_id = $1`,
      [developmentId]
    );

    const preview = await request(app).get(
      `/api/developments/${developmentId}/prelims-adoption/preview`
    );
    assert.equal(preview.status, 200, preview.body?.message || JSON.stringify(preview.body));
    assert.equal(preview.body.readOnly, true);
    assert.equal(preview.body.periodKey, "P04");
    assert.equal(preview.body.reportingMonth, "2026-08");

    const row = (preview.body.candidates || []).find((item) => item.costCodeKey === "5231");
    assert.ok(row);
    assert.equal(row.resolvedPrelimsTotal, 58000);
    assert.equal(row.unresolvedCount, 1);
    assert.equal(row.systemForecast, 50280);
    assert.equal(row.currentAdjustment, 520);
    assert.equal(row.currentFinalForecast, 50800);
    assert.equal(row.proposedAdjustment, 7720);
    assert.equal(row.proposedFinalForecast, 58000);
    assert.equal(row.deltaFinal, 7200);
    assert.equal(row.manualAccrual, 120);
    assert.match(row.unresolvedExcludedMessage, /excluded from proposed CVR value/i);
    assert.equal(row.unresolvedLines.length, 1);

    const missing = (preview.body.missingFromCvr || []).find(
      (item) => item.costCodeKey === "UAT-CC-001"
    );
    assert.ok(missing);
    assert.match(missing.missingFromCvrMessage, /not present in the current CVR/i);

    const afterAdj = await pool.query(
      `
        SELECT commercial_adjustment::float8 AS adj, display_metadata
        FROM cvr_cost_code_inputs
        WHERE period_id = $1 AND cost_code_key = '5231'
      `,
      [period.body.id]
    );
    assert.equal(afterAdj.rows[0].adj, beforeAdj.rows[0].adj);
    assert.deepEqual(afterAdj.rows[0].display_metadata, beforeAdj.rows[0].display_metadata);

    const afterPrelims = await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(version),0)::int AS versions
       FROM development_prelims_items WHERE development_id = $1`,
      [developmentId]
    );
    assert.equal(afterPrelims.rows[0].n, beforePrelims.rows[0].n);
    assert.equal(afterPrelims.rows[0].versions, beforePrelims.rows[0].versions);

    const snapshotCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cvr_period_snapshots WHERE development_id = $1`,
      [developmentId]
    ).catch(() => ({ rows: [{ n: 0 }] }));
    assert.equal(snapshotCount.rows[0].n, 0);
  });

  test("GET without open CVR returns 404", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    const res = await request(app).get(
      `/api/developments/${developmentId}/prelims-adoption/preview`
    );
    assert.equal(res.status, 404);
  });
}
