/**
 * BL-031E.2 — Server CVR close-engine integration tests (buildlite_test only).
 * Does not persist snapshots. Does not touch buildlite_clone.
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

const app = createApp();
const MIGRATION_004 = path.join(__dirname, "..", "migrations", "004_developments.sql");
const MIGRATION_005 = path.join(__dirname, "..", "migrations", "005_packages.sql");
const MIGRATION_006 = path.join(__dirname, "..", "migrations", "006_commercial_events.sql");
const MIGRATION_008 = path.join(__dirname, "..", "migrations", "008_package_payment_certificates.sql");
const MIGRATION_009 = path.join(__dirname, "..", "migrations", "009_cvr_and_purchase_ledger.sql");
const MIGRATION_010 = path.join(__dirname, "..", "migrations", "010_cvr_period_snapshots.sql");
const MIGRATION_021 = path.join(__dirname, "..", "migrations", "021_commercial_event_expected_liability.sql");

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
  await pool.query(fs.readFileSync(MIGRATION_021, "utf8"));
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
  const code = `TESTCLOSE_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const { rows } = await pool.query(
    `
      INSERT INTO clients (code, name, is_active)
      VALUES ($1, $2, false)
      RETURNING id, code, name
    `,
    [code, "Close Engine Tenant B"]
  );
  trackTenant(rows[0].id);
  return rows[0];
}

async function createDevelopment(overrides = {}) {
  const id = overrides.id || `dev-close-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const res = await request(app).post("/api/developments").send({
    id,
    jobNumber: overrides.jobNumber || `DEV-CLOSE-${Date.now()}`,
    developmentName: overrides.developmentName || "Close Engine Test Dev",
    status: "live",
  });
  assert.equal(res.status, 201);
  trackDevelopment(res.body.id);
  return res.body;
}

function buildPo({
  poNumber,
  development,
  supplierId = "sup-close-1",
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
      originalFileName: "close-engine.csv",
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
  description = "Close engine CE",
}) {
  const id = `ce-close-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const eventNumber = `CE-CLOSE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
        NOW(), 'close-engine-test'
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

function uniquePo(prefix = "S-CL") {
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
  const period = await createPeriod(development.id);
  if (inputs.length) await putInputs(development.id, period.id, inputs);
  return { client, development, pkg, period, po, supplierId: sid };
}

function findRow(result, costCodeKey) {
  return result.snapshot.rows.find(
    (row) => String(row.costCodeKey).toLowerCase() === String(costCodeKey).toLowerCase()
  );
}

function assertMoney(actual, expected, label) {
  assert.equal(Number(actual), expected, `${label} expected ${expected}, got ${actual}`);
}

function assertTotals(result, expected) {
  assert.equal(result.ready, true);
  assert.equal(result.complete, true);
  assert.ok(result.snapshot);
  for (const [key, value] of Object.entries(expected)) {
    assertMoney(result.snapshot[key], value, `total.${key}`);
  }
}

function assertRow(result, costCodeKey, expected) {
  const row = findRow(result, costCodeKey);
  assert.ok(row, `missing row ${costCodeKey}`);
  for (const [key, value] of Object.entries(expected)) {
    assertMoney(row[key], value, `${costCodeKey}.${key}`);
  }
}

function reconcileTotals(result) {
  const rows = result.snapshot.rows;
  const fields = [
    "currentBudget",
    "committed",
    "certified",
    "actualCost",
    "manualAccrual",
    "currentCost",
    "systemForecast",
    "commercialAdjustment",
    "finalForecast",
    "costToComplete",
    "outstandingCertified",
    "variance",
  ];
  for (const field of fields) {
    const sum = rows.reduce((total, row) => total + Number(row[field] || 0), 0);
    assert.equal(
      Math.round(sum * 100) / 100,
      Number(result.snapshot[field]),
      `total ${field} must equal sum of rows`
    );
  }
}

async function snapshotCount() {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM cvr_period_snapshots`);
  return rows[0].n;
}

if (!isDbConfigured()) {
  test("BL-031E.2 close engine skipped — TEST_DATABASE_URL not configured", () => {
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

  test("1. PO-only commitment", async () => {
    const world = await setupBase();
    const before = await snapshotCount();
    const result = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    assert.equal(result.ready, true);
    assertRow(result, "5231", { committed: 50000, systemForecast: 50000 });
    assert.equal(await snapshotCount(), before);
  });

  test("BL-038B submitted default expected liability does not move CVR money", async () => {
    const world = await setupBase();
    const snapshotsBefore = await snapshotCount();
    const before = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    const rowBefore = findRow(before, "5231");
    await insertCommercialEvent({
      clientId: world.client.id,
      development: world.development,
      pkg: world.pkg,
      value: 20000,
      eventType: "variation",
      status: "submitted",
      description: "BL-038B submitted expected must not enter close money",
    });
    const after = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    assert.equal(after.ready, true);
    assertRow(after, "5231", {
      committed: Number(rowBefore.committed),
      certified: Number(rowBefore.certified),
      actualCost: Number(rowBefore.actualCost),
      systemForecast: Number(rowBefore.systemForecast),
      commercialAdjustment: Number(rowBefore.commercialAdjustment),
      finalForecast: Number(rowBefore.finalForecast),
      costToComplete: Number(rowBefore.costToComplete),
    });
    assert.equal(after.snapshot.periodId, before.snapshot.periodId);
    assert.equal(after.snapshot.periodKey, before.snapshot.periodKey);
    assert.equal(await snapshotCount(), snapshotsBefore);
  });

  test("2. PO + approved variation", async () => {
    const world = await setupBase();
    await insertCommercialEvent({
      clientId: world.client.id,
      development: world.development,
      pkg: world.pkg,
      value: 250,
      eventType: "variation",
      status: "approved",
    });
    const result = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    assertRow(result, "5231", { committed: 50250 });
  });

  test("3. negative non-recovery contra reduces commitment", async () => {
    const world = await setupBase();
    await insertCommercialEvent({
      clientId: world.client.id,
      development: world.development,
      pkg: world.pkg,
      value: -1000,
      eventType: "contraCharge",
      status: "approved",
      relationshipType: null,
    });
    const result = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    assertRow(result, "5231", { committed: 49000 });
  });

  test("4. recovery relationship excluded from commitment", async () => {
    const world = await setupBase();
    await insertCommercialEvent({
      clientId: world.client.id,
      development: world.development,
      pkg: world.pkg,
      value: 250,
      eventType: "variation",
    });
    await insertCommercialEvent({
      clientId: world.client.id,
      development: world.development,
      pkg: world.pkg,
      value: -100,
      eventType: "contraCharge",
      relationshipType: "recovery",
      description: "Recovery",
    });
    const result = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    assertRow(result, "5231", { committed: 50250 });
  });

  test("5. draft/rejected CE excluded", async () => {
    const world = await setupBase();
    await insertCommercialEvent({
      clientId: world.client.id,
      development: world.development,
      pkg: world.pkg,
      value: 999,
      status: "draft",
    });
    await insertCommercialEvent({
      clientId: world.client.id,
      development: world.development,
      pkg: world.pkg,
      value: 888,
      status: "rejected",
    });
    await insertCommercialEvent({
      clientId: world.client.id,
      development: world.development,
      pkg: world.pkg,
      value: 250,
      status: "closed",
    });
    const result = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    assertRow(result, "5231", { committed: 50250 });
  });

  test("6. multiple POs/cost codes do not double count", async () => {
    const world = await setupBase({ subtotal: 10000 });
    await savePo(
      world.client.id,
      buildPo({
        poNumber: uniquePo(),
        development: world.development,
        supplierId: world.supplierId,
        costCode: "5231",
        subtotal: 4000,
      })
    );
    await savePo(
      world.client.id,
      buildPo({
        poNumber: uniquePo(),
        development: world.development,
        supplierId: `sup-b-${Math.random().toString(36).slice(2, 6)}`,
        costCode: "5218",
        subtotal: 20000,
      })
    );
    await savePo(
      world.client.id,
      buildPo({
        poNumber: uniquePo("M-CL"),
        development: world.development,
        supplierId: "sup-mat",
        costCode: "5231",
        subtotal: 500,
        type: "M",
      })
    );
    await materialise(world.development.id);
    await putInputs(world.development.id, world.period.id, [
      { costCodeKey: "5231", costCodeLabel: "Cleaning", currentBudget: 0 },
      { costCodeKey: "5218", costCodeLabel: "Carpentry", currentBudget: 0 },
    ]);
    const result = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    assertRow(result, "5231", { committed: 14500 });
    assertRow(result, "5218", { committed: 20000 });
    assertMoney(result.snapshot.committed, 34500, "dev committed");
  });

  test("7. certified gross works", async () => {
    const world = await setupBase();
    await insertLockedCertificate({
      clientId: world.client.id,
      development: world.development,
      pkg: world.pkg,
      certificateNumber: 1,
      grossValue: 1625,
      netValue: 1625,
    });
    await insertLockedCertificate({
      clientId: world.client.id,
      development: world.development,
      pkg: world.pkg,
      certificateNumber: 2,
      grossValue: 375,
      netValue: 375,
    });
    const result = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    assertRow(result, "5231", { certified: 2000 });
  });

  test("8. signed recovery treatment, not certificate net", async () => {
    const world = await setupBase();
    await insertLockedCertificate({
      clientId: world.client.id,
      development: world.development,
      pkg: world.pkg,
      certificateNumber: 1,
      grossValue: 2250,
      netValue: -100,
      recoverySigned: -100,
    });
    const result = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    assertRow(result, "5231", { certified: 2150 });
  });

  test("9-10. ledger Actual uses NET only; VAT/gross ignored", async () => {
    const world = await setupBase();
    await importLedger(world.development.id, [
      {
        supplier: "Wipe",
        invoiceNumber: "INV-NET",
        transactionDate: "2026-01-15",
        costCodeKey: "5231",
        netAmount: 1000,
        vatAmount: 200,
        grossAmount: 1200,
      },
    ]);
    const result = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    assertRow(result, "5231", { actualCost: 1000, currentCost: 1000 });
  });

  test("11-12. manual accrual and current cost", async () => {
    const world = await setupBase({
      inputs: [
        {
          costCodeKey: "5231",
          costCodeLabel: "Cleaning",
          currentBudget: 0,
          manualAccrual: 100,
        },
      ],
    });
    const result = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    assertRow(result, "5231", { actualCost: 0, manualAccrual: 100, currentCost: 100 });
  });

  test("13-16. system forecast hierarchy", async () => {
    const commitmentWins = await setupBase();
    let result = await buildCvrCloseCandidate({
      clientId: commitmentWins.client.id,
      developmentId: commitmentWins.development.id,
      periodId: commitmentWins.period.id,
    });
    assertRow(result, "5231", { systemForecast: 50000 });

    const budgetFallback = await createDevelopment();
    const periodB = await createPeriod(budgetFallback.id);
    await putInputs(budgetFallback.id, periodB.id, [
      { costCodeKey: "1110", costCodeLabel: "Prelims", currentBudget: 25000, originalBudget: 25000 },
    ]);
    result = await buildCvrCloseCandidate({
      clientId: (await getActiveClient()).id,
      developmentId: budgetFallback.id,
      periodId: periodB.id,
    });
    assertRow(result, "1110", { systemForecast: 25000, committed: 0 });

    const actualFallback = await createDevelopment();
    const periodC = await createPeriod(actualFallback.id);
    await putInputs(actualFallback.id, periodC.id, [
      { costCodeKey: "2300", costCodeLabel: "Site", currentBudget: 0, originalBudget: 0 },
    ]);
    await importLedger(actualFallback.id, [
      {
        supplier: "Plant",
        invoiceNumber: "ACT-1",
        transactionDate: "2026-02-01",
        costCodeKey: "2300",
        netAmount: 80,
      },
    ]);
    result = await buildCvrCloseCandidate({
      clientId: (await getActiveClient()).id,
      developmentId: actualFallback.id,
      periodId: periodC.id,
    });
    assertRow(result, "2300", { systemForecast: 80, actualCost: 80 });

    const zeroFallback = await createDevelopment();
    const periodD = await createPeriod(zeroFallback.id);
    await putInputs(zeroFallback.id, periodD.id, [
      { costCodeKey: "9999", costCodeLabel: "Empty", currentBudget: 0, originalBudget: 0 },
    ]);
    result = await buildCvrCloseCandidate({
      clientId: (await getActiveClient()).id,
      developmentId: zeroFallback.id,
      periodId: periodD.id,
    });
    assertRow(result, "9999", { systemForecast: 0, finalForecast: 0 });
  });

  test("17-21. commercial adjustment, final forecast, CTC, outstanding certified, variance", async () => {
    const world = await setupBase({
      inputs: [
        {
          costCodeKey: "5231",
          costCodeLabel: "Cleaning",
          currentBudget: 0,
          originalBudget: 0,
          commercialAdjustment: 500,
          adjustmentReason: "Test adjustment",
          manualAccrual: 100,
        },
      ],
    });
    await insertLockedCertificate({
      clientId: world.client.id,
      development: world.development,
      pkg: world.pkg,
      grossValue: 2150,
      netValue: 2000,
      recoverySigned: 0,
    });
    const result = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    assertRow(result, "5231", {
      commercialAdjustment: 500,
      finalForecast: 50500,
      currentCost: 100,
      costToComplete: 50400,
      outstandingCertified: 2150,
      variance: -50500,
    });
  });

  test("22. development totals reconcile exactly to rows", async () => {
    const world = await setupBase();
    await savePo(
      world.client.id,
      buildPo({
        poNumber: uniquePo(),
        development: world.development,
        supplierId: "sup-other",
        costCode: "5218",
        subtotal: 8000,
      })
    );
    await materialise(world.development.id);
    await putInputs(world.development.id, world.period.id, [
      {
        costCodeKey: "5231",
        costCodeLabel: "Cleaning",
        currentBudget: 0,
        commercialAdjustment: 10,
        adjustmentReason: "Reconcile test",
      },
      { costCodeKey: "5218", costCodeLabel: "Carpentry", currentBudget: 0 },
    ]);
    const result = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    reconcileTotals(result);
  });

  test("23. tenant isolation", async () => {
    const world = await setupBase({ subtotal: 50000 });
    const tenantB = await createSecondTenant();
    const developmentB = `dev-b-${Date.now()}`;
    await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, $4, 'live')
      `,
      [developmentB, tenantB.id, `B-${Date.now()}`, "Tenant B"]
    );
    trackDevelopment(developmentB);
    await savePo(
      tenantB.id,
      buildPo({
        poNumber: uniquePo("S-B"),
        development: { id: developmentB, jobNumber: "B", developmentName: "B" },
        costCode: "5231",
        subtotal: 999999,
      })
    );
    const result = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    assertRow(result, "5231", { committed: 50000 });
  });

  test("24. development isolation", async () => {
    const a = await setupBase({ subtotal: 10000 });
    const b = await setupBase({ subtotal: 77777, supplierId: "sup-other-dev" });
    const result = await buildCvrCloseCandidate({
      clientId: a.client.id,
      developmentId: a.development.id,
      periodId: a.period.id,
    });
    assertRow(result, "5231", { committed: 10000 });
    assert.notEqual(a.development.id, b.development.id);
  });

  test("25. period/input isolation", async () => {
    const world = await setupBase({
      inputs: [
        {
          costCodeKey: "5231",
          costCodeLabel: "Cleaning",
          currentBudget: 0,
          manualAccrual: 100,
          commercialAdjustment: 500,
          adjustmentReason: "P01",
        },
      ],
    });
    const period2 = await pool.query(
      `
        INSERT INTO cvr_periods (
          client_id, development_id, period_key, period_label, status, commentary,
          submitted_at, submitted_by, approved_at, approved_by
        )
        VALUES ($1, $2, 'P02', 'P02', 'locked', '{}'::jsonb, NOW(), 'test', NOW(), 'test')
        RETURNING id
      `,
      [world.client.id, world.development.id]
    );
    await pool.query(
      `
        INSERT INTO cvr_cost_code_inputs (
          client_id, period_id, cost_code_key, cost_code_label,
          manual_accrual, commercial_adjustment, adjustment_reason
        )
        VALUES ($1, $2, '5231', 'Cleaning', 9999, 8888, 'P02 overlay')
      `,
      [world.client.id, period2.rows[0].id]
    );
    const p01 = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    const p02 = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: period2.rows[0].id,
    });
    assertRow(p01, "5231", { manualAccrual: 100, commercialAdjustment: 500 });
    assertRow(p02, "5231", { manualAccrual: 9999, commercialAdjustment: 8888 });
    assertRow(p01, "5231", { committed: 50000 });
    assertRow(p02, "5231", { committed: 50000 });
  });

  test("26. unavailable/incomplete source produces NOT READY rather than invented £0", async () => {
    const world = await setupBase();
    const missingPeriod = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: "00000000-0000-4000-8000-000000000099",
    });
    assert.equal(missingPeriod.ready, false);
    assert.equal(missingPeriod.complete, false);
    assert.equal(missingPeriod.canLock, false);
    assert.equal(missingPeriod.snapshot, null);
    assert.ok(missingPeriod.blockers.some((item) => item.source === "period"));

    const ceUnavailable = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
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
    });
    assert.equal(ceUnavailable.ready, false);
    assert.equal(ceUnavailable.snapshot, null);
    assert.ok(
      ceUnavailable.blockers.some((item) => item.source === "commercialEvents")
    );

    const unresolvedCert = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
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
    });
    assert.equal(unresolvedCert.ready, false);
    assert.equal(unresolvedCert.snapshot, null);
    assert.ok(
      unresolvedCert.blockers.some(
        (item) => item.reason === "approved-certificate-gross-unresolved"
      )
    );
  });

  test("Test Site 1 fixture: 5231 and development totals", async () => {
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

    const period = await createPeriod(development.id, { periodKey: "P01" });
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

    const before = await snapshotCount();
    const result = await buildCvrCloseCandidate({
      clientId: client.id,
      developmentId: development.id,
      periodId: period.id,
    });
    assert.equal(result.ready, true);
    assertRow(result, "5231", EXPECTED_5231);
    assertTotals(result, EXPECTED_DEV);
    reconcileTotals(result);
    assert.equal(await snapshotCount(), before, "close engine must not persist a snapshot");
  });
}
