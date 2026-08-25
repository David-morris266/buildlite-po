/**
 * BL-034B — Selling Costs settings/proposal API (buildlite_test only).
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
const MIGRATION_004 = path.join(__dirname, "..", "migrations", "004_developments.sql");
const MIGRATION_009 = path.join(__dirname, "..", "migrations", "009_cvr_and_purchase_ledger.sql");
const MIGRATION_011 = path.join(
  __dirname,
  "..",
  "migrations",
  "011_development_revenue_settings.sql"
);
const MIGRATION_013 = path.join(
  __dirname,
  "..",
  "migrations",
  "013_cost_code_classifications.sql"
);
const MIGRATION_017 = path.join(__dirname, "..", "migrations", "017_cost_codes_tenant_master.sql");
const MIGRATION_020 = path.join(
  __dirname,
  "..",
  "migrations",
  "020_development_selling_costs_settings.sql"
);

const KNOWN_FORECAST_REVENUE = 10444608;
const KNOWN_DEFAULT_PROPOSAL = 208892.16;

const testDevelopmentIds = [];
const testTenantIds = [];
const testCostCodeIds = [];
const testPeriodIds = [];

function trackDevelopment(id) {
  if (id && !testDevelopmentIds.includes(id)) testDevelopmentIds.push(id);
}
function trackTenant(id) {
  if (id && !testTenantIds.includes(id)) testTenantIds.push(id);
}
function trackCostCode(id) {
  if (id && !testCostCodeIds.includes(id)) testCostCodeIds.push(id);
}
function trackPeriod(id) {
  if (id && !testPeriodIds.includes(id)) testPeriodIds.push(id);
}

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_009, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_011, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_013, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_017, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_020, "utf8"));
}

async function cleanup() {
  if (testPeriodIds.length) {
    await pool.query(`DELETE FROM cvr_cost_code_inputs WHERE period_id = ANY($1::uuid[])`, [
      testPeriodIds,
    ]);
    await pool.query(`DELETE FROM cvr_periods WHERE id = ANY($1::uuid[])`, [testPeriodIds]);
  }
  if (testDevelopmentIds.length) {
    await pool.query(
      `DELETE FROM development_selling_costs_settings WHERE development_id = ANY($1::text[])`,
      [testDevelopmentIds]
    );
    await pool.query(
      `DELETE FROM development_revenue_settings WHERE development_id = ANY($1::text[])`,
      [testDevelopmentIds]
    );
    await pool.query(`DELETE FROM developments WHERE id = ANY($1::text[])`, [testDevelopmentIds]);
  }
  if (testCostCodeIds.length) {
    await pool.query(`DELETE FROM cost_codes WHERE id = ANY($1::uuid[])`, [testCostCodeIds]);
  }
  if (testTenantIds.length) {
    await pool.query(`DELETE FROM cost_code_classifications WHERE client_id = ANY($1::uuid[])`, [
      testTenantIds,
    ]);
    await pool.query(`DELETE FROM cost_codes WHERE client_id = ANY($1::uuid[])`, [testTenantIds]);
    await pool.query(
      `DELETE FROM development_selling_costs_settings WHERE client_id = ANY($1::uuid[])`,
      [testTenantIds]
    );
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

async function createDevelopment(active, { withPlots = true, withRevenueSettings = true } = {}) {
  const id = `dev-sc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const payload = withPlots
    ? {
        plotMaster: {
          plots: [
            {
              id: "plot-sc-1",
              plotNumber: "1",
              revenueStatus: "Available",
              revenueSource: "Manual Value",
              manualForecastValue: KNOWN_FORECAST_REVENUE,
              sellingPrice: 0,
            },
          ],
        },
      }
    : {};

  await pool.query(
    `
      INSERT INTO developments (id, client_id, job_number, development_name, status, payload)
      VALUES ($1, $2, $3, $4, 'live', $5::jsonb)
    `,
    [id, active.id, `SC-${id}`, "Selling Costs API test", JSON.stringify(payload)]
  );
  trackDevelopment(id);

  if (withRevenueSettings) {
    await pool.query(
      `
        INSERT INTO development_revenue_settings (
          client_id, development_id, recognition_policy, strategy, house_type_pricing,
          revenue_adjustments, recognition_settings, version, created_by, updated_by
        )
        VALUES ($1, $2, 'completion', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, 1, 'test', 'test')
      `,
      [active.id, id]
    );
  }

  return id;
}

async function insertCostCode(clientId, code, description) {
  await pool.query(
    `DELETE FROM cost_code_classifications WHERE client_id = $1 AND lower(cost_code_key) = lower($2)`,
    [clientId, code]
  );
  await pool.query(`DELETE FROM cost_codes WHERE client_id = $1 AND lower(code) = lower($2)`, [
    clientId,
    code,
  ]);
  const inserted = await pool.query(
    `
      INSERT INTO cost_codes (client_id, code, description, is_active, version)
      VALUES ($1, $2, $3, true, 1)
      RETURNING id, code
    `,
    [clientId, code, description]
  );
  trackCostCode(inserted.rows[0].id);
  return inserted.rows[0];
}

async function classifySelling(clientId, costCodeKey) {
  await pool.query(
    `DELETE FROM cost_code_classifications WHERE client_id = $1 AND lower(cost_code_key) = lower($2)`,
    [clientId, costCodeKey]
  );
  await pool.query(
    `
      INSERT INTO cost_code_classifications (
        client_id, cost_code_key, semantic_group, forecast_driver, version
      )
      VALUES ($1, $2, 'SELLING', 'STANDARD_CVR', 1)
    `,
    [clientId, costCodeKey]
  );
}

async function createDraftCvrInput(clientId, developmentId) {
  const period = await pool.query(
    `
      INSERT INTO cvr_periods (
        client_id, development_id, period_key, period_label, status, version
      )
      VALUES ($1, $2, 'P99', 'Period 99', 'draft', 1)
      RETURNING id
    `,
    [clientId, developmentId]
  );
  const periodId = period.rows[0].id;
  trackPeriod(periodId);
  const input = await pool.query(
    `
      INSERT INTO cvr_cost_code_inputs (
        client_id, period_id, cost_code_key, cost_code_label,
        commercial_adjustment, manual_accrual, version
      )
      VALUES ($1, $2, '5231', '5231 — Cleaning', 7720, 120, 2)
      RETURNING id, commercial_adjustment::float AS adj, manual_accrual::float AS accrual, version
    `,
    [clientId, periodId]
  );
  return { periodId, input: input.rows[0] };
}

if (!isDbConfigured()) {
  test("BL-034B selling costs routes skipped — TEST_DATABASE_URL not configured", () => {
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

  test("GET default 2.00% proposal without inserting settings", async () => {
    const active = await getActiveClient();
    assert.ok(active);
    const developmentId = await createDevelopment(active);
    await insertCostCode(active.id, "5400", "Selling Costs — General Allowance");
    await classifySelling(active.id, "5400");

    const res = await request(app).get(`/api/developments/${developmentId}/selling-costs`);
    assert.equal(res.status, 200);
    assert.equal(res.body.assumptionSource, "default");
    assert.equal(res.body.assumptionPercent, 2);
    assert.equal(res.body.forecastRevenue, KNOWN_FORECAST_REVENUE);
    assert.equal(res.body.forecastSellingCosts, KNOWN_DEFAULT_PROPOSAL);
    assert.equal(res.body.settings.exists, false);
    assert.equal(res.body.settings.version, 0);
    assert.equal(res.body.destination.status, "ready");
    assert.equal(res.body.destination.costCodeKey, "5400");

    const rows = await pool.query(
      `SELECT COUNT(*)::int AS n FROM development_selling_costs_settings WHERE development_id = $1`,
      [developmentId]
    );
    assert.equal(rows.rows[0].n, 0);
  });

  test("PUT saves user assumption and recalculates from live Forecast Revenue", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);

    const created = await request(app)
      .put(`/api/developments/${developmentId}/selling-costs`)
      .send({ version: 0, assumptionPercent: 1.75, actor: "qs-tester" });
    assert.equal(created.status, 201);
    assert.equal(created.body.assumptionSource, "user");
    assert.equal(created.body.assumptionPercent, 1.75);
    assert.equal(created.body.forecastSellingCosts, 182780.64);
    assert.equal(created.body.settings.version, 1);
    assert.equal(created.body.settings.updatedBy, "qs-tester");

    const again = await request(app).get(`/api/developments/${developmentId}/selling-costs`);
    assert.equal(again.body.assumptionSource, "user");
    assert.equal(again.body.assumptionPercent, 1.75);
  });

  test("rejects negative/malformed percent and version conflict", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);

    const negative = await request(app)
      .put(`/api/developments/${developmentId}/selling-costs`)
      .send({ version: 0, assumptionPercent: -1 });
    assert.equal(negative.status, 400);

    const bad = await request(app)
      .put(`/api/developments/${developmentId}/selling-costs`)
      .send({ version: 0, assumptionPercent: "nope" });
    assert.equal(bad.status, 400);

    const first = await request(app)
      .put(`/api/developments/${developmentId}/selling-costs`)
      .send({ version: 0, assumptionPercent: 2 });
    assert.equal(first.status, 201);

    const stale = await request(app)
      .put(`/api/developments/${developmentId}/selling-costs`)
      .send({ version: 0, assumptionPercent: 3 });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.proposal.settings.version, 1);
  });

  test("rejects 5405 as Simple destination; accepts configured 5400", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    await insertCostCode(active.id, "5405", "Sales Incentives");
    await insertCostCode(active.id, "5400", "Selling Costs — General Allowance");
    await classifySelling(active.id, "5400");

    const forbidden = await request(app)
      .put(`/api/developments/${developmentId}/selling-costs`)
      .send({ version: 0, assumptionPercent: 2, destinationCostCodeKey: "5405" });
    assert.equal(forbidden.status, 400);
    assert.match(String(forbidden.body.message || ""), /Sales Incentives|5405/i);

    const ok = await request(app)
      .put(`/api/developments/${developmentId}/selling-costs`)
      .send({ version: 0, assumptionPercent: 2, destinationCostCodeKey: "5400" });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.destination.costCodeKey, "5400");
    assert.equal(ok.body.destination.status, "ready");
  });

  test("Revenue unavailable when settings missing; no CVR side effects on save", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active, {
      withPlots: true,
      withRevenueSettings: false,
    });
    const { input } = await createDraftCvrInput(active.id, developmentId);

    const unavailable = await request(app).get(`/api/developments/${developmentId}/selling-costs`);
    assert.equal(unavailable.status, 200);
    assert.equal(unavailable.body.revenue.ready, false);
    assert.equal(unavailable.body.forecastSellingCosts, null);

    await pool.query(
      `
        INSERT INTO development_revenue_settings (
          client_id, development_id, recognition_policy, strategy, house_type_pricing,
          revenue_adjustments, recognition_settings, version
        )
        VALUES ($1, $2, 'completion', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, 1)
      `,
      [active.id, developmentId]
    );

    const saved = await request(app)
      .put(`/api/developments/${developmentId}/selling-costs`)
      .send({ version: 0, assumptionPercent: 2.5 });
    assert.equal(saved.status, 201);
    assert.equal(saved.body.forecastSellingCosts, 261115.2);

    const after = await pool.query(
      `
        SELECT commercial_adjustment::float AS adj, manual_accrual::float AS accrual, version
        FROM cvr_cost_code_inputs WHERE id = $1
      `,
      [input.id]
    );
    assert.equal(after.rows[0].adj, 7720);
    assert.equal(after.rows[0].accrual, 120);
    assert.equal(after.rows[0].version, 2);
  });

  test("tenant isolation: other client development is 404", async () => {
    const active = await getActiveClient();
    assert.ok(active);

    const other = await pool.query(
      `
        INSERT INTO clients (code, name, is_active)
        VALUES ($1, 'Other SC Tenant', false)
        RETURNING id
      `,
      [`SC-OTHER-${Date.now()}`]
    );
    trackTenant(other.rows[0].id);
    const foreignDev = `dev-sc-foreign-${Date.now()}`;
    await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, 'Foreign', 'live')
      `,
      [foreignDev, other.rows[0].id, `F-${foreignDev}`]
    );
    trackDevelopment(foreignDev);

    const res = await request(app).get(`/api/developments/${foreignDev}/selling-costs`);
    assert.equal(res.status, 404);
  });

  test("rejects detailed mode in BL-034B", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    const res = await request(app)
      .put(`/api/developments/${developmentId}/selling-costs`)
      .send({ version: 0, assumptionPercent: 2, mode: "detailed" });
    assert.equal(res.status, 400);
  });
}
