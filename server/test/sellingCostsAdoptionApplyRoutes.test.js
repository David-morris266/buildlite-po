/**
 * BL-034D — Selling Costs → Draft CVR adoption (buildlite_test only).
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
  SELLING_COSTS_ADOPTION_METADATA_KEY,
} = require("../services/sellingCostsAdoptionCompare");
const {
  SELLING_COSTS_ADOPTION_ERROR_CODES,
} = require("../services/sellingCostsAdoptionApplyService");

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

async function createDevelopment(active) {
  const id = `dev-sc-adopt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const payload = {
    plotMaster: {
      plots: [
        {
          id: "plot-sc-adopt-1",
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
    [id, active.id, `SCADOPT-${id}`, "Selling Costs adopt test", JSON.stringify(payload)]
  );
  trackDevelopment(id);
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

async function createDraftPeriod(clientId, developmentId, { reportingMonth = "2026-08-01", status = "draft" } = {}) {
  const period = await pool.query(
    `
      INSERT INTO cvr_periods (
        client_id, development_id, period_key, period_label, status, version, reporting_month
      )
      VALUES ($1, $2, 'P04', 'Period 04', $4, 1, $3::date)
      RETURNING id
    `,
    [clientId, developmentId, reportingMonth, status]
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
    adjustmentReason = "",
  } = {}
) {
  const inserted = await pool.query(
    `
      INSERT INTO cvr_cost_code_inputs (
        client_id, period_id, cost_code_key, cost_code_label,
        original_budget, current_budget, commercial_adjustment, adjustment_reason,
        manual_accrual, display_metadata, version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 1)
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
      adjustmentReason,
      manualAccrual,
      JSON.stringify(displayMetadata),
    ]
  );
  return inserted.rows[0];
}

async function snapshotState(developmentId, periodId) {
  const [settings, members, period, snapshots, p05, audits, ledger] = await Promise.all([
    pool.query(
      `SELECT version, assumption_percent::float AS pct, mode FROM development_selling_costs_settings WHERE development_id = $1`,
      [developmentId]
    ),
    pool.query(
      `SELECT id, cost_code_key, commercial_adjustment::float AS adj, manual_accrual::float AS accrual,
              original_budget, current_budget, version, display_metadata, adjustment_reason
         FROM cvr_cost_code_inputs WHERE period_id = $1 ORDER BY cost_code_key`,
      [periodId]
    ),
    pool.query(
      `SELECT status, version, reporting_month::text, updated_at::text FROM cvr_periods WHERE id = $1`,
      [periodId]
    ),
    pool.query(`SELECT COUNT(*)::int AS n FROM cvr_period_snapshots WHERE development_id = $1`, [
      developmentId,
    ]),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM cvr_periods WHERE development_id = $1 AND period_key = 'P05'`,
      [developmentId]
    ),
    pool.query(
      `SELECT action, comment FROM cvr_period_audit WHERE period_id = $1 ORDER BY created_at, action`,
      [periodId]
    ),
    pool.query(`SELECT COUNT(*)::int AS n FROM ledger_transactions WHERE development_id = $1`, [
      developmentId,
    ]),
  ]);
  return {
    settings: settings.rows[0] || null,
    members: members.rows,
    period: period.rows[0],
    snapshotCount: snapshots.rows[0].n,
    p05Count: p05.rows[0].n,
    audits: audits.rows,
    ledgerCount: ledger.rows[0].n,
  };
}

async function loadReview(developmentId) {
  const res = await request(app).get(`/api/developments/${developmentId}/selling-costs/review`);
  assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
  return res.body;
}

function intentFromReview(preview, extras = {}) {
  return {
    expectedPeriodKey: preview.periodKey,
    expectedReportingMonth: preview.reportingMonth,
    expectedSettingsVersion: Number(preview.proposal?.settings?.version) || 0,
    proposedAdjustment: 999999,
    proposedFinal: 1,
    forecastRevenue: 1,
    assumptionPercent: 99,
    selections: [
      {
        destinationCostCodeKey: preview.comparison.costCodeKey,
        proposalFingerprint: preview.comparison.proposalFingerprint,
        expectedInputVersion: preview.comparison.inputVersion,
        expectedSystemForecast: preview.comparison.systemForecast,
        expectedCurrentAdjustment: preview.comparison.currentAdjustment,
        proposedAdjustment: 999999,
        proposedFinal: 1,
        forecastSellingCosts: 1,
        ...extras,
      },
    ],
  };
}

/** Exact browser POST shape from buildAdoptionIntentPayload + withActor. */
function exactClientIntentFromReview(preview) {
  const comparison = preview?.comparison || {};
  return {
    expectedPeriodKey: preview.periodKey,
    expectedReportingMonth: preview.reportingMonth,
    expectedSettingsVersion: Number(preview.proposal?.settings?.version) || 0,
    actor: "Commercial Manager",
    selections: [
      {
        destinationCostCodeKey: comparison.costCodeKey || preview.destination?.costCodeKey,
        proposalFingerprint: comparison.proposalFingerprint,
        expectedInputVersion: comparison.inputVersion,
        expectedSystemForecast: comparison.systemForecast,
        expectedCurrentAdjustment: comparison.currentAdjustment,
        acknowledgeSupersededAdjustment: false,
        acknowledgeProposalBelowSystem: false,
      },
    ],
  };
}

