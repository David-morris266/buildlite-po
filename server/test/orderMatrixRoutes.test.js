/**
 * BL-029A — Order Matrix API integration tests (requires TEST_DATABASE_URL).
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
const { MAX_LABEL_LENGTH } = require("../services/orderMatrixConstants");

const app = createApp();
const MIGRATION_004 = path.join(__dirname, "..", "migrations", "004_developments.sql");
const MIGRATION_005 = path.join(__dirname, "..", "migrations", "005_packages.sql");
const MIGRATION_006 = path.join(__dirname, "..", "migrations", "006_commercial_events.sql");
const MIGRATION_007 = path.join(__dirname, "..", "migrations", "007_package_order_matrices.sql");

const testDevelopmentIds = [];
const testPoNumbers = [];
const testPackageIds = [];
const testTenantIds = [];

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

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_005, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_006, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_007, "utf8"));
}

async function cleanup() {
  if (testPackageIds.length) {
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
    await pool.query("DELETE FROM package_order_matrices WHERE client_id = ANY($1::uuid[])", [
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
  const code = `TESTMX_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const { rows } = await pool.query(
    `
      INSERT INTO clients (code, name, is_active)
      VALUES ($1, $2, false)
      RETURNING id, code, name
    `,
    [code, "Matrix Test Tenant B"]
  );
  trackTenant(rows[0].id);
  return rows[0];
}

async function createDevelopment(overrides = {}) {
  const id = overrides.id || `dev-mx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const jobNumber = overrides.jobNumber || `DEV-MX-${Date.now()}`;
  const res = await request(app)
    .post("/api/developments")
    .send({
      id,
      jobNumber,
      developmentName: overrides.developmentName || "Matrix Test Dev",
      status: "live",
    });
  assert.equal(res.status, 201);
  trackDevelopment(res.body.id);
  return res.body;
}

function buildPo({ poNumber, development, supplierId = "sup-mx-1", costCode = "5218", subtotal = 50000 }) {
  return {
    poNumber,
    type: "S",
    supplierId,
    supplierSnapshot: { name: "Matrix Supplier" },
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
  const res = await request(app)
    .post("/api/packages/materialise")
    .send({ developmentId });
  assert.equal(res.status, 200);
  for (const pkg of res.body.packages || []) {
    trackPackage(pkg.id);
  }
  return res.body;
}

async function setupPackage(active, overrides = {}) {
  const development = overrides.development || (await createDevelopment());
  const supplierId = overrides.supplierId || `sup-mx-${Math.random().toString(36).slice(2, 6)}`;
  const costCode = overrides.costCode || "5218";
  const poNumber = overrides.poNumber || `S-MX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await savePo(
    active.id,
    buildPo({
      poNumber,
      development,
      supplierId,
      costCode,
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
    committedValue: 1500,
    stages: ["Foundations", "Superstructure"],
    plots: [{ id: "plot-1", label: "Plot 1", values: [500, 1000] }],
    jobId: "job-mx",
    supplierId: "sup-mx-1",
    projectLabel: "Matrix Test Dev",
    supplierLabel: "Matrix Supplier",
    createdBy: "matrix-test",
    ...overrides,
  };
}

async function putMatrix(packageId, body) {
  return request(app).put(`/api/packages/${packageId}/matrix`).send(body);
}

if (!isDbConfigured()) {
  test("order matrix routes skipped — TEST_DATABASE_URL not configured", () => {
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

  test("1. migration/table availability", async () => {
    const dbName = await pool.query("SELECT current_database() AS db");
    assert.equal(dbName.rows[0].db, "buildlite_test");
    assert.notEqual(dbName.rows[0].db, "buildlite_clone");

    const table = await pool.query(
      `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'package_order_matrices'
        ORDER BY ordinal_position
      `
    );
    const columns = table.rows.map((row) => row.column_name);
    assert.deepEqual(
      columns,
      [
        "id",
        "client_id",
        "package_id",
        "development_id",
        "order_key",
        "layout",
        "committed_value",
        "payload",
        "version",
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
      ]
    );
    assert.ok(!columns.includes("progress"));
    assert.ok(!columns.includes("certificate_progress"));

    const indexes = await pool.query(
      `
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'package_order_matrices'
        ORDER BY indexname
      `
    );
    const indexNames = indexes.rows.map((row) => row.indexname);
    assert.ok(indexNames.includes("uq_package_order_matrices_client_package"));
    assert.ok(indexNames.includes("uq_package_order_matrices_client_order_key"));
    assert.ok(indexNames.includes("idx_package_order_matrices_client_development"));
  });

  test("2. create matrix by package UUID", async () => {
    const active = await getActiveClient();
    const { pkg, orderKey, development } = await setupPackage(active);
    const payloadBefore = await pool.query("SELECT payload FROM packages WHERE id = $1", [pkg.id]);

    const res = await putMatrix(pkg.id, validMatrixBody());
    assert.equal(res.status, 201);
    assert.equal(res.body.packageId, pkg.id);
    assert.equal(res.body.orderKey, orderKey);
    assert.equal(res.body.developmentId, development.id);
    assert.equal(res.body.layout, "plot-stage");
    assert.equal(res.body.version, 1);
    assert.equal(res.body.committedValue, 1500);
    assert.deepEqual(res.body.stages, ["Foundations", "Superstructure"]);
    assert.deepEqual(res.body.plots, [{ id: "plot-1", label: "Plot 1", values: [500, 1000] }]);
    assert.equal(res.body.createdBy, "matrix-test");
    assert.ok(!Object.prototype.hasOwnProperty.call(res.body, "progress"));
    assert.ok(!Object.prototype.hasOwnProperty.call(res.body, "certificates"));

    const payloadAfter = await pool.query("SELECT payload FROM packages WHERE id = $1", [pkg.id]);
    assert.deepEqual(payloadAfter.rows[0].payload, payloadBefore.rows[0].payload);
  });

  test("3. read matrix by package UUID", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    await putMatrix(pkg.id, validMatrixBody());

    const res = await request(app).get(`/api/packages/${pkg.id}/matrix`);
    assert.equal(res.status, 200);
    assert.equal(res.body.packageId, pkg.id);
    assert.equal(res.body.layout, "plot-stage");
    assert.equal(res.body.version, 1);
  });

  test("4. read matrix by orderKey compatibility lookup", async () => {
    const active = await getActiveClient();
    const { pkg, orderKey } = await setupPackage(active);
    await putMatrix(pkg.id, validMatrixBody());

    const res = await request(app).get(
      `/api/packages/by-order-key/${encodeURIComponent(orderKey)}/matrix`
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.packageId, pkg.id);
    assert.equal(res.body.orderKey, orderKey);
  });

  test("5. development matrix list", async () => {
    const active = await getActiveClient();
    const { development, pkg } = await setupPackage(active, { supplierId: "sup-list-a" });
    const second = await setupPackage(active, {
      development,
      supplierId: "sup-list-b",
      costCode: "5219",
    });
    await putMatrix(pkg.id, validMatrixBody({ projectLabel: "A" }));
    await putMatrix(second.pkg.id, validMatrixBody({ projectLabel: "B" }));

    const res = await request(app).get(`/api/developments/${development.id}/matrices`);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
    assert.ok(res.body.every((matrix) => matrix.developmentId === development.id));
    assert.deepEqual(
      res.body.map((matrix) => matrix.packageId).sort(),
      [pkg.id, second.pkg.id].sort()
    );
  });

  test("6. update replaces the same row rather than creating a second", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    const created = await putMatrix(pkg.id, validMatrixBody());
    const updated = await putMatrix(
      pkg.id,
      validMatrixBody({
        version: 1,
        stages: ["Foundations", "Superstructure", "Finishes"],
        plots: [{ id: "plot-1", label: "Plot 1", values: [500, 1000, 250] }],
        committedValue: 1750,
      })
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.id, created.body.id);

    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM package_order_matrices WHERE package_id = $1",
      [pkg.id]
    );
    assert.equal(rows[0].n, 1);
  });

  test("7. version increments on successful replacement", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    const created = await putMatrix(pkg.id, validMatrixBody());
    assert.equal(created.body.version, 1);
    const updated = await putMatrix(pkg.id, validMatrixBody({ version: 1, committedValue: 1600 }));
    assert.equal(updated.status, 200);
    assert.equal(updated.body.version, 2);
  });

  test("8. stale version returns 409", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    await putMatrix(pkg.id, validMatrixBody());
    const stale = await putMatrix(pkg.id, validMatrixBody({ version: 99, committedValue: 1 }));
    assert.equal(stale.status, 409);
    assert.match(stale.body.message, /version conflict/i);

    const current = await request(app).get(`/api/packages/${pkg.id}/matrix`);
    assert.equal(current.body.version, 1);
    assert.equal(current.body.committedValue, 1500);
  });

  test("9. one current matrix per package", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    await putMatrix(pkg.id, validMatrixBody());
    await putMatrix(pkg.id, validMatrixBody({ version: 1, committedValue: 2000 }));
    const { rows } = await pool.query(
      "SELECT id, version FROM package_order_matrices WHERE package_id = $1",
      [pkg.id]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].version, 2);
  });

  test("10. package must already exist", async () => {
    const missingId = "00000000-0000-4000-8000-000000000099";
    const res = await putMatrix(missingId, validMatrixBody());
    assert.equal(res.status, 404);
    assert.match(res.body.message, /Package not found/i);

    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM package_order_matrices WHERE package_id = $1",
      [missingId]
    );
    assert.equal(rows[0].n, 0);
  });

  test("11. tenant isolation by package UUID", async () => {
    const tenantB = await createSecondTenant();
    const { rows: devRows } = await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [`dev-mx-b-${Date.now()}`, tenantB.id, `JOB-MX-B-${Date.now()}`, "Hidden Dev", "live"]
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
    await pool.query(
      `
        INSERT INTO package_order_matrices (
          client_id, package_id, development_id, order_key, layout, committed_value, payload
        )
        VALUES ($1, $2, $3, $4, 'plot-stage', 9, $5::jsonb)
      `,
      [
        tenantB.id,
        pkgRows[0].id,
        devRows[0].id,
        orderKey,
        JSON.stringify({
          stages: ["Hidden"],
          plots: [{ id: "p1", label: "P1", values: [9] }],
        }),
      ]
    );

    const getRes = await request(app).get(`/api/packages/${pkgRows[0].id}/matrix`);
    assert.equal(getRes.status, 404);

    const putRes = await putMatrix(pkgRows[0].id, validMatrixBody({ committedValue: 1 }));
    assert.equal(putRes.status, 404);

    const { rows } = await pool.query(
      "SELECT committed_value::float AS committed_value FROM package_order_matrices WHERE package_id = $1",
      [pkgRows[0].id]
    );
    assert.equal(rows[0].committed_value, 9);
  });

  test("12. tenant isolation by orderKey", async () => {
    const tenantB = await createSecondTenant();
    const { rows: devRows } = await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [`dev-mx-ok-${Date.now()}`, tenantB.id, `JOB-MX-OK-${Date.now()}`, "Hidden OK", "live"]
    );
    trackDevelopment(devRows[0].id);
    const orderKey = buildSubcontractOrderKey(devRows[0].id, "sup-ok", "5218");
    const { rows: pkgRows } = await pool.query(
      `
        INSERT INTO packages (client_id, development_id, supplier_id, cost_code, order_key)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [tenantB.id, devRows[0].id, "sup-ok", "5218", orderKey]
    );
    trackPackage(pkgRows[0].id);
    await pool.query(
      `
        INSERT INTO package_order_matrices (
          client_id, package_id, development_id, order_key, layout, payload
        )
        VALUES ($1, $2, $3, $4, 'plot-stage', $5::jsonb)
      `,
      [
        tenantB.id,
        pkgRows[0].id,
        devRows[0].id,
        orderKey,
        JSON.stringify({
          stages: ["Hidden"],
          plots: [{ id: "p1", label: "P1", values: [1] }],
        }),
      ]
    );

    const res = await request(app).get(
      `/api/packages/by-order-key/${encodeURIComponent(orderKey)}/matrix`
    );
    assert.equal(res.status, 404);
  });

  test("13. development isolation", async () => {
    const active = await getActiveClient();
    const setupA = await setupPackage(active, { supplierId: "sup-iso-a" });
    const setupB = await setupPackage(active, { supplierId: "sup-iso-b" });
    await putMatrix(setupA.pkg.id, validMatrixBody({ projectLabel: "Dev A" }));
    await putMatrix(setupB.pkg.id, validMatrixBody({ projectLabel: "Dev B" }));

    const listA = await request(app).get(`/api/developments/${setupA.development.id}/matrices`);
    assert.equal(listA.status, 200);
    assert.equal(listA.body.length, 1);
    assert.equal(listA.body[0].packageId, setupA.pkg.id);

    const tenantB = await createSecondTenant();
    const { rows: hiddenDev } = await pool.query(
      `
        INSERT INTO developments (id, client_id, job_number, development_name, status)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [`dev-mx-hid-${Date.now()}`, tenantB.id, `JOB-MX-HID-${Date.now()}`, "Hidden", "live"]
    );
    trackDevelopment(hiddenDev[0].id);
    const hiddenList = await request(app).get(`/api/developments/${hiddenDev[0].id}/matrices`);
    assert.equal(hiddenList.status, 404);
  });

  test("14. malformed layout rejected", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    const res = await putMatrix(pkg.id, validMatrixBody({ layout: "flat-rows" }));
    assert.equal(res.status, 400);
    assert.match(res.body.message, /layout must be "plot-stage"/);
  });

  test("15. malformed stages rejected", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    const res = await putMatrix(pkg.id, validMatrixBody({ stages: "Foundations" }));
    assert.equal(res.status, 400);
    assert.match(res.body.message, /stages must be an array/);
  });

  test("16. malformed plots rejected", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    const res = await putMatrix(pkg.id, validMatrixBody({ plots: [{ values: [1, 2] }] }));
    assert.equal(res.status, 400);
    assert.match(res.body.message, /plots\[0\]\.id is required/);
  });

  test("17. invalid/non-finite values rejected", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    const res = await putMatrix(
      pkg.id,
      validMatrixBody({
        plots: [{ id: "p1", label: "P1", values: ["NaN", "Infinity"] }],
      })
    );
    assert.equal(res.status, 400);
    assert.match(res.body.message, /finite number/);
  });

  test("18. incompatible values/stage dimensions rejected", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    const res = await putMatrix(
      pkg.id,
      validMatrixBody({
        stages: ["A", "B", "C"],
        plots: [{ id: "p1", label: "P1", values: [1, 2] }],
      })
    );
    assert.equal(res.status, 400);
    assert.match(res.body.message, /must match stages length/);
  });

  test("19. reasonable payload-size protection", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    const res = await putMatrix(
      pkg.id,
      validMatrixBody({
        stages: Array.from({ length: 20 }, (_, index) => `Stage ${index + 1}`),
        plots: Array.from({ length: 500 }, (_, index) => ({
          id: "i".repeat(MAX_LABEL_LENGTH),
          label: "l".repeat(MAX_LABEL_LENGTH),
          values: Array.from({ length: 20 }, () => index),
        })),
      })
    );
    assert.equal(res.status, 400);
    assert.match(res.body.message, /payload exceeds/);
  });

  test("20. package deletion cascades the matrix", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    const created = await putMatrix(pkg.id, validMatrixBody());
    assert.equal(created.status, 201);

    await pool.query("DELETE FROM packages WHERE id = $1", [pkg.id]);
    const getRes = await request(app).get(`/api/packages/${pkg.id}/matrix`);
    assert.equal(getRes.status, 404);

    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM package_order_matrices WHERE id = $1",
      [created.body.id]
    );
    assert.equal(rows[0].n, 0);
  });

  test("21. no certificate/progress persistence introduced", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    const rejected = await putMatrix(
      pkg.id,
      validMatrixBody({
        progress: { "plot-1": [10, 20] },
        certificates: [{ id: "cert-1" }],
      })
    );
    assert.equal(rejected.status, 400);

    const created = await putMatrix(
      pkg.id,
      validMatrixBody({
        plots: [
          {
            id: "plot-1",
            label: "Plot 1",
            values: [500, 1000],
            progress: [10, 20],
          },
        ],
      })
    );
    assert.equal(created.status, 201);
    assert.ok(!Object.prototype.hasOwnProperty.call(created.body, "progress"));
    assert.ok(!Object.prototype.hasOwnProperty.call(created.body.plots[0], "progress"));

    const { rows } = await pool.query(
      "SELECT payload FROM package_order_matrices WHERE package_id = $1",
      [pkg.id]
    );
    assert.ok(!Object.prototype.hasOwnProperty.call(rows[0].payload, "progress"));
    assert.ok(!Object.prototype.hasOwnProperty.call(rows[0].payload, "certificates"));
    assert.ok(!Object.prototype.hasOwnProperty.call(rows[0].payload, "rows"));
    assert.deepEqual(rows[0].payload.plots[0], {
      id: "plot-1",
      label: "Plot 1",
      values: [500, 1000],
    });
  });

  test("22. PUT does not rebind identity from the request body", async () => {
    const active = await getActiveClient();
    const first = await setupPackage(active, { supplierId: "sup-bind-a" });
    const second = await setupPackage(active, {
      development: first.development,
      supplierId: "sup-bind-b",
      costCode: "5219",
    });
    const res = await putMatrix(
      first.pkg.id,
      validMatrixBody({
        packageId: second.pkg.id,
        orderKey: second.orderKey,
        developmentId: "spoof-dev",
      })
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.packageId, first.pkg.id);
    assert.equal(res.body.orderKey, first.orderKey);
    assert.equal(res.body.developmentId, first.development.id);
  });

  test("23. GET missing package vs missing matrix", async () => {
    const active = await getActiveClient();
    const { pkg } = await setupPackage(active);
    const missingPackage = await request(app).get(
      "/api/packages/00000000-0000-4000-8000-000000000098/matrix"
    );
    assert.equal(missingPackage.status, 404);
    assert.match(missingPackage.body.message, /Package not found/);

    const missingMatrix = await request(app).get(`/api/packages/${pkg.id}/matrix`);
    assert.equal(missingMatrix.status, 404);
    assert.match(missingMatrix.body.message, /Order matrix not found/);
  });

  test("24. malformed package UUID GET returns 400", async () => {
    const res = await request(app).get("/api/packages/not-a-uuid/matrix");
    assert.equal(res.status, 400);
    assert.match(res.body.message, /packageId must be a valid UUID/);
    assert.doesNotMatch(JSON.stringify(res.body), /invalid input syntax/i);
  });

  test("25. malformed package UUID PUT returns 400", async () => {
    const res = await putMatrix("not-a-uuid", validMatrixBody());
    assert.equal(res.status, 400);
    assert.match(res.body.message, /packageId must be a valid UUID/);
    assert.doesNotMatch(JSON.stringify(res.body), /invalid input syntax/i);
  });
}
