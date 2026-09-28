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
const { createCostCode } = require("../services/costCodeMasterRepository");
const { normaliseCostCodeKey } = require("../services/cvrPeriodValidation");
const developmentBudget = require("../services/developmentBudgetRepository");
const developmentBudgetSnapshot = require("../services/cvrDevelopmentBudgetSnapshot");
const { buildCvrCloseCandidate } = require("../services/cvrCloseEngine");
const { PERMISSIONS } = require("../auth/permissions");

let authenticatedClientId = null;
const testAuth = () => ({
  userId: "00000000-0000-0000-0000-000000000001",
  providerUserId: "test-user",
  displayName: "Test Commercial Manager",
  email: "test@example.invalid",
  clientId: authenticatedClientId,
  membershipId: "00000000-0000-0000-0000-000000000002",
  roleKey: "commercial_manager",
  roleName: "Commercial Manager",
  permissions: [...new Set(Object.values(PERMISSIONS))],
  memberships: [],
});
const app = createApp({ testPrincipal: testAuth });
const ROOT = path.join(__dirname, "..");
const MIGRATION_004 = path.join(ROOT, "migrations", "004_developments.sql");
const MIGRATION_009 = path.join(ROOT, "migrations", "009_cvr_and_purchase_ledger.sql");
const MIGRATION_013 = path.join(ROOT, "migrations", "013_cost_code_classifications.sql");
const MIGRATION_014 = path.join(ROOT, "migrations", "014_development_programme.sql");
const MIGRATION_015 = path.join(ROOT, "migrations", "015_development_prelims_items.sql");
const MIGRATION_017 = path.join(ROOT, "migrations", "017_cost_codes_tenant_master.sql");
const MIGRATION_019 = path.join(ROOT, "migrations", "019_development_prelims_time_offsets.sql");

const testDevelopmentIds = [];
const testCostCodeIds = [];
const testHeadIds = [];
let fixtureHeadId = null;

function trackDevelopment(id) {
  if (id && !testDevelopmentIds.includes(id)) testDevelopmentIds.push(id);
}

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_009, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_013, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_014, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_015, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_017, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_019, "utf8"));
}