async function withStarvedPool(fn) {
  const previousTimeout = pool.options.connectionTimeoutMillis;
  const max = Number(pool.options.max) || 10;
  const holders = [];
  pool.options.connectionTimeoutMillis = 1500;
  try {
    for (let i = 0; i < max - 1; i += 1) {
      holders.push(await pool.connect());
    }
    return await fn();
  } finally {
    pool.options.connectionTimeoutMillis = previousTimeout;
    for (const holder of holders) {
      try {
        holder.release();
      } catch {
        // ignore
      }
    }
  }
}

async function postAdopt(developmentId, body) {
  return request(app).post(`/api/developments/${developmentId}/selling-costs/adoption`).send(body);
}

async function seedReadySite(
  active,
  {
    originalBudget = null,
    currentBudget = null,
    commercialAdjustment = 0,
    manualAccrual = 0,
    displayMetadata = {},
    adjustmentReason = "",
  } = {}
) {
  const developmentId = await createDevelopment(active);
  await insertCostCode(active.id, "5400", "Selling Costs — General Allowance");
  await classify(active.id, "5400");
  await saveAssumption(developmentId, 1.75);
  const periodId = await createDraftPeriod(active.id, developmentId);
  const member = await addMember(active.id, periodId, "5400", {
    originalBudget,
    currentBudget,
    commercialAdjustment,
    manualAccrual,
    displayMetadata,
    adjustmentReason,
  });
  return { developmentId, periodId, member };
}

