/**
 * BL-028A — Commercial Event API integration tests (requires DATABASE_URL).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const createApp = require("../app");
const { pool, init, isDbConfigured } = require("../db");
const { buildSubcontractOrderKey } = require("../services/packageKey");
const { COMMERCIAL_EVENT_ID_PATTERN } = require("../services/commercialEventConstants");

const app = createApp();
const MIGRATION_004 = path.join(__dirname, "..", "migrations", "004_developments.sql");
const MIGRATION_005 = path.join(__dirname, "..", "migrations", "005_packages.sql");
const MIGRATION_006 = path.join(__dirname, "..", "migrations", "006_commercial_events.sql");

const testDevelopmentIds = [];
const testJobNumbers = [];
const testPoNumbers = [];
const testPackageIds = [];
const testCommercialEventIds = [];

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
  const code = `TESTCE_${Date.now()}`;
  const { rows } = await pool.query(
    `
      INSERT INTO clients (code, name, is_active)
      VALUES ($1, $2, false)
      RETURNING id, code, name
    `,
    [code, "CE Test Tenant B"]
  );
  return rows[0];
}

async function createDevelopment(active, overrides = {}) {
  const id = overrides.id || `dev-ce-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const jobNumber = overrides.jobNumber || `DEV-CE-${Date.now()}`;
  const res = await request(app)
    .post("/api/developments")
    .send({
      id,
      jobNumber,
      developmentName: overrides.developmentName || "CE Test Dev",
      status: "live",
    });
  assert.equal(res.status, 201);
  trackDevelopment(res.body.id, res.body.jobNumber);
  return res.body;
}

function buildPo({ poNumber, development, supplierId = "sup-ce-1", costCode = "5218", subtotal = 50000 }) {
  return {
    poNumber,
    type: "S",
    supplierId,
    supplierSnapshot: { name: "CE Supplier" },
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
    if (pkg.id) testPackageIds.push(pkg.id);
  }
  return res.body;
}

async function setupDevWithTwoPackages(active, supplierA = "sup-a", supplierB = "sup-b") {
  const development = await createDevelopment(active);
  const stamp = Date.now();
  await savePo(
    active.id,
    buildPo({
      poNumber: `S-CE-A-${stamp}`,
      development,
      supplierId: supplierA,
    })
  );
  await savePo(
    active.id,
    buildPo({
      poNumber: `S-CE-B-${stamp}`,
      development,
      supplierId: supplierB,
      costCode: "5219",
    })
  );
  const materialised = await materialise(development.id);
  const orderKeyA = buildSubcontractOrderKey(development.id, supplierA, "5218");
  const orderKeyB = buildSubcontractOrderKey(development.id, supplierB, "5219");
  const pkgA = materialised.packages.find((p) => p.orderKey === orderKeyA);
  const pkgB = materialised.packages.find((p) => p.orderKey === orderKeyB);
  assert.ok(pkgA);
  assert.ok(pkgB);
  return { development, pkgA, pkgB, orderKeyA, orderKeyB };
}

function baseCePayload(development, orderKey, overrides = {}) {
  return {
    developmentId: development.id,
    packageId: orderKey,
    eventType: "variation",
    category: "design",
    responsibility: "employer",
    description: "Test variation",
    value: 1000,
    financialTreatment: "contractAmendment",
    ...overrides,
  };
}

async function createCe(payload) {
  const res = await request(app).post("/api/commercial-events").send(payload);
  if (res.body?.id) trackCe(res.body.id);
  return res;
}

async function workflowToApproved(eventId) {
  let res = await request(app).post(`/api/commercial-events/${eventId}/submit`).send({});
  assert.equal(res.status, 200);
  res = await request(app).post(`/api/commercial-events/${eventId}/approve`).send({});
  assert.equal(res.status, 200);
  return res.body;
}

if (!isDbConfigured()) {
  test("commercial event routes skipped — DATABASE_URL not configured", () => {
    assert.ok(true);
  });
} else {
  test.before(async () => {
    await init();
    await ensureSchema();
  });

  test.after(async () => {
    await cleanup();
  });

  test("1. new CE creates server id + eventNumber", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const res = await createCe(baseCePayload(development, orderKeyA));
    assert.equal(res.status, 201);
    assert.match(res.body.id, COMMERCIAL_EVENT_ID_PATTERN);
    assert.match(res.body.eventNumber, /^CE-\d{4,}$/);
    assert.equal(res.body.packageId, orderKeyA);
    assert.ok(res.body.packageUuid);
    assert.equal(res.body.orderKey, orderKeyA);
    assert.equal(res.body.certificateStatus, "notIncluded");
    assert.equal(res.body.recoveredAmount, 0);
  });

  test("2. imported supplied ce-* id preserved", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const importId = `ce-import-${Date.now()}-abc123`;
    const res = await request(app)
      .post("/api/commercial-events/import")
      .send({
        developmentId: development.id,
        events: [
          {
            id: importId,
            eventNumber: "CE-9001",
            packageId: orderKeyA,
            eventType: "variation",
            category: "design",
            responsibility: "employer",
            description: "Imported",
            value: 500,
            financialTreatment: "contractAmendment",
            status: "approved",
          },
        ],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 1);
    trackCe(importId);
    const getRes = await request(app).get(`/api/commercial-events/${importId}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.id, importId);
  });

  test("3. imported eventNumber preserved", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const importId = `ce-import-num-${Date.now()}`;
    await request(app)
      .post("/api/commercial-events/import")
      .send({
        developmentId: development.id,
        events: [
          {
            id: importId,
            eventNumber: "CE-8888",
            packageId: orderKeyA,
            eventType: "credit",
            category: "commercial",
            responsibility: "employer",
            description: "Credit import",
            value: -100,
            status: "draft",
          },
        ],
      });
    trackCe(importId);
    const getRes = await request(app).get(`/api/commercial-events/${importId}`);
    assert.equal(getRes.body.eventNumber, "CE-8888");
  });

  test("4. duplicate id skipped on import", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const importId = `ce-dup-skip-${Date.now()}`;
    const body = {
      developmentId: development.id,
      events: [
        {
          id: importId,
          eventNumber: "CE-7701",
          packageId: orderKeyA,
          eventType: "variation",
          category: "design",
          responsibility: "employer",
          description: "First",
          value: 100,
          financialTreatment: "contractAmendment",
        },
      ],
    };
    const first = await request(app).post("/api/commercial-events/import").send(body);
    assert.equal(first.body.imported, 1);
    trackCe(importId);
    const second = await request(app).post("/api/commercial-events/import").send(body);
    assert.equal(second.body.skipped, 1);
  });

  test("4b. duplicate id rejected on POST create", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const id = `ce-dup-post-${Date.now()}`;
    const payload = { ...baseCePayload(development, orderKeyA), id };
    const first = await createCe(payload);
    assert.equal(first.status, 201);
    const second = await createCe(payload);
    assert.equal(second.status, 409);
  });

  test("5. duplicate eventNumber different id conflicts on import", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const id1 = `ce-conflict-a-${Date.now()}`;
    const id2 = `ce-conflict-b-${Date.now()}`;
    await request(app)
      .post("/api/commercial-events/import")
      .send({
        developmentId: development.id,
        events: [
          {
            id: id1,
            eventNumber: "CE-6601",
            packageId: orderKeyA,
            eventType: "variation",
            category: "design",
            responsibility: "employer",
            description: "First",
            value: 100,
            financialTreatment: "contractAmendment",
          },
        ],
      });
    trackCe(id1);
    const second = await request(app)
      .post("/api/commercial-events/import")
      .send({
        developmentId: development.id,
        events: [
          {
            id: id2,
            eventNumber: "CE-6601",
            packageId: orderKeyA,
            eventType: "variation",
            category: "design",
            responsibility: "employer",
            description: "Conflict",
            value: 200,
            financialTreatment: "contractAmendment",
          },
        ],
      });
    assert.equal(second.body.conflicts.length, 1);
    assert.equal(second.body.imported, 0);
  });

  test("6. tenant-global next event number works", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const first = await createCe(baseCePayload(development, orderKeyA));
    const second = await createCe(baseCePayload(development, orderKeyA));
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const n1 = Number.parseInt(first.body.eventNumber.replace("CE-", ""), 10);
    const n2 = Number.parseInt(second.body.eventNumber.replace("CE-", ""), 10);
    assert.equal(n2, n1 + 1);
  });

  test("7. concurrent numbering cannot duplicate", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const payload = baseCePayload(development, orderKeyA);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => request(app).post("/api/commercial-events").send(payload))
    );
    const numbers = results.map((res) => res.body.eventNumber).filter(Boolean);
    for (const res of results) trackCe(res.body.id);
    assert.equal(new Set(numbers).size, numbers.length);
  });

  test("8. GET list tenant scoped", async () => {
    const active = await getActiveClient();
    const tenantB = await createSecondTenant();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const created = await createCe(baseCePayload(development, orderKeyA));
    assert.equal(created.status, 201);

    const { rows: devRow } = await pool.query(
      "INSERT INTO developments (id, client_id, job_number, development_name, status) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [`dev-other-${Date.now()}`, tenantB.id, `JOB-B-${Date.now()}`, "Other", "live"]
    );
    const otherDevId = devRow[0].id;
    const otherOrderKey = buildSubcontractOrderKey(otherDevId, "sup-x", "5218");
    const { rows: pkgRows } = await pool.query(
      `
        INSERT INTO packages (client_id, development_id, supplier_id, cost_code, order_key)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [tenantB.id, otherDevId, "sup-x", "5218", otherOrderKey]
    );
    testPackageIds.push(pkgRows[0].id);
    const otherCeId = `ce-other-tenant-${Date.now()}`;
    await pool.query(
      `
        INSERT INTO commercial_events (
          id, client_id, development_id, package_id, order_key, event_number,
          event_type, category, responsibility, description, value
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'variation', 'design', 'employer', 'Hidden', 1)
      `,
      [otherCeId, tenantB.id, otherDevId, pkgRows[0].id, otherOrderKey, "CE-9999"]
    );
    testCommercialEventIds.push(otherCeId);

    const listRes = await request(app).get("/api/commercial-events");
    assert.equal(listRes.status, 200);
    const ids = listRes.body.map((e) => e.id);
    assert.ok(ids.includes(created.body.id));
    assert.ok(!ids.includes(otherCeId));

    await pool.query("DELETE FROM commercial_events WHERE id = $1", [otherCeId]);
    await pool.query("DELETE FROM packages WHERE id = $1", [pkgRows[0].id]);
    await pool.query("DELETE FROM developments WHERE id = $1", [otherDevId]);
    await pool.query("DELETE FROM clients WHERE id = $1", [tenantB.id]);
  });

  test("9. GET by id tenant scoped", async () => {
    const tenantB = await createSecondTenant();
    const otherCeId = `ce-idor-${Date.now()}`;
    const { rows: devRow } = await pool.query(
      "INSERT INTO developments (id, client_id, job_number, development_name, status) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [`dev-idor-${Date.now()}`, tenantB.id, `JOB-IDOR-${Date.now()}`, "IDOR", "live"]
    );
    const devId = devRow[0].id;
    const orderKey = buildSubcontractOrderKey(devId, "sup-idor", "5218");
    const { rows: pkgRows } = await pool.query(
      `
        INSERT INTO packages (client_id, development_id, supplier_id, cost_code, order_key)
        VALUES ($1, $2, $3, $4, $5) RETURNING id
      `,
      [tenantB.id, devId, "sup-idor", "5218", orderKey]
    );
    await pool.query(
      `
        INSERT INTO commercial_events (
          id, client_id, development_id, package_id, order_key, event_number,
          event_type, category, responsibility, description, value
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'variation', 'design', 'employer', 'Secret', 1)
      `,
      [otherCeId, tenantB.id, devId, pkgRows[0].id, orderKey, "CE-9998"]
    );

    const res = await request(app).get(`/api/commercial-events/${otherCeId}`);
    assert.equal(res.status, 404);

    await pool.query("DELETE FROM commercial_events WHERE id = $1", [otherCeId]);
    await pool.query("DELETE FROM packages WHERE id = $1", [pkgRows[0].id]);
    await pool.query("DELETE FROM developments WHERE id = $1", [devId]);
    await pool.query("DELETE FROM clients WHERE id = $1", [tenantB.id]);
  });

  test("10. filter by development", async () => {
    const active = await getActiveClient();
    const setupA = await setupDevWithTwoPackages(active, "sup-f1", "sup-f2");
    const setupB = await setupDevWithTwoPackages(active, "sup-f3", "sup-f4");
    const ceA = await createCe(baseCePayload(setupA.development, setupA.orderKeyA));
    await createCe(baseCePayload(setupB.development, setupB.orderKeyA));
    const res = await request(app).get(
      `/api/commercial-events?developmentId=${setupA.development.id}`
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.every((e) => e.developmentId === setupA.development.id));
    assert.ok(res.body.some((e) => e.id === ceA.body.id));
  });

  test("11. filter by package UUID", async () => {
    const active = await getActiveClient();
    const { development, pkgA, orderKeyA } = await setupDevWithTwoPackages(active);
    const created = await createCe(baseCePayload(development, orderKeyA));
    const res = await request(app).get(
      `/api/commercial-events?packageId=${pkgA.id}`
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.some((e) => e.id === created.body.id));
    assert.ok(res.body.every((e) => e.packageUuid === pkgA.id));
  });

  test("12. filter by orderKey", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const created = await createCe(baseCePayload(development, orderKeyA));
    const res = await request(app).get(
      `/api/commercial-events?orderKey=${encodeURIComponent(orderKeyA)}`
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.some((e) => e.id === created.body.id));
  });

  test("13. missing development rejected", async () => {
    const active = await getActiveClient();
    const { orderKeyA } = await setupDevWithTwoPackages(active);
    const res = await createCe({
      ...baseCePayload({ id: "missing-dev" }, orderKeyA),
      developmentId: "dev-does-not-exist",
    });
    assert.equal(res.status, 400);
  });

  test("14. missing package rejected", async () => {
    const active = await getActiveClient();
    const development = await createDevelopment(active);
    const res = await createCe(
      baseCePayload(development, buildSubcontractOrderKey(development.id, "missing", "9999"))
    );
    assert.equal(res.status, 400);
  });

  test("15. package/development mismatch rejected", async () => {
    const active = await getActiveClient();
    const setupA = await setupDevWithTwoPackages(active, "sup-m1", "sup-m2");
    const setupB = await setupDevWithTwoPackages(active, "sup-m3", "sup-m4");
    const res = await createCe({
      ...baseCePayload(setupB.development, setupA.orderKeyA),
      developmentId: setupB.development.id,
    });
    assert.equal(res.status, 400);
  });

  test("16. cross-tenant package rejected", async () => {
    const active = await getActiveClient();
    const tenantB = await createSecondTenant();
    const development = await createDevelopment(active);
    const { rows: devRow } = await pool.query(
      "INSERT INTO developments (id, client_id, job_number, development_name, status) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [`dev-bpkg-${Date.now()}`, tenantB.id, `JOB-BPKG-${Date.now()}`, "B Dev", "live"]
    );
    const devB = devRow[0].id;
    const orderKeyB = buildSubcontractOrderKey(devB, "sup-b", "5218");
    await pool.query(
      `
        INSERT INTO packages (client_id, development_id, supplier_id, cost_code, order_key)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [tenantB.id, devB, "sup-b", "5218", orderKeyB]
    );
    const res = await createCe({
      ...baseCePayload(development, orderKeyB),
      developmentId: development.id,
    });
    assert.equal(res.status, 400);
    await pool.query("DELETE FROM packages WHERE client_id = $1", [tenantB.id]);
    await pool.query("DELETE FROM developments WHERE id = $1", [devB]);
    await pool.query("DELETE FROM clients WHERE id = $1", [tenantB.id]);
  });

  test("17. invalid event type rejected", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const res = await createCe(baseCePayload(development, orderKeyA, { eventType: "invalidType" }));
    assert.equal(res.status, 400);
  });

  test("18. invalid financial treatment rejected", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const res = await createCe(
      baseCePayload(development, orderKeyA, { financialTreatment: "notValid" })
    );
    assert.equal(res.status, 400);
  });

  test("19. invalid relationship type rejected", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const res = await createCe(
      baseCePayload(development, orderKeyA, { relationshipType: "invalidRel" })
    );
    assert.equal(res.status, 400);
  });

  test("20. draft edit succeeds", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const created = await createCe(baseCePayload(development, orderKeyA));
    const res = await request(app)
      .put(`/api/commercial-events/${created.body.id}`)
      .send({ version: 1, description: "Updated description" });
    assert.equal(res.status, 200);
    assert.equal(res.body.description, "Updated description");
  });

  test("21. version increments on edit", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const created = await createCe(baseCePayload(development, orderKeyA));
    const res = await request(app)
      .put(`/api/commercial-events/${created.body.id}`)
      .send({ version: 1, description: "V2" });
    assert.equal(res.body.version, 2);
  });

  test("22. stale version returns 409", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const created = await createCe(baseCePayload(development, orderKeyA));
    const res = await request(app)
      .put(`/api/commercial-events/${created.body.id}`)
      .send({ version: 99, description: "Stale" });
    assert.equal(res.status, 409);
  });

  test("23. submit valid transition", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const created = await createCe(baseCePayload(development, orderKeyA));
    const res = await request(app)
      .post(`/api/commercial-events/${created.body.id}/submit`)
      .send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "submitted");
  });

  test("24. approve valid transition", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const created = await createCe(baseCePayload(development, orderKeyA));
    await request(app).post(`/api/commercial-events/${created.body.id}/submit`).send({});
    const res = await request(app)
      .post(`/api/commercial-events/${created.body.id}/approve`)
      .send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "approved");
  });

  test("25. reject valid transition", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const created = await createCe(baseCePayload(development, orderKeyA));
    await request(app).post(`/api/commercial-events/${created.body.id}/submit`).send({});
    const res = await request(app)
      .post(`/api/commercial-events/${created.body.id}/reject`)
      .send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "rejected");
  });

  test("26. close valid transition", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const created = await createCe(baseCePayload(development, orderKeyA));
    await workflowToApproved(created.body.id);
    const res = await request(app)
      .post(`/api/commercial-events/${created.body.id}/close`)
      .send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "closed");
  });

  test("27. invalid transition rejected", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const created = await createCe(baseCePayload(development, orderKeyA));
    const res = await request(app)
      .post(`/api/commercial-events/${created.body.id}/approve`)
      .send({});
    assert.equal(res.status, 400);
  });

  test("28. approved event cannot be draft-edited", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const created = await createCe(baseCePayload(development, orderKeyA));
    const approved = await workflowToApproved(created.body.id);
    const res = await request(app)
      .put(`/api/commercial-events/${created.body.id}`)
      .send({ version: approved.version, description: "Nope" });
    assert.equal(res.status, 400);
  });

  test("29. recovery approval sets outstanding", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const created = await createCe(
      baseCePayload(development, orderKeyA, {
        eventType: "contraCharge",
        financialTreatment: "recoverableDeduction",
        value: -750,
      })
    );
    assert.equal(created.body.relationshipType, "recovery");
    await request(app).post(`/api/commercial-events/${created.body.id}/submit`).send({});
    const approved = await request(app)
      .post(`/api/commercial-events/${created.body.id}/approve`)
      .send({});
    assert.equal(approved.body.recoveryStatus, "outstanding");
  });

  test("30. direct recovery stored correctly", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const created = await createCe(
      baseCePayload(development, orderKeyA, {
        eventType: "contraCharge",
        financialTreatment: "recoverableDeduction",
        value: 500,
      })
    );
    assert.equal(created.body.financialTreatment, "recoverableDeduction");
    assert.equal(created.body.relationshipType, "recovery");
    assert.equal(created.body.linkedEventId, null);
    assert.ok(created.body.value < 0);
  });

  test("31-34. linked recovery creates both records atomically with correct links", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA, orderKeyB } = await setupDevWithTwoPackages(active);
    const originRes = await createCe(
      baseCePayload(development, orderKeyA, {
        potentialContraCharge: true,
        potentialContraChargeNotes: "Recover from B",
      })
    );
    await workflowToApproved(originRes.body.id);
    const linked = await request(app)
      .post(`/api/commercial-events/${originRes.body.id}/create-linked-recovery`)
      .send({ recoveryPackageId: orderKeyB });
    assert.equal(linked.status, 201);
    trackCe(linked.body.recovery.id);
    assert.equal(linked.body.origin.linkedEventId, linked.body.recovery.id);
    assert.equal(linked.body.origin.relationshipType, "origin");
    assert.equal(linked.body.recovery.linkedEventId, originRes.body.id);
    assert.equal(linked.body.recovery.relationshipType, "recovery");
    assert.equal(linked.body.recovery.packageId, orderKeyB);
    assert.equal(linked.body.origin.developmentId, development.id);
    assert.equal(linked.body.recovery.developmentId, development.id);
    assert.notEqual(linked.body.recovery.packageId, orderKeyA);
  });

  test("35. same-package recovery rejected", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const originRes = await createCe(
      baseCePayload(development, orderKeyA, { potentialContraCharge: true })
    );
    await workflowToApproved(originRes.body.id);
    const res = await request(app)
      .post(`/api/commercial-events/${originRes.body.id}/create-linked-recovery`)
      .send({ recoveryPackageId: orderKeyA });
    assert.equal(res.status, 400);
  });

  test("36. cross-development recovery rejected", async () => {
    const active = await getActiveClient();
    const setupA = await setupDevWithTwoPackages(active, "sup-cd1", "sup-cd2");
    const setupB = await setupDevWithTwoPackages(active, "sup-cd3", "sup-cd4");
    const originRes = await createCe(
      baseCePayload(setupA.development, setupA.orderKeyA, { potentialContraCharge: true })
    );
    await workflowToApproved(originRes.body.id);
    const res = await request(app)
      .post(`/api/commercial-events/${originRes.body.id}/create-linked-recovery`)
      .send({ recoveryPackageId: setupB.orderKeyA });
    assert.equal(res.status, 400);
  });

  test("37. linked recovery failure rolls back origin changes", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const originRes = await createCe(
      baseCePayload(development, orderKeyA, { potentialContraCharge: true })
    );
    await workflowToApproved(originRes.body.id);
    const first = await request(app)
      .post(`/api/commercial-events/${originRes.body.id}/create-linked-recovery`)
      .send({ recoveryPackageId: orderKeyA });
    assert.equal(first.status, 400);
    const origin = await request(app).get(`/api/commercial-events/${originRes.body.id}`);
    assert.equal(origin.body.linkedEventId, null);
    assert.notEqual(origin.body.relationshipType, "origin");
  });

  test("38. linked recovery eventNumber unique", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA, orderKeyB } = await setupDevWithTwoPackages(active);
    const originRes = await createCe(
      baseCePayload(development, orderKeyA, { potentialContraCharge: true })
    );
    await workflowToApproved(originRes.body.id);
    const linked = await request(app)
      .post(`/api/commercial-events/${originRes.body.id}/create-linked-recovery`)
      .send({ recoveryPackageId: orderKeyB });
    trackCe(linked.body.recovery.id);
    const list = await request(app).get("/api/commercial-events");
    const numbers = list.body.map((e) => e.eventNumber);
    assert.equal(new Set(numbers).size, numbers.length);
  });

  test("39-43. audit entries written transactionally", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA, orderKeyB } = await setupDevWithTwoPackages(active);
    const created = await createCe(baseCePayload(development, orderKeyA));
    assert.ok(created.body.auditHistory.some((a) => a.action === "CREATED"));

    await request(app).post(`/api/commercial-events/${created.body.id}/submit`).send({});
    let current = await request(app).get(`/api/commercial-events/${created.body.id}`);
    assert.ok(current.body.auditHistory.some((a) => a.action === "SUBMITTED"));

    await request(app).post(`/api/commercial-events/${created.body.id}/approve`).send({});
    current = await request(app).get(`/api/commercial-events/${created.body.id}`);
    assert.ok(current.body.auditHistory.some((a) => a.action === "APPROVED"));

    const origin = await createCe(
      baseCePayload(development, orderKeyA, { potentialContraCharge: true })
    );
    await workflowToApproved(origin.body.id);
    const linked = await request(app)
      .post(`/api/commercial-events/${origin.body.id}/create-linked-recovery`)
      .send({ recoveryPackageId: orderKeyB });
    trackCe(linked.body.recovery.id);
    const originAfter = await request(app).get(`/api/commercial-events/${origin.body.id}`);
    const recoveryAfter = await request(app).get(
      `/api/commercial-events/${linked.body.recovery.id}`
    );
    assert.ok(
      originAfter.body.auditHistory.some((a) => a.action === "LINKED_RECOVERY_CREATED")
    );
    assert.ok(recoveryAfter.body.auditHistory.some((a) => a.action === "LINKED_TO_ORIGIN"));
  });

  test("44-48. transitional lifecycle fields", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const created = await createCe(baseCePayload(development, orderKeyA));
    assert.equal(created.body.certificateStatus, "notIncluded");
    assert.equal(created.body.recoveredAmount, 0);

    const certRoute = await request(app).post(
      `/api/commercial-events/${created.body.id}/certificate-status`
    );
    assert.equal(certRoute.status, 404);

    const importId = `ce-lifecycle-${Date.now()}`;
    await request(app)
      .post("/api/commercial-events/import")
      .send({
        developmentId: development.id,
        events: [
          {
            id: importId,
            eventNumber: "CE-5501",
            packageId: orderKeyA,
            eventType: "variation",
            category: "design",
            responsibility: "employer",
            description: "Imported lifecycle",
            value: 100,
            financialTreatment: "contractAmendment",
            certificateStatus: "partiallyIncluded",
            recoveredAmount: 250,
            status: "approved",
          },
        ],
      });
    trackCe(importId);
    const imported = await request(app).get(`/api/commercial-events/${importId}`);
    assert.equal(imported.body.certificateStatus, "partiallyIncluded");
    assert.equal(imported.body.recoveredAmount, 250);
  });

  test("import preserves audit history idempotently", async () => {
    const active = await getActiveClient();
    const { development, orderKeyA } = await setupDevWithTwoPackages(active);
    const importId = `ce-audit-import-${Date.now()}`;
    const auditId = `ce-audit-fixed-${Date.now()}`;
    const event = {
      id: importId,
      eventNumber: "CE-4401",
      packageId: orderKeyA,
      eventType: "variation",
      category: "design",
      responsibility: "employer",
      description: "Audit import",
      value: 100,
      financialTreatment: "contractAmendment",
      auditHistory: [
        {
          id: auditId,
          action: "CREATED",
          actor: "Tester",
          priorStatus: null,
          newStatus: "draft",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ],
    };
    const first = await request(app)
      .post("/api/commercial-events/import")
      .send({ developmentId: development.id, events: [event] });
    assert.equal(first.body.imported, 1);
    trackCe(importId);
    const second = await request(app)
      .post("/api/commercial-events/import")
      .send({ developmentId: development.id, events: [event] });
    assert.equal(second.body.skipped, 1);
    const loaded = await request(app).get(`/api/commercial-events/${importId}`);
    assert.equal(loaded.body.auditHistory.length, 1);
    assert.equal(loaded.body.auditHistory[0].id, auditId);
  });
}
