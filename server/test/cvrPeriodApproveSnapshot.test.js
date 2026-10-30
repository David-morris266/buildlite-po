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
const { buildCvrRevenueCloseCandidate } = require("../services/cvrRevenueClose");
const {
  loadCvrCloseSources,
  sourceFailure,
  sourceOk,
} = require("../services/cvrCloseSources");
const {
  SNAPSHOT_CREATED_NOTE,
  CVR_CLOSE_NOT_READY_CODE,
} = require("../services/cvrPeriodConstants");
const { approveCvrPeriod, getCvrPeriod } = require("../services/cvrPeriodRepository");
const { PERMISSIONS } = require("../auth/permissions");

const app = createApp();
const MIGRATION_004 = path.join(__dirname, "..", "migrations", "004_developments.sql");
const MIGRATION_005 = path.join(__dirname, "..", "migrations", "005_packages.sql");
const MIGRATION_006 = path.join(__dirname, "..", "migrations", "006_commercial_events.sql");
const MIGRATION_008 = path.join(__dirname, "..", "migrations", "008_package_payment_certificates.sql");
const MIGRATION_009 = path.join(__dirname, "..", "migrations", "009_cvr_and_purchase_ledger.sql");
const MIGRATION_010 = path.join(__dirname, "..", "migrations", "010_cvr_period_snapshots.sql");
const MIGRATION_011 = path.join(
  __dirname,
  "..",
  "migrations",
  "011_development_revenue_settings.sql"
);
const MIGRATION_012 = path.join(
  __dirname,
  "..",
  "migrations",
  "012_cvr_period_snapshot_revenue.sql"
);
const MIGRATION_021 = path.join(
  __dirname,
  "..",
  "migrations",
  "021_commercial_event_expected_liability.sql"
);
const MIGRATION_022 = path.join(
  __dirname,
  "..",
  "migrations",
  "022_cvr_snapshot_expected_liability.sql"
);
const MIGRATION_069 = path.join(__dirname, "..", "migrations", "069_cvr_snapshot_plot_master_gia.sql");
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
  await pool.query(fs.readFileSync(MIGRATION_011, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_012, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_021, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_022, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_069, "utf8"));
  // Migration 012 is intentionally replayed by this legacy fixture. Restore the
  // production Migration 049 mode-aware constraint it supersedes.
  await pool.query(`
    ALTER TABLE cvr_period_snapshots DROP CONSTRAINT IF EXISTS chk_cvr_snapshot_revenue_presence;
    ALTER TABLE cvr_period_snapshots ADD CONSTRAINT chk_cvr_snapshot_revenue_presence CHECK (
      (schema_version = 1 AND forecast_revenue IS NULL AND secured_revenue IS NULL
        AND remaining_forecast_revenue IS NULL AND plots_sold IS NULL AND plots_remaining IS NULL
        AND gross_profit IS NULL AND gross_margin_percent IS NULL)
      OR
      (schema_version >= 2 AND forecast_revenue IS NOT NULL AND gross_profit IS NOT NULL AND (
        (COALESCE(revenue_assumptions->>'revenueMode','sales_register') = 'sales_register'
          AND secured_revenue IS NOT NULL AND remaining_forecast_revenue IS NOT NULL
          AND plots_sold IS NOT NULL AND plots_remaining IS NOT NULL)
        OR
        (revenue_assumptions->>'revenueMode' = 'summary'
          AND secured_revenue IS NULL AND remaining_forecast_revenue IS NULL
          AND plots_sold IS NULL AND plots_remaining IS NULL)
      ))
    )
  `);
}

