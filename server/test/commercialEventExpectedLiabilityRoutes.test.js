/**
 * BL-038B — CE expected-liability command / read-model / audit (buildlite_test only).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const createApp = require("../app");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");
const { buildSubcontractOrderKey } = require("../services/packageKey");

const app = createApp();
const MIGRATION_004 = path.join(__dirname, "..", "migrations", "004_developments.sql");
const MIGRATION_005 = path.join(__dirname, "..", "migrations", "005_packages.sql");
const MIGRATION_006 = path.join(__dirname, "..", "migrations", "006_commercial_events.sql");
const MIGRATION_021 = path.join(__dirname, "..", "migrations", "021_commercial_event_expected_liability.sql");

const testDevelopmentIds = [];
const testJobNumbers = [];
const testPoNumbers = [];
const testPackageIds = [];
const testCommercialEventIds = [];
const testTenantIds = [];

function trackDevelopment(id, jobNumber) {
  if (id) testDevelopmentIds.push(id);
  if (jobNumber) testJobNumbers.push(jobNumber);
}
function trackPo(poNumber) {
  if (poNumber) testPoNumbers.push(poNumber);
}
function trackCe(id) {
  if (id) testCommercialEventIds.push(id);
}

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_005, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_006, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_021, "utf8"));
}

async function cleanup() {
  if (testCommercialEventIds.length) {
    await pool.query("DELETE FROM commercial_event_audit WHERE commercial_event_id = ANY($1::text[])", [
      testCommercialEventIds,
    ]);
    await pool.query("DELETE FROM commercial_events WHERE id = ANY($1::text[])", [
      testCommercialEventIds,
    ]);
  }
  if (testPackageIds.length) {
    await pool.query("DELETE FROM packages WHERE id = ANY($1::uuid[])", [testPackageIds]);
  }
  if (testPoNumbers.length) {
    await pool.query("DELETE FROM purchase_orders WHERE po_number = ANY($1::text[])", [
      testPoNumbers,
    ]);
  }
  if (testDevelopmentIds.length) {
    await pool.query("DELETE FROM developments WHERE id = ANY($1::text[])", [testDevelopmentIds]);
  }
  if (testTenantIds.length) {
    await pool.query("DELETE FROM clients WHERE id = ANY($1::uuid[])", [testTenantIds]);
  }
}

async function getActiveClient() {
  const { rows } = await pool.query(
    "SELECT id, code, name FROM clients WHERE is_active = true LIMIT 1"
  );
  return rows[0] || null;
}

async function createSecondTenant() {
  const code = `TESTEL_${Date.now()}`;
  const { rows } = await pool.query(
    `
      INSERT INTO clients (code, name, is_active)
      VALUES ($1, $2, false)
      RETURNING id, code, name
    `,
    [code, "Expected Liability Tenant B"]
  );
  testTenantIds.push(rows[0].id);
  return rows[0];
}

async function createDevelopment() {
  const id = `dev-el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const jobNumber = `DEV-EL-${Date.now()}`;
  const res = await request(app)
    .post("/api/developments")
    .send({
      id,
      jobNumber,
      developmentName: "EL Test Dev",
      status: "live",
    });
  assert.equal(res.status, 201);
  trackDevelopment(res.body.id, res.body.jobNumber);
  return res.body;
}

function uniquePo() {
  return `S-EL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function buildPo({ poNumber, development, supplierId = "sup-el-1", costCode = "5218", subtotal = 50000 }) {
  return {
    poNumber,
    type: "S",
    supplierId,
    supplierSnapshot: { name: "EL Supplier" },
    developmentId: development.id,
    developmentNumber: development.jobNumber,
    developmentName: development.developmentName,
    development: {
      id: development.id,
      developmentNumber: development.jobNumber,
      developmentName: development.developmentName,
    },
    costRef: { developmentId: development.id, costCode },
    items: [{ description: "Works", qty: 1, rate: subtotal, amount: subtotal, costCode }],
    subtotal,
    totals: { net: subtotal, vat: 0, gross: subtotal },
    approval: { status: "Approved", history: [] },
    status: "Approved",
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function savePo(clientId, po) {
  await pool.query(
    `
      INSERT INTO purchase_orders (po_number, payload, client_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (po_number)
      DO UPDATE SET payload = EXCLUDED.payload, client_id = EXCLUDED.client_id
    `,
    [po.poNumber, po, clientId]
  );
  trackPo(po.poNumber);
}

async function materialise(developmentId) {
  const res = await request(app).post("/api/packages/materialise").send({ developmentId });
  assert.equal(res.status, 200, res.body?.message || "materialise failed");
  for (const pkg of res.body.packages || []) {
    if (pkg.id) testPackageIds.push(pkg.id);
  }
  return res.body;
}

async function setupPackage() {
  const active = await getActiveClient();
  const development = await createDevelopment();
  await savePo(active.id, buildPo({ poNumber: uniquePo(), development }));
  const materialised = await materialise(development.id);
  const orderKey = buildSubcontractOrderKey(development.id, "sup-el-1", "5218");
  const pkg = materialised.packages.find((item) => item.orderKey === orderKey);
  assert.ok(pkg, "expected materialised package");
  return { development, pkg, orderKey };
}

function basePayload(development, orderKey, overrides = {}) {
  return {
    developmentId: development.id,
    packageId: orderKey,
    eventType: "variation",
    category: "design",
    responsibility: "employer",
    description: "EL variation",
    value: 20000,
    financialTreatment: "contractAmendment",
    ...overrides,
  };
}

async function createCe(payload) {
  const res = await request(app).post("/api/commercial-events").send(payload);
  if (res.body?.id) trackCe(res.body.id);
  return res;
}

async function submitCe(id) {
  const res = await request(app).post(`/api/commercial-events/${id}/submit`).send({ actor: "QS" });
  assert.equal(res.status, 200, res.body?.message);
  return res.body;
}

async function patchExpected(id, body) {
  return request(app).patch(`/api/commercial-events/${id}/expected-liability`).send(body);
}

if (!isDbConfigured()) {
  test("BL-038B expected-liability routes skipped — TEST_DATABASE_URL not configured", () => {
    assert.ok(true);
  });
} else {
  test.before(async () => {
    await prepareIntegrationTestDatabase(pool);
    const db = await pool.query("SELECT current_database() AS db");
    assert.equal(db.rows[0].db, "buildlite_test");
    await ensureSchema();
  });

  test.after(async () => {
    await cleanup();
  });

  test("1. draft read model expected is 0 and has no active edit", async () => {
    const { development, orderKey } = await setupPackage();
    const created = await createCe(basePayload(development, orderKey));
    assert.equal(created.status, 201);
    assert.equal(created.body.status, "draft");
    assert.equal(created.body.expectedLiability, 0);
    assert.equal(created.body.potentialLiability, 0);
    assert.equal(created.body.expectedTreatment, "default");
    assert.equal(created.body.isExpectedTreatmentEditable, false);
    assert.equal(created.body.expectedAmount, null);

    const blocked = await patchExpected(created.body.id, {
      treatment: "override",
      expectedAmount: 1000,
      reason: "too early",
      expectedVersion: created.body.version,
      actor: "QS",
    });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.code, "NOT_SUBMITTED");
  });

  test("2/21. submitted default expected equals CE value and is derived", async () => {
    const { development, orderKey } = await setupPackage();
    const created = await createCe(basePayload(development, orderKey, { value: 20000 }));
    const submitted = await submitCe(created.body.id);
    assert.equal(submitted.status, "submitted");
    assert.equal(submitted.expectedTreatment, "default");
    assert.equal(submitted.expectedAmount, null);
    assert.equal(submitted.expectedReason, null);
    assert.equal(submitted.potentialLiability, 20000);
    assert.equal(submitted.expectedLiability, 20000);
    assert.equal(submitted.effectiveExpectedLiability, 20000);
    assert.equal(submitted.isDefaultTreatment, true);
    assert.equal(submitted.canEditExpectedLiability, true);
    assert.equal(submitted.warningAboveSubmitted, false);

    const { rows } = await pool.query(
      "SELECT expected_treatment, expected_amount, expected_reason FROM commercial_events WHERE id = $1",
      [submitted.id]
    );
    assert.equal(rows[0].expected_treatment, "default");
    assert.equal(rows[0].expected_amount, null);
    assert.equal(rows[0].expected_reason, null);
  });

  test("3-6. override below, equal, above, and zero", async () => {
    const { development, orderKey } = await setupPackage();
    const created = await createCe(basePayload(development, orderKey));
    let event = await submitCe(created.body.id);

    let res = await patchExpected(event.id, {
      treatment: "override",
      expectedAmount: 12500,
      reason: "Likely settlement",
      expectedVersion: event.version,
      actor: "Commercial Manager",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.expectedTreatment, "override");
    assert.equal(res.body.expectedAmount, 12500);
    assert.equal(res.body.expectedLiability, 12500);
    assert.equal(res.body.value, 20000);
    assert.equal(res.body.status, "submitted");
    assert.equal(res.body.warningAboveSubmitted, false);
    event = res.body;

    res = await patchExpected(event.id, {
      treatment: "override",
      expectedAmount: 20000,
      reason: "Full value still expected",
      expectedVersion: event.version,
      actor: "Commercial Manager",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.expectedLiability, 20000);
    assert.equal(res.body.warningAboveSubmitted, false);
    event = res.body;

    res = await patchExpected(event.id, {
      treatment: "override",
      expectedAmount: 25000,
      reason: "Likely extra instruction",
      expectedVersion: event.version,
      actor: "Commercial Manager",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.expectedLiability, 25000);
    assert.equal(res.body.warningAboveSubmitted, true);
    event = res.body;

    res = await patchExpected(event.id, {
      treatment: "override",
      expectedAmount: 0,
      reason: "Expect nil settlement",
      expectedVersion: event.version,
      actor: "Commercial Manager",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.expectedLiability, 0);
    assert.equal(res.body.expectedAmount, 0);
  });

  test("7-8. hold and exclude are 0 with required reason", async () => {
    const { development, orderKey } = await setupPackage();
    const created = await createCe(basePayload(development, orderKey));
    let event = await submitCe(created.body.id);

    let res = await patchExpected(event.id, {
      treatment: "hold",
      expectedVersion: event.version,
      actor: "QS",
    });
    assert.equal(res.status, 400);

    res = await patchExpected(event.id, {
      treatment: "hold",
      reason: "Awaiting further information",
      expectedVersion: event.version,
      actor: "QS",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.expectedLiability, 0);
    assert.equal(res.body.expectedAmount, null);
    assert.equal(res.body.expectedTreatment, "hold");
    event = res.body;

    res = await patchExpected(event.id, {
      treatment: "exclude",
      reason: "Does not belong on this code",
      expectedVersion: event.version,
      actor: "QS",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.expectedLiability, 0);
    assert.equal(res.body.expectedTreatment, "exclude");
  });

  test("9/11. restore default clears amount/reason and follows CE value", async () => {
    const { development, orderKey } = await setupPackage();
    const created = await createCe(basePayload(development, orderKey, { value: 18000 }));
    let event = await submitCe(created.body.id);
    const overridden = await patchExpected(event.id, {
      treatment: "override",
      expectedAmount: 9000,
      reason: "Partial",
      expectedVersion: event.version,
      actor: "QS",
    });
    assert.equal(overridden.status, 200);
    const restored = await patchExpected(event.id, {
      treatment: "default",
      expectedVersion: overridden.body.version,
      actor: "QS",
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.expectedTreatment, "default");
    assert.equal(restored.body.expectedAmount, null);
    assert.equal(restored.body.expectedReason, null);
    assert.equal(restored.body.expectedLiability, 18000);
    assert.equal(restored.body.value, 18000);
  });

  test("10. override requires amount and reason", async () => {
    const { development, orderKey } = await setupPackage();
    const created = await createCe(basePayload(development, orderKey));
    const event = await submitCe(created.body.id);
    const missingAmount = await patchExpected(event.id, {
      treatment: "override",
      reason: "No amount",
      expectedVersion: event.version,
      actor: "QS",
    });
    assert.equal(missingAmount.status, 400);
    const missingReason = await patchExpected(event.id, {
      treatment: "override",
      expectedAmount: 1000,
      expectedVersion: event.version,
      actor: "QS",
    });
    assert.equal(missingReason.status, 400);
  });

  test("12-14. approved / rejected / included / closed expected is 0; stored treatment retained", async () => {
    const { development, orderKey } = await setupPackage();
    const created = await createCe(basePayload(development, orderKey));
    let event = await submitCe(created.body.id);
    const overridden = await patchExpected(event.id, {
      treatment: "override",
      expectedAmount: 14000,
      reason: "Historic override",
      expectedVersion: event.version,
      actor: "QS",
    });
    assert.equal(overridden.status, 200);

    const approved = await request(app)
      .post(`/api/commercial-events/${event.id}/approve`)
      .send({ actor: "QS" });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, "approved");
    assert.equal(approved.body.expectedLiability, 0);
    assert.equal(approved.body.potentialLiability, 0);
    assert.equal(approved.body.expectedTreatment, "override");
    assert.equal(approved.body.expectedAmount, 14000);
    assert.equal(approved.body.isExpectedTreatmentEditable, false);
    const blocked = await patchExpected(event.id, {
      treatment: "default",
      expectedVersion: approved.body.version,
      actor: "QS",
    });
    assert.equal(blocked.status, 400);

    const rejectedCreated = await createCe(basePayload(development, orderKey, { description: "reject me" }));
    const rejectedSubmitted = await submitCe(rejectedCreated.body.id);
    const rejected = await request(app)
      .post(`/api/commercial-events/${rejectedCreated.body.id}/reject`)
      .send({ actor: "QS" });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.expectedLiability, 0);

    await pool.query(
      "UPDATE commercial_events SET status = $1 WHERE id = $2",
      ["includedInCertificate", event.id]
    );
    const included = await request(app).get(`/api/commercial-events/${event.id}`);
    assert.equal(included.body.status, "includedInCertificate");
    assert.equal(included.body.expectedLiability, 0);

    await pool.query("UPDATE commercial_events SET status = $1 WHERE id = $2", ["closed", event.id]);
    const closed = await request(app).get(`/api/commercial-events/${event.id}`);
    assert.equal(closed.body.status, "closed");
    assert.equal(closed.body.expectedLiability, 0);
    void rejectedSubmitted;
  });

  test("15. recovery / non-contract-value cannot be edited and expected is 0", async () => {
    const { development, orderKey } = await setupPackage();
    const created = await createCe(
      basePayload(development, orderKey, {
        eventType: "contraCharge",
        financialTreatment: "recoverableDeduction",
        value: -2500,
        description: "Recovery deduction",
      })
    );
    const submitted = await submitCe(created.body.id);
    assert.equal(submitted.expectedLiability, 0);
    assert.equal(submitted.potentialLiability, 0);
    assert.equal(submitted.canEditExpectedLiability, false);
    const blocked = await patchExpected(submitted.id, {
      treatment: "override",
      expectedAmount: 100,
      reason: "should fail",
      expectedVersion: submitted.version,
      actor: "QS",
    });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.code, "NOT_CONTRACT_VALUE");
  });

  test("16. version conflict", async () => {
    const { development, orderKey } = await setupPackage();
    const created = await createCe(basePayload(development, orderKey));
    const event = await submitCe(created.body.id);
    const conflict = await patchExpected(event.id, {
      treatment: "hold",
      reason: "stale",
      expectedVersion: event.version - 1,
      actor: "QS",
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.event.value, 20000);
    assert.equal(conflict.body.event.status, "submitted");
  });

  test("17. tenant isolation", async () => {
    const tenantB = await createSecondTenant();
    const { rows: devRow } = await pool.query(
      "INSERT INTO developments (id, client_id, job_number, development_name, status) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [`dev-el-b-${Date.now()}`, tenantB.id, `JOB-ELB-${Date.now()}`, "Other", "live"]
    );
    const otherDevId = devRow[0].id;
    testDevelopmentIds.push(otherDevId);
    const orderKey = buildSubcontractOrderKey(otherDevId, "sup-x", "5218");
    const { rows: pkgRows } = await pool.query(
      `
        INSERT INTO packages (client_id, development_id, supplier_id, cost_code, order_key)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [tenantB.id, otherDevId, "sup-x", "5218", orderKey]
    );
    testPackageIds.push(pkgRows[0].id);
    const otherCeId = `ce-el-other-${Date.now()}`;
    await pool.query(
      `
        INSERT INTO commercial_events (
          id, client_id, development_id, package_id, order_key, event_number,
          event_type, category, responsibility, description, value, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'variation', 'design', 'employer', 'Hidden', 5000, 'submitted')
      `,
      [otherCeId, tenantB.id, otherDevId, pkgRows[0].id, orderKey, `CE-ELB-${Date.now()}`]
    );
    trackCe(otherCeId);

    const getRes = await request(app).get(`/api/commercial-events/${otherCeId}`);
    assert.equal(getRes.status, 404);
    const patchRes = await patchExpected(otherCeId, {
      treatment: "hold",
      reason: "cross tenant",
      expectedVersion: 1,
      actor: "QS",
    });
    assert.equal(patchRes.status, 404);
  });

  test("18. expected command does not change factual CE value or status", async () => {
    const { development, orderKey } = await setupPackage();
    const created = await createCe(basePayload(development, orderKey, { value: 17500 }));
    const event = await submitCe(created.body.id);
    const res = await patchExpected(event.id, {
      treatment: "override",
      expectedAmount: 5000,
      reason: "Judgement only",
      expectedVersion: event.version,
      actor: "QS",
      value: 1,
      status: "approved",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.value, 17500);
    assert.equal(res.body.status, "submitted");
    assert.equal(res.body.expectedLiability, 5000);
  });

  test("19. audit history is typed and restore-default is recorded", async () => {
    const { development, orderKey } = await setupPackage();
    const created = await createCe(basePayload(development, orderKey));
    const event = await submitCe(created.body.id);
    const overridden = await patchExpected(event.id, {
      treatment: "override",
      expectedAmount: 15000,
      reason: "Likely settlement based on QS assessment",
      expectedVersion: event.version,
      actor: "Commercial Manager",
    });
    assert.equal(overridden.status, 200);
    const restored = await patchExpected(event.id, {
      treatment: "default",
      expectedVersion: overridden.body.version,
      actor: "Commercial Manager",
    });
    assert.equal(restored.status, 200);
    const history = restored.body.auditHistory.filter(
      (entry) => entry.action === "EXPECTED_LIABILITY_CHANGED"
    );
    assert.equal(history.length, 2);
    assert.equal(history[0].priorExpectedTreatment, "default");
    assert.equal(history[0].newExpectedTreatment, "override");
    assert.equal(history[0].priorExpectedAmount, null);
    assert.equal(history[0].newExpectedAmount, 15000);
    assert.equal(history[0].priorEffectiveExpected, 20000);
    assert.equal(history[0].newEffectiveExpected, 15000);
    assert.equal(history[0].ceValueAtChange, 20000);
    assert.equal(history[0].ceStatusAtChange, "submitted");
    assert.equal(history[0].comment, "Likely settlement based on QS assessment");
    assert.equal(history[0].actor, "Commercial Manager");
    assert.equal(history[1].newExpectedTreatment, "default");
    assert.equal(history[1].newExpectedAmount, null);
    assert.equal(history[1].newEffectiveExpected, 20000);
    assert.match(history[1].comment, /Restored default/i);
  });

  test("20. GET read model exposes expected fields after submit", async () => {
    const { development, orderKey } = await setupPackage();
    const created = await createCe(basePayload(development, orderKey));
    const submitted = await submitCe(created.body.id);
    const getRes = await request(app).get(`/api/commercial-events/${submitted.id}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.potentialLiability, 20000);
    assert.equal(getRes.body.expectedLiability, 20000);
    assert.equal(getRes.body.expectedTreatment, "default");
    assert.equal(getRes.body.canEditExpectedLiability, true);
  });
}
