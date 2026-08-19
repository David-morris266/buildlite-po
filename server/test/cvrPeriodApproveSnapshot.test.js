/**
 * BL-031E.3B — Atomic CVR Approve & Lock + snapshot persistence (buildlite_test only).
 * Does not touch buildlite_clone. Does not Submit/Approve Test Site 1.
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
const { buildCvrCloseCandidate } = require("../services/cvrCloseEngine");
const { sourceFailure, sourceOk } = require("../services/cvrCloseSources");
const {
  SNAPSHOT_CREATED_NOTE,
  CVR_CLOSE_NOT_READY_CODE,
} = require("../services/cvrPeriodConstants");
const { approveCvrPeriod, getCvrPeriod } = require("../services/cvrPeriodRepository");

const app = createApp();
const MIGRATION_004 = path.join(__dirname, "..", "migrations", "004_developments.sql");
const MIGRATION_005 = path.join(__dirname, "..", "migrations", "005_packages.sql");
const MIGRATION_006 = path.join(__dirname, "..", "migrations", "006_commercial_events.sql");
const MIGRATION_008 = path.join(__dirname, "..", "migrations", "008_package_payment_certificates.sql");
const MIGRATION_009 = path.join(__dirname, "..", "migrations", "009_cvr_and_purchase_ledger.sql");
const MIGRATION_010 = path.join(__dirname, "..", "migrations", "010_cvr_period_snapshots.sql");
const CVR_ROUTES = path.join(__dirname, "..", "routes", "cvrRoutes.js");

const EXPECTED_5231 = {
  currentBudget: 0,
  committed: 50250,
  certified: 2150,
  actualCost: 0,
  manualAccrual: 100,
  currentCost: 100,
  systemForecast: 50250,
  commercialAdjustment: 500,
  finalForecast: 50750,
  costToComplete: 50650,
  outstandingCertified: 2150,
  variance: -50750,
};

const EXPECTED_DEV = {
  currentBudget: 0,
  committed: 2364873,
  certified: 2150,
  actualCost: 0,
  manualAccrual: 100,
  currentCost: 100,
  systemForecast: 2364873,
  commercialAdjustment: 500,
  finalForecast: 2365373,
  costToComplete: 2365273,
  outstandingCertified: 2150,
  variance: -2365373,
};

const OTHER_COMMITTED = EXPECTED_DEV.committed - EXPECTED_5231.committed;

const testDevelopmentIds = [];
const testPoNumbers = [];
const testPackageIds = [];
const testTenantIds = [];
const testCeIds = [];

function trackDevelopment(id) {
  if (id && !testDevelopmentIds.includes(id)) testDevelopmentIds.push(id);
}
function trackPo(poNumber) {
  if (poNumber && !testPoNumbers.includes(poNumber)) testPoNumbers.push(poNumber);
}
function trackPackage(id) {
  if (id && !testPackageIds.includes(id)) testPackageIds.push(id);
}
function trackTenant(id) {
  if (id && !testTenantIds.includes(id)) testTenantIds.push(id);
}
function trackCe(id) {
  if (id && !testCeIds.includes(id)) testCeIds.push(id);
}

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_005, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_006, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_008, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_009, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_010, "utf8"));
}

async function cleanup() {
  if (testPackageIds.length) {
    await pool.query(
      `DELETE FROM cvr_period_snapshot_rows WHERE snapshot_id IN (
         SELECT id FROM cvr_period_snapshots WHERE development_id IN (
           SELECT development_id FROM packages WHERE id = ANY($1::uuid[])
         )
       )`,
      [testPackageIds]
    );
    await pool.query(
      "DELETE FROM package_payment_certificates WHERE package_id = ANY($1::uuid[])",
      [testPackageIds]
    );
    await pool.query(
      `
        DELETE FROM commercial_event_audit
        WHERE commercial_event_id IN (
          SELECT id FROM commercial_events WHERE package_id = ANY($1::uuid[])
        )
      `,
      [testPackageIds]
    );
    await pool.query("DELETE FROM commercial_events WHERE package_id = ANY($1::uuid[])", [
      testPackageIds,
    ]);
    await pool.query("DELETE FROM packages WHERE id = ANY($1::uuid[])", [testPackageIds]);
  }
  if (testCeIds.length) {
    await pool.query(
      "DELETE FROM commercial_event_audit WHERE commercial_event_id = ANY($1::text[])",
      [testCeIds]
    );
    await pool.query("DELETE FROM commercial_events WHERE id = ANY($1::text[])", [testCeIds]);
  }
  if (testDevelopmentIds.length) {
    await pool.query(
      `DELETE FROM cvr_period_snapshot_rows WHERE snapshot_id IN (
         SELECT id FROM cvr_period_snapshots WHERE development_id = ANY($1::text[])
       )`,
      [testDevelopmentIds]
    );
    await pool.query(`DELETE FROM cvr_period_snapshots WHERE development_id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
    await pool.query(`DELETE FROM ledger_transactions WHERE development_id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
    await pool.query(`DELETE FROM ledger_import_batches WHERE development_id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
    await pool.query(
      `DELETE FROM cvr_cost_code_inputs WHERE period_id IN (SELECT id FROM cvr_periods WHERE development_id = ANY($1::text[]))`,
      [testDevelopmentIds]
    );
    await pool.query(
      `DELETE FROM cvr_period_audit WHERE period_id IN (SELECT id FROM cvr_periods WHERE development_id = ANY($1::text[]))`,
      [testDevelopmentIds]
    );
    await pool.query(`DELETE FROM cvr_periods WHERE development_id = ANY($1::text[])`, [
      testDevelopmentIds,
    ]);
    await pool.query("DELETE FROM package_payment_certificates WHERE development_id = ANY($1::text[])", [
      testDevelopmentIds,
    ]);
    await pool.query("DELETE FROM commercial_events WHERE development_id = ANY($1::text[])", [
      testDevelopmentIds,
    ]);
    await pool.query("DELETE FROM packages WHERE development_id = ANY($1::text[])", [
      testDevelopmentIds,
    ]);
    await pool.query(`DELETE FROM developments WHERE id = ANY($1::text[])`, [testDevelopmentIds]);
  }
  if (testPoNumbers.length) {
    await pool.query("DELETE FROM purchase_orders WHERE po_number = ANY($1::text[])", [
      testPoNumbers,
    ]);
  }
  if (testTenantIds.length) {
    await pool.query(
      `DELETE FROM cvr_period_snapshot_rows WHERE snapshot_id IN (
         SELECT id FROM cvr_period_snapshots WHERE client_id = ANY($1::uuid[])
       )`,
      [testTenantIds]
    );
    await pool.query(`DELETE FROM cvr_period_snapshots WHERE client_id = ANY($1::uuid[])`, [
      testTenantIds,
    ]);
    await pool.query(`DELETE FROM ledger_transactions WHERE client_id = ANY($1::uuid[])`, [
      testTenantIds,
    ]);
    await pool.query(`DELETE FROM cvr_periods WHERE client_id = ANY($1::uuid[])`, [testTenantIds]);
    await pool.query(`DELETE FROM packages WHERE client_id = ANY($1::uuid[])`, [testTenantIds]);
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

async function createSecondTenant() {
  const code = `TESTAPPR_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const { rows } = await pool.query(
    `
      INSERT INTO clients (code, name, is_active)
      VALUES ($1, $2, false)
      RETURNING id, code, name
    `,
    [code, "Approve Snapshot Tenant B"]
  );
  trackTenant(rows[0].id);
  return rows[0];
}

async function createDevelopment(overrides = {}) {
  const id = overrides.id || `dev-appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const res = await request(app).post("/api/developments").send({
    id,
    jobNumber: overrides.jobNumber || `DEV-APPR-${Date.now()}`,
    developmentName: overrides.developmentName || "Approve Snapshot Test Dev",
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

function buildPo({
  poNumber,
  development,
  supplierId = "sup-appr-1",
  costCode = "5231",
  subtotal = 50000,
  type = "S",
  archived = false,
  approvalStatus = "Approved",
}) {
  return {
    poNumber,
    type,
    supplierId,
    supplierSnapshot: { name: `Supplier ${supplierId}` },
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
    approval: { status: approvalStatus, history: [] },
    status: approvalStatus,
    archived,
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
  assert.equal(res.status, 200);
  for (const pkg of res.body.packages || []) trackPackage(pkg.id);
  return res.body;
}

async function createPeriod(developmentId, body = {}) {
  const res = await request(app)
    .post(`/api/developments/${encodeURIComponent(developmentId)}/cvr/periods`)
    .send(body);
  assert.equal(res.status, 201);
  return res.body;
}

async function putInputs(developmentId, periodId, inputs) {
  const listed = await request(app).get(
    `/api/developments/${encodeURIComponent(developmentId)}/cvr/periods/${periodId}/inputs`
  );
  const existingByKey = new Map(
    (listed.status === 200 ? listed.body.inputs || [] : []).map((row) => [
      row.costCodeKey,
      row,
    ])
  );
  const payload = inputs.map((input) => {
    const existing = existingByKey.get(input.costCodeKey);
    return existing ? { ...input, version: existing.version } : input;
  });
  const res = await request(app)
    .put(
      `/api/developments/${encodeURIComponent(developmentId)}/cvr/periods/${periodId}/inputs`
    )
    .send({ actor: "QS", inputs: payload });
  assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
  return res.body;
}

async function importLedger(developmentId, transactions) {
  const res = await request(app)
    .post(`/api/developments/${encodeURIComponent(developmentId)}/ledger/batches`)
    .send({
      actor: "QS",
      originalFileName: "approve-snapshot.csv",
      sourceProfile: "test",
      transactions,
    });
  assert.equal(res.status, 201);
  return res.body;
}

async function insertCommercialEvent({
  clientId,
  development,
  pkg,
  value,
  status = "approved",
  eventType = "variation",
  relationshipType = null,
  description = "Approve snapshot CE",
}) {
  const id = `ce-appr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const eventNumber = `CE-APPR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await pool.query(
    `
      INSERT INTO commercial_events (
        id, client_id, development_id, package_id, order_key, event_number,
        event_type, category, responsibility, description, value, status,
        relationship_type, vat_treatment, payload
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, 'commercial', 'commercial', $8, $9, $10,
        $11, 'standard', '{}'::jsonb
      )
    `,
    [
      id,
      clientId,
      development.id,
      pkg.id,
      pkg.orderKey,
      eventNumber,
      eventType,
      description,
      value,
      status,
      relationshipType,
    ]
  );
  trackCe(id);
  return id;
}

async function insertLockedCertificate({
  clientId,
  development,
  pkg,
  certificateNumber = 1,
  grossValue,
  netValue,
  recoverySigned = 0,
  matrixGross = null,
  commercialEventGross = 0,
}) {
  const { rows } = await pool.query(
    `
      INSERT INTO package_payment_certificates (
        client_id, package_id, development_id, order_key, certificate_number,
        status, gross_value, net_value, matrix_gross, commercial_event_gross,
        recovery_signed, retention, vat, retention_rate, vat_rate, payload,
        approved_at, approved_by
      )
      VALUES (
        $1, $2, $3, $4, $5,
        'locked', $6, $7, $8, $9,
        $10, 0, 0, 0, 0, '{}'::jsonb,
        NOW(), 'approve-snapshot-test'
      )
      RETURNING id
    `,
    [
      clientId,
      pkg.id,
      development.id,
      pkg.orderKey,
      certificateNumber,
      grossValue,
      netValue,
      matrixGross == null ? grossValue : matrixGross,
      commercialEventGross,
      recoverySigned,
    ]
  );
  return rows[0].id;
}

function uniquePo(prefix = "S-AP") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function setupBase({
  costCode = "5231",
  subtotal = 50000,
  supplierId,
  inputs = [
    {
      costCodeKey: "5231",
      costCodeLabel: "5231 — Cleaning",
      currentBudget: 0,
      originalBudget: 0,
      manualAccrual: 100,
      commercialAdjustment: 500,
      adjustmentReason: "Test adjustment",
      displayMetadata: { adjustmentHistory: [{ amount: 500, reason: "Test adjustment" }] },
    },
  ],
} = {}) {
  const client = await getActiveClient();
  const development = await createDevelopment();
  const sid = supplierId || `sup-${Math.random().toString(36).slice(2, 8)}`;
  const po = buildPo({
    poNumber: uniquePo(),
    development,
    supplierId: sid,
    costCode,
    subtotal,
  });
  await savePo(client.id, po);
  const materialised = await materialise(development.id);
  const orderKey = buildSubcontractOrderKey(development.id, sid, costCode);
  const pkg = materialised.packages.find((item) => item.orderKey === orderKey);
  assert.ok(pkg, "expected materialised package");
  const period = await createPeriod(development.id, {
    commentary: { keyCommercialIssues: "Approve snapshot commentary" },
  });
  if (inputs.length) await putInputs(development.id, period.id, inputs);
  return { client, development, pkg, period, po, supplierId: sid };
}

async function submitPeriod(developmentId, periodId, actor = "QS") {
  const res = await request(app)
    .post(`${periodUrl(developmentId, periodId)}/submit`)
    .send({ actor });
  assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
  return res.body;
}

function findRow(snapshot, costCodeKey) {
  return (snapshot?.rows || []).find(
    (row) => String(row.costCodeKey).toLowerCase() === String(costCodeKey).toLowerCase()
  );
}

function assertMoney(actual, expected, label) {
  assert.equal(Number(actual), expected, `${label} expected ${expected}, got ${actual}`);
}

function assertTotals(snapshot, expected) {
  assert.ok(snapshot);
  for (const [key, value] of Object.entries(expected)) {
    assertMoney(snapshot[key], value, `total.${key}`);
  }
}

function assertRow(snapshot, costCodeKey, expected) {
  const row = findRow(snapshot, costCodeKey);
  assert.ok(row, `missing row ${costCodeKey}`);
  for (const [key, value] of Object.entries(expected)) {
    assertMoney(row[key], value, `${costCodeKey}.${key}`);
  }
}

async function snapshotCounts(periodId) {
  const headers = await pool.query(
    `SELECT COUNT(*)::int AS n FROM cvr_period_snapshots WHERE period_id = $1`,
    [periodId]
  );
  const rows = await pool.query(
    `SELECT COUNT(*)::int AS n FROM cvr_period_snapshot_rows WHERE snapshot_id IN (
       SELECT id FROM cvr_period_snapshots WHERE period_id = $1
     )`,
    [periodId]
  );
  return { headers: headers.rows[0].n, rows: rows.rows[0].n };
}

async function auditActions(periodId) {
  const { rows } = await pool.query(
    `
      SELECT action, actor, comment, prior_status, new_status
      FROM cvr_period_audit
      WHERE period_id = $1
      ORDER BY created_at ASC
    `,
    [periodId]
  );
  return rows;
}

async function assertRolledBack(clientId, developmentId, periodId) {
  const loaded = await getCvrPeriod(clientId, developmentId, periodId);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.period.status, "submitted");
  assert.equal(loaded.period.snapshot, null);
  const counts = await snapshotCounts(periodId);
  assert.equal(counts.headers, 0);
  assert.equal(counts.rows, 0);
  const audit = await auditActions(periodId);
  assert.equal(audit.some((item) => item.action === "locked"), false);
  assert.equal(audit.some((item) => item.action === "approved"), false);
}

async function setupTestSite1Fixture() {
  const client = await getActiveClient();
  const development = await createDevelopment({ developmentName: "Test Site 1 fixture" });
  const wipeSupplier = "sup-wipe-fixture";
  const otherSupplier = "sup-other-fixture";

  await savePo(
    client.id,
    buildPo({
      poNumber: uniquePo("S-WIPE"),
      development,
      supplierId: wipeSupplier,
      costCode: "5231",
      subtotal: 50000,
    })
  );
  await savePo(
    client.id,
    buildPo({
      poNumber: uniquePo("S-OTH"),
      development,
      supplierId: otherSupplier,
      costCode: "5218",
      subtotal: OTHER_COMMITTED,
    })
  );
  const materialised = await materialise(development.id);
  const wipeKey = buildSubcontractOrderKey(development.id, wipeSupplier, "5231");
  const wipePkg = materialised.packages.find((item) => item.orderKey === wipeKey);
  assert.ok(wipePkg);

  const period = await createPeriod(development.id, {
    periodKey: "P01",
    commentary: { keyCommercialIssues: "Fixture commentary" },
  });
  await putInputs(development.id, period.id, [
    {
      costCodeKey: "5231",
      costCodeLabel: "5231 — Cleaning",
      originalBudget: 0,
      currentBudget: 0,
      manualAccrual: 100,
      commercialAdjustment: 500,
      adjustmentReason: "BL-031D UAT test adjustment",
    },
    {
      costCodeKey: "5218",
      costCodeLabel: "5218 — Carpentry",
      originalBudget: 0,
      currentBudget: 0,
    },
  ]);

  await insertCommercialEvent({
    clientId: client.id,
    development,
    pkg: wipePkg,
    value: 250,
    eventType: "variation",
    status: "approved",
    description: "CE-0020 fixture",
  });
  await insertCommercialEvent({
    clientId: client.id,
    development,
    pkg: wipePkg,
    value: -100,
    eventType: "contraCharge",
    relationshipType: "recovery",
    status: "approved",
    description: "CE-0021 fixture",
  });

  await insertLockedCertificate({
    clientId: client.id,
    development,
    pkg: wipePkg,
    certificateNumber: 1,
    grossValue: 1625,
    netValue: 1625,
  });
  await insertLockedCertificate({
    clientId: client.id,
    development,
    pkg: wipePkg,
    certificateNumber: 2,
    grossValue: 375,
    netValue: 375,
  });
  await insertLockedCertificate({
    clientId: client.id,
    development,
    pkg: wipePkg,
    certificateNumber: 3,
    grossValue: 250,
    netValue: 250,
  });
  await insertLockedCertificate({
    clientId: client.id,
    development,
    pkg: wipePkg,
    certificateNumber: 4,
    grossValue: 0,
    netValue: -100,
    recoverySigned: -100,
  });

  await importLedger(development.id, [
    {
      supplier: "Wipe It Cleaners",
      invoiceNumber: "BL031D-UAT-001-ORIGIN",
      transactionDate: "2026-04-01",
      costCodeKey: "5231",
      netAmount: 25,
      vatAmount: 5,
      grossAmount: 30,
    },
    {
      supplier: "Wipe It Cleaners",
      invoiceNumber: "BL031D-UAT-001-REV",
      transactionDate: "2026-04-02",
      costCodeKey: "5231",
      netAmount: -25,
      vatAmount: -5,
      grossAmount: -30,
    },
  ]);

  return { client, development, period, wipePkg };
}

if (!isDbConfigured()) {
  test("BL-031E.3B approve snapshot skipped — TEST_DATABASE_URL not configured", () => {
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

  test("1-11. submitted period approves atomically with snapshot, audit, and response", async () => {
    const world = await setupBase();
    const submitted = await submitPeriod(world.development.id, world.period.id);
    const candidate = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    assert.equal(candidate.canLock, true);

    const locked = await request(app)
      .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
      .send({ actor: "Director", comment: "Lock P01" });
    assert.equal(locked.status, 200, locked.body?.message || JSON.stringify(locked.body));
    assert.equal(locked.body.status, "locked");
    assert.equal(locked.body.version, submitted.version + 1);
    assert.equal(locked.body.approvedBy, "Director");
    assert.ok(locked.body.approvedAt);
    assert.equal(locked.body.snapshotDeferred, false);
    assert.equal(locked.body.snapshotNote, SNAPSHOT_CREATED_NOTE);
    assert.ok(locked.body.snapshot);
    assert.equal(locked.body.snapshot.periodId, world.period.id);
    assert.equal(locked.body.snapshot.clientId, world.client.id);
    assert.equal(locked.body.snapshot.developmentId, world.development.id);
    assert.equal(locked.body.snapshot.rows.length, candidate.snapshot.rows.length);
    assertTotals(locked.body.snapshot, {
      committed: candidate.snapshot.committed,
      certified: candidate.snapshot.certified,
      actualCost: candidate.snapshot.actualCost,
      manualAccrual: candidate.snapshot.manualAccrual,
      currentCost: candidate.snapshot.currentCost,
      systemForecast: candidate.snapshot.systemForecast,
      commercialAdjustment: candidate.snapshot.commercialAdjustment,
      finalForecast: candidate.snapshot.finalForecast,
      costToComplete: candidate.snapshot.costToComplete,
      outstandingCertified: candidate.snapshot.outstandingCertified,
      variance: candidate.snapshot.variance,
    });
    const row5231 = findRow(locked.body.snapshot, "5231");
    assert.ok(row5231);
    assert.equal(row5231.adjustmentReason, "Test adjustment");
    assert.deepEqual(row5231.adjustmentHistory, [{ amount: 500, reason: "Test adjustment" }]);
    assert.equal(locked.body.snapshot.commentary.keyCommercialIssues, "Approve snapshot commentary");
    assert.ok(locked.body.snapshot.sourceReadiness);

    const counts = await snapshotCounts(world.period.id);
    assert.equal(counts.headers, 1);
    assert.equal(counts.rows, candidate.snapshot.rows.length);

    const audit = await auditActions(world.period.id);
    assert.ok(audit.some((item) => item.action === "locked" && item.actor === "Director"));
    assert.ok(
      audit.some(
        (item) =>
          item.action === "approved" &&
          item.prior_status === "submitted" &&
          item.new_status === "locked" &&
          item.comment === SNAPSHOT_CREATED_NOTE
      )
    );
    assert.ok(audit.some((item) => item.action === "locked" && item.comment === "Lock P01"));
  });

  test("12. forced header insert failure rolls back", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    await assert.rejects(
      () =>
        approveCvrPeriod(
          world.client.id,
          world.development.id,
          world.period.id,
          {},
          { actor: "Director", failAfter: "header" }
        ),
      /forced-header-insert-failure/
    );
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("13. forced row insert failure rolls back", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    await assert.rejects(
      () =>
        approveCvrPeriod(
          world.client.id,
          world.development.id,
          world.period.id,
          {},
          { actor: "Director", failAfter: "rows" }
        ),
      /forced-row-insert-failure/
    );
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("14. forced period update failure rolls snapshot back", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    await assert.rejects(
      () =>
        approveCvrPeriod(
          world.client.id,
          world.development.id,
          world.period.id,
          {},
          { actor: "Director", failAfter: "period" }
        ),
      /forced-period-update-failure/
    );
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("15. forced audit failure rolls lock and snapshot back", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    await assert.rejects(
      () =>
        approveCvrPeriod(
          world.client.id,
          world.development.id,
          world.period.id,
          {},
          { actor: "Director", failAfter: "audit" }
        ),
      /forced-audit-failure/
    );
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("16. canLock false returns 409 with blockers and no snapshot", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    const result = await approveCvrPeriod(
      world.client.id,
      world.development.id,
      world.period.id,
      {},
      {
        actor: "Director",
        loadSources: async () => ({
          ok: false,
          sources: {
            development: sourceOk({ id: world.development.id }),
            period: sourceOk(world.period),
            inputs: sourceOk([]),
            purchaseOrders: sourceOk([]),
            commercialEvents: sourceFailure("commercial-events-query-failed"),
            certificates: sourceOk([]),
            ledger: sourceOk([]),
          },
        }),
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.code, CVR_CLOSE_NOT_READY_CODE);
    assert.ok(result.blockers.some((item) => item.source === "commercialEvents"));
    assert.equal(result.blockers[0].error, undefined);
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("17. unresolved certificate gross returns 409 and no lock", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    const unresolved = await approveCvrPeriod(
      world.client.id,
      world.development.id,
      world.period.id,
      {},
      {
        actor: "Director",
        loadSources: async () => ({
          ok: true,
          sources: {
            development: sourceOk({ id: world.development.id }),
            period: sourceOk(world.period),
            inputs: sourceOk([
              { costCodeKey: "5231", costCodeLabel: "Cleaning", currentBudget: 0 },
            ]),
            purchaseOrders: sourceOk([world.po]),
            commercialEvents: sourceOk([]),
            certificates: sourceOk([
              {
                id: "cert-incomplete",
                orderKey: world.pkg.orderKey,
                status: "locked",
                grossValue: null,
                netValue: 0,
                recoverySigned: 0,
                valuationSnapshot: { totals: {} },
              },
            ]),
            ledger: sourceOk([]),
          },
        }),
      }
    );
    assert.equal(unresolved.ok, false);
    assert.equal(unresolved.status, 409);
    assert.equal(unresolved.code, CVR_CLOSE_NOT_READY_CODE);
    assert.ok(
      unresolved.blockers.some((item) => item.reason === "approved-certificate-gross-unresolved")
    );
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("18. stale version returns 409 with no snapshot", async () => {
    const world = await setupBase();
    const submitted = await submitPeriod(world.development.id, world.period.id);
    const stale = await request(app)
      .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
      .send({ actor: "Director", version: submitted.version - 1 });
    assert.equal(stale.status, 409);
    assert.match(stale.body.message, /version conflict/i);
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("19. concurrent approve: exactly one snapshot", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    const [first, second] = await Promise.all([
      request(app)
        .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
        .send({ actor: "Director-A" }),
      request(app)
        .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
        .send({ actor: "Director-B" }),
    ]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const counts = await snapshotCounts(world.period.id);
    assert.equal(counts.headers, 1);
    const loaded = await getCvrPeriod(world.client.id, world.development.id, world.period.id);
    assert.equal(loaded.period.status, "locked");
  });

  test("20. second approve after locked returns 409", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    const first = await request(app)
      .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
      .send({ actor: "Director" });
    assert.equal(first.status, 200);
    const retry = await request(app)
      .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
      .send({ actor: "Director", version: first.body.version });
    assert.equal(retry.status, 409);
    assert.match(retry.body.message, /Locked/i);
    const counts = await snapshotCounts(world.period.id);
    assert.equal(counts.headers, 1);
  });

  test("21. duplicate snapshot constraint cannot produce partial state", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    const result = await approveCvrPeriod(
      world.client.id,
      world.development.id,
      world.period.id,
      {},
      { actor: "Director", failAfter: "duplicateHeader" }
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("22. cross-client cannot approve", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    const tenantB = await createSecondTenant();
    const result = await approveCvrPeriod(
      tenantB.id,
      world.development.id,
      world.period.id,
      {},
      { actor: "Director" }
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("23-24. cross-development cannot approve; snapshot stays on tenant/development", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    const other = await createDevelopment();
    const result = await approveCvrPeriod(
      world.client.id,
      other.id,
      world.period.id,
      {},
      { actor: "Director" }
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);

    const locked = await request(app)
      .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
      .send({ actor: "Director" });
    assert.equal(locked.status, 200);
    assert.equal(locked.body.snapshot.clientId, world.client.id);
    assert.equal(locked.body.snapshot.developmentId, world.development.id);
    const crossed = await pool.query(
      `
        SELECT COUNT(*)::int AS n
        FROM cvr_period_snapshots
        WHERE period_id = $1 AND (client_id <> $2 OR development_id <> $3)
      `,
      [world.period.id, world.client.id, world.development.id]
    );
    assert.equal(crossed.rows[0].n, 0);
  });

  test("25. persisted snapshot rows are not updated by later source changes", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    const locked = await request(app)
      .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
      .send({ actor: "Director" });
    assert.equal(locked.status, 200);
    const frozenCommitted = Number(findRow(locked.body.snapshot, "5231").committed);

    const mutated = {
      ...world.po,
      subtotal: 999999,
      totals: { net: 999999, vat: 0, gross: 999999 },
      items: [{ description: "Works", qty: 1, rate: 999999, amount: 999999, costCode: "5231" }],
    };
    await savePo(world.client.id, mutated);

    const got = await request(app).get(periodUrl(world.development.id, world.period.id));
    assert.equal(got.status, 200);
    assertMoney(findRow(got.body.snapshot, "5231").committed, frozenCommitted, "frozen committed");

    const live = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    assert.notEqual(Number(findRow(live.snapshot, "5231").committed), frozenCommitted);
  });

  test("26. Test Site 1 fixture persists exact 5231 and development totals", async () => {
    const world = await setupTestSite1Fixture();
    const candidate = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    assertRow(candidate.snapshot, "5231", EXPECTED_5231);
    assertTotals(candidate.snapshot, EXPECTED_DEV);

    await submitPeriod(world.development.id, world.period.id);
    const locked = await request(app)
      .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
      .send({ actor: "Director" });
    assert.equal(locked.status, 200, locked.body?.message || JSON.stringify(locked.body));
    assertRow(locked.body.snapshot, "5231", EXPECTED_5231);
    assertTotals(locked.body.snapshot, EXPECTED_DEV);
    assert.equal(locked.body.snapshot.rows.length, candidate.snapshot.rows.length);
  });

  test("delete of a locked period with a snapshot is restricted; no CVR delete route", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    const locked = await request(app)
      .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
      .send({ actor: "Director" });
    assert.equal(locked.status, 200);
    await assert.rejects(
      () => pool.query(`DELETE FROM cvr_periods WHERE id = $1`, [world.period.id]),
      /restrict|violates foreign key/i
    );
    const still = await snapshotCounts(world.period.id);
    assert.equal(still.headers, 1);
    const routes = fs.readFileSync(CVR_ROUTES, "utf8");
    assert.equal(/router\.delete\s*\(/i.test(routes), false);
  });

  test("close-engine queries honour the approval transaction client", async () => {
    const world = await setupBase();
    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");
      await dbClient.query(
        `
          UPDATE cvr_cost_code_inputs
          SET manual_accrual = 999
          WHERE client_id = $1 AND period_id = $2 AND cost_code_key = '5231'
        `,
        [world.client.id, world.period.id]
      );
      const txCandidate = await buildCvrCloseCandidate({
        clientId: world.client.id,
        developmentId: world.development.id,
        periodId: world.period.id,
        dbClient,
      });
      const poolCandidate = await buildCvrCloseCandidate({
        clientId: world.client.id,
        developmentId: world.development.id,
        periodId: world.period.id,
      });
      assertMoney(findRow(txCandidate.snapshot, "5231").manualAccrual, 999, "tx accrual");
      assertMoney(findRow(poolCandidate.snapshot, "5231").manualAccrual, 100, "pool accrual");
      await dbClient.query("ROLLBACK");
    } finally {
      dbClient.release();
    }
  });

  test("legacy locked period without a snapshot is left untouched", async () => {
    const world = await setupBase();
    await pool.query(
      `
        UPDATE cvr_periods
        SET
          status = 'locked',
          submitted_at = NOW(),
          submitted_by = 'legacy',
          approved_at = NOW(),
          approved_by = 'legacy',
          version = version + 1
        WHERE id = $1
      `,
      [world.period.id]
    );
    const loaded = await getCvrPeriod(world.client.id, world.development.id, world.period.id);
    assert.equal(loaded.period.status, "locked");
    assert.equal(loaded.period.snapshot, null);
    assert.equal(loaded.period.snapshotDeferred, true);
    const counts = await snapshotCounts(world.period.id);
    assert.equal(counts.headers, 0);
    const approve = await approveCvrPeriod(
      world.client.id,
      world.development.id,
      world.period.id,
      {},
      { actor: "Director" }
    );
    assert.equal(approve.ok, false);
    assert.equal(approve.status, 409);
    const after = await snapshotCounts(world.period.id);
    assert.equal(after.headers, 0);
  });
}
