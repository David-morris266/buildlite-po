const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { pool, isDbConfigured } = require("../db");
const { prepareIntegrationTestDatabase } = require("./integrationTestSetup");
const repository = require("../services/variationOrderRepository");

const sql = (name) => fs.readFileSync(path.join(__dirname, "..", "migrations", name), "utf8");
const clients = [];
let a;
let b;
let ceA;
let ceB;

async function seed(label) {
  const client = (await pool.query(
    "INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING *",
    [`VO_${label}_${randomUUID().slice(0, 8)}`, `VO Tenant ${label}`]
  )).rows[0];
  clients.push(client.id);
  const development = `dev-vo-${label}-${randomUUID()}`;
  await pool.query(
    "INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,$3,$4,'live','{}')",
    [development, client.id, `JOB-${label}-${randomUUID().slice(0, 6)}`, `VO Development ${label}`]
  );
  const pkg = (await pool.query(
    "INSERT INTO packages(client_id,development_id,supplier_id,cost_code,order_key) VALUES($1,$2,$3,'5218',$4) RETURNING *",
    [client.id, development, `supplier-${label}`, `subcontract:${randomUUID()}`]
  )).rows[0];
  const po = `S-${label}-${randomUUID().slice(0, 8)}`;
  await pool.query("INSERT INTO package_purchase_orders(package_id,client_id,po_number) VALUES($1,$2,$3)", [pkg.id, client.id, po]);
  return { client, development, pkg, po };
}

function body(seed, overrides = {}) {
  return {
    developmentId: seed.development,
    packageId: seed.pkg.id,
    sourcePoNumber: seed.po,
    supplierId: seed.pkg.supplier_id,
    description: "Foundation VO",
    lines: [
      { costCode: "5218", description: "Addition", netValue: 1500 },
      { costCode: "5219", description: "Credit", netValue: -300 },
    ],
    sourceCommercialEvents: [{ commercialEventId: ceA, allocatedValue: 1200 }],
    actor: "VO Test",
    ...overrides,
  };
}

test.before(async () => {
  if (!isDbConfigured()) return;
  await prepareIntegrationTestDatabase(pool);
  for (const name of ["004_developments.sql", "005_packages.sql", "006_commercial_events.sql", "021_commercial_event_expected_liability.sql", "023_variation_orders.sql"]) {
    await pool.query(sql(name));
  }
  a = await seed("A");
  b = await seed("B");
  ceA = `ce-vo-${randomUUID()}`;
  await pool.query(
    `INSERT INTO commercial_events
     (id,client_id,development_id,package_id,order_key,event_number,event_type,category,responsibility,description,value,status,supplier_id,cost_code)
     VALUES($1,$2,$3,$4,$5,$6,'variation','commercial','commercial','Approved source',1200,'approved',$7,'5218')`,
    [ceA, a.client.id, a.development, a.pkg.id, a.pkg.order_key, `CE-${randomUUID().slice(0, 8)}`, a.pkg.supplier_id]
  );
  ceB = `ce-vo-${randomUUID()}`;
  await pool.query(
    `INSERT INTO commercial_events
     (id,client_id,development_id,package_id,order_key,event_number,event_type,category,responsibility,description,value,status,supplier_id,cost_code)
     VALUES($1,$2,$3,$4,$5,$6,'variation','commercial','commercial','Approved source B',1200,'approved',$7,'5218')`,
    [ceB, b.client.id, b.development, b.pkg.id, b.pkg.order_key, `CE-${randomUUID().slice(0, 8)}`, b.pkg.supplier_id]
  );
});

test.after(async () => {
  if (isDbConfigured() && clients.length) await pool.query("DELETE FROM clients WHERE id=ANY($1::uuid[])", [clients]);
});

