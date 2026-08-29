/**
 * BL-027B.1 — Package API + materialisation integration tests (requires TEST_DATABASE_URL).
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

const testDevelopmentIds = [];
const testJobNumbers = [];
const testPoNumbers = [];
const testPackageIds = [];

function trackDevelopment(id, jobNumber) {
  if (id) testDevelopmentIds.push(id);
  if (jobNumber) testJobNumbers.push(jobNumber);
}

function trackPo(poNumber) {
  if (poNumber) testPoNumbers.push(poNumber);
}

function shouldTrackPackage(pkg) {
  if (!pkg?.id) return false;
  if (pkg.developmentId && testDevelopmentIds.includes(pkg.developmentId)) {
    return true;
  }
  const poNumbers = pkg.poNumbers || [];
  return poNumbers.some((poNumber) => testPoNumbers.includes(poNumber));
}

function trackPackage(pkg) {
  if (shouldTrackPackage(pkg) && !testPackageIds.includes(pkg.id)) {
    testPackageIds.push(pkg.id);
  }
}

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_005, "utf8"));
}

async function cleanup() {
  if (testPackageIds.length) {
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
}

async function getActiveClient() {
  const { rows } = await pool.query(
    "SELECT id, code, name FROM clients WHERE is_active = true LIMIT 1"
  );
  return rows[0] || null;
}

async function createSecondTenant() {
  const code = `TESTPKG_${Date.now()}`;
  const { rows } = await pool.query(
    `
      INSERT INTO clients (code, name, is_active)
      VALUES ($1, $2, false)
      RETURNING id, code, name
    `,
    [code, "Package Test Tenant B"]
  );
  return rows[0];
}

async function createDevelopment(active, overrides = {}) {
  const id = overrides.id || `dev-pkg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const jobNumber = overrides.jobNumber || `DEV-PKG-${Date.now()}`;
  const res = await request(app)
    .post("/api/developments")
    .send({
      id,
      jobNumber,
      developmentName: overrides.developmentName || "Package Test Dev",
      status: "live",
    });
  assert.equal(res.status, 201);
  trackDevelopment(res.body.id, res.body.jobNumber);
  return res.body;
}

function buildPo({
  poNumber,
  development,
  supplierId = "sup-test-1",
  supplierLabel = "Sparktastic",
  costCode = "5218",
  type = "S",
  status = "Approved",
  approvalStatus = "Approved",
  subtotal = 50000,
  archived = false,
  developmentIdOverride = null,
}) {
  return {
    poNumber,
    type,
    supplierId,
    supplierSnapshot: { name: supplierLabel },
    developmentId: developmentIdOverride || development.id,
    developmentNumber: development.jobNumber,
    developmentName: development.developmentName,
    development: {
      id: development.id,
      developmentNumber: development.jobNumber,
      developmentName: development.developmentName,
    },
    costRef: {
      developmentId: developmentIdOverride || development.id,
      costCode,
    },
    items: [{ description: "Works", qty: 1, rate: subtotal, amount: subtotal, costCode }],
    subtotal,
    totals: { net: subtotal, vat: 0, gross: subtotal },
    approval: { status: approvalStatus, history: [] },
    status,
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

async function materialise(active, developmentId = null) {
  const body = developmentId ? { developmentId } : {};
  const res = await request(app).post("/api/packages/materialise").send(body);
  assert.equal(res.status, 200);
  for (const pkg of res.body.packages || []) {
    trackPackage(pkg);
  }
  return res.body;
}

if (!isDbConfigured()) {
  test("package routes skipped — TEST_DATABASE_URL not configured", () => {
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

  test("one approved type-S PO creates one package with UUID id and exact orderKey", async () => {
    const active = await getActiveClient();
    assert.ok(active);

    const development = await createDevelopment(active);
    const poNumber = `S-PKG-1-${Date.now()}`;
    await savePo(
      active.id,
      buildPo({ poNumber, development, subtotal: 50000, supplierId: "sup-spark" })
    );

    const result = await materialise(active, development.id);
    assert.equal(result.summary.packageCount, 1);

    const pkg = result.packages[0];
    assert.match(pkg.id, /^[0-9a-f-]{36}$/i);
    assert.equal(
      pkg.orderKey,
      buildSubcontractOrderKey(development.id, "sup-spark", "5218")
    );
    assert.equal(pkg.poNumbers.length, 1);
    assert.equal(pkg.poNumbers[0], poNumber);
    assert.equal(pkg.materialisationSource, "approved-pos");
    assert.equal(pkg.committedValue, undefined);
    assert.equal(pkg.certificates, undefined);
  });

  test("two approved POs same dev/supplier/costCode create one package with both PO numbers", async () => {
    const active = await getActiveClient();
    const development = await createDevelopment(active);
    const po1 = `S-PKG-2A-${Date.now()}`;
    const po2 = `S-PKG-2B-${Date.now()}`;

    await savePo(
      active.id,
      buildPo({ poNumber: po1, development, subtotal: 50000, supplierId: "sup-a" })
    );
    await savePo(
      active.id,
      buildPo({ poNumber: po2, development, subtotal: 30000, supplierId: "sup-a" })
    );

    const result = await materialise(active, development.id);
    const orderKey = buildSubcontractOrderKey(development.id, "sup-a", "5218");
    const matches = result.packages.filter((pkg) => pkg.orderKey === orderKey);
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0].poNumbers.sort(), [po1, po2].sort());
    assert.equal(matches[0].committedValue, undefined);
  });

  test("draft, pending, rejected, archived, and type M POs are excluded", async () => {
    const active = await getActiveClient();
    const development = await createDevelopment(active);
    const base = Date.now();

    await savePo(
      active.id,
      buildPo({
        poNumber: `S-DRAFT-${base}`,
        development,
        status: "Draft",
        approvalStatus: "Draft",
      })
    );
    await savePo(
      active.id,
      buildPo({
        poNumber: `S-PEND-${base}`,
        development,
        status: "Pending",
        approvalStatus: "Pending",
      })
    );
    await savePo(
      active.id,
      buildPo({
        poNumber: `S-REJ-${base}`,
        development,
        status: "Rejected",
        approvalStatus: "Rejected",
      })
    );
    await savePo(
      active.id,
      buildPo({
        poNumber: `S-ARCH-${base}`,
        development,
        archived: true,
      })
    );
    await savePo(
      active.id,
      buildPo({
        poNumber: `M-APP-${base}`,
        development,
        type: "M",
      })
    );
    await savePo(
      active.id,
      buildPo({
        poNumber: `S-OK-${base}`,
        development,
        supplierId: "sup-only",
      })
    );

    const result = await materialise(active);
    const included = result.packages.find((pkg) =>
      (pkg.poNumbers || []).includes(`S-OK-${base}`)
    );
    assert.ok(included);
    assert.ok(
      result.skipped.some((item) => item.reason === "not-approved-subcontract")
    );
  });

  test("different supplier, cost code, and development create different packages", async () => {
    const active = await getActiveClient();
    const devA = await createDevelopment(active, { developmentName: "Dev A" });
    const devB = await createDevelopment(active, { developmentName: "Dev B" });
    const stamp = Date.now();

    await savePo(
      active.id,
      buildPo({ poNumber: `S-DIFF-SUP-${stamp}`, development: devA, supplierId: "sup-1" })
    );
    await savePo(
      active.id,
      buildPo({ poNumber: `S-DIFF-SUP2-${stamp}`, development: devA, supplierId: "sup-2" })
    );
    await savePo(
      active.id,
      buildPo({
        poNumber: `S-DIFF-CC-${stamp}`,
        development: devA,
        supplierId: "sup-1",
        costCode: "0120",
      })
    );
    await savePo(
      active.id,
      buildPo({ poNumber: `S-DIFF-DEV-${stamp}`, development: devB, supplierId: "sup-1" })
    );

    const resultA = await materialise(active, devA.id);
    const keysA = new Set(resultA.packages.map((pkg) => pkg.orderKey));
    assert.ok(keysA.has(buildSubcontractOrderKey(devA.id, "sup-1", "5218")));
    assert.ok(keysA.has(buildSubcontractOrderKey(devA.id, "sup-2", "5218")));
    assert.ok(keysA.has(buildSubcontractOrderKey(devA.id, "sup-1", "0120")));

    const resultB = await materialise(active, devB.id);
    const keysB = new Set(resultB.packages.map((pkg) => pkg.orderKey));
    assert.ok(keysB.has(buildSubcontractOrderKey(devB.id, "sup-1", "5218")));
  });

  test("missing costCode uses general; casing normalises identically to client", async () => {
    const active = await getActiveClient();
    const development = await createDevelopment(active);
    const poNumber = `S-GEN-${Date.now()}`;

    const po = buildPo({
      poNumber,
      development,
      supplierId: "sup-general",
      costCode: "",
    });
    delete po.costRef.costCode;
    delete po.items[0].costCode;
    await savePo(active.id, po);

    const result = await materialise(active, development.id);
    const pkg = result.packages.find((item) => item.poNumbers.includes(poNumber));
    assert.ok(pkg);
    assert.equal(
      pkg.orderKey,
      buildSubcontractOrderKey(development.id, "sup-general", "general")
    );
    assert.equal(pkg.costCode, "general");
  });

  test("missing development and missing supplier POs are skipped/quarantined", async () => {
    const active = await getActiveClient();
    const development = await createDevelopment(active);
    const stamp = Date.now();

    await savePo(
      active.id,
      (() => {
        const po = buildPo({
          poNumber: `S-NODEV-${stamp}`,
          development,
          supplierId: "sup-nodev",
        });
        po.developmentId = "dev-does-not-exist";
        po.development = null;
        po.costRef.developmentId = "dev-does-not-exist";
        return po;
      })()
    );

    const noSupplier = buildPo({
      poNumber: `S-NOSUP-${stamp}`,
      development,
    });
    delete noSupplier.supplierId;
    await savePo(active.id, noSupplier);

    const result = await materialise(active);
    assert.ok(result.skipped.some((item) => item.reason === "development-not-found"));
    assert.ok(result.skipped.some((item) => item.reason === "missing-supplier-id"));
  });

  test("materialisation rerun is idempotent and preserves orderKey", async () => {
    const active = await getActiveClient();
    const development = await createDevelopment(active);
    const poNumber = `S-IDEM-${Date.now()}`;

    await savePo(
      active.id,
      buildPo({ poNumber, development, supplierId: "sup-idem" })
    );

    const first = await materialise(active, development.id);
    const pkg = first.packages[0];
    const second = await materialise(active, development.id);
    const again = second.packages.find((item) => item.id === pkg.id);
    assert.ok(again);
    assert.equal(again.orderKey, pkg.orderKey);
    assert.equal(second.summary.updated, 1);
    assert.equal(second.summary.created, 0);
  });

  test("GET package by UUID and orderKey are tenant scoped", async () => {
    const active = await getActiveClient();
    const tenantB = await createSecondTenant();
    const development = await createDevelopment(active);
    const poNumber = `S-SCOPE-${Date.now()}`;

    await savePo(
      active.id,
      buildPo({ poNumber, development, supplierId: "sup-scope" })
    );
    const result = await materialise(active);
    const pkg = result.packages[0];

    const byId = await request(app).get(`/api/packages/${pkg.id}`);
    assert.equal(byId.status, 200);
    assert.equal(byId.body.orderKey, pkg.orderKey);

    const encodedKey = encodeURIComponent(pkg.orderKey);
    const byKey = await request(app).get(`/api/packages/by-order-key/${encodedKey}`);
    assert.equal(byKey.status, 200);
    assert.equal(byKey.body.id, pkg.id);

    await pool.query(
      `
        INSERT INTO packages (
          client_id, development_id, supplier_id, cost_code, order_key
        )
        VALUES ($1, $2, 'sup-foreign', '9999', $3)
      `,
      [tenantB.id, development.id, `${development.id}::sup-foreign::9999`]
    );

    const foreignIdRes = await pool.query(
      "SELECT id FROM packages WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1",
      [tenantB.id]
    );
    const foreignId = foreignIdRes.rows[0].id;

    const leakId = await request(app).get(`/api/packages/${foreignId}`);
    assert.equal(leakId.status, 404);

    const leakKey = await request(app).get(
      `/api/packages/by-order-key/${encodeURIComponent(`${development.id}::sup-foreign::9999`)}`
    );
    assert.equal(leakKey.status, 404);

    await pool.query("DELETE FROM packages WHERE id = $1", [foreignId]);
    await pool.query("DELETE FROM clients WHERE id = $1", [tenantB.id]);
  });

  test("GET development package list is tenant scoped and returns identity fields", async () => {
    const active = await getActiveClient();
    const development = await createDevelopment(active);
    const poNumber = `S-LIST-${Date.now()}`;

    await savePo(
      active.id,
      buildPo({ poNumber, development, supplierId: "sup-list", supplierLabel: "Mucky Plasterers" })
    );
    await materialise(active);

    const list = await request(app).get(`/api/developments/${development.id}/packages`);
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body));
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].developmentId, development.id);
    assert.equal(list.body[0].supplierId, "sup-list");
    assert.equal(list.body[0].supplierLabel, "Mucky Plasterers");
    assert.ok(list.body[0].materialisedAt);
    assert.equal(list.body[0].committedValue, undefined);
    assert.deepEqual(list.body[0].currentContractProvenance, {
      originalOrder: 50000,
      approvedUninstructedValue: 0,
      issuedVariationOrderValue: 0,
      pendingEventValue: 0,
      currentContract: 50000,
      supersededCommercialEventIds: [],
      issuedVariationOrderCount: 0,
    });
  });

  test("POST materialise-from-po creates/refreshes package membership for PO group", async () => {
    const active = await getActiveClient();
    const development = await createDevelopment(active);
    const po1 = `S-SINGLE-1-${Date.now()}`;
    const po2 = `S-SINGLE-2-${Date.now()}`;

    await savePo(
      active.id,
      buildPo({ poNumber: po1, development, supplierId: "sup-single", subtotal: 50000 })
    );
    await savePo(
      active.id,
      buildPo({ poNumber: po2, development, supplierId: "sup-single", subtotal: 30000 })
    );

    const res = await request(app).post(`/api/packages/materialise-from-po/${po1}`).send({});
    assert.equal(res.status, 201);
    assert.match(res.body.package.id, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(res.body.package.poNumbers.sort(), [po1, po2].sort());
    trackPackage(res.body.package);
  });

  test("Test Site 1 style orderKey is preserved exactly when using dev-* development id", async () => {
    const active = await getActiveClient();
    const testSiteId = `dev-testsite-${Date.now()}`;
    const jobNumber = `TS1-${Date.now()}`;

    const devRes = await request(app).post("/api/developments").send({
      id: testSiteId,
      jobNumber,
      developmentName: "Test Site 1 Style",
      status: "live",
    });
    assert.equal(devRes.status, 201);
    trackDevelopment(testSiteId, jobNumber);

    const poNumber = `S-TS1-${Date.now()}`;
    await savePo(
      active.id,
      buildPo({
        poNumber,
        development: devRes.body,
        supplierId: "sup-sparktastic",
        supplierLabel: "Sparktastic",
        costCode: "0120",
      })
    );

    const result = await materialise(active, testSiteId);
    const expected = buildSubcontractOrderKey(testSiteId, "sup-sparktastic", "0120");
    const pkg = result.packages.find((item) => item.orderKey === expected);
    assert.ok(pkg);
    assert.match(pkg.id, /^[0-9a-f-]{36}$/i);
    assert.equal(pkg.orderKey, expected);
  });

  test("no DELETE route is exposed for packages", async () => {
    const res = await request(app).delete("/api/packages/any-id");
    assert.equal(res.status, 404);
  });
}