if (!isDbConfigured()) {
  test("BL-034D selling costs adoption routes skipped — TEST_DATABASE_URL not configured", () => {
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

  test("happy path: system 0, replacement = proposal, provenance/history/audit", async () => {
    const active = await getActiveClient();
    const { developmentId, periodId } = await seedReadySite(active, { manualAccrual: 0 });
    const before = await snapshotState(developmentId, periodId);
    const preview = await loadReview(developmentId);
    const res = await postAdopt(developmentId, intentFromReview(preview));
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.adopted.length, 1);
    assert.equal(res.body.unchanged.length, 0);
    const adopted = res.body.adopted[0];
    assert.equal(adopted.oldAdjustment, 0);
    assert.equal(adopted.newAdjustment, KNOWN_PROPOSAL);
    assert.equal(adopted.oldFinal, 0);
    assert.equal(adopted.newFinal, KNOWN_PROPOSAL);
    assert.equal(adopted.inputVersion, 2);
    assert.equal(adopted.manualAccrual, 0);
    assert.equal(adopted.newReason, "Selling Costs forecast adopted — 2026-08");

    const after = await snapshotState(developmentId, periodId);
    const row = after.members[0];
    assert.equal(Number(row.adj), KNOWN_PROPOSAL);
    assert.equal(Number(row.accrual), 0);
    assert.equal(row.original_budget, null);
    assert.equal(row.current_budget, null);
    assert.equal(row.version, 2);
    const meta = row.display_metadata[SELLING_COSTS_ADOPTION_METADATA_KEY];
    assert.equal(meta.mode, "simple");
    assert.equal(meta.assumptionPercent, 1.75);
    assert.equal(meta.forecastRevenueAtAdoption, KNOWN_FORECAST_REVENUE);
    assert.equal(meta.adoptedTargetFinal, KNOWN_PROPOSAL);
    assert.equal(meta.adoptedAdjustment, KNOWN_PROPOSAL);
    assert.equal(meta.systemForecastAtAdoption, 0);
    assert.equal(meta.previousAdjustment, 0);
    assert.equal(meta.previousFinalForecast, 0);
    assert.equal(meta.destinationCostCodeKey, "5400");
    assert.equal(meta.settingsVersion, 1);
    assert.equal(meta.reportingMonth, "2026-08");
    assert.equal(meta.periodKey, "P04");
    assert.equal(meta.superseded, false);
    assert.equal(meta.inputVersionAtAdoption, 1);
    assert.ok(meta.proposalFingerprint);
    assert.ok(Array.isArray(row.display_metadata.adjustmentHistory));
    assert.equal(row.display_metadata.adjustmentHistory.length, 1);
    assert.equal(row.display_metadata.adjustmentHistory[0].source, "selling_costs_adoption");
    assert.equal(row.display_metadata.adjustmentHistory[0].previousAdjustment, 0);
    assert.equal(row.display_metadata.adjustmentHistory[0].newAdjustment, KNOWN_PROPOSAL);

    const adoptAudits = after.audits.filter((item) => item.action === "selling_costs_adopted");
    assert.equal(adoptAudits.length, 1);
    assert.equal(after.period.status, "draft");
    assert.equal(after.period.version, 1);
    assert.equal(after.period.updated_at, before.period.updated_at);
    assert.equal(after.snapshotCount, 0);
    assert.equal(after.p05Count, 0);
    assert.equal(after.settings.pct, 1.75);
    assert.equal(after.ledgerCount, before.ledgerCount);

    const refreshed = await loadReview(developmentId);
    assert.equal(refreshed.reviewState, "up_to_date");
    assert.equal(refreshed.canAdopt, true);
  });

  test("GET Review then exact client POST still adopts when the pool has only the adoption client left", async () => {
    const active = await getActiveClient();
    const { developmentId, periodId } = await seedReadySite(active);
    const preview = await loadReview(developmentId);
    const payload = exactClientIntentFromReview(preview);
    const res = await withStarvedPool(() => postAdopt(developmentId, payload));
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.adopted.length, 1);
    assert.equal(res.body.adopted[0].newAdjustment, KNOWN_PROPOSAL);
    const after = await snapshotState(developmentId, periodId);
    assert.equal(Number(after.members[0].adj), KNOWN_PROPOSAL);
    assert.equal(after.members[0].version, 2);
    assert.equal(
      after.audits.filter((item) => item.action === "selling_costs_adopted").length,
      1
    );
  });

  test("GET Review then exact client POST still adopts when the development has more than one CVR period", async () => {
    const active = await getActiveClient();
    const { developmentId, periodId } = await seedReadySite(active);
    const prior = await pool.query(
      `
        INSERT INTO cvr_periods (
          client_id, development_id, period_key, period_label, status, version, reporting_month,
          submitted_at, submitted_by, approved_at, approved_by
        )
        VALUES (
          $1, $2, 'P01', 'Period 01', 'locked', 1, '2026-05-01'::date,
          NOW(), 'test', NOW(), 'test'
        )
        RETURNING id
      `,
      [active.id, developmentId]
    );
    trackPeriod(prior.rows[0].id);
    const periodCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cvr_periods WHERE development_id = $1`,
      [developmentId]
    );
    assert.equal(periodCount.rows[0].n, 2);
    const preview = await loadReview(developmentId);
    const payload = exactClientIntentFromReview(preview);
    const res = await postAdopt(developmentId, payload);
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.adopted.length, 1);
    assert.equal(res.body.adopted[0].newAdjustment, KNOWN_PROPOSAL);
    const after = await snapshotState(developmentId, periodId);
    assert.equal(Number(after.members[0].adj), KNOWN_PROPOSAL);
    assert.equal(after.members[0].version, 2);
  });

  test("existing budget/system £150k yields replacement +£32,780.64", async () => {
    const active = await getActiveClient();
    const { developmentId } = await seedReadySite(active, {
      originalBudget: 150000,
      currentBudget: 150000,
    });
    const preview = await loadReview(developmentId);
    assert.equal(preview.comparison.systemForecast, 150000);
    const res = await postAdopt(developmentId, intentFromReview(preview));
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.adopted[0].newAdjustment, 32780.64);
    assert.equal(res.body.adopted[0].newFinal, KNOWN_PROPOSAL);
  });

  test("system £200k negative replacement requires ack then writes", async () => {
    const active = await getActiveClient();
    const { developmentId, periodId } = await seedReadySite(active, {
      originalBudget: 200000,
      currentBudget: 200000,
    });
    const preview = await loadReview(developmentId);
    assert.equal(preview.comparison.proposedReplacementAdjustment, -17219.36);
    const denied = await postAdopt(developmentId, intentFromReview(preview));
    assert.equal(denied.status, 400);
    assert.equal(
      denied.body.code,
      SELLING_COSTS_ADOPTION_ERROR_CODES.BELOW_SYSTEM_ACK_REQUIRED
    );
    const allowed = await postAdopt(
      developmentId,
      intentFromReview(preview, { acknowledgeProposalBelowSystem: true })
    );
    assert.equal(allowed.status, 200, allowed.body?.message || JSON.stringify(allowed.body));
    assert.equal(allowed.body.adopted[0].newAdjustment, -17219.36);
    const after = await snapshotState(developmentId, periodId);
    assert.equal(Number(after.members[0].current_budget), 200000);
    assert.equal(Number(after.members[0].original_budget), 200000);
  });

  test("accrual, budget, system forecast, commitment and actual stay closed", async () => {
    const active = await getActiveClient();
    const { developmentId, periodId } = await seedReadySite(active, {
      originalBudget: 150000,
      currentBudget: 150000,
      manualAccrual: 120,
      commercialAdjustment: 10,
      adjustmentReason: "prior QS",
    });
    const before = await snapshotState(developmentId, periodId);
    const preview = await loadReview(developmentId);
    const res = await postAdopt(developmentId, intentFromReview(preview));
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    const after = await snapshotState(developmentId, periodId);
    assert.equal(Number(after.members[0].accrual), 120);
    assert.equal(Number(after.members[0].original_budget), 150000);
    assert.equal(Number(after.members[0].current_budget), 150000);
    assert.equal(after.ledgerCount, before.ledgerCount);
    assert.equal(after.settings.pct, before.settings.pct);
    assert.equal(after.settings.version, before.settings.version);
    const refreshed = await loadReview(developmentId);
    assert.equal(refreshed.comparison.systemForecast, 150000);
  });

  test("missing CVR destination is rejected and does not create membership", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    await insertCostCode(active.id, "5400", "Selling Costs — General Allowance");
    await classify(active.id, "5400");
    await saveAssumption(developmentId, 1.75);
    const periodId = await createDraftPeriod(active.id, developmentId);
    const preview = await loadReview(developmentId);
    assert.equal(preview.reviewStatus, "blocked");
    const res = await postAdopt(developmentId, {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      expectedSettingsVersion: preview.proposal.settings.version,
      selections: [
        {
          destinationCostCodeKey: "5400",
          proposalFingerprint: "stale",
          expectedInputVersion: 1,
          expectedSystemForecast: 0,
          expectedCurrentAdjustment: 0,
        },
      ],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, SELLING_COSTS_ADOPTION_ERROR_CODES.DESTINATION_NOT_ON_CVR);
    const after = await snapshotState(developmentId, periodId);
    assert.equal(after.members.length, 0);
  });

  test("invalid/inactive destination is rejected", async () => {
    const active = await getActiveClient();
    const { developmentId, periodId, member } = await seedReadySite(active);
    await pool.query(`UPDATE cost_codes SET is_active = false WHERE id = $1`, [
      (await pool.query(`SELECT id FROM cost_codes WHERE client_id = $1 AND code = '5400'`, [
        active.id,
      ])).rows[0].id,
    ]);
    const preview = await request(app).get(`/api/developments/${developmentId}/selling-costs/review`);
    assert.equal(preview.status, 200);
    const res = await postAdopt(developmentId, {
      expectedPeriodKey: "P04",
      expectedReportingMonth: "2026-08",
      expectedSettingsVersion: 1,
      selections: [
        {
          destinationCostCodeKey: "5400",
          proposalFingerprint: "x",
          expectedInputVersion: member.version,
          expectedSystemForecast: 0,
          expectedCurrentAdjustment: 0,
        },
      ],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, SELLING_COSTS_ADOPTION_ERROR_CODES.DESTINATION_INVALID);
    const after = await snapshotState(developmentId, periodId);
    assert.equal(Number(after.members[0].adj), 0);
    assert.equal(after.members[0].version, 1);
  });

  test("period not Draft is rejected", async () => {
    const active = await getActiveClient();
    const { developmentId, periodId } = await seedReadySite(active);
    const preview = await loadReview(developmentId);
    await pool.query(
      `UPDATE cvr_periods SET status = 'submitted', submitted_at = NOW(), submitted_by = 'QS' WHERE id = $1`,
      [periodId]
    );
    const res = await postAdopt(developmentId, intentFromReview(preview));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, SELLING_COSTS_ADOPTION_ERROR_CODES.PERIOD_NOT_DRAFT);
  });

  test("reporting month drift is rejected", async () => {
    const active = await getActiveClient();
    const { developmentId } = await seedReadySite(active);
    const preview = await loadReview(developmentId);
    const body = intentFromReview(preview);
    body.expectedReportingMonth = "2026-07";
    const res = await postAdopt(developmentId, body);
    assert.equal(res.status, 409);
    assert.equal(res.body.code, SELLING_COSTS_ADOPTION_ERROR_CODES.REPORTING_MONTH_CHANGED);
  });

  test("settings version drift is rejected", async () => {
    const active = await getActiveClient();
    const { developmentId } = await seedReadySite(active);
    const preview = await loadReview(developmentId);
    const body = intentFromReview(preview);
    body.expectedSettingsVersion = 99;
    const res = await postAdopt(developmentId, body);
    assert.equal(res.status, 409);
    assert.equal(res.body.code, SELLING_COSTS_ADOPTION_ERROR_CODES.SELLING_COSTS_SETTINGS_CHANGED);
  });

  test("proposal fingerprint drift is rejected", async () => {
    const active = await getActiveClient();
    const { developmentId } = await seedReadySite(active);
    const preview = await loadReview(developmentId);
    const res = await postAdopt(
      developmentId,
      intentFromReview(preview, { proposalFingerprint: "bl034c-stale" })
    );
    assert.equal(res.status, 409);
    assert.equal(res.body.code, SELLING_COSTS_ADOPTION_ERROR_CODES.SELLING_COSTS_PROPOSAL_STALE);
  });

  test("input version conflict is rejected", async () => {
    const active = await getActiveClient();
    const { developmentId } = await seedReadySite(active);
    const preview = await loadReview(developmentId);
    const res = await postAdopt(
      developmentId,
      intentFromReview(preview, { expectedInputVersion: 99 })
    );
    assert.equal(res.status, 409);
    assert.equal(res.body.code, SELLING_COSTS_ADOPTION_ERROR_CODES.CVR_INPUT_CONFLICT);
  });

  test("system forecast drift is rejected", async () => {
    const active = await getActiveClient();
    const { developmentId } = await seedReadySite(active);
    const preview = await loadReview(developmentId);
    const res = await postAdopt(
      developmentId,
      intentFromReview(preview, { expectedSystemForecast: 1 })
    );
    assert.equal(res.status, 409);
    assert.equal(res.body.code, SELLING_COSTS_ADOPTION_ERROR_CODES.SYSTEM_FORECAST_DRIFT);
  });

  test("current adjustment drift is rejected", async () => {
    const active = await getActiveClient();
    const { developmentId } = await seedReadySite(active);
    const preview = await loadReview(developmentId);
    const res = await postAdopt(
      developmentId,
      intentFromReview(preview, { expectedCurrentAdjustment: 99 })
    );
    assert.equal(res.status, 409);
    assert.equal(res.body.code, SELLING_COSTS_ADOPTION_ERROR_CODES.CURRENT_ADJUSTMENT_DRIFT);
  });

  test("superseded acknowledgement is required then re-adoption replaces", async () => {
    const active = await getActiveClient();
    const { developmentId, periodId } = await seedReadySite(active);
    const firstPreview = await loadReview(developmentId);
    const first = await postAdopt(developmentId, intentFromReview(firstPreview));
    assert.equal(first.status, 200);
    await pool.query(
      `UPDATE cvr_cost_code_inputs SET commercial_adjustment = 50 WHERE period_id = $1 AND cost_code_key = '5400'`,
      [periodId]
    );
    const preview = await loadReview(developmentId);
    assert.equal(preview.reviewState, "superseded");
    const denied = await postAdopt(developmentId, intentFromReview(preview));
    assert.equal(denied.status, 400);
    assert.equal(denied.body.code, SELLING_COSTS_ADOPTION_ERROR_CODES.SUPERSEDED_ACK_REQUIRED);
    const allowed = await postAdopt(
      developmentId,
      intentFromReview(preview, { acknowledgeSupersededAdjustment: true })
    );
    assert.equal(allowed.status, 200, allowed.body?.message || JSON.stringify(allowed.body));
    const after = await snapshotState(developmentId, periodId);
    assert.equal(Number(after.members[0].adj), KNOWN_PROPOSAL);
    assert.equal(after.members[0].display_metadata.adjustmentHistory.length, 2);
    assert.equal(after.members[0].display_metadata.sellingCostsAdoption.previousAdjustment, 50);
    assert.equal(after.members[0].display_metadata.sellingCostsAdoption.superseded, false);
  });

  test("already up to date does not bump version or duplicate history/audit", async () => {
    const active = await getActiveClient();
    const { developmentId, periodId } = await seedReadySite(active);
    const firstPreview = await loadReview(developmentId);
    const first = await postAdopt(developmentId, intentFromReview(firstPreview));
    assert.equal(first.status, 200);
    const afterFirst = await snapshotState(developmentId, periodId);
    const secondPreview = await loadReview(developmentId);
    assert.equal(secondPreview.reviewState, "up_to_date");
    const second = await postAdopt(developmentId, intentFromReview(secondPreview));
    assert.equal(second.status, 200, second.body?.message || JSON.stringify(second.body));
    assert.equal(second.body.adopted.length, 0);
    assert.equal(second.body.unchanged.length, 1);
    assert.equal(second.body.unchanged[0].result, "already_up_to_date");
    const after = await snapshotState(developmentId, periodId);
    assert.equal(after.members[0].version, afterFirst.members[0].version);
    assert.equal(
      after.members[0].display_metadata.adjustmentHistory.length,
      afterFirst.members[0].display_metadata.adjustmentHistory.length
    );
    assert.equal(
      after.audits.filter((item) => item.action === "selling_costs_adopted").length,
      1
    );
  });

  test("unrelated display_metadata survives adoption", async () => {
    const active = await getActiveClient();
    const { developmentId, periodId } = await seedReadySite(active, {
      displayMetadata: { qsNote: "keep-me", otherKey: { nested: true } },
    });
    const preview = await loadReview(developmentId);
    const res = await postAdopt(developmentId, intentFromReview(preview));
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    const after = await snapshotState(developmentId, periodId);
    assert.equal(after.members[0].display_metadata.qsNote, "keep-me");
    assert.deepEqual(after.members[0].display_metadata.otherKey, { nested: true });
    assert.ok(after.members[0].display_metadata[SELLING_COSTS_ADOPTION_METADATA_KEY]);
  });

  test("client-supplied fake adjustment/target is ignored", async () => {
    const active = await getActiveClient();
    const { developmentId, periodId } = await seedReadySite(active);
    const preview = await loadReview(developmentId);
    const res = await postAdopt(developmentId, intentFromReview(preview));
    assert.equal(res.status, 200);
    const after = await snapshotState(developmentId, periodId);
    assert.equal(Number(after.members[0].adj), KNOWN_PROPOSAL);
    assert.notEqual(Number(after.members[0].adj), 999999);
  });

  test("tenant isolation: other client development is 404", async () => {
    const other = await pool.query(
      `
        INSERT INTO clients (code, name, is_active)
        VALUES ($1, 'Other SC Adopt Tenant', false)
        RETURNING id
      `,
      [`SC-ADOPT-OTHER-${Date.now()}`]
    );
    trackTenant(other.rows[0].id);
    const foreignDev = `dev-sc-adopt-foreign-${Date.now()}`;
    await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, 'Foreign', 'live')
      `,
      [foreignDev, other.rows[0].id, `F-${foreignDev}`]
    );
    trackDevelopment(foreignDev);
    const res = await postAdopt(foreignDev, {
      expectedPeriodKey: "P04",
      expectedReportingMonth: "2026-08",
      expectedSettingsVersion: 1,
      selections: [
        {
          destinationCostCodeKey: "5400",
          proposalFingerprint: "x",
          expectedInputVersion: 1,
          expectedSystemForecast: 0,
          expectedCurrentAdjustment: 0,
        },
      ],
    });
    assert.equal(res.status, 404);
  });

  test("drifted re-adoption does not require superseded acknowledgement", async () => {
    const active = await getActiveClient();
    const { developmentId } = await seedReadySite(active);
    const firstPreview = await loadReview(developmentId);
    const first = await postAdopt(developmentId, intentFromReview(firstPreview));
    assert.equal(first.status, 200);
    await request(app)
      .put(`/api/developments/${developmentId}/selling-costs`)
      .send({ version: 1, assumptionPercent: 2, actor: "qs-tester" });
    const drifted = await loadReview(developmentId);
    assert.equal(drifted.reviewState, "drifted");
    const res = await postAdopt(developmentId, intentFromReview(drifted));
    assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
    assert.equal(res.body.adopted.length, 1);
  });
}
