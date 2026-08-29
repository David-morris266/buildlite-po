/**
 * BL-030A — V1 Payment Certificate API integration tests (requires TEST_DATABASE_URL / buildlite_test).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const createApp = require("../app");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");
const { buildSubcontractOrderKey } = require("../services/packageKey");
const { buildCellId } = require("../services/paymentCertificateCellIdentity");

const app = createApp();
const MIGRATION_004 = path.join(__dirname, "..", "migrations", "004_developments.sql");
const MIGRATION_005 = path.join(__dirname, "..", "migrations", "005_packages.sql");
const MIGRATION_006 = path.join(__dirname, "..", "migrations", "006_commercial_events.sql");
const MIGRATION_007 = path.join(__dirname, "..", "migrations", "007_package_order_matrices.sql");
const MIGRATION_008 = path.join(__dirname, "..", "migrations", "008_package_payment_certificates.sql");
const MIGRATION_023 = path.join(__dirname, "..", "migrations", "023_variation_orders.sql");
const MIGRATION_024 = path.join(__dirname, "..", "migrations", "024_variation_order_normal_source.sql");
const MIGRATION_025 = path.join(__dirname, "..", "migrations", "025_variation_order_line_ce_allocations.sql");

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
  await pool.query(fs.readFileSync(MIGRATION_007, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_008, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_023, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_024, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_025, "utf8"));
}

async function cleanup() {
  if (testPackageIds.length) {
    await pool.query("DELETE FROM variation_orders WHERE package_id = ANY($1::uuid[])", [testPackageIds]);
    await pool.query(
      "DELETE FROM package_payment_certificates WHERE package_id = ANY($1::uuid[])",
      [testPackageIds]
    );
    await pool.query("DELETE FROM package_order_matrices WHERE package_id = ANY($1::uuid[])", [
      testPackageIds,
    ]);
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
  if (testPoNumbers.length) {
    await pool.query("DELETE FROM purchase_orders WHERE po_number = ANY($1::text[])", [
      testPoNumbers,
    ]);
  }
  if (testDevelopmentIds.length) {
    await pool.query("DELETE FROM developments WHERE id = ANY($1::text[])", [
      testDevelopmentIds,
    ]);
  }
  if (testTenantIds.length) {
    await pool.query(
      "DELETE FROM package_payment_certificates WHERE client_id = ANY($1::uuid[])",
      [testTenantIds]
    );
    await pool.query("DELETE FROM package_order_matrices WHERE client_id = ANY($1::uuid[])", [
      testTenantIds,
    ]);
    await pool.query("DELETE FROM commercial_events WHERE client_id = ANY($1::uuid[])", [
      testTenantIds,
    ]);
    await pool.query("DELETE FROM packages WHERE client_id = ANY($1::uuid[])", [testTenantIds]);
    await pool.query("DELETE FROM developments WHERE client_id = ANY($1::uuid[])", [
      testTenantIds,
    ]);
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
  const code = `TESTPC_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const { rows } = await pool.query(
    `
      INSERT INTO clients (code, name, is_active)
      VALUES ($1, $2, false)
      RETURNING id, code, name
    `,
    [code, "Certificate Test Tenant B"]
  );
  trackTenant(rows[0].id);
  return rows[0];
}

async function createDevelopment(overrides = {}) {
  const id = overrides.id || `dev-pc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const jobNumber = overrides.jobNumber || `DEV-PC-${Date.now()}`;
  const res = await request(app)
    .post("/api/developments")
    .send({
      id,
      jobNumber,
      developmentName: overrides.developmentName || "Certificate Test Dev",
      status: "live",
    });
  assert.equal(res.status, 201);
  trackDevelopment(res.body.id);
  return res.body;
}

function buildPo({
  poNumber,
  development,
  supplierId = "sup-pc-1",
  costCode = "5218",
  subtotal = 100000,
  vatRateDefault = 0,
  retentionRateDefault = 0.05,
}) {
  return {
    poNumber,
    type: "S",
    supplierId,
    supplierSnapshot: { name: "Certificate Supplier" },
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
    vatRateDefault,
    retentionRateDefault,
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
  assert.equal(res.status, 200);
  for (const pkg of res.body.packages || []) {
    trackPackage(pkg.id);
  }
  return res.body;
}

async function setupPackage(active, overrides = {}) {
  const development = overrides.development || (await createDevelopment());
  const supplierId = overrides.supplierId || `sup-pc-${Math.random().toString(36).slice(2, 6)}`;
  const costCode = overrides.costCode || "5218";
  const poNumber =
    overrides.poNumber || `S-PC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await savePo(
    active.id,
    buildPo({
      poNumber,
      development,
      supplierId,
      costCode,
      vatRateDefault: overrides.vatRateDefault ?? 0,
      retentionRateDefault: overrides.retentionRateDefault ?? 0.05,
    })
  );
  const materialised = await materialise(development.id);
  const orderKey = buildSubcontractOrderKey(development.id, supplierId, costCode);
  const pkg = materialised.packages.find((item) => item.orderKey === orderKey);
  assert.ok(pkg);
  return { development, pkg, orderKey };
}

function validMatrixBody(overrides = {}) {
  return {
    layout: "plot-stage",
    committedValue: 50000,
    stages: ["First Fix", "Second Fix"],
    plots: [
      {
        id: "plot-1",
        label: "Plot 1",
        houseType: "Terrace",
        values: [10000, 20000],
      },
      {
        id: "plot-2",
        label: "Plot 2",
        houseType: "Semi",
        values: [8000, 12000],
      },
    ],
    createdBy: "cert-test",
    ...overrides,
  };
}

async function putMatrix(packageId, body) {
  const existing = await request(app).get(`/api/packages/${packageId}/matrix`);
  const payload = { ...body };
  if (existing.status === 200 && existing.body?.version) {
    payload.version = existing.body.version;
  }
  return request(app).put(`/api/packages/${packageId}/matrix`).send(payload);
}

function progressEntry(plotId, stageKey, thisCertificatePct) {
  const cellId = buildCellId(plotId, stageKey);
  return {
    [cellId]: { plotId, stageKey, thisCertificatePct },
  };
}

function certBase(packageId, certificateId = "") {
  return `/api/packages/${packageId}/certificates${certificateId ? `/${certificateId}` : ""}`;
}

async function createCert(packageId, body = {}) {
  return request(app)
    .post(certBase(packageId))
    .send({ actor: "cert-test", ...body });
}

async function getCert(packageId, certificateId) {
  return request(app).get(certBase(packageId, certificateId));
}

async function listCerts(packageId) {
  return request(app).get(certBase(packageId));
}

async function patchCert(packageId, certificateId, body) {
  return request(app)
    .patch(certBase(packageId, certificateId))
    .send({ actor: "cert-test", ...body });
}

async function submitCert(packageId, certificateId, body) {
  return request(app)
    .post(`${certBase(packageId, certificateId)}/submit`)
    .send({ actor: "cert-test", ...body });
}

async function approveCert(packageId, certificateId, body) {
  return request(app)
    .post(`${certBase(packageId, certificateId)}/approve`)
    .send({ actor: "cert-test", ...body });
}

async function rejectCert(packageId, certificateId, body) {
  return request(app)
    .post(`${certBase(packageId, certificateId)}/reject`)
    .send({ actor: "cert-test", ...body });
}

async function deleteCert(packageId, certificateId) {
  return request(app).delete(certBase(packageId, certificateId));
}

async function createApprovedCe(development, orderKey, overrides = {}) {
  const res = await request(app)
    .post("/api/commercial-events")
    .send({
      developmentId: development.id,
      packageId: orderKey,
      eventType: "variation",
      category: "design",
      responsibility: "employer",
      description: "Approved CE",
      value: 10000,
      financialTreatment: "contractAmendment",
      ...overrides,
    });
  assert.equal(res.status, 201);
  trackCe(res.body.id);
  const submitted = await request(app)
    .post(`/api/commercial-events/${res.body.id}/submit`)
    .send({});
  assert.equal(submitted.status, 200);
  const approved = await request(app)
    .post(`/api/commercial-events/${res.body.id}/approve`)
    .send({});
  assert.equal(approved.status, 200);
  return approved.body;
}

async function legacyCertCount() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM payment_certificates");
  return rows[0].n;
}

async function seedDraftWithProgress(active, progressOverrides) {
  const setup = await setupPackage(active);
  const matrix = await putMatrix(setup.pkg.id, validMatrixBody());
  assert.ok([200, 201].includes(matrix.status), matrix.body?.message);
  const created = await createCert(setup.pkg.id);
  assert.equal(created.status, 201);
  const patched = await patchCert(setup.pkg.id, created.body.id, {
    version: created.body.version,
    progress: progressOverrides || progressEntry("plot-1", "First Fix", 40),
  });
  assert.equal(patched.status, 200, patched.body?.message);
  return { ...setup, certificate: patched.body };
}

if (!isDbConfigured()) {
  test("payment certificate routes skipped — TEST_DATABASE_URL not configured", () => {
    assert.ok(true);
  });
} else {
  test.before(async () => {
    await prepareIntegrationTestDatabase(pool);
    const db = await pool.query("SELECT current_database() AS db");
    const dbName = db.rows[0].db;
    console.log(`[BL-030A] Confirmed test database: ${dbName}`);
    assert.equal(dbName, "buildlite_test");
    assert.notEqual(dbName, "buildlite_clone");
    await ensureSchema();
  });

  test.after(async () => {
    await cleanup();
  });

  test("1. migration/schema for package_payment_certificates", async () => {
    const db = await pool.query("SELECT current_database() AS db");
    assert.equal(db.rows[0].db, "buildlite_test");

    const table = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'package_payment_certificates'
        ORDER BY ordinal_position
      `
    );
    const columns = table.rows.map((row) => row.column_name);
    assert.ok(columns.includes("id"));
    assert.ok(columns.includes("package_id"));
    assert.ok(columns.includes("certificate_number"));
    assert.ok(columns.includes("status"));
    assert.ok(columns.includes("payload"));
    assert.ok(columns.includes("version"));
    assert.ok(columns.includes("gross_value"));
    assert.ok(columns.includes("valuation_snapshot") === false);

    const indexes = await pool.query(
      `
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'package_payment_certificates'
      `
    );
    const indexNames = indexes.rows.map((row) => row.indexname);
    assert.ok(indexNames.includes("uq_package_payment_certificates_client_package_number"));
    assert.ok(indexNames.includes("uq_package_payment_certificates_one_open"));

    const audit = await pool.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'package_payment_certificate_audit'
      `
    );
    assert.equal(audit.rows.length, 1);

    const legacy = await pool.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'payment_certificates'
      `
    );
    assert.equal(legacy.rows.length, 1);
  });

  test("2. create certificate allocates package-scoped number 1", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    const res = await createCert(pkg.id, { certificateDate: "2026-08-17" });
    assert.equal(res.status, 201);
    assert.equal(res.body.certificateNumber, 1);
    assert.equal(res.body.status, "draft");
    assert.equal(res.body.packageId, pkg.id);
    assert.equal(res.body.version, 1);
    assert.equal(res.body.certificateDate, "2026-08-17");
    assert.deepEqual(res.body.progress, {});
    assert.equal(res.body.valuationSnapshot, null);
  });

  test("3. concurrent/open-certificate conflict returns 409", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    const first = await createCert(pkg.id);
    assert.equal(first.status, 201);
    const second = await createCert(pkg.id);
    assert.equal(second.status, 409);
    assert.match(String(second.body.message), /Certificate No\. 1/);
    assert.equal(second.body.code, undefined);

    const { pkg: pkg2 } = await setupPackage(active);
    const [left, right] = await Promise.all([createCert(pkg2.id), createCert(pkg2.id)]);
    const statuses = [left.status, right.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [201, 409]);
  });

  test("4. malformed package UUID is 400 before Postgres lookup", async () => {
    const res = await listCerts("not-a-uuid");
    assert.equal(res.status, 400);
    const created = await createCert("also-not-a-uuid");
    assert.equal(created.status, 400);
  });

  test("5. malformed certificate UUID is 400", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    const res = await getCert(pkg.id, "bad-cert-id");
    assert.equal(res.status, 400);
  });

  test("6. valid missing package is 404", async () => {
    const res = await listCerts(crypto.randomUUID());
    assert.equal(res.status, 404);
  });

  test("7. cross-tenant package access is 404", async () => {
    const tenantB = await createSecondTenant();
    const { rows: devRows } = await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [`dev-pc-b-${Date.now()}`, tenantB.id, `JOB-PC-B-${Date.now()}`, "Hidden Dev", "live"]
    );
    trackDevelopment(devRows[0].id);
    const orderKey = buildSubcontractOrderKey(devRows[0].id, "sup-hidden", "5218");
    const { rows: pkgRows } = await pool.query(
      `
        INSERT INTO packages (client_id, development_id, supplier_id, cost_code, order_key)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [tenantB.id, devRows[0].id, "sup-hidden", "5218", orderKey]
    );
    trackPackage(pkgRows[0].id);
    const list = await listCerts(pkgRows[0].id);
    assert.equal(list.status, 404);
    const created = await createCert(pkgRows[0].id);
    assert.equal(created.status, 404);
  });

  test("8. cross-tenant certificate access is 404", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    const created = await createCert(pkg.id);
    assert.equal(created.status, 201);

    const tenantB = await createSecondTenant();
    const { rows: devRows } = await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [`dev-pc-c-${Date.now()}`, tenantB.id, `JOB-PC-C-${Date.now()}`, "Hidden C", "live"]
    );
    trackDevelopment(devRows[0].id);
    const orderKey = buildSubcontractOrderKey(devRows[0].id, "sup-c", "5218");
    const { rows: pkgRows } = await pool.query(
      `
        INSERT INTO packages (client_id, development_id, supplier_id, cost_code, order_key)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [tenantB.id, devRows[0].id, "sup-c", "5218", orderKey]
    );
    trackPackage(pkgRows[0].id);
    await pool.query(
      `
        INSERT INTO package_payment_certificates (
          client_id, package_id, development_id, order_key, certificate_number, status, payload
        )
        VALUES ($1, $2, $3, $4, 1, 'draft', '{}'::jsonb)
      `,
      [tenantB.id, pkgRows[0].id, devRows[0].id, orderKey]
    );
    const { rows: hidden } = await pool.query(
      "SELECT id FROM package_payment_certificates WHERE package_id = $1",
      [pkgRows[0].id]
    );

    const viaOwnPackage = await getCert(pkg.id, hidden[0].id);
    assert.equal(viaOwnPackage.status, 404);
    const viaForeignPackage = await getCert(pkgRows[0].id, hidden[0].id);
    assert.equal(viaForeignPackage.status, 404);
    const viaForeignPackageOwnCert = await getCert(pkgRows[0].id, created.body.id);
    assert.equal(viaForeignPackageOwnCert.status, 404);
  });

  test("9. draft PATCH stores stable-cell progress", async () => {
    const active = await getActiveClient();
    const seeded = await seedDraftWithProgress(active);
    const cellId = buildCellId("plot-1", "First Fix");
    assert.equal(seeded.certificate.progress[cellId].thisCertificatePct, 40);
    assert.equal(seeded.certificate.progress[cellId].plotId, "plot-1");
    assert.equal(seeded.certificate.progress[cellId].stageKey, "First Fix");
    assert.equal(seeded.certificate.totals.matrixGrossThisCertificate, 4000);
    assert.equal(seeded.certificate.status, "draft");
  });

  test("10. forbidden PATCH fields are rejected", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    const created = await createCert(pkg.id);
    const res = await patchCert(pkg.id, created.body.id, {
      version: created.body.version,
      status: "locked",
      grossValue: 999,
      certificateNumber: 9,
      clientId: "nope",
    });
    assert.equal(res.status, 400);
    assert.match(String(res.body.message), /cannot be patched/);
  });

  test("11. positional progress keys are rejected", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    await putMatrix(pkg.id, validMatrixBody());
    const created = await createCert(pkg.id);
    const res = await patchCert(pkg.id, created.body.id, {
      version: created.body.version,
      progress: { "0::0": { thisCertificatePct: 40 } },
    });
    assert.equal(res.status, 400);
    assert.match(String(res.body.message), /positional/);
  });

  test("12. stale PATCH returns 409", async () => {
    const active = await getActiveClient();
    const seeded = await seedDraftWithProgress(active);
    const res = await patchCert(seeded.pkg.id, seeded.certificate.id, {
      version: 1,
      certificateDate: "2026-08-18",
    });
    assert.equal(res.status, 409);
  });

  test("13. submit and stale submit 409", async () => {
    const active = await getActiveClient();
    const seeded = await seedDraftWithProgress(active);
    const submitted = await submitCert(seeded.pkg.id, seeded.certificate.id, {
      version: seeded.certificate.version,
    });
    assert.equal(submitted.status, 200, submitted.body?.message);
    assert.equal(submitted.body.status, "submitted");
    assert.ok(submitted.body.submittedAt);
    assert.equal(submitted.body.valuationSnapshot, null);
    const stale = await submitCert(seeded.pkg.id, seeded.certificate.id, {
      version: seeded.certificate.version,
    });
    assert.equal(stale.status, 409);
  });

  test("14. reject requires comment and stale reject is 409", async () => {
    const active = await getActiveClient();
    const seeded = await seedDraftWithProgress(active);
    const submitted = await submitCert(seeded.pkg.id, seeded.certificate.id, {
      version: seeded.certificate.version,
    });
    const missing = await rejectCert(seeded.pkg.id, seeded.certificate.id, {
      version: submitted.body.version,
      comment: "  ",
    });
    assert.equal(missing.status, 400);
    const stale = await rejectCert(seeded.pkg.id, seeded.certificate.id, {
      version: 1,
      comment: "Please revise",
    });
    assert.equal(stale.status, 409);
    const rejected = await rejectCert(seeded.pkg.id, seeded.certificate.id, {
      version: submitted.body.version,
      comment: "Please revise the valuation",
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, "draft");
    assert.equal(rejected.body.submittedAt, null);
    const audit = rejected.body.auditHistory.find((entry) => entry.action === "rejected");
    assert.ok(audit);
    assert.equal(audit.comment, "Please revise the valuation");
  });

  test("15. approve only submitted; draft approve is 409", async () => {
    const active = await getActiveClient();
    const seeded = await seedDraftWithProgress(active);
    const res = await approveCert(seeded.pkg.id, seeded.certificate.id, {
      version: seeded.certificate.version,
    });
    assert.equal(res.status, 409);
  });

  test("16. stale approve 409; fake totals ignored; snapshot frozen", async () => {
    const active = await getActiveClient();
    const beforeLegacy = await legacyCertCount();
    const seeded = await seedDraftWithProgress(active);
    const submitted = await submitCert(seeded.pkg.id, seeded.certificate.id, {
      version: seeded.certificate.version,
    });
    const stale = await approveCert(seeded.pkg.id, seeded.certificate.id, {
      version: 1,
    });
    assert.equal(stale.status, 409);
    const approved = await approveCert(seeded.pkg.id, seeded.certificate.id, {
      version: submitted.body.version,
      grossValue: 999999,
      netValue: 1,
      status: "locked",
      totals: { netPayment: 1 },
    });
    assert.equal(approved.status, 200, approved.body?.message);
    assert.equal(approved.body.status, "locked");
    assert.equal(approved.body.grossValue, 4000);
    assert.equal(approved.body.netValue, 3800);
    assert.equal(approved.body.matrixGross, 4000);
    assert.equal(approved.body.retention, 200);
    assert.equal(approved.body.vat, 0);
    assert.equal(approved.body.retentionRate, 0.05);
    assert.equal(approved.body.vatRate, 0);
    assert.ok(approved.body.approvedAt);
    assert.equal(approved.body.valuationSnapshot.snapshotVersion, 1);
    assert.equal(approved.body.valuationSnapshot.totals.grossWorksThisCertificate, 4000);
    const cell = approved.body.valuationSnapshot.cells.find(
      (item) => item.plotId === "plot-1" && item.stageKey === "First Fix"
    );
    assert.equal(cell.thisCertificatePct, 40);
    assert.equal(cell.thisCertificateValue, 4000);
    assert.equal(cell.contractValue, 10000);
    assert.equal(cell.plotLabel, "Plot 1");
    assert.ok(Object.prototype.hasOwnProperty.call(cell, "houseType"));
    assert.equal(await legacyCertCount(), beforeLegacy);
  });

  test("17. cumulative progress over 100% is rejected", async () => {
    const active = await getActiveClient();
    const seeded = await seedDraftWithProgress(active, progressEntry("plot-1", "First Fix", 40));
    const submitted = await submitCert(seeded.pkg.id, seeded.certificate.id, {
      version: seeded.certificate.version,
    });
    await approveCert(seeded.pkg.id, seeded.certificate.id, {
      version: submitted.body.version,
    });
    const second = await createCert(seeded.pkg.id);
    const patched = await patchCert(seeded.pkg.id, second.body.id, {
      version: second.body.version,
      progress: progressEntry("plot-1", "First Fix", 70),
    });
    assert.equal(patched.status, 400);
    assert.match(String(patched.body.message), /100%/);
  });

  test("18. CE inclusion and recovery validation; no CE row mutation", async () => {
    const active = await getActiveClient();
    const { development, pkg, orderKey } = await setupPackage(active);
    await putMatrix(pkg.id, validMatrixBody());
    const event = await createApprovedCe(development, orderKey, { value: 10000 });
    const recovery = await createApprovedCe(development, orderKey, {
      eventType: "contraCharge",
      financialTreatment: "recoverableDeduction",
      value: -5000,
      description: "Recovery",
    });
    const created = await createCert(pkg.id);
    const tooMuch = await patchCert(pkg.id, created.body.id, {
      version: created.body.version,
      commercialLines: [
        {
          commercialEventId: event.id,
          lineType: "valueInclusion",
          amountThisCertificate: 11000,
        },
      ],
    });
    assert.equal(tooMuch.status, 400);

    const patched = await patchCert(pkg.id, created.body.id, {
      version: created.body.version,
      progress: progressEntry("plot-1", "First Fix", 40),
      commercialLines: [
        {
          commercialEventId: event.id,
          lineType: "valueInclusion",
          amountThisCertificate: 4000,
          sourceEventNumber: event.eventNumber,
          sourceEventType: event.eventType,
          description: event.description,
        },
        {
          commercialEventId: recovery.id,
          lineType: "recoveryDeduction",
          amountThisCertificate: -3000,
          sourceEventNumber: recovery.eventNumber,
          sourceEventType: recovery.eventType,
          description: recovery.description,
        },
      ],
    });
    assert.equal(patched.status, 200, patched.body?.message);
    assert.equal(patched.body.totals.grossWorksThisCertificate, 8000);
    assert.equal(patched.body.totals.commercialEventGrossThisCertificate, 4000);
    assert.equal(patched.body.totals.recoveryDeductionSigned, -3000);
    assert.equal(patched.body.totals.retention, 400);
    assert.equal(patched.body.totals.netPayment, 4600);

    const submitted = await submitCert(pkg.id, created.body.id, {
      version: patched.body.version,
    });
    const approved = await approveCert(pkg.id, created.body.id, {
      version: submitted.body.version,
    });
    assert.equal(approved.status, 200, approved.body?.message);
    assert.equal(approved.body.grossValue, 8000);
    assert.equal(approved.body.recoverySigned, -3000);
    assert.equal(approved.body.netValue, 4600);

    const ceAfter = await request(app).get(`/api/commercial-events/${event.id}`);
    assert.equal(ceAfter.body.recoveredAmount, 0);
    assert.equal(ceAfter.body.certificateStatus, "notIncluded");
    const recoveryAfter = await request(app).get(`/api/commercial-events/${recovery.id}`);
    assert.equal(recoveryAfter.body.recoveredAmount, 0);
  });

  test("18a. legacy closed partial recovery remains deductible only for its approved outstanding balance", async () => {
    const active = await getActiveClient();
    const { development, pkg, orderKey } = await setupPackage(active);
    await putMatrix(pkg.id, validMatrixBody());
    const recovery = await createApprovedCe(development, orderKey, {
      eventType: "contraCharge",
      financialTreatment: "recoverableDeduction",
      value: -1000,
      description: "Legacy partial recovery",
    });

    const first = await createCert(pkg.id);
    const firstPatched = await patchCert(pkg.id, first.body.id, {
      version: first.body.version,
      commercialLines: [{
        commercialEventId: recovery.id,
        lineType: "recoveryDeduction",
        amountThisCertificate: -400,
      }],
    });
    assert.equal(firstPatched.status, 200, firstPatched.body?.message);
    const firstSubmitted = await submitCert(pkg.id, first.body.id, {
      version: firstPatched.body.version,
    });
    const firstApproved = await approveCert(pkg.id, first.body.id, {
      version: firstSubmitted.body.version,
    });
    assert.equal(firstApproved.status, 200, firstApproved.body?.message);

    // Reproduce the pre-guard persisted state without rewriting approved history.
    await pool.query("UPDATE commercial_events SET status = $1 WHERE id = $2", [
      "closed",
      recovery.id,
    ]);

    const second = await createCert(pkg.id);
    const overRemaining = await patchCert(pkg.id, second.body.id, {
      version: second.body.version,
      commercialLines: [{
        commercialEventId: recovery.id,
        lineType: "recoveryDeduction",
        amountThisCertificate: -600.01,
      }],
    });
    assert.equal(overRemaining.status, 400);
    assert.match(String(overRemaining.body.message), /remaining|600/i);

    const exactRemaining = await patchCert(pkg.id, second.body.id, {
      version: second.body.version,
      commercialLines: [{
        commercialEventId: recovery.id,
        lineType: "recoveryDeduction",
        amountThisCertificate: -600,
      }],
    });
    assert.equal(exactRemaining.status, 200, exactRemaining.body?.message);
    assert.equal(exactRemaining.body.totals.recoveryDeductionSigned, -600);

    const secondSubmitted = await submitCert(pkg.id, second.body.id, {
      version: exactRemaining.body.version,
    });
    assert.equal(secondSubmitted.status, 200, secondSubmitted.body?.message);
    const rejected = await rejectCert(pkg.id, second.body.id, {
      version: secondSubmitted.body.version,
      comment: "Prove rejected deductions do not count as recovered history",
    });
    assert.equal(rejected.status, 200, rejected.body?.message);

    const afterRejected = await patchCert(pkg.id, rejected.body.id, {
      version: rejected.body.version,
      commercialLines: [{
        commercialEventId: recovery.id,
        lineType: "recoveryDeduction",
        amountThisCertificate: -600,
      }],
    });
    assert.equal(afterRejected.status, 200, afterRejected.body?.message);
  });

  test("19. retention and VAT use package PO rates", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active, {
      vatRateDefault: 0.2,
      retentionRateDefault: 0.05,
    });
    await putMatrix(pkg.id, validMatrixBody());
    const created = await createCert(pkg.id);
    const patched = await patchCert(pkg.id, created.body.id, {
      version: created.body.version,
      progress: progressEntry("plot-1", "First Fix", 40),
    });
    assert.equal(patched.body.totals.retention, 200);
    assert.equal(patched.body.totals.vat, 760);
    assert.equal(patched.body.totals.netPayment, 4560);
    const submitted = await submitCert(pkg.id, created.body.id, {
      version: patched.body.version,
    });
    const approved = await approveCert(pkg.id, created.body.id, {
      version: submitted.body.version,
    });
    assert.equal(approved.body.vat, 760);
    assert.equal(approved.body.vatRate, 0.2);
  });

  test("20. matrix replacement after approval does not change snapshot", async () => {
    const active = await getActiveClient();
    const seeded = await seedDraftWithProgress(active);
    const submitted = await submitCert(seeded.pkg.id, seeded.certificate.id, {
      version: seeded.certificate.version,
    });
    const approved = await approveCert(seeded.pkg.id, seeded.certificate.id, {
      version: submitted.body.version,
    });
    const originalCell = approved.body.valuationSnapshot.cells.find(
      (cell) => cell.plotId === "plot-1" && cell.stageKey === "First Fix"
    );
    const replaced = await putMatrix(
      seeded.pkg.id,
      validMatrixBody({
        stages: ["First Fix"],
        plots: [{ id: "plot-9", label: "Plot 9", values: [1] }],
        committedValue: 1,
      })
    );
    assert.ok([200, 201].includes(replaced.status), replaced.body?.message);
    const fetched = await getCert(seeded.pkg.id, approved.body.id);
    assert.equal(fetched.body.status, "locked");
    const frozen = fetched.body.valuationSnapshot.cells.find(
      (cell) => cell.plotId === "plot-1" && cell.stageKey === "First Fix"
    );
    assert.equal(frozen.contractValue, originalCell.contractValue);
    assert.equal(frozen.thisCertificateValue, 4000);
    assert.equal(fetched.body.grossValue, 4000);
  });

  test("21. reorder/add/remove/value-change keep stable previous progress", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    await putMatrix(pkg.id, validMatrixBody());
    const first = await createCert(pkg.id);
    const patched1 = await patchCert(pkg.id, first.body.id, {
      version: first.body.version,
      progress: {
        ...progressEntry("plot-1", "First Fix", 40),
        ...progressEntry("plot-2", "Second Fix", 25),
      },
    });
    const submitted1 = await submitCert(pkg.id, first.body.id, {
      version: patched1.body.version,
    });
    const approved1 = await approveCert(pkg.id, first.body.id, {
      version: submitted1.body.version,
    });
    assert.equal(approved1.status, 200, approved1.body?.message);

    const reordered = await putMatrix(pkg.id, {
      layout: "plot-stage",
      committedValue: 50000,
      stages: ["Second Fix", "First Fix"],
      plots: [
        { id: "plot-2", label: "Plot 2 swapped", houseType: "Semi", values: [12000, 8000] },
        { id: "plot-1", label: "Plot 1 swapped", houseType: "Terrace", values: [20000, 10000] },
      ],
      createdBy: "cert-test",
    });
    assert.ok([200, 201].includes(reordered.status), reordered.body?.message);

    const second = await createCert(pkg.id);
    const completeRemaining = await patchCert(pkg.id, second.body.id, {
      version: second.body.version,
      progress: progressEntry("plot-1", "First Fix", 60),
    });
    assert.equal(completeRemaining.status, 200, completeRemaining.body?.message);
    const remainingCell = completeRemaining.body.totals;
    assert.equal(remainingCell.matrixGrossThisCertificate, 6000);

    const overflow = await patchCert(pkg.id, second.body.id, {
      version: completeRemaining.body.version,
      progress: progressEntry("plot-1", "First Fix", 61),
    });
    assert.equal(overflow.status, 400);

    const added = await putMatrix(pkg.id, {
      layout: "plot-stage",
      committedValue: 55000,
      stages: ["Second Fix", "First Fix", "Snagging"],
      plots: [
        { id: "plot-2", label: "Plot 2", values: [12000, 8000, 1000] },
        { id: "plot-1", label: "Plot 1", values: [20000, 10000, 1000] },
        { id: "plot-3", label: "Plot 3", values: [500, 500, 500] },
      ],
      createdBy: "cert-test",
    });
    assert.ok([200, 201].includes(added.status), added.body?.message);
    const addedProgress = await patchCert(pkg.id, second.body.id, {
      version: completeRemaining.body.version,
      progress: {
        ...progressEntry("plot-1", "First Fix", 60),
        ...progressEntry("plot-3", "Snagging", 10),
      },
    });
    assert.equal(addedProgress.status, 200, addedProgress.body?.message);
    assert.equal(addedProgress.body.totals.matrixGrossThisCertificate, 6050);

    const removed = await putMatrix(pkg.id, {
      layout: "plot-stage",
      committedValue: 30000,
      stages: ["First Fix"],
      plots: [{ id: "plot-1", label: "Plot 1", values: [15000] }],
      createdBy: "cert-test",
    });
    assert.ok([200, 201].includes(removed.status), removed.body?.message);
    const changedValue = await patchCert(pkg.id, second.body.id, {
      version: addedProgress.body.version,
      progress: progressEntry("plot-1", "First Fix", 60),
    });
    assert.equal(changedValue.status, 200, changedValue.body?.message);
    assert.equal(changedValue.body.totals.matrixGrossThisCertificate, 9000);

    const submitted2 = await submitCert(pkg.id, second.body.id, {
      version: changedValue.body.version,
    });
    const approved2 = await approveCert(pkg.id, second.body.id, {
      version: submitted2.body.version,
    });
    assert.equal(approved2.status, 200, approved2.body?.message);
    const cell = approved2.body.valuationSnapshot.cells.find(
      (item) => item.plotId === "plot-1" && item.stageKey === "First Fix"
    );
    assert.equal(cell.previousCumulativePct, 40);
    assert.equal(cell.thisCertificatePct, 60);
    assert.equal(cell.contractValue, 15000);
    assert.equal(cell.thisCertificateValue, 9000);

    const historic = await getCert(pkg.id, approved1.body.id);
    const historicCell = historic.body.valuationSnapshot.cells.find(
      (item) => item.plotId === "plot-2" && item.stageKey === "Second Fix"
    );
    assert.equal(historicCell.thisCertificatePct, 25);
    assert.equal(historicCell.contractValue, 12000);
  });

  test("22. approval transaction rolls back on forced failure", async () => {
    const active = await getActiveClient();
    const seeded = await seedDraftWithProgress(active);
    const submitted = await submitCert(seeded.pkg.id, seeded.certificate.id, {
      version: seeded.certificate.version,
    });
    await pool.query(`
      CREATE OR REPLACE FUNCTION bl030a_fail_locked_certificate()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.status = 'locked' THEN
          RAISE EXCEPTION 'forced approval failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await pool.query("DROP TRIGGER IF EXISTS trg_bl030a_fail_locked ON package_payment_certificates");
    await pool.query(`
      CREATE TRIGGER trg_bl030a_fail_locked
      BEFORE UPDATE ON package_payment_certificates
      FOR EACH ROW EXECUTE PROCEDURE bl030a_fail_locked_certificate()
    `);
    try {
      const failed = await approveCert(seeded.pkg.id, seeded.certificate.id, {
        version: submitted.body.version,
      });
      assert.equal(failed.status, 500);
      const fetched = await getCert(seeded.pkg.id, seeded.certificate.id);
      assert.equal(fetched.body.status, "submitted");
      assert.equal(fetched.body.version, submitted.body.version);
      assert.equal(fetched.body.valuationSnapshot, null);
      assert.equal(fetched.body.grossValue, null);
      const audit = await pool.query(
        "SELECT action FROM package_payment_certificate_audit WHERE certificate_id = $1 ORDER BY created_at",
        [seeded.certificate.id]
      );
      assert.ok(!audit.rows.some((row) => row.action === "approved"));
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS trg_bl030a_fail_locked ON package_payment_certificates");
      await pool.query("DROP FUNCTION IF EXISTS bl030a_fail_locked_certificate()");
    }
  });

  test("23. audit records created/edited/submitted/approved", async () => {
    const active = await getActiveClient();
    const seeded = await seedDraftWithProgress(active);
    const submitted = await submitCert(seeded.pkg.id, seeded.certificate.id, {
      version: seeded.certificate.version,
    });
    const approved = await approveCert(seeded.pkg.id, seeded.certificate.id, {
      version: submitted.body.version,
    });
    const actions = approved.body.auditHistory.map((entry) => entry.action);
    assert.deepEqual(actions, ["created", "edited", "submitted", "approved"]);
    assert.equal(approved.body.auditHistory[3].priorStatus, "submitted");
    assert.equal(approved.body.auditHistory[3].newStatus, "locked");
  });

  test("24. numbering continues after approval; draft delete is allowed", async () => {
    const active = await getActiveClient();
    const seeded = await seedDraftWithProgress(active);
    const submitted = await submitCert(seeded.pkg.id, seeded.certificate.id, {
      version: seeded.certificate.version,
    });
    await approveCert(seeded.pkg.id, seeded.certificate.id, {
      version: submitted.body.version,
    });
    const second = await createCert(seeded.pkg.id);
    assert.equal(second.status, 201);
    assert.equal(second.body.certificateNumber, 2);
    const deleted = await deleteCert(seeded.pkg.id, second.body.id);
    assert.equal(deleted.status, 204);
    const missing = await getCert(seeded.pkg.id, second.body.id);
    assert.equal(missing.status, 404);
    const third = await createCert(seeded.pkg.id);
    assert.equal(third.body.certificateNumber, 2);
    const submittedDelete = await submitCert(seeded.pkg.id, third.body.id, {
      version: third.body.version,
    });
    const cannotDelete = await deleteCert(seeded.pkg.id, third.body.id);
    assert.equal(cannotDelete.status, 409);
    assert.equal(submittedDelete.status, 200);
  });

  test("25. Issued VO line persists as frozen valueInclusion and revalidates through Submit and Approve", async () => {
    const active = await getActiveClient();
    const setup = await setupPackage(active, { vatRateDefault: 0.2, retentionRateDefault: 0.05 });
    await pool.query("INSERT INTO cost_codes(client_id,code,is_active) VALUES($1,'5218',true) ON CONFLICT (client_id,code) DO UPDATE SET is_active=true", [active.id]);
    assert.ok([200, 201].includes((await putMatrix(setup.pkg.id, validMatrixBody())).status));
    const ce = await createApprovedCe(setup.development, setup.orderKey, { value: 4500, description: "Formal VO certificate test" });
    let response = await request(app).post(`/api/variation-orders/from-commercial-event/${ce.id}`).send({ actor: "QS" });
    assert.equal(response.status, 201, response.body.message);
    let vo = response.body;
    response = await request(app).post(`/api/variation-orders/${vo.id}/submit`).send({ version: vo.version, actor: "QS" });
    assert.equal(response.status, 200, response.body.message);
    vo = response.body;
    response = await request(app).post(`/api/variation-orders/${vo.id}/approve-and-issue`).send({ version: vo.version, actor: "CD", comment: "Issued" });
    assert.equal(response.status, 200, response.body.message);
    vo = response.body;

    const ready = await request(app).get(`/api/variation-orders/certificate-readiness/${setup.pkg.id}`);
    assert.equal(ready.status, 200);
    const authority = ready.body.lines.find((line) => line.variationOrderId === vo.id);
    assert.equal(authority.eligible, true);
    assert.equal(authority.remainingCertifiableValue, 4500);

    let certificate = (await createCert(setup.pkg.id)).body;
    const eventRead = await request(app).get(`/api/commercial-events?packageId=${setup.pkg.id}`);
    assert.equal(eventRead.status, 200);
    assert.equal(eventRead.body.find((event) => event.id === ce.id).issuedVariationOrderId, vo.id);
    const forgedCeLine = {
      id: `ce-cert-${crypto.randomUUID()}`,
      commercialEventId: ce.id,
      lineType: "valueInclusion",
      sourceType: "commercialEvent",
      sourceEventNumber: ce.eventNumber,
      sourceEventValue: 4500,
      description: ce.description,
      amountThisCertificate: 1000,
    };
    response = await patchCert(setup.pkg.id, certificate.id, {
      version: certificate.version,
      commercialLines: [forgedCeLine],
    });
    assert.equal(response.status, 400);
    assert.match(response.body.message, /Issued Variation Order/i);

    const frozenLine = {
      id: `vo-cert-${crypto.randomUUID()}`,
      lineType: "valueInclusion", sourceType: "variationOrder",
      variationOrderId: authority.variationOrderId, variationOrderLineId: authority.variationOrderLineId,
      sourceReference: authority.variationOrderReference, sourcePoNumber: authority.sourcePoNumber,
      sourceCostCode: authority.costCode, description: authority.description,
      sourceValue: authority.issuedLineValue, sourcePreviouslyCertified: authority.previouslyCertifiedValue,
      sourceRemainingAtAdd: authority.remainingCertifiableValue, amountThisCertificate: 1000,
    };
    response = await patchCert(setup.pkg.id, certificate.id, { version: certificate.version, commercialLines: [frozenLine] });
    assert.equal(response.status, 200, response.body.message);
    certificate = response.body;
    assert.equal(certificate.commercialLines[0].commercialEventId, "");
    assert.equal(certificate.totals.grossWorksThisCertificate, 1000);
    assert.equal(certificate.totals.retention, 50);
    assert.equal(certificate.totals.vat, 190);
    assert.equal(certificate.totals.netPayment, 1140);

    response = await submitCert(setup.pkg.id, certificate.id, { version: certificate.version });
    assert.equal(response.status, 200, response.body.message);
    certificate = response.body;
    response = await approveCert(setup.pkg.id, certificate.id, { version: certificate.version });
    assert.equal(response.status, 200, response.body.message);
    assert.equal(response.body.status, "locked");
    assert.equal(response.body.commercialLines[0].sourceType, "variationOrder");
    assert.equal(response.body.commercialLines[0].variationOrderId, vo.id);
    assert.equal(response.body.commercialLines[0].variationOrderLineId, authority.variationOrderLineId);
    assert.equal(response.body.commercialLines[0].sourceReference, authority.variationOrderReference);
    assert.equal(response.body.commercialLines[0].amountThisCertificate, 1000);
    const after = await request(app).get(`/api/variation-orders/certificate-readiness/${setup.pkg.id}`);
    assert.equal(after.body.lines.find((line) => line.variationOrderLineId === authority.variationOrderLineId).remainingCertifiableValue, 3500);
  });
}