async function cleanup() {
  if (testDevelopmentIds.length) {
    await pool.query("DELETE FROM variation_orders WHERE development_id = ANY($1::text[])", [
      testDevelopmentIds,
    ]);
  }
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
      ON CONFLICT (client_id, po_number)
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
  await pool.query(`INSERT INTO cvr_periods(client_id,development_id,period_key,period_label,status,commentary,version,budget_source,submitted_at,submitted_by,approved_at,approved_by)
    SELECT client_id,$1,'P00','Legacy baseline','locked','{}',1,'legacy_cvr',NOW(),'legacy-test',NOW(),'legacy-test'
    FROM developments d
    WHERE d.id=$1
      AND NOT EXISTS (
        SELECT 1 FROM cvr_periods p
        WHERE p.client_id=d.client_id AND p.development_id=$1 AND p.period_key='P00'
      )`, [developmentId]);
  const existing = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM cvr_periods
     WHERE development_id=$1 AND period_key <> 'P00'`,
    [developmentId]
  );
  const reportingMonth = new Date(Date.UTC(2026, 5 + Number(existing.rows[0].count || 0), 1))
    .toISOString()
    .slice(0, 7);
  const res = await request(app)
    .post(`/api/developments/${encodeURIComponent(developmentId)}/cvr/periods`)
    .send({ reportingMonth, ...body });
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
  const client = await getActiveClient();
  const res = await request(app)
    .post(`/api/developments/${encodeURIComponent(developmentId)}/ledger/batches`)
    .set('X-BuildLite-Client-Id', client.id)
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
  expectedTreatment = "default",
  expectedAmount = null,
  expectedReason = null,
  costCode = pkg.costCode || pkg.costCodeKey || "5231",
}) {
  const id = `ce-appr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const eventNumber = `CE-APPR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await pool.query(
    `
      INSERT INTO commercial_events (
        id, client_id, development_id, package_id, order_key, event_number,
        event_type, category, responsibility, description, value, status,
        relationship_type, vat_treatment, payload,
        expected_treatment, expected_amount, expected_reason, cost_code
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, 'commercial', 'commercial', $8, $9, $10,
        $11, 'standard', '{}'::jsonb,
        $12, $13, $14, $15
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
      expectedTreatment,
      expectedAmount,
      expectedReason,
      costCode,
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

async function seedDefaultRevenueSettings(developmentId) {
  const result = await pool.query(`
    INSERT INTO development_revenue_settings(client_id,development_id,recognition_policy,created_by,updated_by)
    SELECT client_id,id,'completion','Approve snapshot fixture','Approve snapshot fixture'
    FROM developments WHERE id=$1
    RETURNING *
  `, [developmentId]);
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

async function seedPlotMaster(development, plots, clientId) {
  const tenantApp = createApp({
    testPrincipal: {
      userId: "00000000-0000-0000-0000-000000000001",
      providerUserId: "approve-snapshot-test-user",
      displayName: "Director",
      clientId,
      membershipId: "00000000-0000-0000-0000-000000000002",
      roleKey: "commercial_director",
      roleName: "Commercial Director",
      permissions: [...new Set(Object.values(PERMISSIONS))],
      memberships: [],
    },
  });
  const res = await request(tenantApp)
    .put(`/api/developments/${encodeURIComponent(development.id)}`)
    .send({
      version: development.version,
      plotMaster: { plots },
      actor: "Director",
    });
  assert.equal(res.status, 200, res.body?.message || JSON.stringify(res.body));
  return res.body;
}

async function setupBase({
  costCode = "5231",
  subtotal = 50000,
  supplierId,
  seedRevenue = true,
  plots = null,
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
  if (seedRevenue) await seedDefaultRevenueSettings(development.id);
  let liveDevelopment = development;
  if (Array.isArray(plots)) {
    liveDevelopment = await seedPlotMaster(development, plots, client.id);
  }
  return { client, development: liveDevelopment, pkg, period, po, supplierId: sid };
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
  const plots = await pool.query(
    `SELECT COUNT(*)::int AS n FROM cvr_period_snapshot_plots WHERE snapshot_id IN (
       SELECT id FROM cvr_period_snapshots WHERE period_id = $1
     )`,
    [periodId]
  );
  const gia = await pool.query(
    `SELECT COUNT(*)::int AS n FROM cvr_period_snapshot_gia_evidence WHERE period_id=$1`,
    [periodId]
  );
  return { headers: headers.rows[0].n, rows: rows.rows[0].n, plots: plots.rows[0].n, gia: gia.rows[0].n };
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
  assert.equal(counts.plots, 0);
  assert.equal(counts.gia, 0);
  const audit = await auditActions(periodId);
  assert.equal(audit.some((item) => item.action === "locked"), false);
  assert.equal(audit.some((item) => item.action === "approved"), false);
  const milestone = await pool.query(
    "SELECT COUNT(*)::int AS n FROM development_budget_milestones WHERE site_start_period_id=$1",
    [periodId]
  );
  assert.equal(milestone.rows[0].n, 0);
}

async function assertReconciliationRejected(world, mutateCandidate, expectedInvariant) {
  await submitPeriod(world.development.id, world.period.id);
  const diagnostics = [];
  const buildWholeCvrCloseCandidate = require("../services/cvrCommercialClose").buildWholeCvrCloseCandidate;
  const result = await approveCvrPeriod(
    world.client.id,
    world.development.id,
    world.period.id,
    {},
    {
      actor: "Director",
      reconciliationLogger: (...args) => diagnostics.push(args),
      buildWholeCloseCandidate: async (options) => {
        const candidate = await buildWholeCvrCloseCandidate(options);
        mutateCandidate(candidate);
        return candidate;
      },
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, "CVR_SNAPSHOT_RECONCILIATION_FAILED");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0][1].invariant, expectedInvariant);
  assert.deepEqual(Object.keys(diagnostics[0][1]).sort(), ["invariant", "periodType"]);
  assert.doesNotMatch(result.message, /persisted|candidate|sql|committed|budget/i);
  await assertRolledBack(world.client.id, world.development.id, world.period.id);
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

  await seedDefaultRevenueSettings(development.id);
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
    assert.equal(locked.body.snapshot.schemaVersion, 3);
    assert.equal(locked.body.snapshot.variationExposure.state, "locked");
    assert.equal(locked.body.snapshot.variationExposure.captured, true);
    assert.deepEqual(locked.body.snapshot.variationExposure.document.items, []);
    assert.equal(Number(locked.body.snapshot.expectedLiability), 0);
    assert.equal(Number(locked.body.snapshot.forecastRevenue), 0);
    assert.equal(Number(locked.body.snapshot.securedRevenue), 0);
    assert.equal(Number(locked.body.snapshot.grossProfit), -Number(candidate.snapshot.finalForecast));
    assert.equal(locked.body.snapshot.grossMarginPercent, null);
    assert.ok(locked.body.snapshot.revenueAssumptions);
    assert.ok(Array.isArray(locked.body.snapshot.plots));
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
    assert.equal(Number(row5231.expectedLiability), 0);
    assert.deepEqual(row5231.expectedLiabilityProvenance, []);
    assert.deepEqual(row5231.adjustmentHistory, [{ amount: 500, reason: "Test adjustment" }]);
    assert.equal(locked.body.snapshot.commentary.keyCommercialIssues, "Approve snapshot commentary");
    assert.ok(locked.body.snapshot.sourceReadiness);

    const counts = await snapshotCounts(world.period.id);
    assert.equal(counts.headers, 1);
    assert.equal(counts.rows, candidate.snapshot.rows.length);
    assert.equal(counts.plots, locked.body.snapshot.plots.length);

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

  test("migration 069 compares current xid8 to snapshot xmin with epoch-safe xid semantics", async () => {
    const result = await pool.query(`SELECT
      ('4294967301'::xid8)::xid = '5'::xid AS wrapped_epoch_matches,
      ('4294967301'::xid8)::text::bigint = '5'::xid::text::bigint AS unsafe_full_width_matches`);
    assert.equal(result.rows[0].wrapped_epoch_matches, true);
    assert.equal(result.rows[0].unsafe_full_width_matches, false);
  });

  test("P0-06 approval persists Cost Code floors and reconciles the header from verified rows", async () => {
    const world = await setupBase({
      subtotal: 100,
      inputs: [
        {
          costCodeKey: "5231",
          costCodeLabel: "5231 — Cleaning",
          currentBudget: 100,
          originalBudget: 100,
          manualAccrual: 0,
          commercialAdjustment: -5,
          adjustmentReason: "Do not release committed authority",
        },
        {
          costCodeKey: "6000",
          costCodeLabel: "6000 — Other",
          currentBudget: 100,
          originalBudget: 100,
          manualAccrual: 0,
          commercialAdjustment: -20,
          adjustmentReason: "Release uncommitted allowance",
        },
      ],
    });
    await submitPeriod(world.development.id, world.period.id);
    const locked = await request(app)
      .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
      .send({ actor: "Director", comment: "Lock floored forecast" });
    assert.equal(locked.status, 200, locked.body?.message || JSON.stringify(locked.body));
    assertRow(locked.body.snapshot, "5231", {
      recognisedObligation: 100,
      systemForecast: 100,
      commercialAdjustment: -5,
      finalForecast: 100,
    });
    assertRow(locked.body.snapshot, "6000", {
      recognisedObligation: 0,
      systemForecast: 100,
      commercialAdjustment: -20,
      finalForecast: 80,
    });
    assertMoney(locked.body.snapshot.systemForecast, 200, "header.systemForecast");
    assertMoney(locked.body.snapshot.commercialAdjustment, -25, "header.commercialAdjustment");
    assertMoney(locked.body.snapshot.finalForecast, 180, "header.finalForecast");
    assertMoney(locked.body.snapshot.grossProfit, -180, "header.grossProfit");
    assert.equal(locked.body.snapshot.grossMarginPercent, null);
  });

  test("P0-06 approval reconciles valid decimal-pence composition", async () => {
    const world = await setupBase({
      subtotal: 0,
      inputs: [{
        costCodeKey: "5231",
        costCodeLabel: "5231 — Cleaning",
        currentBudget: 0.1,
        originalBudget: 0.1,
        manualAccrual: 0,
        commercialAdjustment: 0.2,
        adjustmentReason: "Pence reconciliation",
      }],
    });
    await submitPeriod(world.development.id, world.period.id);
    const locked = await request(app)
      .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
      .send({ actor: "Director", comment: "Lock pence forecast" });
    assert.equal(locked.status, 200, locked.body?.message || JSON.stringify(locked.body));
    assertRow(locked.body.snapshot, "5231", { systemForecast: 0.1, commercialAdjustment: 0.2, finalForecast: 0.3 });
    assertMoney(locked.body.snapshot.finalForecast, 0.3, "header.finalForecast");
  });

  test("genuine snapshot reconciliation mismatch returns a controlled conflict and rolls back", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    const buildWholeCvrCloseCandidate = require("../services/cvrCommercialClose").buildWholeCvrCloseCandidate;
    const result = await approveCvrPeriod(
      world.client.id,
      world.development.id,
      world.period.id,
      {},
      {
        actor: "Director",
        buildWholeCloseCandidate: async (options) => {
          const candidate = await buildWholeCvrCloseCandidate(options);
          candidate.snapshot.rows[0].finalForecast += 1;
          candidate.snapshot.finalForecast += 1;
          return candidate;
        },
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.code, "CVR_SNAPSHOT_RECONCILIATION_FAILED");
    assert.match(result.message, /financial evidence did not reconcile/i);
    assert.doesNotMatch(result.message, /persisted|candidate|sql/i);
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("P0-06 rejects manipulated candidate financial evidence and rolls back every approval side effect", async (t) => {
    const cases = [
      {
        name: "recognised obligation",
        invariant: "row_recognised_obligation_formula",
        mutate(candidate) {
          candidate.snapshot.rows[0].recognisedObligation += 1;
        },
      },
      {
        name: "committed value on a floored Cost Code",
        invariant: "row_recognised_obligation_formula",
        mutate(candidate) {
          candidate.snapshot.rows[0].committed += 1;
          candidate.snapshot.committed += 1;
        },
      },
      {
        name: "Change Exposure evidence",
        invariant: "row_change_exposure_evidence",
        mutate(candidate) {
          candidate.snapshot.rows[0].changeExposureEvidence = [{ resultingExposure: 1 }];
        },
      },
      {
        name: "header-only financial value",
        invariant: "header_row_sum_currentBudget",
        mutate(candidate) {
          candidate.snapshot.currentBudget += 1;
        },
      },
      {
        name: "System Forecast and Final Forecast raised together",
        invariant: "row_system_forecast_formula",
        mutate(candidate) {
          candidate.snapshot.rows[0].systemForecast += 1;
          candidate.snapshot.rows[0].finalForecast += 1;
          candidate.snapshot.systemForecast += 1;
          candidate.snapshot.finalForecast += 1;
          candidate.snapshot.grossProfit -= 1;
        },
      },
      {
        name: "Cost Code-to-header aggregation",
        invariant: "header_row_sum_currentBudget",
        mutate(candidate) {
          candidate.snapshot.rows[0].currentBudget += 1;
        },
      },
    ];

    for (const scenario of cases) {
      await t.test(scenario.name, async () => {
        const world = await setupBase();
        await assertReconciliationRejected(world, scenario.mutate, scenario.invariant);
      });
    }
  });

  test("P0-06 rejects an incorrect persisted penny and rolls back", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const periodRow = (await client.query(
        "SELECT * FROM cvr_periods WHERE client_id=$1 AND development_id=$2 AND id=$3 FOR UPDATE",
        [world.client.id, world.development.id, world.period.id]
      )).rows[0];
      const candidate = await require("../services/cvrCommercialClose").buildWholeCvrCloseCandidate({
        clientId: world.client.id,
        developmentId: world.development.id,
        periodId: world.period.id,
        dbClient: client,
      });
      const originalQuery = client.query.bind(client);
      const verificationClient = { query: async (text, params) => {
        const result = await originalQuery(text, params);
        if (/INSERT INTO cvr_period_snapshot_rows/i.test(String(text)) && result.rows?.[0]) {
          return {
            ...result,
            rows: [{ ...result.rows[0], final_forecast: Number(result.rows[0].final_forecast) + 0.01 }],
          };
        }
        return result;
      } };
      await assert.rejects(
        require("../services/cvrSnapshotRepository").persistCvrPeriodSnapshot(
          verificationClient,
          { clientId: world.client.id, developmentId: world.development.id, periodRow, candidate, actor: "Director" }
        ),
        (error) => error.code === "CVR_SNAPSHOT_RECONCILIATION_FAILED" && error.invariant === "persisted_row_finalForecast"
      );
      await client.query("ROLLBACK");
    } finally {
      try { await client.query("ROLLBACK"); } catch (_error) {}
      client.release();
    }
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("P0-06 positive approvals retain each governed floor and signed adjustment behaviour", async (t) => {
    async function approve(world) {
      await submitPeriod(world.development.id, world.period.id);
      const locked = await request(app)
        .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
        .send({ actor: "Director", comment: "Lock governed positive case" });
      assert.equal(locked.status, 200, locked.body?.message || JSON.stringify(locked.body));
      assert.equal(locked.body.status, "locked");
      return locked.body.snapshot;
    }

    await t.test("Certified drives the recognised-obligation floor", async () => {
      const world = await setupBase({
        subtotal: 80,
        inputs: [{ costCodeKey: "5231", currentBudget: 100, originalBudget: 100, commercialAdjustment: -20, adjustmentReason: "Certified floor" }],
      });
      await insertLockedCertificate({ clientId: world.client.id, development: world.development, pkg: world.pkg, grossValue: 110, netValue: 110 });
      const snapshot = await approve(world);
      assertRow(snapshot, "5231", { committed: 80, certified: 110, recognisedObligation: 110, finalForecast: 110 });
    });

    await t.test("Current Cost drives the recognised-obligation floor", async () => {
      const world = await setupBase({
        subtotal: 80,
        inputs: [{ costCodeKey: "5231", currentBudget: 100, originalBudget: 100, commercialAdjustment: -20, adjustmentReason: "Current Cost floor" }],
      });
      await importLedger(world.development.id, [{ supplier: "Current Cost Test", invoiceNumber: uniquePo("INV"), transactionDate: "2026-04-02", costCodeKey: "5231", netAmount: 110, vatAmount: 22, grossAmount: 132 }]);
      const snapshot = await approve(world);
      assertRow(snapshot, "5231", { committed: 80, currentCost: 110, recognisedObligation: 110, finalForecast: 110 });
    });

    await t.test("£110 commitment with a £20 favourable adjustment remains £110", async () => {
      const world = await setupBase({
        subtotal: 110,
        inputs: [{ costCodeKey: "5231", currentBudget: 100, originalBudget: 100, commercialAdjustment: -20, adjustmentReason: "Commitment floor" }],
      });
      const snapshot = await approve(world);
      assertRow(snapshot, "5231", { committed: 110, recognisedObligation: 110, finalForecast: 110 });
    });

    await t.test("signed CE credit and negative Projected Adjustment remain signed", async () => {
      const world = await setupBase({
        subtotal: 0,
        inputs: [{ costCodeKey: "5231", currentBudget: 100, originalBudget: 100, commercialAdjustment: -5, adjustmentReason: "Signed exposure" }],
      });
      await insertCommercialEvent({ clientId: world.client.id, development: world.development, pkg: world.pkg, value: -10, status: "submitted" });
      const snapshot = await approve(world);
      assertRow(snapshot, "5231", { changeExposure: -10, commercialAdjustment: -5, finalForecast: 85 });
    });

    await t.test("positive Projected Adjustment increases Final Forecast", async () => {
      const world = await setupBase({
        subtotal: 80,
        inputs: [{ costCodeKey: "5231", currentBudget: 100, originalBudget: 100, commercialAdjustment: 10, adjustmentReason: "Positive adjustment" }],
      });
      const snapshot = await approve(world);
      assertRow(snapshot, "5231", { systemForecast: 100, commercialAdjustment: 10, finalForecast: 110 });
    });
  });

  test("BL-038E lock freezes Expected provenance and later approval recomposes Create Next", async () => {
    const world = await setupBase({ inputs: [] });
    const ceId = await insertCommercialEvent({
      clientId: world.client.id,
      development: world.development,
      pkg: world.pkg,
      value: 20000,
      status: "submitted",
    });
    await submitPeriod(world.development.id, world.period.id);
    const locked = await request(app)
      .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
      .send({ actor: "Director", comment: "BL-038E freeze" });
    assert.equal(locked.status, 200, locked.body?.message || JSON.stringify(locked.body));
    const frozenRow = findRow(locked.body.snapshot, "5231");
    assert.equal(locked.body.snapshot.schemaVersion, 3);
    assert.equal(Number(locked.body.snapshot.expectedLiability), 20000);
    assert.equal(Number(frozenRow.systemForecast), 50000);
    assert.equal(Number(frozenRow.expectedLiability), 20000);
    assert.equal(Number(frozenRow.finalForecast), 70000);
    assert.equal(frozenRow.expectedLiabilityProvenance.length, 1);
    assert.deepEqual(frozenRow.expectedLiabilityProvenance[0], {
      ceId,
      ceReference: frozenRow.expectedLiabilityProvenance[0].eventNumber,
      eventNumber: frozenRow.expectedLiabilityProvenance[0].eventNumber,
      costCode: "5231",
      factualValue: 20000,
      statusAtLock: "submitted",
      expectedTreatment: "default",
      overrideAmount: null,
      effectiveExpectedAmount: 20000,
      reason: null,
    });

    await pool.query(
      `UPDATE commercial_events
       SET status = 'approved', value = 25000, expected_treatment = 'override',
           expected_amount = 999, expected_reason = 'Later live change', version = version + 1
       WHERE id = $1 AND client_id = $2`,
      [ceId, world.client.id]
    );
    const historic = await getCvrPeriod(world.client.id, world.development.id, world.period.id);
    const historicRow = findRow(historic.period.snapshot, "5231");
    assert.equal(Number(historic.period.snapshot.expectedLiability), 20000);
    assert.equal(Number(historicRow.expectedLiability), 20000);
    assert.equal(Number(historicRow.finalForecast), 70000);
    assert.equal(historicRow.expectedLiabilityProvenance[0].factualValue, 20000);

    const next = await createPeriod(world.development.id);
    const nextCandidate = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: next.id,
    });
    const nextRow = findRow(nextCandidate.snapshot, "5231");
    assert.equal(Number(nextRow.committed), 75000);
    assert.equal(Number(nextRow.systemForecast), 75000);
    assert.equal(Number(nextRow.expectedLiability), 0);
    assert.equal(Number(nextRow.finalForecast), 75000);
  });

  test("BL-038E Create Next recomputes a still-submitted fact-only Expected without overlay copy", async () => {
    const world = await setupBase({ costCode: "7777", inputs: [] });
    await insertCommercialEvent({
      clientId: world.client.id,
      development: world.development,
      pkg: world.pkg,
      value: 15000,
      status: "submitted",
      expectedTreatment: "override",
      expectedAmount: 12000,
      expectedReason: "Current QS view",
      costCode: "7777",
    });
    await submitPeriod(world.development.id, world.period.id);
    const locked = await request(app)
      .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
      .send({ actor: "Director" });
    assert.equal(locked.status, 200, locked.body?.message || JSON.stringify(locked.body));
    const next = await createPeriod(world.development.id);
    const nextInputs = await pool.query(
      "SELECT * FROM cvr_cost_code_inputs WHERE period_id = $1",
      [next.id]
    );
    assert.equal(nextInputs.rows.length, 0);
    const candidate = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: next.id,
    });
    const nextRow = findRow(candidate.snapshot, "7777");
    assert.ok(nextRow);
    assert.equal(Number(nextRow.expectedLiability), 12000);
    assert.equal(Number(nextRow.finalForecast), 62000);
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

  test("approval freezes one repeatable-read view across PO, CE, VO, certificate, and ledger changes", async () => {
    const world = await setupBase();
    const latePo = buildPo({
      poNumber: uniquePo(),
      development: world.development,
      supplierId: world.supplierId,
      costCode: "5231",
      subtotal: 1000,
      type: "M",
      approvalStatus: "Draft",
    });
    await savePo(world.client.id, latePo);
    await submitPeriod(world.development.id, world.period.id);

    let releaseApproval;
    const approvalReleased = new Promise((resolve) => { releaseApproval = resolve; });
    let sourceReached;
    const sourceBarrier = new Promise((resolve) => { sourceReached = resolve; });
    const approval = approveCvrPeriod(
      world.client.id,
      world.development.id,
      world.period.id,
      {},
      {
        actor: "Director",
        afterSourceRead: async ({ source }) => {
          if (source !== "purchaseOrders") return;
          sourceReached();
          await approvalReleased;
        },
      }
    );

    await sourceBarrier;
    const inputWriter = await pool.connect();
    try {
      await inputWriter.query("BEGIN");
      await inputWriter.query("SET LOCAL lock_timeout = '250ms'");
      await assert.rejects(
        () => inputWriter.query("SELECT id FROM cvr_periods WHERE id=$1 FOR UPDATE", [world.period.id]),
        (error) => error?.code === "55P03"
      );
      await inputWriter.query("ROLLBACK");
    } finally {
      inputWriter.release();
    }
    const concurrent = await pool.connect();
    try {
      await concurrent.query("BEGIN");
      const approvedPayload = {
        ...latePo,
        status: "Approved",
        approval: { status: "Approved", history: [] },
        updatedAt: new Date().toISOString(),
      };
      await concurrent.query(
        "UPDATE purchase_orders SET payload=$1 WHERE client_id=$2 AND po_number=$3",
        [approvedPayload, world.client.id, latePo.poNumber]
      );
      const ceId = `ce-overlap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      trackCe(ceId);
      await concurrent.query(
        `INSERT INTO commercial_events (
           id, client_id, development_id, package_id, order_key, event_number,
           event_type, category, responsibility, description, value, status,
           vat_treatment, payload, expected_treatment, cost_code
         ) VALUES ($1,$2,$3,$4,$5,$6,'variation','commercial','commercial',
           'Concurrent expected liability',200,'submitted','standard','{}'::jsonb,'default','5231')`,
        [ceId, world.client.id, world.development.id, world.pkg.id, world.pkg.orderKey, uniquePo("CE")]
      );
      const variation = await concurrent.query(
        `INSERT INTO variation_orders (
           client_id, development_id, package_id, order_key, source_po_number,
           supplier_id, variation_order_number, description, status,
           approved_at, approved_by, issued_at, issued_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'Concurrent issued variation','issued',
           NOW(),'Director',NOW(),'Director') RETURNING id`,
        [world.client.id, world.development.id, world.pkg.id, world.pkg.orderKey,
          world.po.poNumber, world.supplierId, uniquePo("VO")]
      );
      await concurrent.query(
        `INSERT INTO variation_order_lines (
           client_id, variation_order_id, line_number, cost_code, description, net_value
         ) VALUES ($1,$2,1,'5231','Concurrent variation line',300)`,
        [world.client.id, variation.rows[0].id]
      );
      await concurrent.query(
        `INSERT INTO package_payment_certificates (
           client_id, package_id, development_id, order_key, certificate_number,
           status, gross_value, net_value, matrix_gross, commercial_event_gross,
           recovery_signed, retention, vat, retention_rate, vat_rate, payload,
           approved_at, approved_by
         ) VALUES ($1,$2,$3,$4,99,'locked',250,250,250,0,0,0,0,0,0,'{}'::jsonb,NOW(),'Director')`,
        [world.client.id, world.pkg.id, world.development.id, world.pkg.orderKey]
      );
      await concurrent.query("COMMIT");
    } finally {
      concurrent.release();
    }
    try {
      await importLedger(world.development.id, [{
        supplier: "Concurrent Ledger Supplier",
        invoiceNumber: uniquePo("INV"),
        transactionDate: "2026-04-03",
        costCodeKey: "5231",
        netAmount: 125,
        vatAmount: 25,
        grossAmount: 150,
      }]);
    } finally {
      releaseApproval();
    }

    const result = await approval;
    assert.equal(result.ok, true, result.message);
    assert.equal(result.period.status, "locked");
    assert.equal(Number(findRow(result.period.snapshot, "5231").committed), 50000);
    assert.equal(Number(findRow(result.period.snapshot, "5231").certified), 0);
    assert.equal(Number(findRow(result.period.snapshot, "5231").actualCost), 0);
    assert.equal(Number(findRow(result.period.snapshot, "5231").expectedLiability), 0);

    const live = await buildCvrCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
      periodId: world.period.id,
    });
    const liveRow = findRow(live.snapshot, "5231");
    assert.equal(Number(liveRow.committed), 51300);
    assert.equal(Number(liveRow.certified), 250);
    assert.equal(Number(liveRow.actualCost), 125);
    assert.equal(Number(liveRow.expectedLiability), 200);
  });

  test("a genuine repeatable-read serialization conflict fails closed with a controlled retry response", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);

    let releaseApproval;
    const approvalReleased = new Promise((resolve) => { releaseApproval = resolve; });
    let sourceReached;
    const sourceBarrier = new Promise((resolve) => { sourceReached = resolve; });
    const approval = approveCvrPeriod(
      world.client.id,
      world.development.id,
      world.period.id,
      {},
      {
        actor: "Director",
        afterSourceRead: async ({ source }) => {
          if (source !== "purchaseOrders") return;
          sourceReached();
          await approvalReleased;
        },
      }
    );

    await sourceBarrier;
    const concurrent = await pool.connect();
    try {
      await concurrent.query("BEGIN");
      await concurrent.query(
        "UPDATE developments SET updated_at=NOW() WHERE client_id=$1 AND id=$2",
        [world.client.id, world.development.id]
      );
      await concurrent.query("COMMIT");
    } finally {
      concurrent.release();
      releaseApproval();
    }

    const result = await approval;
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.code, "CVR_APPROVAL_CONCURRENCY_CONFLICT");
    assert.match(result.message, /refresh the CVR and try again/i);
    assert.doesNotMatch(result.message, /sql|40001|development|financial amount/i);
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("approval lock timeout returns a controlled conflict and leaves no approval evidence", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    const locker = await pool.connect();
    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM cvr_periods WHERE id=$1 FOR UPDATE", [world.period.id]);
      const startedAt = Date.now();
      const response = await request(app)
        .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
        .send({ actor: "Director" });
      assert.equal(response.status, 409);
      assert.equal(response.body.code, "CVR_APPROVAL_CONCURRENCY_CONFLICT");
      assert.match(response.body.message, /refresh the CVR and try again/i);
      assert.doesNotMatch(response.body.message, /sql|55P03|lock timeout|financial amount/i);
      assert.ok(Date.now() - startedAt >= 9000, "approval should wait for the configured lock timeout");
      await locker.query("ROLLBACK");
    } finally {
      locker.release();
    }
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("a genuine PostgreSQL deadlock is propagated through revenue loading and fails approval closed", async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    let deadlockError;
    try {
      await first.query("BEGIN");
      await second.query("BEGIN");
      const firstPid = Number((await first.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      await first.query("SELECT pg_advisory_xact_lock(9100501)");
      await second.query("SELECT pg_advisory_xact_lock(9100502)");
      const firstWait = first.query("SELECT pg_advisory_xact_lock(9100502)");

      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const activity = await pool.query(
          "SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE pid=$1",
          [firstPid]
        );
        waiting = activity.rows[0]?.wait_event_type === "Lock";
      }
      assert.equal(waiting, true, "first transaction must be waiting before completing the deadlock cycle");

      const secondWait = second.query("SELECT pg_advisory_xact_lock(9100501)");
      const outcomes = await Promise.allSettled([firstWait, secondWait]);
      const rejected = outcomes.find((outcome) => outcome.status === "rejected");
      assert.ok(rejected, "PostgreSQL must abort one deadlock participant");
      assert.equal(rejected.reason?.code, "40P01");
      deadlockError = rejected.reason;
    } finally {
      await first.query("ROLLBACK").catch(() => {});
      await second.query("ROLLBACK").catch(() => {});
      first.release();
      second.release();
    }

    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    const result = await approveCvrPeriod(
      world.client.id,
      world.development.id,
      world.period.id,
      {},
      {
        actor: "Director",
        loadDevelopment: async () => { throw deadlockError; },
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.code, "CVR_APPROVAL_CONCURRENCY_CONFLICT");
    assert.match(result.message, /refresh the CVR and try again/i);
    assert.doesNotMatch(result.message, /sql|40P01|deadlock|financial amount/i);
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("cost-source loading propagates concurrency SQLSTATEs and retains ordinary readiness failures", async (t) => {
    const world = await setupBase();
    const cases = [
      { code: "40001", source: "purchaseOrders" },
      { code: "55P03", source: "commercialEvents" },
      { code: "40P01", source: "ledger" },
    ];

    for (const scenario of cases) {
      await t.test(`${scenario.code} propagates from the ${scenario.source} catch boundary`, async () => {
        const dbClient = await pool.connect();
        try {
          await assert.rejects(
            () => loadCvrCloseSources({
              clientId: world.client.id,
              developmentId: world.development.id,
              periodId: world.period.id,
              dbClient,
              afterSourceRead: async ({ source }) => {
                if (source !== scenario.source) return;
                await dbClient.query(
                  `DO $block$ BEGIN RAISE EXCEPTION USING ERRCODE = '${scenario.code}'; END $block$`
                );
              },
            }),
            (error) => error?.code === scenario.code
          );
        } finally {
          dbClient.release();
        }
      });
    }

    await t.test("an unrelated source error remains a readiness blocker", async () => {
      const dbClient = await pool.connect();
      try {
        const result = await loadCvrCloseSources({
          clientId: world.client.id,
          developmentId: world.development.id,
          periodId: world.period.id,
          dbClient,
          afterSourceRead: async ({ source }) => {
            if (source !== "certificates") return;
            await dbClient.query(
              "DO $block$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001'; END $block$"
            );
          },
        });
        assert.equal(result.ok, false);
        assert.equal(result.sources.certificates.loaded, false);
        assert.equal(result.sources.certificates.ready, false);
        assert.equal(result.sources.certificates.reason, "certificates-query-failed");
      } finally {
        dbClient.release();
      }
    });
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

  test("forced plot insert failure rolls back the whole v2 snapshot", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    await assert.rejects(
      () =>
        approveCvrPeriod(
          world.client.id,
          world.development.id,
          world.period.id,
          {},
          { actor: "Director", failAfter: "plots" }
        ),
      /forced-plot-insert-failure/
    );
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("forced assumptions/header failure rolls back", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    await assert.rejects(
      () =>
        approveCvrPeriod(
          world.client.id,
          world.development.id,
          world.period.id,
          {},
          { actor: "Director", failAfter: "assumptions" }
        ),
      /forced-assumptions-insert-failure/
    );
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("missing Revenue settings blocks Approve & Lock without a snapshot", async () => {
    const world = await setupBase({ seedRevenue: false });
    await submitPeriod(world.development.id, world.period.id);
    const result = await approveCvrPeriod(
      world.client.id,
      world.development.id,
      world.period.id,
      {},
      { actor: "Director" }
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.ok(result.blockers.some((item) => item.reason === "revenue-settings-missing"));
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("Revenue load failure rolls back with no partial v2 snapshot", async () => {
    const world = await setupBase();
    await submitPeriod(world.development.id, world.period.id);
    const result = await approveCvrPeriod(
      world.client.id,
      world.development.id,
      world.period.id,
      {},
      {
        actor: "Director",
        loadDevelopment: async () => {
          throw new Error("forced-revenue-load-failure");
        },
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.ok(result.blockers.some((item) => item.reason === "plot-master-query-failed"));
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("invalid secured sellingPrice lists plot numbers and does not freeze £0", async () => {
    const world = await setupBase({
      plots: [
        {
          id: "plot-31",
          plotNumber: "31",
          houseType: "Arundel",
          tenureCode: "OPEN_MARKET",
          revenueStatus: "Exchanged",
          sellingPrice: 0,
          revenueSource: "Manual Value",
          manualForecastValue: 255100,
        },
      ],
    });
    await submitPeriod(world.development.id, world.period.id);
    const result = await approveCvrPeriod(
      world.client.id,
      world.development.id,
      world.period.id,
      { forecastRevenue: 1 },
      { actor: "Director" }
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    const blocker = result.blockers.find(
      (item) => item.reason === "invalid-secured-selling-price"
    );
    assert.ok(blocker);
    assert.deepEqual(blocker.plotNumbers, ["31"]);
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("browser-supplied Revenue totals cannot change snapshot truth", async () => {
    const world = await setupBase({
      plots: [
        {
          id: "plot-1",
          plotNumber: "1",
          houseType: "Arundel",
          tenureCode: "OPEN_MARKET",
          revenueStatus: "Available",
          revenueSource: "Manual Value",
          manualForecastValue: 1000000,
          sellingPrice: 0,
        },
      ],
    });
    await submitPeriod(world.development.id, world.period.id);
    const locked = await request(app)
      .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
      .send({ actor: "Director", forecastRevenue: 1, securedRevenue: 99, grossProfit: 3 });
    assert.equal(locked.status, 200, locked.body?.message || JSON.stringify(locked.body));
    assert.equal(locked.body.snapshot.schemaVersion, 3);
    assert.equal(Number(locked.body.snapshot.forecastRevenue), 1000000);
    assert.equal(Number(locked.body.snapshot.securedRevenue), 0);
    const expectedGrossProfit = 1000000 - Number(locked.body.snapshot.finalForecast);
    assert.equal(Number(locked.body.snapshot.grossProfit), expectedGrossProfit);
    assert.equal(
      Number(locked.body.snapshot.grossMarginPercent),
      (expectedGrossProfit / 1000000) * 100
    );
    assert.notEqual(Number(locked.body.snapshot.grossProfit), 3);
  });

  test("independently imported plot forecasts lock without saved pricing strategy and remain immutable", async () => {
    const plots = [
      { id: "independent-1", plotNumber: "1", houseType: "A", gia: 1000, tenureCode: "OPEN_MARKET", revenueStatus: "Available", revenueSource: "Development Strategy", sellingPrice: 600000 },
      { id: "independent-2", plotNumber: "2", houseType: "B", gia: 900, tenureCode: "AFFORDABLE_RENT", revenueStatus: "Available", revenueSource: "Development Strategy", sellingPrice: 450000 },
    ];
    const world = await setupBase({ seedRevenue: false, plots });
    const settingsBefore = await pool.query(
      "SELECT COUNT(*)::int count FROM development_revenue_settings WHERE client_id=$1 AND development_id=$2",
      [world.client.id, world.development.id]
    );
    assert.equal(settingsBefore.rows[0].count, 0);

    const sourceEvidence = {
      fileName: "independent-plot-forecasts.xlsx",
      worksheet: "Sales Register",
      sha256: "a".repeat(64),
      sourceRowCount: 2,
      mapping: [
        { header: "Plot", destination: "plotNumber" },
        { header: "Forecast", destination: "forecastPrice" },
      ],
    };
    const importBody = {
      version: world.development.version,
      treatment: "forecast_manual_value",
      reason: "Adopt independently reviewed plot forecasts",
      sourceEvidence,
      excludedRows: [],
      updates: [
        { plotId: "independent-1", plotNumber: "1", sourceRowNumber: 2, importedPrice: 600000 },
        { plotId: "independent-2", plotNumber: "2", sourceRowNumber: 3, importedPrice: 450000 },
      ],
    };
    const importPreview = await request(app)
      .post(`/api/developments/${world.development.id}/revenue/sales-register-import/preview`)
      .set("X-BuildLite-Client-Id", world.client.id)
      .send(importBody);
    assert.equal(importPreview.status, 200, importPreview.body?.message);
    assert.equal(importPreview.body.preview.projectedAuthoritativeGdv, 1050000);
    assert.equal(importPreview.body.preview.difference, 0);
    const imported = await request(app)
      .post(`/api/developments/${world.development.id}/revenue/sales-register-import`)
      .set("X-BuildLite-Client-Id", world.client.id)
      .send({ ...importBody, previewFingerprint: importPreview.body.preview.fingerprint });
    assert.equal(imported.status, 200, imported.body?.message);

    const submitted = await submitPeriod(world.development.id, world.period.id);
    assert.equal(submitted.status, "submitted");
    const locked = await request(app)
      .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
      .send({ actor: "Director" });
    assert.equal(locked.status, 200, locked.body?.message || JSON.stringify(locked.body));
    assert.equal(locked.body.status, "locked");
    assert.equal(Number(locked.body.snapshot.forecastRevenue), 1050000);
    assert.equal(
      locked.body.snapshot.plots.reduce((total, plot) => total + Number(plot.forecastRevenue), 0),
      1050000
    );

    const revisedBody = {
      ...importBody,
      version: imported.body.development.version,
      reason: "Adopt later live Revenue evidence",
      sourceEvidence: { ...sourceEvidence, sha256: "b".repeat(64) },
      updates: [
        { plotId: "independent-1", plotNumber: "1", sourceRowNumber: 2, importedPrice: 610000 },
        { plotId: "independent-2", plotNumber: "2", sourceRowNumber: 3, importedPrice: 450000 },
      ],
    };
    const revisedPreview = await request(app)
      .post(`/api/developments/${world.development.id}/revenue/sales-register-import/preview`)
      .set("X-BuildLite-Client-Id", world.client.id)
      .send(revisedBody);
    assert.equal(revisedPreview.status, 200, revisedPreview.body?.message);
    const revised = await request(app)
      .post(`/api/developments/${world.development.id}/revenue/sales-register-import`)
      .set("X-BuildLite-Client-Id", world.client.id)
      .send({ ...revisedBody, previewFingerprint: revisedPreview.body.preview.fingerprint });
    assert.equal(revised.status, 200, revised.body?.message);

    const liveRevenue = await buildCvrRevenueCloseCandidate({
      clientId: world.client.id,
      developmentId: world.development.id,
    });
    assert.equal(liveRevenue.canLock, true);
    assert.equal(liveRevenue.summary.forecastRevenue, 1060000);
    const frozen = await getCvrPeriod(world.client.id, world.development.id, world.period.id);
    assert.equal(frozen.ok, true);
    assert.equal(Number(frozen.period.snapshot.forecastRevenue), 1050000);
    assert.equal(
      frozen.period.snapshot.plots.reduce((total, plot) => total + Number(plot.forecastRevenue), 0),
      1050000
    );
    const settingsAfter = await pool.query(
      "SELECT COUNT(*)::int count FROM development_revenue_settings WHERE client_id=$1 AND development_id=$2",
      [world.client.id, world.development.id]
    );
    assert.equal(settingsAfter.rows[0].count, 0);
  });

  test("Approve & Lock freezes complete governed Plot Master GIA independently of Revenue NIA", async () => {
    const world = await setupBase({ plots: [
      { id: "gia-1", plotNumber: "1", status: "Active", gia: 1076.4, nia: 850, tenureCode: "OPEN_MARKET", revenueStatus: "Available", revenueSource: "Manual Value", manualForecastValue: 100000 },
      { id: "gia-2", plotNumber: "2", status: "inactive", gia: 900, nia: 800, tenureCode: "OPEN_MARKET", revenueStatus: "Available", revenueSource: "Manual Value", manualForecastValue: 90000 },
      { id: "gia-3", plotNumber: "3", gia: 893.2, nia: 950, tenureCode: "OPEN_MARKET", revenueStatus: "Available", revenueSource: "Manual Value", manualForecastValue: 110000 },
    ] });
    await submitPeriod(world.development.id, world.period.id);
    const locked = await request(app).post(`${periodUrl(world.development.id, world.period.id)}/approve`).send({ actor: "Director" });
    assert.equal(locked.status, 200, locked.body?.message || JSON.stringify(locked.body));
    assert.equal(locked.body.snapshot.giaEvidence.availabilityState, "complete");
    assert.equal(locked.body.snapshot.giaEvidence.totalPlotCount, 3);
    assert.equal(locked.body.snapshot.giaEvidence.activePlotCount, 2);
    assert.equal(locked.body.snapshot.giaEvidence.totalActiveGia, 1969.6);
    assert.deepEqual(locked.body.snapshot.giaEvidence.plots.map((row) => row.originalGia), [1076.4, 900, 893.2]);

    await assert.rejects(
      () => pool.query("UPDATE cvr_period_snapshot_gia_evidence SET total_active_gia=1 WHERE period_id=$1", [world.period.id]),
      /immutable/i
    );
    await assert.rejects(
      () => pool.query(`UPDATE cvr_period_snapshot_gia_plots SET original_gia=1
        WHERE snapshot_id=(SELECT id FROM cvr_period_snapshots WHERE period_id=$1)`, [world.period.id]),
      /immutable/i
    );
    await assert.rejects(
      () => pool.query("DELETE FROM cvr_period_snapshot_gia_evidence WHERE period_id=$1", [world.period.id]),
      /immutable/i
    );
    await assert.rejects(
      () => pool.query(`DELETE FROM cvr_period_snapshot_gia_plots
        WHERE snapshot_id=(SELECT id FROM cvr_period_snapshots WHERE period_id=$1)`, [world.period.id]),
      /immutable/i
    );
    const frozenIdentity = await pool.query(
      `SELECT e.id evidence_id,e.snapshot_id FROM cvr_period_snapshot_gia_evidence e WHERE e.period_id=$1`,
      [world.period.id]
    );
    await assert.rejects(
      () => pool.query(`INSERT INTO cvr_period_snapshot_gia_plots
        (client_id,evidence_id,snapshot_id,plot_id,source_index,plot_number,active,original_gia_raw,original_gia,gia_valid)
        VALUES($1,$2,$3,'late-row',999,'late',TRUE,'1',1,TRUE)`,
      [world.client.id, frozenIdentity.rows[0].evidence_id, frozenIdentity.rows[0].snapshot_id]),
      /already finalised/i
    );
    const otherTenant = await createSecondTenant();
    await assert.rejects(
      () => pool.query(`INSERT INTO cvr_period_snapshot_gia_evidence
        (client_id,development_id,period_id,snapshot_id,evidence_schema_version,availability_state,
         total_plot_count,active_plot_count,active_plot_gia_count,captured_valid_active_gia,total_active_gia)
        VALUES($1,$2,$3,$4,1,'complete',1,1,1,1000,1000)`,
      [otherTenant.id, world.development.id, world.period.id, frozenIdentity.rows[0].snapshot_id]),
      /current lock transaction/i
    );
    const leaked = await pool.query(
      "SELECT * FROM cvr_period_snapshot_gia_evidence WHERE client_id=$1 AND period_id=$2",
      [otherTenant.id, world.period.id]
    );
    assert.equal(leaked.rowCount, 0);
  });

  test("incomplete GIA is frozen explicitly and does not add a CVR lock blocker", async () => {
    const world = await setupBase({ plots: [
      { id: "gia-ok", plotNumber: "1", gia: 1000, tenureCode: "OPEN_MARKET", revenueStatus: "Available", revenueSource: "Manual Value", manualForecastValue: 100000 },
      { id: "gia-missing", plotNumber: "2", gia: "", tenureCode: "OPEN_MARKET", revenueStatus: "Available", revenueSource: "Manual Value", manualForecastValue: 100000 },
    ] });
    await submitPeriod(world.development.id, world.period.id);
    const locked = await request(app).post(`${periodUrl(world.development.id, world.period.id)}/approve`).send({ actor: "Director" });
    assert.equal(locked.status, 200, locked.body?.message || JSON.stringify(locked.body));
    assert.equal(locked.body.snapshot.giaEvidence.availabilityState, "incomplete");
    assert.equal(locked.body.snapshot.giaEvidence.capturedValidActiveGia, 1000);
    assert.equal(locked.body.snapshot.giaEvidence.totalActiveGia, null);
  });

  test("a GIA evidence persistence failure rolls back the entire lock transaction", async () => {
    const world = await setupBase({ plots: [{ id: "gia-rollback", plotNumber: "1", gia: 1000, tenureCode: "OPEN_MARKET", revenueStatus: "Available", revenueSource: "Manual Value", manualForecastValue: 100000 }] });
    await submitPeriod(world.development.id, world.period.id);
    await assert.rejects(
      () => approveCvrPeriod(world.client.id, world.development.id, world.period.id, {}, { actor: "Director", failAfter: "giaEvidence" }),
      /forced-gia-evidence-insert-failure/
    );
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("Summary Revenue locks duplicate and oversized GIA source identities without weakening their evidence", async () => {
    const oversized = `plot-${"x".repeat(160)}`;
    const world = await setupBase({ plots: [] });
    await pool.query(`UPDATE developments SET payload=jsonb_set(payload,'{plotMaster,plots}',$1::jsonb,true)
      WHERE client_id=$2 AND id=$3`, [JSON.stringify([
      { id: "duplicate", plotNumber: "1", gia: 850.1 },
      { id: "duplicate", plotNumber: "2", gia: 920.2 },
      { id: oversized, plotNumber: "3", gia: 700 },
    ]), world.client.id, world.development.id]);
    await pool.query(`UPDATE development_revenue_settings SET revenue_mode='summary',
      summary_revenue_lines='[{"id":"private","description":"Private Sales","forecastRevenue":1000000}]'::jsonb
      WHERE client_id=$1 AND development_id=$2`, [world.client.id, world.development.id]);
    await submitPeriod(world.development.id, world.period.id);
    const locked = await request(app).post(`${periodUrl(world.development.id, world.period.id)}/approve`).send({ actor: "Director" });
    assert.equal(locked.status, 200, locked.body?.message || JSON.stringify(locked.body));
    assert.equal(locked.body.snapshot.giaEvidence.availabilityState, "complete");
    assert.equal(locked.body.snapshot.giaEvidence.totalActiveGia, 2470.3);
    assert.deepEqual(locked.body.snapshot.giaEvidence.plots.map((row) => row.sourceIdentityDuplicate), [true, true, false]);
    assert.equal(locked.body.snapshot.giaEvidence.plots[2].sourceIdentityOversized, true);
    assert.equal(locked.body.snapshot.giaEvidence.plots[2].sourcePlotId, oversized);
  });

  test("combined GIA overflow is frozen unavailable without blocking Summary Revenue lock", async () => {
    const world = await setupBase({ plots: [] });
    await pool.query(`UPDATE developments SET payload=jsonb_set(payload,'{plotMaster,plots}',$1::jsonb,true)
      WHERE client_id=$2 AND id=$3`, [JSON.stringify([
      { id: "large-1", plotNumber: "1", gia: "600000000000.0000" },
      { id: "large-2", plotNumber: "2", gia: "600000000000.0000" },
    ]), world.client.id, world.development.id]);
    await pool.query(`UPDATE development_revenue_settings SET revenue_mode='summary',
      summary_revenue_lines='[{"id":"private","description":"Private Sales","forecastRevenue":1000000}]'::jsonb
      WHERE client_id=$1 AND development_id=$2`, [world.client.id, world.development.id]);
    await submitPeriod(world.development.id, world.period.id);
    const locked = await request(app).post(`${periodUrl(world.development.id, world.period.id)}/approve`).send({ actor: "Director" });
    assert.equal(locked.status, 200, locked.body?.message || JSON.stringify(locked.body));
    assert.equal(locked.body.snapshot.giaEvidence.availabilityState, "total_out_of_range");
    assert.equal(locked.body.snapshot.giaEvidence.capturedValidActiveGia, null);
    assert.equal(locked.body.snapshot.giaEvidence.totalActiveGia, null);
    assert.deepEqual(locked.body.snapshot.giaEvidence.plots.map((row) => row.originalGia), [600000000000, 600000000000]);
  });

  test("Sales Register retains duplicate-plot-id as a governed lock blocker", async () => {
    const world = await setupBase({ plots: [] });
    await pool.query(`UPDATE developments SET payload=jsonb_set(payload,'{plotMaster,plots}',$1::jsonb,true)
      WHERE client_id=$2 AND id=$3`, [JSON.stringify([
      { id: "duplicate", plotNumber: "1", gia: 850, tenureCode: "OPEN_MARKET", revenueStatus: "Available", revenueSource: "Manual Value", manualForecastValue: 100000 },
      { id: "duplicate", plotNumber: "2", gia: 920, tenureCode: "OPEN_MARKET", revenueStatus: "Available", revenueSource: "Manual Value", manualForecastValue: 100000 },
    ]), world.client.id, world.development.id]);
    await submitPeriod(world.development.id, world.period.id);
    const locked = await request(app).post(`${periodUrl(world.development.id, world.period.id)}/approve`).send({ actor: "Director" });
    assert.equal(locked.status, 409);
    assert.ok(locked.body.blockers.some((item) => item.reason === "duplicate-plot-id"));
    await assertRolledBack(world.client.id, world.development.id, world.period.id);
  });

  test("retrospective GIA evidence cannot be attached to a legacy locked snapshot", async () => {
    const world = await setupBase();
    await pool.query(`UPDATE cvr_periods SET status='locked',submitted_at=NOW(),submitted_by='legacy',
      approved_at=NOW(),approved_by='legacy' WHERE id=$1`, [world.period.id]);
    const snapshot = await pool.query(`INSERT INTO cvr_period_snapshots
      (client_id,development_id,period_id,period_key,schema_version,created_by)
      VALUES($1,$2,$3,$4,1,'legacy') RETURNING id`,
    [world.client.id, world.development.id, world.period.id, world.period.periodKey]);
    await assert.rejects(() => pool.query(`INSERT INTO cvr_period_snapshot_gia_evidence
      (client_id,development_id,period_id,snapshot_id,evidence_schema_version,availability_state,
       total_plot_count,active_plot_count,active_plot_gia_count,captured_valid_active_gia,total_active_gia)
      VALUES($1,$2,$3,$4,1,'no_active_plots',0,0,0,0,NULL)`,
    [world.client.id, world.development.id, world.period.id, snapshot.rows[0].id]), /current lock transaction/i);
  });

  test("Summary Revenue locks immutable authority and Create Next returns to current live authority", async () => {
    const world = await setupBase({ plots: [] });
    const summaryLines = [
      { id: "private", description: "Private Sales", forecastRevenue: 700000 },
      { id: "affordable", description: "Affordable Housing", forecastRevenue: 300000 },
    ];
    const settings = await pool.query(
      `UPDATE development_revenue_settings
       SET revenue_mode='summary', summary_revenue_lines=$1::jsonb, version=version+1,
           updated_by='Summary lifecycle test', updated_at=NOW()
       WHERE client_id=$2 AND development_id=$3 RETURNING *`,
      [JSON.stringify(summaryLines), world.client.id, world.development.id]
    );
    assert.equal(settings.rowCount, 1);

    await submitPeriod(world.development.id, world.period.id);
    const locked = await request(app)
      .post(`${periodUrl(world.development.id, world.period.id)}/approve`)
      .send({ actor: "Director", comment: "Lock Summary Revenue" });
    assert.equal(locked.status, 200, locked.body?.message || JSON.stringify(locked.body));
    assert.equal(Number(locked.body.snapshot.forecastRevenue), 1000000);
    assert.equal(locked.body.snapshot.securedRevenue, null);
    assert.equal(locked.body.snapshot.remainingForecastRevenue, null);
    assert.equal(locked.body.snapshot.revenueAssumptions.revenueMode, "summary");
    assert.deepEqual(locked.body.snapshot.revenueAssumptions.summaryRevenueLines, summaryLines);
    assert.equal(locked.body.snapshot.revenueAssumptions.settingsId, settings.rows[0].id);
    assert.equal(locked.body.snapshot.revenueAssumptions.settingsVersion, settings.rows[0].version);
    assert.equal(locked.body.snapshot.revenueAssumptions.settingsUpdatedBy, "Summary lifecycle test");
    assert.equal(locked.body.snapshot.giaEvidence.availabilityState, "no_active_plots");
    assert.equal(locked.body.snapshot.giaEvidence.totalActiveGia, null);

    const liveLines = [{ id: "private", description: "Private Sales", forecastRevenue: 1200000 }];
    await pool.query(
      `UPDATE development_revenue_settings
       SET summary_revenue_lines=$1::jsonb, version=version+1, updated_by='Later live edit', updated_at=NOW()
       WHERE client_id=$2 AND development_id=$3`,
      [JSON.stringify(liveLines), world.client.id, world.development.id]
    );
    const frozen = await getCvrPeriod(world.client.id, world.development.id, world.period.id);
    assert.equal(Number(frozen.period.snapshot.forecastRevenue), 1000000);
    assert.deepEqual(frozen.period.snapshot.revenueAssumptions.summaryRevenueLines, summaryLines);

    const next = await request(app)
      .post(periodUrl(world.development.id))
      .send({ actor: "QS", reportingMonth: "2026-07" });
    assert.equal(next.status, 201, next.body?.message || JSON.stringify(next.body));
    assert.equal(next.body.periodKey, "P02");
    assert.equal(next.body.status, "draft");
    assert.equal(next.body.snapshot, null);

    const { getRevenueSettings } = require("../services/revenueSettingsRepository");
    const current = await getRevenueSettings(world.client.id, world.development.id);
    assert.equal(current.settings.revenueMode, "summary");
    assert.deepEqual(current.settings.summaryRevenueLines, liveLines);
    assert.equal(Number(current.settings.revenueAuthority.summary.forecastRevenue), 1200000);
  });
}
