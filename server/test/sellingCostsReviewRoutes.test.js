/**
 * BL-034C — Read-only Selling Costs Review against CVR (buildlite_test only).
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
const {
  SELLING_COSTS_REVIEW_STATES,
  SELLING_COSTS_REVIEW_BLOCK_CODES,
  SELLING_COSTS_ADOPTION_METADATA_KEY,
  buildProposalFingerprint,
  buildSellingCostsAdoptionMetadata,
} = require("../services/sellingCostsAdoptionCompare");

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
const KNOWN_PROPOSAL = 182780.64;

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
    await pool.query(`DELETE FROM cvr_period_audit WHERE period_id = ANY($1::uuid[])`, [
      testPeriodIds,
    ]);
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
    await pool.query(
      `DELETE FROM cvr_period_audit WHERE period_id IN (
         SELECT id FROM cvr_periods WHERE development_id = ANY($1::text[])
       )`,
      [testDevelopmentIds]
    );
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
  if (testCostCodeIds.length) {
    await pool.query(`DELETE FROM cost_codes WHERE id = ANY($1::uuid[])`, [testCostCodeIds]);
  }
  if (testTenantIds.length) {
    await pool.query(`DELETE FROM cost_code_classifications WHERE client_id = ANY($1::uuid[])`, [
      testTenantIds,
    ]);
    await pool.query(`DELETE FROM cost_codes WHERE client_id = ANY($1::uuid[])`, [testTenantIds]);
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

async function createDevelopment(active, { withRevenueSettings = true } = {}) {
  const id = `dev-sc-rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const payload = {
    plotMaster: {
      plots: [
        {
          id: "plot-sc-rev-1",
          plotNumber: "1",
          revenueStatus: "Available",
          revenueSource: "Manual Value",
          manualForecastValue: KNOWN_FORECAST_REVENUE,
          sellingPrice: 0,
        },
      ],
    },
  };
  await pool.query(
    `
      INSERT INTO developments (id, client_id, job_number, development_name, status, payload)
      VALUES ($1, $2, $3, $4, 'live', $5::jsonb)
    `,
    [id, active.id, `SCREV-${id}`, "Selling Costs review test", JSON.stringify(payload)]
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

async function insertCostCode(clientId, code, description, { active = true } = {}) {
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
      VALUES ($1, $2, $3, $4, 1)
      RETURNING id, code
    `,
    [clientId, code, description, active]
  );
  trackCostCode(inserted.rows[0].id);
  return inserted.rows[0];
}

async function classify(clientId, costCodeKey, semanticGroup = "SELLING") {
  await pool.query(
    `DELETE FROM cost_code_classifications WHERE client_id = $1 AND lower(cost_code_key) = lower($2)`,
    [clientId, costCodeKey]
  );
  await pool.query(
    `
      INSERT INTO cost_code_classifications (
        client_id, cost_code_key, semantic_group, forecast_driver, version
      )
      VALUES ($1, $2, $3, 'STANDARD_CVR', 1)
    `,
    [clientId, costCodeKey, semanticGroup]
  );
}

async function saveAssumption(developmentId, percent = 1.75) {
  const res = await request(app)
    .put(`/api/developments/${developmentId}/selling-costs`)
    .send({ version: 0, assumptionPercent: percent, actor: "qs-tester" });
  assert.equal(res.status, 201, res.body?.message || JSON.stringify(res.body));
  return res.body;
}

async function createDraftPeriod(clientId, developmentId, { reportingMonth = "2026-08-01" } = {}) {
  const period = await pool.query(
    `
      INSERT INTO cvr_periods (
        client_id, development_id, period_key, period_label, status, version, reporting_month
      )
      VALUES ($1, $2, 'P04', 'Period 04', 'draft', 1, $3::date)
      RETURNING id
    `,
    [clientId, developmentId, reportingMonth]
  );
  const periodId = period.rows[0].id;
  trackPeriod(periodId);
  return periodId;
}

async function addMember(
  clientId,
  periodId,
  costCodeKey,
  {
    originalBudget = null,
    currentBudget = null,
    commercialAdjustment = 0,
    manualAccrual = 0,
    displayMetadata = {},
  } = {}
) {
  const inserted = await pool.query(
    `
      INSERT INTO cvr_cost_code_inputs (
        client_id, period_id, cost_code_key, cost_code_label,
        original_budget, current_budget, commercial_adjustment, manual_accrual,
        display_metadata, version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 1)
      RETURNING id, version
    `,
    [
      clientId,
      periodId,
      costCodeKey,
      `${costCodeKey} — Selling Costs — General Allowance`,
      originalBudget,
      currentBudget,
      commercialAdjustment,
      manualAccrual,
      JSON.stringify(displayMetadata),
    ]
  );
  return inserted.rows[0];
}

async function snapshotState(developmentId, periodId) {
  const [settings, members, period, snapshots, p05, audits] = await Promise.all([
    pool.query(
      `SELECT version, assumption_percent::float AS pct FROM development_selling_costs_settings WHERE development_id = $1`,
      [developmentId]
    ),
    pool.query(
      `SELECT cost_code_key, commercial_adjustment::float AS adj, manual_accrual::float AS accrual,
              original_budget, current_budget, version, display_metadata
         FROM cvr_cost_code_inputs WHERE period_id = $1 ORDER BY cost_code_key`,
      [periodId]
    ),
    pool.query(`SELECT status, version FROM cvr_periods WHERE id = $1`, [periodId]),
    pool.query(`SELECT COUNT(*)::int AS n FROM cvr_period_snapshots WHERE development_id = $1`, [
      developmentId,
    ]),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM cvr_periods WHERE development_id = $1 AND period_key = 'P05'`,
      [developmentId]
    ),
    pool.query(`SELECT COUNT(*)::int AS n FROM cvr_period_audit WHERE period_id = $1`, [periodId]),
  ]);
  return {
    settings: settings.rows[0] || null,
    members: members.rows,
    period: period.rows[0],
    snapshotCount: snapshots.rows[0].n,
    p05Count: p05.rows[0].n,
    auditCount: audits.rows[0].n,
  };
}

if (!isDbConfigured()) {
  test("BL-034C selling costs review routes skipped — TEST_DATABASE_URL not configured", () => {
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

  test("POST/PUT/PATCH/DELETE selling-costs/review are not available", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    const base = `/api/developments/${developmentId}/selling-costs/review`;
    assert.equal((await request(app).post(base).send({})).status, 404);
    assert.equal((await request(app).put(base).send({})).status, 404);
    assert.equal((await request(app).patch(base).send({})).status, 404);
    assert.equal((await request(app).delete(base)).status, 404);
  });

  test("GET review returns Simple-mode comparison without writes", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    await insertCostCode(active.id, "5400", "Selling Costs — General Allowance");
    await classify(active.id, "5400");
    await saveAssumption(developmentId, 1.75);
    const periodId = await createDraftPeriod(active.id, developmentId);
    await addMember(active.id, periodId, "5400");

    const before = await snapshotState(developmentId, periodId);
    const res = await request(app).get(`/api/developments/${developmentId}/selling-costs/review`);
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.readOnly, true);
    assert.equal(res.body.canAdopt, false);
    assert.equal(res.body.reviewStatus, "ready");
    assert.equal(res.body.reviewState, SELLING_COSTS_REVIEW_STATES.NOT_ADOPTED);
    assert.equal(res.body.proposal.forecastRevenue, KNOWN_FORECAST_REVENUE);
    assert.equal(res.body.proposal.forecastSellingCosts, KNOWN_PROPOSAL);
    assert.equal(res.body.proposal.assumptionPercent, 1.75);
    assert.equal(res.body.destination.costCodeKey, "5400");
    assert.equal(res.body.comparison.systemForecast, 0);
    assert.equal(res.body.comparison.currentAdjustment, 0);
    assert.equal(res.body.comparison.currentFinalForecast, 0);
    assert.equal(res.body.comparison.proposedReplacementAdjustment, KNOWN_PROPOSAL);
    assert.equal(res.body.comparison.proposedFinalForecast, KNOWN_PROPOSAL);
    assert.equal(res.body.comparison.resultingMovement, KNOWN_PROPOSAL);
    assert.equal(res.body.comparison.currentAccrual, 0);
    assert.match(String(res.body.headline || ""), /proposes £182,780\.64/);
    assert.equal(res.body.comparison.adoptionMetadata, null);

    const after = await snapshotState(developmentId, periodId);
    assert.deepEqual(after, before);
    assert.equal(after.p05Count, 0);
    assert.equal(after.snapshotCount, 0);
    assert.equal(after.members.length, 1);
    assert.equal(after.settings.pct, 1.75);
  });

  test("GET review uses replacement maths when a current adjustment exists", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    await insertCostCode(active.id, "5400", "Selling Costs — General Allowance");
    await classify(active.id, "5400");
    await saveAssumption(developmentId, 1.75);
    const periodId = await createDraftPeriod(active.id, developmentId);
    await addMember(active.id, periodId, "5400", { commercialAdjustment: 5000 });

    const res = await request(app).get(`/api/developments/${developmentId}/selling-costs/review`);
    assert.equal(res.status, 200);
    assert.equal(res.body.comparison.currentAdjustment, 5000);
    assert.equal(res.body.comparison.currentFinalForecast, 5000);
    assert.equal(res.body.comparison.proposedReplacementAdjustment, KNOWN_PROPOSAL);
    assert.equal(res.body.comparison.proposedFinalForecast, KNOWN_PROPOSAL);
    assert.equal(res.body.comparison.resultingMovement, 177780.64);
  });

  test("GET review warns when proposal is below system forecast", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    await insertCostCode(active.id, "5400", "Selling Costs — General Allowance");
    await classify(active.id, "5400");
    await saveAssumption(developmentId, 1.75);
    const periodId = await createDraftPeriod(active.id, developmentId);
    await addMember(active.id, periodId, "5400", {
      originalBudget: 200000,
      currentBudget: 200000,
    });

    const res = await request(app).get(`/api/developments/${developmentId}/selling-costs/review`);
    assert.equal(res.status, 200);
    assert.equal(res.body.comparison.systemForecast, 200000);
    assert.equal(res.body.comparison.proposedReplacementAdjustment, -17219.36);
    assert.equal(res.body.comparison.flags.proposalBelowSystem, true);
    assert.equal(res.body.reviewState, SELLING_COSTS_REVIEW_STATES.NOT_ADOPTED);
  });

  test("GET review blocks when destination is missing from CVR and does not add membership", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    await insertCostCode(active.id, "5400", "Selling Costs — General Allowance");
    await classify(active.id, "5400");
    await saveAssumption(developmentId, 1.75);
    const periodId = await createDraftPeriod(active.id, developmentId);

    const before = await snapshotState(developmentId, periodId);
    const res = await request(app).get(`/api/developments/${developmentId}/selling-costs/review`);
    assert.equal(res.status, 200);
    assert.equal(res.body.reviewStatus, "blocked");
    assert.equal(
      res.body.blockedReason.code,
      SELLING_COSTS_REVIEW_BLOCK_CODES.DESTINATION_NOT_ON_CVR
    );
    assert.equal(res.body.canAdopt, false);
    assert.equal(res.body.comparison, null);

    const after = await snapshotState(developmentId, periodId);
    assert.equal(after.members.length, 0);
    assert.deepEqual(after, before);
  });

  test("GET review blocks inactive and missing destinations", async () => {
    const active = await getActiveClient();
    const inactiveDev = await createDevelopment(active);
    await insertCostCode(active.id, "5400", "Selling Costs — General Allowance", { active: false });
    await classify(active.id, "5400");
    const inactive = await request(app).get(
      `/api/developments/${inactiveDev}/selling-costs/review`
    );
    assert.equal(inactive.status, 200);
    assert.equal(inactive.body.reviewStatus, "blocked");
    assert.equal(
      inactive.body.blockedReason.code,
      SELLING_COSTS_REVIEW_BLOCK_CODES.DESTINATION_INACTIVE
    );

    const missingDev = await createDevelopment(active);
    await pool.query(`DELETE FROM cost_codes WHERE client_id = $1 AND lower(code) = '5400'`, [
      active.id,
    ]);
    const missing = await request(app).get(`/api/developments/${missingDev}/selling-costs/review`);
    assert.equal(missing.status, 200);
    assert.equal(missing.body.reviewStatus, "blocked");
    assert.equal(
      missing.body.blockedReason.code,
      SELLING_COSTS_REVIEW_BLOCK_CODES.DESTINATION_MISSING
    );
  });

  test("GET review coincidental equality without provenance is NOT ADOPTED", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    await insertCostCode(active.id, "5400", "Selling Costs — General Allowance");
    await classify(active.id, "5400");
    await saveAssumption(developmentId, 1.75);
    const periodId = await createDraftPeriod(active.id, developmentId);
    await addMember(active.id, periodId, "5400", { commercialAdjustment: KNOWN_PROPOSAL });

    const res = await request(app).get(`/api/developments/${developmentId}/selling-costs/review`);
    assert.equal(res.status, 200);
    assert.equal(res.body.reviewState, SELLING_COSTS_REVIEW_STATES.NOT_ADOPTED);
    assert.equal(res.body.comparison.coincidentalMatch, true);
    assert.equal(res.body.comparison.isUpToDate, false);
    assert.equal(res.body.comparison.adoptionMetadata, null);
  });

  test("GET review provenance states: up to date, drifted, superseded", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    await insertCostCode(active.id, "5400", "Selling Costs — General Allowance");
    await classify(active.id, "5400");
    await saveAssumption(developmentId, 1.75);
    const periodId = await createDraftPeriod(active.id, developmentId);

    const fingerprint = buildProposalFingerprint({
      developmentId,
      periodKey: "P04",
      reportingMonth: "2026-08-01",
      mode: "simple",
      assumptionPercent: 1.75,
      forecastRevenue: KNOWN_FORECAST_REVENUE,
      forecastSellingCosts: KNOWN_PROPOSAL,
      destinationCostCodeKey: "5400",
    });
    const metadata = buildSellingCostsAdoptionMetadata({
      adoptedTargetFinal: KNOWN_PROPOSAL,
      adoptedAdjustment: KNOWN_PROPOSAL,
      systemForecastAtAdoption: 0,
      previousFinalForecast: 0,
      previousAdjustment: 0,
      proposalFingerprint: fingerprint,
      assumptionPercent: 1.75,
      forecastRevenueUsed: KNOWN_FORECAST_REVENUE,
      destinationCostCodeKey: "5400",
      settingsVersion: 1,
      reportingMonth: "2026-08",
      periodKey: "P04",
    });

    await addMember(active.id, periodId, "5400", {
      commercialAdjustment: KNOWN_PROPOSAL,
      displayMetadata: { [SELLING_COSTS_ADOPTION_METADATA_KEY]: metadata },
    });

    const upToDate = await request(app).get(
      `/api/developments/${developmentId}/selling-costs/review`
    );
    assert.equal(upToDate.status, 200, upToDate.body?.message || JSON.stringify(upToDate.body));
    assert.equal(upToDate.body.reviewState, SELLING_COSTS_REVIEW_STATES.UP_TO_DATE);
    assert.equal(upToDate.body.comparison.isUpToDate, true);

    await pool.query(
      `
        UPDATE development_selling_costs_settings
           SET assumption_percent = 2.00, version = version + 1
         WHERE development_id = $1
      `,
      [developmentId]
    );
    const drifted = await request(app).get(
      `/api/developments/${developmentId}/selling-costs/review`
    );
    assert.equal(drifted.status, 200);
    assert.equal(drifted.body.reviewState, SELLING_COSTS_REVIEW_STATES.DRIFTED);

    await pool.query(
      `
        UPDATE development_selling_costs_settings
           SET assumption_percent = 1.75, version = version + 1
         WHERE development_id = $1
      `,
      [developmentId]
    );
    await pool.query(
      `
        UPDATE cvr_cost_code_inputs
           SET commercial_adjustment = 50000
         WHERE period_id = $1 AND cost_code_key = '5400'
      `,
      [periodId]
    );
    const superseded = await request(app).get(
      `/api/developments/${developmentId}/selling-costs/review`
    );
    assert.equal(superseded.status, 200);
    assert.equal(superseded.body.reviewState, SELLING_COSTS_REVIEW_STATES.SUPERSEDED);
  });
}