test("Draft, signed lines, total, provenance, tenant isolation and package-scoped numbering", async (t) => {
  if (!isDbConfigured()) return t.skip("TEST_DATABASE_URL not configured");
  const one = await repository.createDraftVariationOrder(a.client.id, body(a));
  assert.equal(one.ok, true, one.message);
  assert.equal(one.variationOrder.variationOrderNumber, "VO-0001");
  assert.equal(one.variationOrder.totalNetValue, 1200);
  assert.deepEqual(one.variationOrder.lines.map((line) => line.netValue), [1500, -300]);
  assert.equal(one.variationOrder.sourceCommercialEvents[0].id, ceA);
  const two = await repository.createDraftVariationOrder(a.client.id, body(a, { description: "Second" }));
  assert.equal(two.variationOrder.variationOrderNumber, "VO-0002");
  const tenantB = await repository.createDraftVariationOrder(b.client.id, body(b, { sourceCommercialEvents: [{ commercialEventId: ceB }] }));
  assert.equal(tenantB.variationOrder.variationOrderNumber, "VO-0001");
  assert.equal(await repository.getVariationOrder(b.client.id, one.variationOrder.id), null);
  assert.equal((await repository.listVariationOrders(a.client.id, { packageId: a.pkg.id })).length >= 2, true);
});

test("cross-tenant/package/development/CE relationships fail closed", async (t) => {
  if (!isDbConfigured()) return t.skip("TEST_DATABASE_URL not configured");
  assert.equal((await repository.createDraftVariationOrder(a.client.id, body(a, { packageId: b.pkg.id }))).status, 400);
  assert.equal((await repository.createDraftVariationOrder(b.client.id, body(b, { sourceCommercialEvents: [{ commercialEventId: ceA }] }))).status, 400);
  assert.equal((await repository.createDraftVariationOrder(a.client.id, body(a, { sourcePoNumber: b.po }))).status, 400);
});

test("lifecycle, optimistic version, rejection and issued immutability", async (t) => {
  if (!isDbConfigured()) return t.skip("TEST_DATABASE_URL not configured");
  let vo = (await repository.createDraftVariationOrder(a.client.id, body(a, { description: "Lifecycle" }))).variationOrder;
  assert.equal((await repository.transitionVariationOrder(a.client.id, vo.id, "approve", { version: 1 })).status, 409);
  vo = (await repository.transitionVariationOrder(a.client.id, vo.id, "submit", { version: 1, actor: "QS" })).variationOrder;
  assert.equal((await repository.transitionVariationOrder(a.client.id, vo.id, "approve", { version: 1 })).status, 409);
  vo = (await repository.transitionVariationOrder(a.client.id, vo.id, "approve", { version: 2, actor: "CM" })).variationOrder;
  assert.ok(vo.approvedAt);
  assert.equal((await repository.transitionVariationOrder(a.client.id, vo.id, "issue", { version: 3 })).status, 400);
  vo = (await repository.transitionVariationOrder(a.client.id, vo.id, "issue", { version: 3, actor: "CD", comment: "Issued" })).variationOrder;
  assert.equal(vo.status, "issued");
  assert.match((await repository.transitionVariationOrder(a.client.id, vo.id, "submit", { version: 4 })).message, /immutable/i);

  const correction = await repository.createDraftVariationOrder(a.client.id, body(a, { description: "Correction", supersedesId: vo.id }));
  assert.equal(correction.ok, true, correction.message);
  assert.equal((await repository.createDraftVariationOrder(a.client.id, body(a, { reversesId: correction.variationOrder.id }))).status, 409);

  let rejected = (await repository.createDraftVariationOrder(a.client.id, body(a, { description: "Reject" }))).variationOrder;
  rejected = (await repository.transitionVariationOrder(a.client.id, rejected.id, "submit", { version: 1 })).variationOrder;
  assert.equal((await repository.transitionVariationOrder(a.client.id, rejected.id, "reject", { version: 2 })).status, 400);
  rejected = (await repository.transitionVariationOrder(a.client.id, rejected.id, "reject", { version: 2, comment: "Not authorised" })).variationOrder;
  assert.equal(rejected.status, "rejected");
});

test("creating a VO has zero effect on existing package and CE monetary facts", async (t) => {
  if (!isDbConfigured()) return t.skip("TEST_DATABASE_URL not configured");
  const beforePackage = (await pool.query("SELECT version,payload FROM packages WHERE id=$1", [a.pkg.id])).rows;
  const beforeCe = (await pool.query("SELECT value,status,version FROM commercial_events WHERE id=$1", [ceA])).rows;
  await repository.createDraftVariationOrder(a.client.id, body(a, { description: "No monetary effect" }));
  assert.deepEqual((await pool.query("SELECT version,payload FROM packages WHERE id=$1", [a.pkg.id])).rows, beforePackage);
  assert.deepEqual((await pool.query("SELECT value,status,version FROM commercial_events WHERE id=$1", [ceA])).rows, beforeCe);
});
