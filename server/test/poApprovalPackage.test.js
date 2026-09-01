/**
 * BL-027B.3 — PO approval triggers server Package materialisation.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const createApp = require("../app");
const { createTestAuthAdapter } = require('../auth/authAdapters');
const { PERMISSIONS } = require('../auth/permissions');
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
const testSupplierIds = [];

function trackDevelopment(id, jobNumber) {
  if (id) testDevelopmentIds.push(id);
  if (jobNumber) testJobNumbers.push(jobNumber);
}

function trackPo(poNumber) {
  if (poNumber) testPoNumbers.push(poNumber);
}

function trackSupplier(id) {
  if (id) testSupplierIds.push(id);
}

async function ensureSchema() {
  await pool.query(fs.readFileSync(MIGRATION_004, "utf8"));
  await pool.query(fs.readFileSync(MIGRATION_005, "utf8"));
}

async function cleanup() {
  if (testPackageIds.length) {
    await pool.query("DELETE FROM packages WHERE id = ANY($1::uuid[])", [testPackageIds]);
  }
  if (testPoNumbers.length) {
    await pool.query("DELETE FROM purchase_orders WHERE po_number = ANY($1::text[])", [
      testPoNumbers,
    ]);
  }
  if (testSupplierIds.length) {
    await pool.query("DELETE FROM suppliers WHERE id = ANY($1::text[])", [testSupplierIds]);
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

async function createDevelopment(active, overrides = {}) {
  const res = await request(app)
    .post("/api/developments")
    .send({
      id: overrides.id || `dev-poappr-${Date.now()}`,
      jobNumber: overrides.jobNumber || `DEV-POAPPR-${Date.now()}`,
      developmentName: overrides.developmentName || "PO Approval Dev",
      status: "live",
    });
  assert.equal(res.status, 201);
  trackDevelopment(res.body.id, res.body.jobNumber);
  return res.body;
}

async function createApprovedSupplier(clientId, supplierId, name = "Supplier A") {
  const payload = {
    id: supplierId,
    name,
    approvedSupplier: true,
    approvalStatus: "approved",
  };
  await pool.query(
    `
      INSERT INTO suppliers (id, name, payload, client_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id)
      DO UPDATE SET name = EXCLUDED.name, payload = EXCLUDED.payload, client_id = EXCLUDED.client_id
    `,
    [supplierId, name, payload, clientId]
  );
  trackSupplier(supplierId);
  return payload;
}

function buildPendingPo({
  poNumber,
  development,
  supplierId,
  supplierLabel = "Supplier A",
  costCode = "5218",
  type = "S",
  subtotal = 50000,
  developmentIdOverride = null,
}) {
  const developmentId = developmentIdOverride || development.id;
  return {
    poNumber,
    type,
    supplierId,
    supplierSnapshot: { id: supplierId, name: supplierLabel },
    developmentId,
    developmentNumber: development.jobNumber,
    developmentName: development.developmentName,
    development: {
      id: developmentId,
      developmentNumber: development.jobNumber,
      developmentName: development.developmentName,
    },
    costRef: {
      developmentId,
      costCode,
    },
    items: [{ description: "Works", qty: 1, rate: subtotal, amount: subtotal, costCode }],
    subtotal,
    totals: { net: subtotal, vat: 0, gross: subtotal },
    approval: { status: "Pending", history: [] },
    status: "Issued",
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

async function approvePo(poNumber, body = {}) {
  return request(app).post(`/api/po/${poNumber}/approve`).send({
    status: "Approved",
    approver: "Test Approver",
    ...body,
  });
}

async function getPackageByOrderKey(clientId, orderKey) {
  const { rows } = await pool.query(
    `
      SELECT *
      FROM packages
      WHERE client_id = $1 AND order_key = $2
      LIMIT 1
    `,
    [clientId, orderKey]
  );
  if (!rows[0]) return null;
  const { rows: membership } = await pool.query(
    `
      SELECT po_number
      FROM package_purchase_orders
      WHERE client_id = $1 AND package_id = $2
      ORDER BY po_number ASC
    `,
    [clientId, rows[0].id]
  );
  return {
    ...rows[0],
    poNumbers: membership.map((row) => row.po_number),
  };
}

async function countPackages(clientId) {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM packages WHERE client_id = $1",
    [clientId]
  );
  return rows[0].count;
}

if (!isDbConfigured()) {
  test("po approval package tests skipped — TEST_DATABASE_URL not configured", () => {
    assert.ok(true);
  });
} else {
  test("PO approval package hook", { concurrency: false }, async (t) => {
    await prepareIntegrationTestDatabase(pool);
    await ensureSchema();

    t.after(async () => {
      await cleanup();
    });

    await t.test("final approval of eligible type-S PO creates Package with membership", async () => {
      const active = await getActiveClient();
      const development = await createDevelopment(active);
      const supplierId = `sup-poappr-${Date.now()}`;
      await createApprovedSupplier(active.id, supplierId);

      const poNumber = `S-APPR-1-${Date.now()}`;
      await savePo(
        active.id,
        buildPendingPo({ poNumber, development, supplierId, costCode: "5218" })
      );

      const beforeCount = await countPackages(active.id);
      const res = await approvePo(poNumber);
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "Approved");

      const orderKey = buildSubcontractOrderKey(development.id, supplierId, "5218");
      const pkg = await getPackageByOrderKey(active.id, orderKey);
      assert.ok(pkg);
      assert.match(pkg.id, /^[0-9a-f-]{36}$/i);
      assert.equal(pkg.order_key, orderKey);
      assert.deepEqual(pkg.poNumbers, [poNumber]);
      assert.equal(await countPackages(active.id), beforeCount + 1);
      testPackageIds.push(pkg.id);
    });

    await t.test("authenticated PO approver overrides forged browser actor fields", async () => {
      const active = await getActiveClient();
      const development = await createDevelopment(active);
      const supplierId = `sup-rbac-actor-${Date.now()}`;
      await createApprovedSupplier(active.id, supplierId, "RBAC Actor Supplier");
      const poNumber = `S-RBAC-ACTOR-${Date.now()}`;
      await savePo(active.id, buildPendingPo({ poNumber, development, supplierId }));
      const authApp = createApp({ authAdapter:createTestAuthAdapter({
        userId:'rbac-user',providerUserId:'clerk-rbac-user',displayName:'Authenticated Manager',email:'manager@example.test',
        clientId:active.id,membershipId:'rbac-membership',roleKey:'commercial_manager',roleName:'Commercial Manager',
        permissions:[PERMISSIONS.PO_APPROVE],memberships:[],
      }) });
      const response = await request(authApp).post(`/api/po/${poNumber}/approve`).send({
        status:'Approved',approver:'Forged Browser Actor',approvedBy:'Also Forged',approverEmail:'forged@example.test',
      });
      assert.equal(response.status,200);
      assert.equal(response.body.approval.approver,'Authenticated Manager');
      assert.equal(response.body.approval.approverEmail,'manager@example.test');
      assert.equal(response.body.approval.history.at(-1).by,'Authenticated Manager');
      const orderKey=buildSubcontractOrderKey(development.id,supplierId,'5218');
      const pkg=await getPackageByOrderKey(active.id,orderKey);
      assert.equal(pkg.created_by,'Authenticated Manager');
      testPackageIds.push(pkg.id);
    });

    await t.test("second approved PO same key reuses Package UUID and adds membership", async () => {
      const active = await getActiveClient();
      const development = await createDevelopment(active);
      const supplierId = `sup-spark-${Date.now()}`;
      await createApprovedSupplier(active.id, supplierId, "Sparktastic Ltd");

      const po1 = `S-SPARK-7-${Date.now()}`;
      const po2 = `S-SPARK-10-${Date.now()}`;
      const orderKey = buildSubcontractOrderKey(development.id, supplierId, "5215");

      await savePo(
        active.id,
        buildPendingPo({
          poNumber: po1,
          development,
          supplierId,
          supplierLabel: "Sparktastic Ltd",
          costCode: "5215",
        })
      );
      await savePo(
        active.id,
        buildPendingPo({
          poNumber: po2,
          development,
          supplierId,
          supplierLabel: "Sparktastic Ltd",
          costCode: "5215",
        })
      );

      const first = await approvePo(po1);
      assert.equal(first.status, 200);
      const pkgAfterFirst = await getPackageByOrderKey(active.id, orderKey);
      assert.ok(pkgAfterFirst);
      testPackageIds.push(pkgAfterFirst.id);

      const second = await approvePo(po2);
      assert.equal(second.status, 200);
      const pkgAfterSecond = await getPackageByOrderKey(active.id, orderKey);
      assert.equal(pkgAfterSecond.id, pkgAfterFirst.id);
      assert.deepEqual(pkgAfterSecond.poNumbers.sort(), [po1, po2].sort());
    });

    await t.test("different supplier or cost code or development creates different Package", async () => {
      const active = await getActiveClient();
      const devA = await createDevelopment(active, { developmentName: "Dev A" });
      const devB = await createDevelopment(active, { developmentName: "Dev B" });
      const sup1 = `sup-diff-1-${Date.now()}`;
      const sup2 = `sup-diff-2-${Date.now()}`;
      await createApprovedSupplier(active.id, sup1, "Supplier One");
      await createApprovedSupplier(active.id, sup2, "Supplier Two");

      const poSup = `S-DIFF-SUP-${Date.now()}`;
      const poCost = `S-DIFF-COST-${Date.now()}`;
      const poDev = `S-DIFF-DEV-${Date.now()}`;

      await savePo(
        active.id,
        buildPendingPo({ poNumber: poSup, development: devA, supplierId: sup1, costCode: "5218" })
      );
      await savePo(
        active.id,
        buildPendingPo({
          poNumber: poCost,
          development: devA,
          supplierId: sup1,
          costCode: "6100",
        })
      );
      await savePo(
        active.id,
        buildPendingPo({ poNumber: poDev, development: devB, supplierId: sup1, costCode: "5218" })
      );

      assert.equal((await approvePo(poSup)).status, 200);
      assert.equal((await approvePo(poCost)).status, 200);
      assert.equal((await approvePo(poDev)).status, 200);

      const keySup = buildSubcontractOrderKey(devA.id, sup1, "5218");
      const keyCost = buildSubcontractOrderKey(devA.id, sup1, "6100");
      const keyDev = buildSubcontractOrderKey(devB.id, sup1, "5218");

      const pkgSup = await getPackageByOrderKey(active.id, keySup);
      const pkgCost = await getPackageByOrderKey(active.id, keyCost);
      const pkgDev = await getPackageByOrderKey(active.id, keyDev);

      assert.notEqual(pkgSup.id, pkgCost.id);
      assert.notEqual(pkgSup.id, pkgDev.id);
      testPackageIds.push(pkgSup.id, pkgCost.id, pkgDev.id);
    });

    await t.test("type-M PO approval does not materialise Package", async () => {
      const active = await getActiveClient();
      const development = await createDevelopment(active);
      const supplierId = `sup-mat-${Date.now()}`;
      await createApprovedSupplier(active.id, supplierId);

      const poNumber = `M-NOPKG-${Date.now()}`;
      await savePo(
        active.id,
        buildPendingPo({
          poNumber,
          development,
          supplierId,
          type: "M",
          costCode: "5218",
        })
      );

      const beforeCount = await countPackages(active.id);
      const res = await approvePo(poNumber);
      assert.equal(res.status, 200);
      assert.equal(await countPackages(active.id), beforeCount);
    });

    await t.test("reject and request-approval do not materialise Package", async () => {
      const active = await getActiveClient();
      const development = await createDevelopment(active);
      const supplierId = `sup-flow-${Date.now()}`;
      await createApprovedSupplier(active.id, supplierId);

      const rejectPoNumber = `S-REJECT-${Date.now()}`;
      const pendingPoNumber = `S-PENDING-${Date.now()}`;

      await savePo(
        active.id,
        buildPendingPo({ poNumber: rejectPoNumber, development, supplierId })
      );
      await savePo(
        active.id,
        buildPendingPo({ poNumber: pendingPoNumber, development, supplierId })
      );

      const beforeCount = await countPackages(active.id);

      const rejectRes = await request(app)
        .post(`/api/po/${rejectPoNumber}/approve`)
        .send({ status: "Rejected", approver: "Tester", note: "No" });
      assert.equal(rejectRes.status, 200);

      const requestRes = await request(app)
        .post(`/api/po/${pendingPoNumber}/request-approval`)
        .send({ approverName: "Tester" });
      assert.equal(requestRes.status, 200);

      assert.equal(await countPackages(active.id), beforeCount);
    });

    await t.test("supplier approval route does not materialise Package", async () => {
      const active = await getActiveClient();
      const supplierId = `sup-only-appr-${Date.now()}`;
      await pool.query(
        `
          INSERT INTO suppliers (id, name, payload, client_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload
        `,
        [
          supplierId,
          "Pending Supplier",
          {
            id: supplierId,
            name: "Pending Supplier",
            approvedSupplier: false,
            approvalStatus: "pending",
          },
          active.id,
        ]
      );
      trackSupplier(supplierId);

      const beforeCount = await countPackages(active.id);
      const res = await request(app)
        .post(`/api/po/suppliers/${supplierId}/approve`)
        .send({ by: "Admin" });
      assert.equal(res.status, 200);
      assert.equal(await countPackages(active.id), beforeCount);
    });

    await t.test("missing development blocks subcontract PO approval and rolls back PO state", async () => {
      const active = await getActiveClient();
      const development = await createDevelopment(active);
      const supplierId = `sup-nodev-${Date.now()}`;
      await createApprovedSupplier(active.id, supplierId);

      const poNumber = `S-NODEV-${Date.now()}`;
      const pending = buildPendingPo({
        poNumber,
        development,
        supplierId,
        developmentIdOverride: "dev-does-not-exist",
      });
      pending.development = null;
      await savePo(active.id, pending);

      const res = await approvePo(poNumber);
      assert.equal(res.status, 400);
      assert.match(res.body.message, /not eligible for package materialisation/i);

      const stored = await pool.query(
        "SELECT payload FROM purchase_orders WHERE client_id = $1 AND po_number = $2",
        [active.id, poNumber]
      );
      assert.equal(stored.rows[0].payload.status, "Issued");
      assert.equal(stored.rows[0].payload.approval.status, "Pending");
    });

    await t.test("missing supplierId blocks subcontract PO approval", async () => {
      const active = await getActiveClient();
      const development = await createDevelopment(active);

      const poNumber = `S-NOSUP-${Date.now()}`;
      const pending = buildPendingPo({ poNumber, development, supplierId: "sup-x" });
      delete pending.supplierId;
      await savePo(active.id, pending);

      const res = await approvePo(poNumber);
      assert.equal(res.status, 400);
      assert.match(res.body.message, /missing-supplier-id/i);
    });

    await t.test("pending supplier still blocks PO approval before package materialisation", async () => {
      const active = await getActiveClient();
      const development = await createDevelopment(active);
      const supplierId = `sup-pending-${Date.now()}`;
      await pool.query(
        `
          INSERT INTO suppliers (id, name, payload, client_id)
          VALUES ($1, $2, $3, $4)
        `,
        [
          supplierId,
          "Pending Supplier",
          {
            id: supplierId,
            name: "Pending Supplier",
            approvedSupplier: false,
            approvalStatus: "pending",
          },
          active.id,
        ]
      );
      trackSupplier(supplierId);

      const poNumber = `S-PEND-SUP-${Date.now()}`;
      await savePo(
        active.id,
        buildPendingPo({ poNumber, development, supplierId })
      );

      const res = await approvePo(poNumber);
      assert.equal(res.status, 400);
      assert.match(res.body.message, /supplier is pending approval/i);
    });

    await t.test("repeated approval of same subcontract PO remains idempotent", async () => {
      const active = await getActiveClient();
      const development = await createDevelopment(active);
      const supplierId = `sup-idem-${Date.now()}`;
      await createApprovedSupplier(active.id, supplierId);

      const poNumber = `S-IDEM-${Date.now()}`;
      await savePo(
        active.id,
        buildPendingPo({ poNumber, development, supplierId, costCode: "5218" })
      );

      const first = await approvePo(poNumber);
      assert.equal(first.status, 200);
      const orderKey = buildSubcontractOrderKey(development.id, supplierId, "5218");
      const pkgFirst = await getPackageByOrderKey(active.id, orderKey);
      testPackageIds.push(pkgFirst.id);

      const second = await approvePo(poNumber);
      assert.equal(second.status, 200);
      const pkgSecond = await getPackageByOrderKey(active.id, orderKey);
      assert.equal(pkgSecond.id, pkgFirst.id);
      assert.deepEqual(pkgSecond.poNumbers, [poNumber]);

      const { rows: membershipRows } = await pool.query(
        `
          SELECT COUNT(*)::int AS count
          FROM package_purchase_orders
          WHERE client_id = $1 AND package_id = $2 AND po_number = $3
        `,
        [active.id, pkgSecond.id, poNumber]
      );
      assert.equal(membershipRows[0].count, 1);
    });
  });
}
