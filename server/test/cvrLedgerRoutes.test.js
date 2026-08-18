/**
 * BL-031A — CVR period and purchase ledger API tests (TEST_DATABASE_URL / buildlite_test).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const createApp = require("../app");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");
const { SNAPSHOT_DEFERRED_NOTE } = require("../services/cvrPeriodConstants");

const app = createApp();
const MIGRATION_004 = path.join(__dirname, "..", "migrations", "004_developments.sql");
const MIGRATION_009 = path.join(__dirname, "..", "migrations", "009_cvr_and_purchase_ledger.sql");

const testDevelopmentIds = [];
const testTenantIds = [];

function trackDevelopment(id) {
  if (id && !testDevelopmentIds.includes(id)) testDevelopmentIds.push(id);
}
function trackTenant(id) {
  if (id && !testTenantIds.includes(id)) testTenantIds.push(id);
}

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_009, "utf8"));
}

async function cleanup() {
  if (testDevelopmentIds.length) {
    await pool.query(
      `
        DELETE FROM ledger_transactions
        WHERE development_id = ANY($1::text[])
      `,
      [testDevelopmentIds]
    );
    await pool.query(
      `DELETE FROM ledger_import_batches WHERE development_id = ANY($1::text[])`,
      [testDevelopmentIds]
    );
    await pool.query(
      `
        DELETE FROM cvr_cost_code_inputs
        WHERE period_id IN (
          SELECT id FROM cvr_periods WHERE development_id = ANY($1::text[])
        )
      `,
      [testDevelopmentIds]
    );
    await pool.query(
      `
        DELETE FROM cvr_period_audit
        WHERE period_id IN (
          SELECT id FROM cvr_periods WHERE development_id = ANY($1::text[])
        )
      `,
      [testDevelopmentIds]
    );
    await pool.query(`DELETE FROM cvr_periods WHERE development_id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
    await pool.query(`DELETE FROM developments WHERE id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
  }
  if (testTenantIds.length) {
    await pool.query(
      `DELETE FROM ledger_transactions WHERE client_id = ANY($1::uuid[])`,
      [testTenantIds]
    );
    await pool.query(
      `DELETE FROM ledger_import_batches WHERE client_id = ANY($1::uuid[])`,
      [testTenantIds]
    );
    await pool.query(
      `DELETE FROM cvr_cost_code_inputs WHERE client_id = ANY($1::uuid[])`,
      [testTenantIds]
    );
    await pool.query(
      `DELETE FROM cvr_period_audit WHERE client_id = ANY($1::uuid[])`,
      [testTenantIds]
    );
    await pool.query(`DELETE FROM cvr_periods WHERE client_id = ANY($1::uuid[])`, [testTenantIds]);
    await pool.query(`DELETE FROM developments WHERE client_id = ANY($1::uuid[])`, [
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

async function createSecondTenant() {
  const code = `TESTCVR_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const { rows } = await pool.query(
    `
      INSERT INTO clients (code, name, is_active)
      VALUES ($1, $2, false)
      RETURNING id, code, name
    `,
    [code, "CVR Test Tenant B"]
  );
  trackTenant(rows[0].id);
  return rows[0];
}

async function createDevelopment(overrides = {}) {
  const id = overrides.id || `dev-cvr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const jobNumber = overrides.jobNumber || `DEV-CVR-${Date.now()}`;
  const res = await request(app).post("/api/developments").send({
    id,
    jobNumber,
    developmentName: overrides.developmentName || "CVR Ledger Test Dev",
    status: "live",
  });
  assert.equal(res.status, 201);
  trackDevelopment(res.body.id);
  return res.body;
}

function periodUrl(developmentId, periodId = "") {
  const base = `/api/developments/${encodeURIComponent(developmentId)}/cvr/periods`;
  return periodId ? `${base}/${periodId}` : base;
}

function ledgerUrl(developmentId, suffix = "batches") {
  return `/api/developments/${encodeURIComponent(developmentId)}/ledger/${suffix}`;
}

if (!isDbConfigured()) {
  test("BL-031A routes skipped — TEST_DATABASE_URL not configured", () => {
    assert.ok(true);
  });
} else {
  test.before(async () => {
    await prepareIntegrationTestDatabase(pool);
    await ensureSchema();
  });

  test.after(async () => {
    await cleanup();
  });

  test("create/list/get CVR period", async () => {
    const development = await createDevelopment();
    const created = await request(app).post(periodUrl(development.id)).send({
      actor: "QS",
      commentary: { keyCommercialIssues: "Brickwork delay" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.periodKey, "P01");
    assert.equal(created.body.status, "draft");
    assert.equal(created.body.version, 1);
    assert.equal(created.body.snapshot, null);
    assert.equal(created.body.snapshotDeferred, true);
    assert.match(created.body.snapshotNote, /BL-031E/);
    assert.equal(created.body.commentary.keyCommercialIssues, "Brickwork delay");

    const listed = await request(app).get(periodUrl(development.id));
    assert.equal(listed.status, 200);
    assert.equal(listed.body.periods.length, 1);

    const got = await request(app).get(periodUrl(development.id, created.body.id));
    assert.equal(got.status, 200);
    assert.equal(got.body.id, created.body.id);
  });

  test("duplicate period key and second draft are rejected", async () => {
    const development = await createDevelopment();
    const first = await request(app)
      .post(periodUrl(development.id))
      .send({ periodKey: "P01" });
    assert.equal(first.status, 201);

    const duplicateKey = await request(app)
      .post(periodUrl(development.id))
      .send({ periodKey: "P01" });
    assert.equal(duplicateKey.status, 409);

    const secondDraft = await request(app)
      .post(periodUrl(development.id))
      .send({ periodKey: "P02" });
    assert.equal(secondDraft.status, 409);

    await request(app).post(`${periodUrl(development.id, first.body.id)}/submit`).send({});
    const whileSubmitted = await request(app)
      .post(periodUrl(development.id))
      .send({ periodKey: "P02" });
    assert.equal(whileSubmitted.status, 409);
  });

  test("patch draft period and stale version returns 409", async () => {
    const development = await createDevelopment();
    const created = await request(app).post(periodUrl(development.id)).send({});
    const patched = await request(app)
      .patch(periodUrl(development.id, created.body.id))
      .send({ version: 1, periodLabel: "January", reportingMonth: "2026-01" });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.periodLabel, "January");
    assert.equal(patched.body.reportingMonth, "2026-01-01");
    assert.equal(patched.body.version, 2);

    const stale = await request(app)
      .patch(periodUrl(development.id, created.body.id))
      .send({ version: 1, periodLabel: "Stale" });
    assert.equal(stale.status, 409);
    assert.match(stale.body.message, /version conflict/i);
    assert.equal(stale.body.period.version, 2);
  });

  test("submit, reject, approve/lock without creating a snapshot", async () => {
    const development = await createDevelopment();
    const created = await request(app).post(periodUrl(development.id)).send({});
    const submitted = await request(app)
      .post(`${periodUrl(development.id, created.body.id)}/submit`)
      .send({ actor: "QS" });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.status, "submitted");
    assert.ok(submitted.body.submittedAt);

    const rejected = await request(app)
      .post(`${periodUrl(development.id, created.body.id)}/reject`)
      .send({ actor: "CM", comment: "Need more commentary" });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, "draft");
    assert.equal(rejected.body.submittedAt, null);

    await request(app)
      .post(`${periodUrl(development.id, created.body.id)}/submit`)
      .send({ actor: "QS" });
    const locked = await request(app)
      .post(`${periodUrl(development.id, created.body.id)}/approve`)
      .send({ actor: "Director" });
    assert.equal(locked.status, 200);
    assert.equal(locked.body.status, "locked");
    assert.equal(locked.body.snapshot, null);
    assert.equal(locked.body.snapshotDeferred, true);
    assert.equal(locked.body.snapshotNote, SNAPSHOT_DEFERRED_NOTE);
    assert.ok(locked.body.approvedAt);
    assert.ok(locked.body.auditHistory.some((item) => item.action === "locked"));

    const mutateLocked = await request(app)
      .patch(periodUrl(development.id, created.body.id))
      .send({ version: locked.body.version, periodLabel: "Nope" });
    assert.equal(mutateLocked.status, 409);
    assert.match(mutateLocked.body.message, /Locked/);

    const nextPeriod = await request(app)
      .post(periodUrl(development.id))
      .send({ periodKey: "P02" });
    assert.equal(nextPeriod.status, 201);
    assert.equal(nextPeriod.body.periodKey, "P02");
    assert.equal(nextPeriod.body.status, "draft");
    assert.equal(nextPeriod.body.snapshot, null);
  });

  test("cost-code inputs round-trip including manual_accrual", async () => {
    const development = await createDevelopment();
    const period = await request(app).post(periodUrl(development.id)).send({});
    const created = await request(app)
      .post(`${periodUrl(development.id, period.body.id)}/inputs`)
      .send({
        costCodeKey: "5231",
        costCodeLabel: "5231 — Cleaning",
        originalBudget: 10000,
        currentBudget: 11000,
        commercialAdjustment: 250,
        adjustmentReason: "Anticipated extra cleaning",
        manualAccrual: 400,
        notes: "QS overlay",
        commercialHead: "Subcontract",
        actor: "QS",
      });
    assert.equal(created.status, 201);
    assert.equal(created.body.costCodeKey, "5231");
    assert.equal(created.body.manualAccrual, 400);
    assert.equal(created.body.commercialAdjustment, 250);
    assert.equal(created.body.originalBudget, 10000);

    const listed = await request(app).get(
      `${periodUrl(development.id, period.body.id)}/inputs`
    );
    assert.equal(listed.status, 200);
    assert.equal(listed.body.inputs.length, 1);
    assert.equal(listed.body.inputs[0].manualAccrual, 400);

    const patched = await request(app)
      .patch(`${periodUrl(development.id, period.body.id)}/inputs/${created.body.id}`)
      .send({ version: 1, manualAccrual: 500 });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.manualAccrual, 500);
    assert.equal(patched.body.version, 2);

    const stale = await request(app)
      .patch(`${periodUrl(development.id, period.body.id)}/inputs/${created.body.id}`)
      .send({ version: 1, manualAccrual: 1 });
    assert.equal(stale.status, 409);
  });

  test("locked period cannot mutate cost-code inputs", async () => {
    const development = await createDevelopment();
    const period = await request(app).post(periodUrl(development.id)).send({});
    await request(app).post(`${periodUrl(development.id, period.body.id)}/submit`).send({});
    await request(app).post(`${periodUrl(development.id, period.body.id)}/approve`).send({});

    const createInput = await request(app)
      .post(`${periodUrl(development.id, period.body.id)}/inputs`)
      .send({ costCodeKey: "5218", costCodeLabel: "Carpentry" });
    assert.equal(createInput.status, 409);
  });

  test("PUT cost-code inputs upserts a draft batch and round-trips manual_accrual", async () => {
    const development = await createDevelopment();
    const period = await request(app).post(periodUrl(development.id)).send({});
    const inputsUrl = `${periodUrl(development.id, period.body.id)}/inputs`;

    const created = await request(app).put(inputsUrl).send({
      actor: "QS",
      inputs: [
        {
          costCodeKey: "5231",
          costCodeLabel: "5231 — Cleaning",
          originalBudget: 10000,
          currentBudget: 11000,
          commercialAdjustment: 250,
          adjustmentReason: "Variation overlay",
          manualAccrual: 400,
          commercialHead: "Subcontract",
        },
        {
          costCodeKey: "5218",
          costCodeLabel: "5218 — Carpentry",
          originalBudget: 50000,
          manualAccrual: 0,
          notes: "No accrual",
        },
      ],
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.inputs.length, 2);
    const cleaning = created.body.inputs.find((row) => row.costCodeKey === "5231");
    const carpentry = created.body.inputs.find((row) => row.costCodeKey === "5218");
    assert.equal(cleaning.manualAccrual, 400);
    assert.equal(cleaning.currentBudget, 11000);
    assert.equal(carpentry.manualAccrual, 0);
    assert.equal(carpentry.originalBudget, 50000);
    assert.equal(carpentry.version, 1);

    const listed = await request(app).get(inputsUrl);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.inputs.length, 2);
    assert.equal(
      listed.body.inputs.find((row) => row.costCodeKey === "5231").manualAccrual,
      400
    );

    const updated = await request(app).put(inputsUrl).send({
      actor: "QS",
      inputs: [
        {
          costCodeKey: "5231",
          costCodeLabel: "5231 — Cleaning",
          version: cleaning.version,
          manualAccrual: 650,
          originalBudget: 10000,
          currentBudget: 11000,
        },
      ],
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.inputs.length, 1);
    assert.equal(updated.body.inputs[0].manualAccrual, 650);
    assert.equal(updated.body.inputs[0].version, cleaning.version + 1);

    const afterPartial = await request(app).get(inputsUrl);
    assert.equal(afterPartial.body.inputs.length, 2);
    assert.equal(
      afterPartial.body.inputs.find((row) => row.costCodeKey === "5231").manualAccrual,
      650
    );
    assert.equal(
      afterPartial.body.inputs.find((row) => row.costCodeKey === "5218").notes,
      "No accrual"
    );
  });

  test("PUT cost-code inputs rejects stale versions and invalid batches without partial writes", async () => {
    const development = await createDevelopment();
    const period = await request(app).post(periodUrl(development.id)).send({});
    const inputsUrl = `${periodUrl(development.id, period.body.id)}/inputs`;

    const seeded = await request(app).put(inputsUrl).send({
      inputs: [
        {
          costCodeKey: "5231",
          costCodeLabel: "Cleaning",
          manualAccrual: 100,
        },
      ],
    });
    assert.equal(seeded.status, 200);
    const current = seeded.body.inputs[0];

    const staleAndNew = await request(app).put(inputsUrl).send({
      inputs: [
        {
          costCodeKey: "5231",
          costCodeLabel: "Cleaning",
          version: current.version,
          manualAccrual: 999,
        },
        {
          costCodeKey: "5218",
          costCodeLabel: "Carpentry",
          manualAccrual: 50,
        },
      ],
    });
    assert.equal(staleAndNew.status, 200);

    const stale = await request(app).put(inputsUrl).send({
      inputs: [
        {
          costCodeKey: "5999",
          costCodeLabel: "Should not persist",
          manualAccrual: 25,
        },
        {
          costCodeKey: "5231",
          costCodeLabel: "Cleaning overwritten",
          version: current.version,
          manualAccrual: 1,
        },
      ],
    });
    assert.equal(stale.status, 409);
    assert.match(stale.body.message, /version conflict/i);
    assert.equal(stale.body.input.version, current.version + 1);
    assert.equal(stale.body.input.manualAccrual, 999);

    const afterStale = await request(app).get(inputsUrl);
    assert.equal(afterStale.body.inputs.length, 2);
    assert.equal(
      afterStale.body.inputs.find((row) => row.costCodeKey === "5231").manualAccrual,
      999
    );
    assert.equal(
      afterStale.body.inputs.find((row) => row.costCodeKey === "5231").costCodeLabel,
      "Cleaning"
    );
    assert.equal(
      afterStale.body.inputs.some((row) => row.costCodeKey === "5999"),
      false
    );

    const invalid = await request(app).put(inputsUrl).send({
      inputs: [
        {
          costCodeKey: "5218",
          costCodeLabel: "Carpentry",
          version: staleAndNew.body.inputs.find((row) => row.costCodeKey === "5218").version,
          manualAccrual: 75,
        },
        {
          costCodeKey: "6001",
          costCodeLabel: "Bad money",
          manualAccrual: "not-a-number",
        },
      ],
    });
    assert.equal(invalid.status, 400);

    const afterInvalid = await request(app).get(inputsUrl);
    assert.equal(afterInvalid.body.inputs.length, 2);
    assert.equal(
      afterInvalid.body.inputs.find((row) => row.costCodeKey === "5218").manualAccrual,
      50
    );
    assert.equal(
      afterInvalid.body.inputs.some((row) => row.costCodeKey === "6001"),
      false
    );

    const duplicateKeys = await request(app).put(inputsUrl).send({
      inputs: [
        { costCodeKey: "6100", costCodeLabel: "First", manualAccrual: 10 },
        { costCodeKey: "6100 — Alias", costCodeLabel: "Alias", manualAccrual: 20 },
      ],
    });
    assert.equal(duplicateKeys.status, 409);
    assert.match(duplicateKeys.body.message, /Duplicate cost-code input/i);

    const afterDuplicate = await request(app).get(inputsUrl);
    assert.equal(afterDuplicate.body.inputs.length, 2);
    assert.equal(
      afterDuplicate.body.inputs.some((row) => row.costCodeKey === "6100"),
      false
    );
  });

  test("PUT cost-code inputs cannot mutate submitted/locked periods and is isolated", async () => {
    const development = await createDevelopment();
    const otherDevelopment = await createDevelopment();
    const period = await request(app).post(periodUrl(development.id)).send({});
    const inputsUrl = `${periodUrl(development.id, period.body.id)}/inputs`;

    const seeded = await request(app).put(inputsUrl).send({
      inputs: [{ costCodeKey: "5231", costCodeLabel: "Cleaning", manualAccrual: 40 }],
    });
    assert.equal(seeded.status, 200);

    await request(app).post(`${periodUrl(development.id, period.body.id)}/submit`).send({});
    const submitted = await request(app).put(inputsUrl).send({
      inputs: [{ costCodeKey: "5231", costCodeLabel: "Cleaning", version: 1, manualAccrual: 99 }],
    });
    assert.equal(submitted.status, 409);
    assert.match(submitted.body.message, /draft/i);

    await request(app)
      .post(`${periodUrl(development.id, period.body.id)}/reject`)
      .send({ comment: "Return to draft" });
    await request(app).post(`${periodUrl(development.id, period.body.id)}/submit`).send({});
    await request(app).post(`${periodUrl(development.id, period.body.id)}/approve`).send({});

    const locked = await request(app).put(inputsUrl).send({
      inputs: [{ costCodeKey: "5231", costCodeLabel: "Cleaning", version: 1, manualAccrual: 99 }],
    });
    assert.equal(locked.status, 409);
    assert.match(locked.body.message, /Locked/);

    const nextPeriod = await request(app)
      .post(periodUrl(development.id))
      .send({ periodKey: "P02" });
    assert.equal(nextPeriod.status, 201);
    const nextInputs = await request(app)
      .put(`${periodUrl(development.id, nextPeriod.body.id)}/inputs`)
      .send({
        inputs: [{ costCodeKey: "5231", costCodeLabel: "P02 Cleaning", manualAccrual: 7 }],
      });
    assert.equal(nextInputs.status, 200);

    const lockedInputs = await request(app).get(inputsUrl);
    assert.equal(lockedInputs.body.inputs[0].manualAccrual, 40);
    assert.equal(lockedInputs.body.inputs[0].costCodeLabel, "Cleaning");

    const crossDevelopment = await request(app)
      .put(`${periodUrl(otherDevelopment.id, period.body.id)}/inputs`)
      .send({
        inputs: [{ costCodeKey: "5231", costCodeLabel: "Cross", manualAccrual: 1 }],
      });
    assert.equal(crossDevelopment.status, 404);

    const tenantB = await createSecondTenant();
    const tenantBDevelopmentId = `dev-cvr-put-b-${Date.now()}`;
    await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, $4, 'live')
      `,
      [tenantBDevelopmentId, tenantB.id, `BPUT-${Date.now()}`, "Tenant B PUT Dev"]
    );
    trackDevelopment(tenantBDevelopmentId);
    const tenantBPeriod = await pool.query(
      `
        INSERT INTO cvr_periods (
          client_id, development_id, period_key, period_label, status, commentary
        )
        VALUES ($1, $2, 'P01', 'P01', 'draft', '{}'::jsonb)
        RETURNING id
      `,
      [tenantB.id, tenantBDevelopmentId]
    );
    const crossTenant = await request(app)
      .put(`${periodUrl(tenantBDevelopmentId, tenantBPeriod.rows[0].id)}/inputs`)
      .send({
        inputs: [{ costCodeKey: "5231", costCodeLabel: "Tenant B", manualAccrual: 1 }],
      });
    assert.equal(crossTenant.status, 404);
  });

  test("cross-tenant CVR period access is rejected", async () => {
    const tenantB = await createSecondTenant();
    const active = await getActiveClient();
    const developmentId = `dev-cvr-b-${Date.now()}`;
    await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, $4, 'live')
      `,
      [developmentId, tenantB.id, `B-${Date.now()}`, "Tenant B Dev"]
    );
    trackDevelopment(developmentId);
    const inserted = await pool.query(
      `
        INSERT INTO cvr_periods (
          client_id, development_id, period_key, period_label, status, commentary
        )
        VALUES ($1, $2, 'P01', 'P01', 'draft', '{}'::jsonb)
        RETURNING id
      `,
      [tenantB.id, developmentId]
    );

    const res = await request(app).get(periodUrl(developmentId, inserted.rows[0].id));
    assert.equal(res.status, 404);
    assert.notEqual(active.id, tenantB.id);
  });

  test("ledger batch import is atomic and totals use net", async () => {
    const development = await createDevelopment();
    const imported = await request(app).post(ledgerUrl(development.id, "batches")).send({
      actor: "QS",
      originalFileName: "actuals.csv",
      sourceProfile: "Sage Purchase Ledger",
      transactions: [
        {
          supplier: "Wipe It Cleaners",
          invoiceNumber: "INV-1",
          transactionDate: "2026-01-15",
          costCodeKey: "5231",
          netAmount: 1000,
          vatAmount: 200,
          description: "January invoice",
        },
        {
          supplier: "Wipe It Cleaners",
          invoiceNumber: "INV-2",
          transactionDate: "2026-02-15",
          costCodeKey: "5231",
          netAmount: 250.5,
          vatAmount: 50.1,
        },
      ],
    });
    assert.equal(imported.status, 201);
    assert.equal(imported.body.batch.rowsImported, 2);
    assert.equal(imported.body.batch.totalNet, 1250.5);
    assert.equal(imported.body.transactions[0].vatAmount, 200);
    assert.ok(imported.body.transactions[0].fingerprint);

    const totals = await request(app).get(ledgerUrl(development.id, "totals"));
    assert.equal(totals.status, 200);
    assert.equal(totals.body.totalNet, 1250.5);
    assert.equal(totals.body.transactionCount, 2);
    assert.equal(totals.body.actualCostByCostCode["5231"], 1250.5);

    const listed = await request(app).get(ledgerUrl(development.id, "transactions"));
    assert.equal(listed.status, 200);
    assert.equal(listed.body.transactions.length, 2);
  });

  test("duplicate fingerprint rejects the whole batch and leaves no partial data", async () => {
    const development = await createDevelopment();
    const first = await request(app).post(ledgerUrl(development.id, "batches")).send({
      originalFileName: "first.csv",
      transactions: [
        {
          supplier: "A Ltd",
          invoiceNumber: "DUP-1",
          transactionDate: "2026-03-01",
          costCodeKey: "5218",
          netAmount: 10,
        },
      ],
    });
    assert.equal(first.status, 201);

    const duplicate = await request(app).post(ledgerUrl(development.id, "batches")).send({
      originalFileName: "second.csv",
      transactions: [
        {
          supplier: "A Ltd",
          invoiceNumber: "DUP-1",
          transactionDate: "2026-03-01",
          costCodeKey: "5218",
          netAmount: 10,
        },
        {
          supplier: "A Ltd",
          invoiceNumber: "NEW-2",
          transactionDate: "2026-03-02",
          costCodeKey: "5218",
          netAmount: 99,
        },
      ],
    });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.body.message, /Duplicate/);

    const listed = await request(app).get(ledgerUrl(development.id, "transactions"));
    assert.equal(listed.body.transactions.length, 1);
    assert.equal(listed.body.transactions[0].invoiceNumber, "DUP-1");

    const inBatch = await request(app).post(ledgerUrl(development.id, "batches")).send({
      transactions: [
        {
          supplier: "B Ltd",
          invoiceNumber: "SAME",
          transactionDate: "2026-04-01",
          costCodeKey: "5218",
          netAmount: 5,
        },
        {
          supplier: "B Ltd",
          invoiceNumber: "SAME",
          transactionDate: "2026-04-01",
          costCodeKey: "5218",
          netAmount: 5,
        },
      ],
    });
    assert.equal(inBatch.status, 400);
  });

  test("invalid ledger money/date is rejected with no batch created", async () => {
    const development = await createDevelopment();
    const invalid = await request(app).post(ledgerUrl(development.id, "batches")).send({
      transactions: [
        {
          supplier: "Bad Date",
          transactionDate: "15/01/2026",
          costCodeKey: "5231",
          netAmount: 10,
        },
      ],
    });
    assert.equal(invalid.status, 400);

    const batches = await request(app).get(ledgerUrl(development.id, "batches"));
    assert.equal(batches.body.batches.length, 0);
  });

  test("ledger reversal creates an offsetting net row once", async () => {
    const development = await createDevelopment();
    const imported = await request(app).post(ledgerUrl(development.id, "batches")).send({
      transactions: [
        {
          supplier: "Contra Ltd",
          invoiceNumber: "REV-1",
          transactionDate: "2026-05-01",
          costCodeKey: "5231",
          netAmount: 80,
          vatAmount: 16,
        },
      ],
    });
    const originId = imported.body.transactions[0].id;
    const reversed = await request(app)
      .post(`${ledgerUrl(development.id, "transactions")}/${originId}/reverse`)
      .send({ actor: "QS" });
    assert.equal(reversed.status, 201);
    assert.equal(reversed.body.netAmount, -80);
    assert.equal(reversed.body.vatAmount, -16);
    assert.equal(reversed.body.reversesId, originId);

    const again = await request(app)
      .post(`${ledgerUrl(development.id, "transactions")}/${originId}/reverse`)
      .send({});
    assert.equal(again.status, 409);

    const totals = await request(app).get(ledgerUrl(development.id, "totals"));
    assert.equal(totals.body.totalNet, 0);
  });

  test("cross-development ledger isolation", async () => {
    const a = await createDevelopment();
    const b = await createDevelopment();
    await request(app).post(ledgerUrl(a.id, "batches")).send({
      transactions: [
        {
          supplier: "Only A",
          invoiceNumber: "A-1",
          transactionDate: "2026-06-01",
          costCodeKey: "5231",
          netAmount: 12,
        },
      ],
    });
    const listedB = await request(app).get(ledgerUrl(b.id, "transactions"));
    assert.equal(listedB.body.transactions.length, 0);
  });
}
