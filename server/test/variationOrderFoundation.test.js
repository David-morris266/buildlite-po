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
let workflowCe;

async function seed(label) {
  const client = (await pool.query(
    "INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING *",
    [`VO_${label}_${randomUUID().slice(0, 8)}`, `VO Tenant ${label}`]
  )).rows[0];
  clients.push(client.id);
  await pool.query(
    "INSERT INTO cost_codes(client_id,code,is_active) VALUES($1,'5218',true),($1,'5219',true) ON CONFLICT DO NOTHING",
    [client.id]
  );
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
  for (const name of ["004_developments.sql", "005_packages.sql", "006_commercial_events.sql", "021_commercial_event_expected_liability.sql", "023_variation_orders.sql", "024_variation_order_normal_source.sql"]) {
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
  workflowCe = `ce-vo-${randomUUID()}`;
  await pool.query(
    `INSERT INTO commercial_events
     (id,client_id,development_id,package_id,order_key,event_number,event_type,category,responsibility,description,value,status,supplier_id,cost_code)
     VALUES($1,$2,$3,$4,$5,$6,'variation','commercial','commercial','Workflow scope',2750,'approved',$7,'5218')`,
    [workflowCe, a.client.id, a.development, a.pkg.id, a.pkg.order_key, `CE-${randomUUID().slice(0, 8)}`, a.pkg.supplier_id]
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

test("approved CE creates one pre-populated editable VO without rewriting its source fact", async (t) => {
  if (!isDbConfigured()) return t.skip("TEST_DATABASE_URL not configured");
  const before = (await pool.query("SELECT value,description,status,version FROM commercial_events WHERE id=$1", [workflowCe])).rows;
  let result = await repository.createDraftVariationOrderFromCommercialEvent(a.client.id, workflowCe, {}, { actor: "QS" });
  assert.equal(result.ok, true, result.message);
  let vo = result.variationOrder;
  assert.equal(vo.displayReference, `${a.po}/${vo.variationOrderNumber}`);
  assert.equal(vo.description, "Workflow scope");
  assert.equal(vo.lines[0].costCode, "5218");
  assert.equal(vo.lines[0].netValue, 2750);
  result = await repository.createDraftVariationOrderFromCommercialEvent(a.client.id, workflowCe);
  assert.equal(result.status, 409);
  assert.equal(result.existingVariationOrder.id, vo.id);

  result = await repository.updateDraftVariationOrder(a.client.id, vo.id, {
    version: vo.version,
    reference: vo.reference,
    description: "Reviewed formal scope",
    lines: [{ costCode: "5218", description: "Reviewed line", netValue: 2500 }],
  }, { actor: "QS" });
  assert.equal(result.ok, true, result.message);
  vo = result.variationOrder;
  assert.equal(vo.totalNetValue, 2500);
  assert.deepEqual((await pool.query("SELECT value,description,status,version FROM commercial_events WHERE id=$1", [workflowCe])).rows, before);

  vo = (await repository.transitionVariationOrder(a.client.id, vo.id, "submit", { version: vo.version }, { actor: "QS" })).variationOrder;
  result = await repository.approveAndIssueVariationOrder(a.client.id, vo.id, { version: vo.version, comment: "Approved formal instruction" }, { actor: "CD" });
  assert.equal(result.ok, true, result.message);
  vo = result.variationOrder;
  assert.equal(vo.status, "issued");
  assert.equal(vo.approvedBy, "CD");
  assert.equal(vo.issuedBy, "CD");
  assert.deepEqual(vo.audit.slice(-2).map((entry) => entry.action), ["approve", "issue"]);
  assert.equal((await repository.updateDraftVariationOrder(a.client.id, vo.id, { version: vo.version, description: "No", lines: vo.lines })).status, 409);
});

test("ineligible CE creation and atomic approve-and-issue fail closed", async (t) => {
  if (!isDbConfigured()) return t.skip("TEST_DATABASE_URL not configured");
  const ineligible = `ce-vo-${randomUUID()}`;
  await pool.query(
    `INSERT INTO commercial_events
     (id,client_id,development_id,package_id,order_key,event_number,event_type,category,responsibility,description,value,status,supplier_id,cost_code)
     VALUES($1,$2,$3,$4,$5,$6,'budgetTransfer','budget','commercial','No VO',100,'approved',$7,'5218')`,
    [ineligible, a.client.id, a.development, a.pkg.id, a.pkg.order_key, `CE-${randomUUID().slice(0, 8)}`, a.pkg.supplier_id]
  );
  assert.equal((await repository.createDraftVariationOrderFromCommercialEvent(a.client.id, ineligible)).status, 409);

  const ce = `ce-vo-${randomUUID()}`;
  await pool.query(
    `INSERT INTO commercial_events
     (id,client_id,development_id,package_id,order_key,event_number,event_type,category,responsibility,description,value,status,supplier_id,cost_code)
     VALUES($1,$2,$3,$4,$5,$6,'credit','commercial','commercial','Atomic issue',-100,'approved',$7,'5218')`,
    [ce, a.client.id, a.development, a.pkg.id, a.pkg.order_key, `CE-${randomUUID().slice(0, 8)}`, a.pkg.supplier_id]
  );
  let vo = (await repository.createDraftVariationOrderFromCommercialEvent(a.client.id, ce)).variationOrder;
  vo = (await repository.transitionVariationOrder(a.client.id, vo.id, "submit", { version: vo.version })).variationOrder;
  await pool.query(`CREATE OR REPLACE FUNCTION bl_vo_fail_issue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='issue' THEN RAISE EXCEPTION 'forced issue failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER bl_vo_fail_issue_trigger BEFORE INSERT ON variation_order_audit FOR EACH ROW EXECUTE FUNCTION bl_vo_fail_issue()`);
  try {
    const failed = await repository.approveAndIssueVariationOrder(a.client.id, vo.id, { version: vo.version, comment: "Issue" });
    assert.equal(failed.ok, false);
    const unchanged = await repository.getVariationOrder(a.client.id, vo.id);
    assert.equal(unchanged.status, "submitted");
    assert.equal(unchanged.approvedAt, null);
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS bl_vo_fail_issue_trigger ON variation_order_audit");
    await pool.query("DROP FUNCTION IF EXISTS bl_vo_fail_issue()");
  }
});