async function cleanup() {
  if (!testDevelopmentIds.length) return;
  await pool.query("ALTER TABLE development_budget_event_lines DISABLE TRIGGER USER");
  await pool.query("ALTER TABLE development_budget_events DISABLE TRIGGER USER");
  await pool.query(`DELETE FROM development_budget_event_lines WHERE development_id = ANY($1::text[])`, [
    testDevelopmentIds,
  ]);
  await pool.query(`DELETE FROM development_budget_events WHERE development_id = ANY($1::text[])`, [
    testDevelopmentIds,
  ]);
  await pool.query("ALTER TABLE development_budget_event_lines ENABLE TRIGGER USER");
  await pool.query("ALTER TABLE development_budget_events ENABLE TRIGGER USER");
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
    await pool.query(
      `DELETE FROM cvr_period_audit WHERE period_id IN (
         SELECT id FROM cvr_periods WHERE development_id = ANY($1::text[])
       )`,
      [testDevelopmentIds]
    );
    await pool.query(`DELETE FROM cvr_periods WHERE development_id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
  await pool.query(`DELETE FROM developments WHERE id = ANY($1::text[])`, [testDevelopmentIds]);
  if (testCostCodeIds.length) {
    await pool.query(`DELETE FROM cost_codes WHERE id = ANY($1::uuid[])`, [testCostCodeIds]);
  }
  if (testHeadIds.length) {
    await pool.query(`DELETE FROM commercial_structure_heads WHERE id = ANY($1::uuid[])`, [testHeadIds]);
  }
}

async function getActiveClient() {
  const { rows } = await pool.query(
    "SELECT id, code, name FROM clients WHERE id = $1 AND is_active = true",
    [authenticatedClientId]
  );
  return rows[0] || null;
}

async function createReadyCostCode(active, code) {
  const created = await createCostCode(
    active.id,
    {
      code,
      description: "Prelims adoption fixture",
      commercialHeadId: fixtureHeadId,
      defaultVatTreatment: "Standard",
      defaultOrderType: "S",
      actor: "Commercial Manager",
    },
    { actor: "Commercial Manager" }
  );
  if (!created.ok && created.status === 409) {
    const existing = await pool.query(
      `SELECT id, code, description FROM cost_codes
       WHERE client_id = $1 AND lower(btrim(code)) = lower(btrim($2)) AND is_active = true`,
      [active.id, code]
    );
    assert.equal(existing.rows.length, 1, created.message || JSON.stringify(created));
    return existing.rows[0];
  }
  assert.equal(created.ok, true, created.message || JSON.stringify(created));
  testCostCodeIds.push(created.costCode.id);
  return created.costCode;
}

async function makeCvrReady(active, developmentId, code = "5231", amount = "50280.00") {
  const costCode = await createReadyCostCode(active, code);
  const budget = await developmentBudget.postEvent(
    active.id,
    developmentId,
    {
      eventType: "opening_budget",
      effectiveDate: "2026-08-01",
      reference: `OPEN-${developmentId}`,
      reason: "Valid Prelims preview readiness fixture",
      idempotencyKey: `open-${developmentId}`,
      lines: [{ costCodeId: costCode.id, amount }],
    },
    testAuth()
  );
  assert.equal(budget.ok, true, budget.message || JSON.stringify(budget));
  return costCode;
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
    const membership = await pool.query(
      `SELECT client_id FROM client_user_memberships
       WHERE id = '00000000-0000-0000-0000-000000000002' AND is_active = true`
    );
    authenticatedClientId = membership.rows[0]?.client_id || null;
    assert.ok(authenticatedClientId, "Default test principal must have an active tenant membership");
    const head = await pool.query(
      `INSERT INTO commercial_structure_heads (client_id, name, display_order)
       VALUES ($1, $2, 999) RETURNING id`,
      [authenticatedClientId, `Prelims preview fixture ${Date.now()}`]
    );
    fixtureHeadId = head.rows[0].id;
    testHeadIds.push(fixtureHeadId);
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
    await makeCvrReady(active, developmentId);

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

    const adoptedBudget = await request(app)
      .post(
        `/api/developments/${developmentId}/cvr/periods/${period.body.id}/development-budget-adoption`
      )
      .send({ actor: "Commercial Manager", reason: "Use authoritative fixture budget" });
    assert.equal(
      adoptedBudget.status,
      200,
      adoptedBudget.body?.message || JSON.stringify(adoptedBudget.body)
    );

    const addedInput = await request(app)
      .post(`/api/developments/${developmentId}/cvr/periods/${period.body.id}/cost-code-members`)
      .send({ costCodeKey: "5231", actor: "Commercial Manager" });
    assert.equal(addedInput.status, 201, addedInput.body?.message || JSON.stringify(addedInput.body));
    const prelimsInput = addedInput.body;
    const inputs = await request(app)
      .patch(
        `/api/developments/${developmentId}/cvr/periods/${period.body.id}/inputs/${prelimsInput.id}`
      )
      .send({
        version: prelimsInput.version,
        actor: "QS",
        commercialAdjustment: 520,
        adjustmentReason: "P04 controlled adjustment",
        manualAccrual: 120,
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
    assert.equal(row.inputVersion, 2);
    assert.ok(row.proposalFingerprint);
    assert.match(row.unresolvedExcludedMessage, /excluded from proposed CVR value/i);
    assert.equal(row.unresolvedLines.length, 1);

    const missing = (preview.body.missingFromCvr || []).find(
      (item) => item.costCodeKey === "UAT-CC-001"
    );
    assert.ok(missing);
    assert.match(missing.missingFromCvrMessage, /not currently included as a CVR line/i);

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

    const budgetDocument = await developmentBudgetSnapshot.liveDocument(
      pool,
      active.id,
      developmentId
    );
    const ordinaryCandidate = await buildCvrCloseCandidate({
      clientId: active.id,
      developmentId,
      periodId: period.body.id,
      developmentBudgetDocument: budgetDocument,
    });
    const ordinaryRow = ordinaryCandidate.snapshot.rows.find(
      (item) => item.costCodeKey === "5231"
    );
    assert.equal(ordinaryRow.currentBudget, 50280);
    assert.equal(ordinaryRow.systemForecast, row.systemForecast);
    const storedBudget = await pool.query(
      `SELECT original_budget, current_budget FROM cvr_cost_code_inputs
       WHERE period_id = $1 AND lower(btrim(cost_code_key)) = '5231'`,
      [period.body.id]
    );
    assert.equal(storedBudget.rows[0].original_budget, null);
    assert.equal(storedBudget.rows[0].current_budget, null);
  });

  test("preview preserves the recognised-obligation floor above Development Budget", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    const costCode = `floor-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    await makeCvrReady(active, developmentId, costCode, "100.00");

    const period = await request(app)
      .post(`/api/developments/${developmentId}/cvr/periods`)
      .send({ reportingMonth: "2026-08-01", periodKey: "P04" });
    assert.equal(period.status, 201, period.body?.message || JSON.stringify(period.body));

    const added = await request(app)
      .post(`/api/developments/${developmentId}/cvr/periods/${period.body.id}/cost-code-members`)
      .send({ costCodeKey: costCode, actor: "Commercial Manager" });
    assert.equal(added.status, 201, added.body?.message || JSON.stringify(added.body));
    const canonicalCostCode = added.body.costCodeKey;
    const patched = await request(app)
      .patch(`/api/developments/${developmentId}/cvr/periods/${period.body.id}/inputs/${added.body.id}`)
      .send({ version: added.body.version, actor: "QS", manualAccrual: 120 });
    assert.equal(patched.status, 200, patched.body?.message || JSON.stringify(patched.body));

    const prelims = await request(app)
      .post(`/api/developments/${developmentId}/prelims-items`)
      .send({
        version: 0,
        costCodeKey: canonicalCostCode,
        name: "Obligation floor regression",
        forecastDriver: "LUMP_SUM",
        lumpSumAmount: 200,
        status: "active",
      });
    assert.equal(prelims.status, 201, prelims.body?.message || JSON.stringify(prelims.body));

    const preview = await request(app).get(
      `/api/developments/${developmentId}/prelims-adoption/preview`
    );
    assert.equal(preview.status, 200, preview.body?.message || JSON.stringify(preview.body));
    const previewRow = preview.body.candidates.find(
      (item) => String(item.costCodeKey).toLowerCase() === canonicalCostCode.toLowerCase()
    );
    assert.ok(previewRow, JSON.stringify(preview.body));
    assert.equal(previewRow.systemForecast, 120);

    const budgetDocument = await developmentBudgetSnapshot.liveDocument(
      pool,
      active.id,
      developmentId
    );
    const ordinaryCandidate = await buildCvrCloseCandidate({
      clientId: active.id,
      developmentId,
      periodId: period.body.id,
      developmentBudgetDocument: budgetDocument,
    });
    const ordinaryRow = ordinaryCandidate.snapshot.rows.find(
      (item) => String(item.costCodeKey).toLowerCase() === canonicalCostCode.toLowerCase()
    );
    assert.equal(ordinaryRow.currentBudget, 100);
    assert.equal(ordinaryRow.systemForecast, 120);
    assert.equal(previewRow.systemForecast, ordinaryRow.systemForecast);
  });

  test("GET preview recognises a mixed-case Master code immediately after one membership POST", async () => {
    const active = await getActiveClient();
    const developmentId = await createDevelopment(active);
    const mixedCode = `UAT-CC-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    await makeCvrReady(active, developmentId, `READY-${Date.now().toString(36)}`);

    const created = await createCostCode(
      active.id,
      {
        code: mixedCode,
        description: "BL-037C mixed-case membership preview",
        commercialHeadId: fixtureHeadId,
        defaultVatTreatment: "Standard",
        defaultOrderType: "S",
        actor: "Commercial Manager",
      },
      { actor: "Commercial Manager" }
    );
    assert.equal(created.ok, true, created.message || JSON.stringify(created));
    testCostCodeIds.push(created.costCode.id);

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

    await request(app)
      .post(`/api/developments/${developmentId}/prelims-items`)
      .send({
        version: 0,
        costCodeKey: mixedCode,
        name: "Mixed-case Prelims proposal",
        forecastDriver: "LUMP_SUM",
        lumpSumAmount: 1000,
        status: "active",
      });

    const before = await request(app).get(
      `/api/developments/${developmentId}/prelims-adoption/preview`
    );
    assert.equal(before.status, 200, before.body?.message || JSON.stringify(before.body));
    const missingBefore = (before.body.missingFromCvr || []).find(
      (item) => String(item.costCodeKey).toLowerCase() === mixedCode.toLowerCase()
    );
    assert.ok(missingBefore);
    assert.equal(missingBefore.costCodeKey, mixedCode);
    assert.equal(missingBefore.canAddToCvr, true);
    assert.equal(
      (before.body.candidates || []).some(
        (item) => String(item.costCodeKey).toLowerCase() === mixedCode.toLowerCase()
      ),
      false
    );

    const added = await request(app)
      .post(
        `/api/developments/${developmentId}/cvr/periods/${period.body.id}/cost-code-members`
      )
      .send({ costCodeKey: mixedCode, actor: "Commercial Manager" });
    assert.equal(added.status, 201, added.body?.message || JSON.stringify(added.body));
    assert.equal(added.body.costCodeKey, normaliseCostCodeKey(mixedCode));
    assert.equal(added.body.originalBudget, null);
    assert.equal(added.body.currentBudget, null);
    assert.equal(added.body.commercialAdjustment, 0);
    assert.equal(added.body.manualAccrual, 0);
    assert.equal(added.body.version, 1);

    const after = await request(app).get(
      `/api/developments/${developmentId}/prelims-adoption/preview`
    );
    assert.equal(after.status, 200, after.body?.message || JSON.stringify(after.body));
    assert.equal(
      (after.body.missingFromCvr || []).some(
        (item) => String(item.costCodeKey).toLowerCase() === mixedCode.toLowerCase()
      ),
      false
    );
    const reviewable = (after.body.candidates || []).find(
      (item) => String(item.costCodeKey).toLowerCase() === mixedCode.toLowerCase()
    );
    assert.ok(reviewable);
    assert.equal(reviewable.costCodeKey, mixedCode);
    assert.equal(reviewable.flags?.noCvrRow, false);
    assert.equal(reviewable.cannotAdopt, false);
    assert.equal(reviewable.inputVersion, 1);
    assert.equal(reviewable.resolvedPrelimsTotal, 1000);
    assert.ok(reviewable.proposalFingerprint);

    const stored = await pool.query(
      `
        SELECT cost_code_key, original_budget, current_budget,
               commercial_adjustment::float8 AS adj, manual_accrual::float8 AS accrual, version
          FROM cvr_cost_code_inputs
         WHERE period_id = $1 AND lower(btrim(cost_code_key)) = lower(btrim($2))
      `,
      [period.body.id, mixedCode]
    );
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].cost_code_key, normaliseCostCodeKey(mixedCode));
    assert.equal(stored.rows[0].original_budget, null);
    assert.equal(stored.rows[0].current_budget, null);
    assert.equal(stored.rows[0].adj, 0);
    assert.equal(stored.rows[0].accrual, 0);
    assert.equal(stored.rows[0].version, 1);

    const audits = await pool.query(
      `
        SELECT action, comment
          FROM cvr_period_audit
         WHERE period_id = $1 AND action = 'cost_code_added'
      `,
      [period.body.id]
    );
    assert.equal(audits.rows.length, 1);
    assert.match(audits.rows[0].comment, new RegExp(normaliseCostCodeKey(mixedCode)));

    const adopted = await pool.query(
      `
        SELECT COUNT(*)::int AS n
          FROM cvr_period_audit
         WHERE period_id = $1 AND action = 'prelims_adopted'
      `,
      [period.body.id]
    );
    assert.equal(adopted.rows[0].n, 0);
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
