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
const users = [];
let a;
let b;
let ceA;
let ceB;
let workflowCe;
let migrationFixture;

async function seedMixedLegacyMigrationFixture() {
  const client = (await pool.query(
    "INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING *",
    [`VO_MIGRATION_${randomUUID().slice(0, 8)}`, "VO migration mixed-state tenant"]
  )).rows[0];
  clients.push(client.id);
  const descriptions = { 4120: "Brickwork", 3640: "Planting", 4330: "Mastic & Sealing" };
  for (const [code, description] of Object.entries(descriptions)) {
    await pool.query(
      "INSERT INTO cost_codes(client_id,code,description,is_active) VALUES($1,$2,$3,true)",
      [client.id, code, description]
    );
  }
  const development = `dev-vo-migration-${randomUUID()}`;
  await pool.query(
    "INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,$3,$4,'live','{}')",
    [development, client.id, `JOB-MIG-${randomUUID().slice(0, 6)}`, "VO migration mixed state"]
  );
  const pkg = (await pool.query(
    "INSERT INTO packages(client_id,development_id,supplier_id,cost_code,order_key) VALUES($1,$2,'supplier-migration','4120',$3) RETURNING *",
    [client.id, development, `subcontract:${randomUUID()}`]
  )).rows[0];
  const lines = [];
  for (const [index, fixture] of [
    { code: "4120", value: 5000, status: "issued" },
    { code: "3640", value: 4500, status: "issued" },
    { code: "4330", value: 12000, status: "issued" },
    { code: "3000 — groundworks general", value: 9600, status: "draft" },
  ].entries()) {
    const issued = fixture.status === "issued";
    const vo = (await pool.query(
      `INSERT INTO variation_orders
       (client_id,development_id,package_id,order_key,source_po_number,supplier_id,variation_order_number,description,status,approved_at,issued_at)
       VALUES($1,$2,$3,$4,'S-MIG','supplier-migration',$5,$6,$7,$8,$9) RETURNING *`,
      [client.id, development, pkg.id, pkg.order_key, `VO-MIG-${index + 1}`, `Migration ${fixture.code}`,
        fixture.status, issued ? new Date("2026-01-01T00:00:00Z") : null, issued ? new Date("2026-01-02T00:00:00Z") : null]
    )).rows[0];
    const line = (await pool.query(
      `INSERT INTO variation_order_lines(client_id,variation_order_id,line_number,cost_code,description,net_value)
       VALUES($1,$2,1,$3,$4,$5) RETURNING *`,
      [client.id, vo.id, fixture.code, `Migration line ${fixture.code}`, fixture.value]
    )).rows[0];
    lines.push({ ...fixture, voId: vo.id, lineId: line.id });
  }
  return { client, lines, descriptions };
}

async function seed(label) {
  const client = (await pool.query(
    "INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING *",
    [`VO_${label}_${randomUUID().slice(0, 8)}`, `VO Tenant ${label}`]
  )).rows[0];
  clients.push(client.id);
  await pool.query("INSERT INTO cost_codes(client_id,code,is_active) VALUES($1,'5218',true),($1,'5219',true) ON CONFLICT DO NOTHING", [client.id]);
  const costCodes = (await pool.query("SELECT id,code FROM cost_codes WHERE client_id=$1 AND code IN('5218','5219')", [client.id])).rows;
  const costCodeIds = Object.fromEntries(costCodes.map((row) => [row.code, row.id]));
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
  return { client, development, pkg, po, costCodeIds };
}

function body(seed, overrides = {}) {
  return {
    developmentId: seed.development,
    packageId: seed.pkg.id,
    sourcePoNumber: seed.po,
    supplierId: seed.pkg.supplier_id,
    description: "Foundation VO",
    lines: [
      { costCodeId: seed.costCodeIds['5218'], costCode: "5218", description: "Addition", netValue: 1500 },
      { costCodeId: seed.costCodeIds['5219'], costCode: "5219", description: "Credit", netValue: -300 },
    ],
    sourceCommercialEvents: [{ commercialEventId: ceA, allocatedValue: 1200 }],
    actor: "VO Test",
    ...overrides,
  };
}

test.before(async () => {
  if (!isDbConfigured()) return;
  await prepareIntegrationTestDatabase(pool);
  for (const name of ["004_developments.sql", "005_packages.sql", "006_commercial_events.sql", "021_commercial_event_expected_liability.sql", "023_variation_orders.sql", "024_variation_order_normal_source.sql", "025_variation_order_line_ce_allocations.sql"]) {
    await pool.query(sql(name));
  }
  if (!(await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name='package_variation_account_items'")).rowCount) {
    await pool.query(sql("033_package_variation_account.sql"));
  }
  if (!(await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name='package_variation_account_authority_allocations'")).rowCount) {
    await pool.query(sql("036_variation_account_authority_allocations.sql"));
    await pool.query(sql("037_variation_account_substitution_corrections.sql"));
  }
  migrationFixture = await seedMixedLegacyMigrationFixture();
  await pool.query(sql("062_variation_order_line_cost_code_authority.sql"));
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

test("Migration 062 resolves exact historic lines while preserving an unresolved Draft review state", async (t) => {
  if (!isDbConfigured()) return t.skip("TEST_DATABASE_URL not configured");
  const rows = (await pool.query(
    `SELECT line.id,vo.status,line.cost_code_id,line.cost_code,line.cost_code_description,
            line.cost_code_source_evidence,line.net_value,code.code canonical_code
       FROM variation_order_lines line
       JOIN variation_orders vo ON vo.id=line.variation_order_id AND vo.client_id=line.client_id
       LEFT JOIN cost_codes code ON code.id=line.cost_code_id AND code.client_id=line.client_id
      WHERE line.client_id=$1 ORDER BY line.created_at,line.id`,
    [migrationFixture.client.id]
  )).rows;
  assert.equal(rows.length, 4);
  for (const fixture of migrationFixture.lines.filter((line) => line.status === "issued")) {
    const row = rows.find((candidate) => candidate.cost_code === fixture.code);
    assert.equal(row.status, "issued");
    assert.ok(row.cost_code_id);
    assert.equal(row.canonical_code, fixture.code);
    assert.equal(row.cost_code_description, migrationFixture.descriptions[fixture.code]);
    assert.equal(row.cost_code_source_evidence, fixture.code);
    assert.equal(Number(row.net_value), fixture.value);
  }
  const unresolved = rows.find((row) => row.cost_code === "3000 — groundworks general");
  assert.equal(unresolved.status, "draft");
  assert.equal(unresolved.cost_code_id, null);
  assert.equal(unresolved.cost_code_description, null);
  assert.equal(unresolved.cost_code_source_evidence, "3000 — groundworks general");
  assert.equal(Number(unresolved.net_value), 9600);

  await assert.rejects(
    pool.query(
      "UPDATE variation_order_lines SET cost_code_id=$1,cost_code_description=NULL WHERE id=$2",
      [rows.find((row) => row.cost_code === "4120").cost_code_id, unresolved.id]
    ),
    /resolved_cost_code_evidence|check constraint/i
  );
});

test.after(async () => {
  if (isDbConfigured() && clients.length) {
    for (const table of ['package_variation_account_authority_audit','package_variation_account_authority_substitutions','package_variation_account_authority_allocations','package_variation_account_items']) {
      await pool.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    }
    await pool.query("DELETE FROM package_variation_account_authority_audit WHERE client_id=ANY($1::uuid[])", [clients]);
    await pool.query("DELETE FROM package_variation_account_authority_substitutions WHERE client_id=ANY($1::uuid[])", [clients]);
    await pool.query("DELETE FROM package_variation_account_authority_allocations WHERE client_id=ANY($1::uuid[])", [clients]);
    await pool.query("DELETE FROM package_variation_account_items WHERE client_id=ANY($1::uuid[])", [clients]);
    await pool.query("DELETE FROM purchase_orders WHERE client_id=ANY($1::uuid[])", [clients]);
    await pool.query("DELETE FROM clients WHERE id=ANY($1::uuid[])", [clients]);
    if (users.length) await pool.query("DELETE FROM buildlite_users WHERE id=ANY($1::uuid[])", [users]);
    for (const table of ['package_variation_account_authority_audit','package_variation_account_authority_substitutions','package_variation_account_authority_allocations','package_variation_account_items']) {
      await pool.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    }
  }
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

test("stable Cost Code identity is tenant-active authority while legacy text remains review evidence", async (t) => {
  if (!isDbConfigured()) return t.skip("TEST_DATABASE_URL not configured");
  const legacy = await repository.createDraftVariationOrder(a.client.id, body(a, {
    description: "Legacy review",
    lines: [{ costCode: "5218 — Legacy label", costCodeSourceEvidence: "5218 — Legacy label", description: "Legacy line", netValue: 1200 }],
  }));
  assert.equal(legacy.ok, true, legacy.message);
  assert.equal(legacy.variationOrder.lines[0].costCodeId, null);
  assert.equal(legacy.variationOrder.lines[0].costCodeAuthorityState, "review_required");
  assert.equal((await repository.transitionVariationOrder(a.client.id, legacy.variationOrder.id, "submit", { version: legacy.variationOrder.version })).status, 400);

  const selected = await repository.updateDraftVariationOrder(a.client.id, legacy.variationOrder.id, {
    version: legacy.variationOrder.version,
    reference: legacy.variationOrder.reference,
    description: legacy.variationOrder.description,
    lines: [{ ...legacy.variationOrder.lines[0], costCodeId: a.costCodeIds['5218'], costCode: "stale display" }],
  });
  assert.equal(selected.ok, true, selected.message);
  assert.equal(selected.variationOrder.lines[0].costCodeId, a.costCodeIds['5218']);
  assert.equal(selected.variationOrder.lines[0].costCode, "5218");
  assert.equal(selected.variationOrder.lines[0].costCodeSourceEvidence, "5218 — Legacy label");
  assert.equal((await repository.transitionVariationOrder(a.client.id, selected.variationOrder.id, "submit", { version: selected.variationOrder.version })).ok, true);

  const foreign = await repository.createDraftVariationOrder(a.client.id, body(a, {
    description: "Foreign identity",
    lines: [{ costCodeId: b.costCodeIds['5218'], costCode: "5218", description: "Wrong tenant", netValue: 1200 }],
  }));
  assert.equal(foreign.status, 400);
  const inactive = (await pool.query("INSERT INTO cost_codes(client_id,code,is_active) VALUES($1,'INACTIVE-VO',false) RETURNING id", [a.client.id])).rows[0];
  assert.equal((await repository.createDraftVariationOrder(a.client.id, body(a, {
    description: "Inactive identity", lines: [{ costCodeId: inactive.id, costCode: "INACTIVE-VO", description: "Inactive", netValue: 1200 }],
  }))).status, 400);
  assert.equal((await repository.createDraftVariationOrder(a.client.id, body(a, {
    description: "Missing identity", lines: [{ costCodeId: randomUUID(), costCode: "MISSING", description: "Missing", netValue: 1200 }],
  }))).status, 400);
});

test('direct PO instruction is explicit, tenant scoped and follows governed issue lifecycle', async t => {
  if (!isDbConfigured()) return t.skip('TEST_DATABASE_URL not configured');
  await pool.query(`INSERT INTO purchase_orders(client_id,po_number,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`,[a.client.id,a.po,JSON.stringify({status:'Approved'})]);
  const spoofed = await repository.createDraftVariationOrder(a.client.id, body(a,{
    sourceCommercialEvents:[], instructionOrigin:'direct_po',
    directInstruction:{treatment:'independent',reason:'Spoofed'},
    termsOverride:{directInstruction:{schemaVersion:'direct_vo_v1',treatment:'independent'}},
  }));
  assert.equal(spoofed.status,400);
  assert.match(spoofed.message,/governed Direct Variation Order route/i);
  const missing = await repository.createDirectVariationOrder(a.client.id, body(a,{sourceCommercialEvents:[],directInstruction:{}}));
  assert.equal(missing.status,400);
  const crossTenantPo = await repository.createDirectVariationOrder(a.client.id, body(a,{sourcePoNumber:b.po,sourceCommercialEvents:[],directInstruction:{treatment:'independent',reason:'Invalid foreign PO test'}}));
  assert.equal(crossTenantPo.status,400);
  const overlap = await repository.listDirectVariationOrderOverlaps(a.client.id,a.pkg.id,null);
  const created = await repository.createDirectVariationOrder(a.client.id, body(a,{
    sourceCommercialEvents:[],
    directInstruction:{treatment:'independent',reason:'Separate instructed work reviewed against existing package evidence',reviewedEvidence:overlap.records.map(({type,id})=>({type,id}))},
  }));
  assert.equal(created.ok,true,created.message);
  assert.equal(created.variationOrder.termsOverride.directInstruction.schemaVersion,'direct_vo_v1');
  const edited = await repository.updateDraftVariationOrder(a.client.id,created.variationOrder.id,{
    version:created.variationOrder.version,description:'Edited direct instruction description',termsOverride:{},lines:created.variationOrder.lines,
  });
  assert.equal(edited.variationOrder.termsOverride.directInstruction.treatment,'independent');
  const lateCe = `ce-late-${randomUUID()}`;
  await pool.query(`INSERT INTO commercial_events
    (id,client_id,development_id,package_id,order_key,event_number,event_type,category,responsibility,description,value,status,supplier_id,cost_code)
    VALUES($1,$2,$3,$4,$5,$6,'variation','commercial','commercial','Late overlap evidence',250,'submitted',$7,'5218')`,
  [lateCe,a.client.id,a.development,a.pkg.id,a.pkg.order_key,`CE-${randomUUID().slice(0,8)}`,a.pkg.supplier_id]);
  const staleSubmit=await repository.transitionVariationOrder(a.client.id,created.variationOrder.id,'submit',{version:edited.variationOrder.version});
  assert.equal(staleSubmit.status,409);
  assert.match(staleSubmit.message,/overlap review is stale/i);
  const refreshedOverlap=await repository.listDirectVariationOrderOverlaps(a.client.id,a.pkg.id,null);
  const reviewed=await repository.reviewDirectVariationOrderOverlaps(a.client.id,created.variationOrder.id,{
    version:edited.variationOrder.version,reason:'Reviewed new CE before submission',
    reviewedEvidence:refreshedOverlap.records.map(({type,id})=>({type,id})),
  });
  assert.equal(reviewed.ok,true,reviewed.message);
  assert.equal(reviewed.variationOrder.audit.at(-1).action,'overlap_reviewed');
  const submitted=await repository.transitionVariationOrder(a.client.id,created.variationOrder.id,'submit',{version:reviewed.variationOrder.version});
  assert.equal(submitted.ok,true,submitted.message);
  const issueCe=`ce-issue-${randomUUID()}`;
  await pool.query(`INSERT INTO commercial_events
    (id,client_id,development_id,package_id,order_key,event_number,event_type,category,responsibility,description,value,status,supplier_id,cost_code)
    VALUES($1,$2,$3,$4,$5,$6,'variation','commercial','commercial','Overlap before issue',100,'submitted',$7,'5218')`,
  [issueCe,a.client.id,a.development,a.pkg.id,a.pkg.order_key,`CE-${randomUUID().slice(0,8)}`,a.pkg.supplier_id]);
  const staleIssue=await repository.approveAndIssueVariationOrder(a.client.id,created.variationOrder.id,{version:submitted.variationOrder.version,comment:'Must re-review first'});
  assert.equal(staleIssue.status,409);
  const issueOverlap=await repository.listDirectVariationOrderOverlaps(a.client.id,a.pkg.id,null);
  const issueReviewed=await repository.reviewDirectVariationOrderOverlaps(a.client.id,created.variationOrder.id,{
    version:submitted.variationOrder.version,reason:'Reviewed new evidence before approval and issue',
    reviewedEvidence:issueOverlap.records.map(({type,id})=>({type,id})),
  });
  assert.equal(issueReviewed.ok,true,issueReviewed.message);
  const issued=await repository.approveAndIssueVariationOrder(a.client.id,created.variationOrder.id,{version:issueReviewed.variationOrder.version,comment:'Commercially reviewed direct instruction'});
  assert.equal(issued.ok,true,issued.message);
  assert.equal(issued.variationOrder.status,'issued');
  const reversalOverlap = await repository.listDirectVariationOrderOverlaps(a.client.id,a.pkg.id,null);
  const reversal = await repository.createDirectVariationOrder(a.client.id,body(a,{
    sourceCommercialEvents:[],description:'Reverse direct instruction',reversesId:issued.variationOrder.id,
    lines:[{costCodeId:a.costCodeIds['5218'],costCode:'5218',description:'Full reversal',netValue:-1200}],
    directInstruction:{treatment:'independent',reason:'Direct instruction cancelled',reviewedEvidence:reversalOverlap.records.map(({type,id})=>({type,id}))},
  }));
  assert.equal(reversal.ok,true,reversal.message);
  const reversalSubmitted=await repository.transitionVariationOrder(a.client.id,reversal.variationOrder.id,'submit',{version:reversal.variationOrder.version});
  assert.equal(reversalSubmitted.ok,true,reversalSubmitted.message);
  const reversalIssued=await repository.approveAndIssueVariationOrder(a.client.id,reversal.variationOrder.id,{version:reversalSubmitted.variationOrder.version,comment:'Approved cancellation'});
  assert.equal(reversalIssued.ok,true,reversalIssued.message);
  const authorityFacts=await require('../services/variationOrderAuthority').listVariationOrderAuthorityFacts(pool,a.client.id,{packageIds:[a.pkg.id]});
  const authority=require('../services/variationOrderAuthority').buildContractAuthority({variationOrders:authorityFacts});
  assert.equal(authority.issuedVariationOrderValue,0);
  const immutable=await repository.updateDraftVariationOrder(a.client.id,issued.variationOrder.id,{version:issued.variationOrder.version,description:'rewrite',lines:issued.variationOrder.lines});
  assert.equal(immutable.status,409);
});

test('a linked direct VO rejects ambiguous existing CE authority instead of double counting or substituting it', async t => {
  if (!isDbConfigured()) return t.skip('TEST_DATABASE_URL not configured');
  await pool.query(`INSERT INTO purchase_orders(client_id,po_number,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`,[a.client.id,a.po,JSON.stringify({status:'Approved'})]);
  const userId = randomUUID(), membershipId = randomUUID();
  users.push(userId);
  const role = (await pool.query("SELECT id FROM roles WHERE key='commercial_manager' LIMIT 1")).rows[0];
  await pool.query(`INSERT INTO buildlite_users(id,auth_provider,provider_user_id,email_snapshot,display_name) VALUES($1,'clerk',$2,$3,'VO Reconciliation QS')`,[userId,`vo-user-${userId}`,`vo-${userId}@example.invalid`]);
  await pool.query(`INSERT INTO client_user_memberships(id,client_id,user_id,role_id,is_active) VALUES($1,$2,$3,$4,true)`,[membershipId,a.client.id,userId,role.id]);
  const auth = { userId, membershipId, providerUserId:`vo-user-${userId}`, displayName:'VO Reconciliation QS', permissions:['vo.create','vo.submit','vo.approve','vo.issue'] };
  const va = (await pool.query(`INSERT INTO package_variation_account_items
    (client_id,development_id,package_id,cost_code,variation_reference,description,current_qs_forecast,forecast_status,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name)
    VALUES($1,$2,$3,'5218','VA-DIRECT','Previously certified direct work',NULL,'pending',$4,$5,$6,$7) RETURNING *`,
  [a.client.id,a.development,a.pkg.id,userId,membershipId,auth.providerUserId,auth.displayName])).rows[0];
  await pool.query(`INSERT INTO package_variation_account_authority_allocations
    (client_id,development_id,package_id,variation_account_item_id,source_type,commercial_event_id,signed_allocated_amount,reason,source_status_snapshot,source_value_snapshot,source_reference_snapshot,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name)
    VALUES($1,$2,$3,$4,'commercial_event',$9,500,'Historic certified evidence','approved',500,'CE authority',$5,$6,$7,$8)`,
  [a.client.id,a.development,a.pkg.id,va.id,userId,membershipId,auth.providerUserId,auth.displayName,ceA]);
  const overlap = await repository.listDirectVariationOrderOverlaps(a.client.id,a.pkg.id,auth);
  const created = await repository.createDirectVariationOrder(a.client.id, body(a,{
    sourceCommercialEvents:[],description:'Formal instruction after certification',
    lines:[{costCodeId:a.costCodeIds['5218'],costCode:'5218',description:'Formal instruction',netValue:500}],
    directInstruction:{treatment:'link_variation_account',variationAccountItemId:va.id,reason:'Reconciles previously certified VA item',reviewedEvidence:overlap.records.map(({type,id})=>({type,id}))},
  }),{actor:auth.displayName,auth});
  assert.equal(created.ok,true,created.message);
  const submitted=await repository.transitionVariationOrder(a.client.id,created.variationOrder.id,'submit',{version:created.variationOrder.version},{actor:auth.displayName,auth});
  assert.equal(submitted.ok,true,submitted.message);
  const issued=await repository.approveAndIssueVariationOrder(a.client.id,created.variationOrder.id,{version:submitted.variationOrder.version,comment:'Approved direct authority'},{actor:auth.displayName,auth});
  assert.equal(issued.ok,false);
  assert.equal(issued.status,409);
  assert.match(issued.message,/cannot be silently replaced/i);
  const projection = await require('../services/variationAccountAuthorityRepository').getProjection(a.client.id,va.id,{...auth,permissions:[...auth.permissions,'variation_account.view']});
  assert.equal(projection.effectiveRecognisedAuthority,500);
  assert.equal(projection.allocations.filter(entry=>entry.sourceType==='variation_order_line').length,0);
  assert.equal(projection.substitutions.length,0);

  const linkedVa = (await pool.query(`INSERT INTO package_variation_account_items
    (client_id,development_id,package_id,cost_code,variation_reference,description,current_qs_forecast,forecast_status,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name)
    VALUES($1,$2,$3,'5218','VA-SUPERSEDE','Direct supersession evidence',NULL,'pending',$4,$5,$6,$7) RETURNING *`,
  [a.client.id,a.development,a.pkg.id,userId,membershipId,auth.providerUserId,auth.displayName])).rows[0];
  const issueLinked = async ({ value, description, supersedesId = null, reversesId = null }) => {
    const currentOverlap = await repository.listDirectVariationOrderOverlaps(a.client.id,a.pkg.id,auth);
    const draft = await repository.createDirectVariationOrder(a.client.id,body(a,{
      sourceCommercialEvents:[],description,supersedesId,reversesId,
      lines:[{costCodeId:a.costCodeIds['5218'],costCode:'5218',description,netValue:value}],
      directInstruction:{treatment:'link_variation_account',variationAccountItemId:linkedVa.id,reason:description,reviewedEvidence:currentOverlap.records.map(({type,id})=>({type,id}))},
    }),{actor:auth.displayName,auth});
    assert.equal(draft.ok,true,draft.message);
    const submittedVo=await repository.transitionVariationOrder(a.client.id,draft.variationOrder.id,'submit',{version:draft.variationOrder.version},{actor:auth.displayName,auth});
    assert.equal(submittedVo.ok,true,submittedVo.message);
    const issuedVo=await repository.approveAndIssueVariationOrder(a.client.id,draft.variationOrder.id,{version:submittedVo.variationOrder.version,comment:'Approved governed supersession'},{actor:auth.displayName,auth});
    assert.equal(issuedVo.ok,true,issuedVo.message);
    return issuedVo.variationOrder;
  };
  const original=await issueLinked({value:750,description:'Initial linked direct instruction'});
  const decrease=await issueLinked({value:500,description:'Superseding decrease',supersedesId:original.id});
  let linkedProjection=await require('../services/cvrVariationExposure').loadVariationExposureFacts(pool,a.client.id,a.development);
  assert.equal(linkedProjection.find(item=>item.variationAccountItemId===linkedVa.id).effectiveRecognisedAuthority,500);
  const increase=await issueLinked({value:1000,description:'Superseding increase',supersedesId:decrease.id});
  linkedProjection=await require('../services/cvrVariationExposure').loadVariationExposureFacts(pool,a.client.id,a.development);
  assert.equal(linkedProjection.find(item=>item.variationAccountItemId===linkedVa.id).effectiveRecognisedAuthority,1000);
  const storedAllocations=(await pool.query(`SELECT a.id,a.signed_allocated_amount,l.variation_order_id
    FROM package_variation_account_authority_allocations a JOIN variation_order_lines l ON l.client_id=a.client_id AND l.id=a.variation_order_line_id
    WHERE a.client_id=$1 AND a.variation_account_item_id=$2 ORDER BY a.created_at,a.id`,[a.client.id,linkedVa.id])).rows;
  assert.deepEqual(storedAllocations.map(row=>Number(row.signed_allocated_amount)),[750,500,1000]);
  assert.deepEqual(storedAllocations.map(row=>row.variation_order_id),[original.id,decrease.id,increase.id]);
  await issueLinked({value:-1000,description:'Full direct reversal',reversesId:increase.id});
  linkedProjection=await require('../services/cvrVariationExposure').loadVariationExposureFacts(pool,a.client.id,a.development);
  assert.equal(linkedProjection.find(item=>item.variationAccountItemId===linkedVa.id).effectiveRecognisedAuthority,0);
  assert.equal((await pool.query(`SELECT COUNT(*)::int count FROM package_variation_account_authority_allocations
    WHERE client_id=$1 AND variation_account_item_id=$2`,[a.client.id,linkedVa.id])).rows[0].count,3);
});

test('approved direct VO overlap re-review returns it to Submitted for fresh approval',async t=>{
  if(!isDbConfigured())return t.skip('TEST_DATABASE_URL not configured');
  await pool.query(`INSERT INTO purchase_orders(client_id,po_number,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`,[a.client.id,a.po,JSON.stringify({status:'Approved'})]);
  const userId=randomUUID(),membershipId=randomUUID();users.push(userId);
  const role=(await pool.query("SELECT id FROM roles WHERE key='commercial_manager' LIMIT 1")).rows[0];
  await pool.query(`INSERT INTO buildlite_users(id,auth_provider,provider_user_id,email_snapshot,display_name) VALUES($1,'clerk',$2,$3,'Overlap Reviewer')`,[userId,`overlap-${userId}`,`overlap-${userId}@example.invalid`]);
  await pool.query(`INSERT INTO client_user_memberships(id,client_id,user_id,role_id,is_active) VALUES($1,$2,$3,$4,true)`,[membershipId,a.client.id,userId,role.id]);
  const auth={userId,membershipId,providerUserId:`overlap-${userId}`,displayName:'Overlap Reviewer',permissions:['vo.create','vo.submit','vo.approve','vo.issue']};
  const initialOverlap=await repository.listDirectVariationOrderOverlaps(a.client.id,a.pkg.id,auth);
  const created=await repository.createDirectVariationOrder(a.client.id,body(a,{sourceCommercialEvents:[],description:'Approved overlap refresh',directInstruction:{treatment:'independent',reason:'Reviewed initial package evidence',reviewedEvidence:initialOverlap.records.map(({type,id})=>({type,id}))}}),{actor:auth.displayName,auth});
  assert.equal(created.ok,true,created.message);
  const submitted=await repository.transitionVariationOrder(a.client.id,created.variationOrder.id,'submit',{version:created.variationOrder.version},{actor:auth.displayName,auth});
  const approved=await repository.transitionVariationOrder(a.client.id,created.variationOrder.id,'approve',{version:submitted.variationOrder.version},{actor:'Commercial Director',auth});
  assert.equal(approved.variationOrder.status,'approved');
  const unchanged=await repository.reviewDirectVariationOrderOverlaps(a.client.id,created.variationOrder.id,{version:approved.variationOrder.version,reason:'No material change',reviewedEvidence:initialOverlap.records.map(({type,id})=>({type,id}))},{actor:auth.displayName,auth});
  assert.equal(unchanged.status,409);
  assert.match(unchanged.message,/unchanged/i);
  assert.equal((await repository.getVariationOrder(a.client.id,created.variationOrder.id)).status,'approved');
  await pool.query(`INSERT INTO package_variation_account_items
    (client_id,development_id,package_id,cost_code,variation_reference,description,current_qs_forecast,forecast_status,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name)
    VALUES($1,$2,$3,'5218',$4,'New material overlap',250,'assessed',$5,$6,$7,$8)`,
  [a.client.id,a.development,a.pkg.id,`VA-REVIEW-${randomUUID().slice(0,6)}`,userId,membershipId,auth.providerUserId,auth.displayName]);
  const staleIssue=await repository.transitionVariationOrder(a.client.id,created.variationOrder.id,'issue',{version:approved.variationOrder.version,comment:'Attempt stale issue'},{actor:'Commercial Director',auth});
  assert.equal(staleIssue.status,409);
  assert.match(staleIssue.message,/overlap review is stale/i);
  const currentOverlap=await repository.listDirectVariationOrderOverlaps(a.client.id,a.pkg.id,auth);
  const submitOnly={...auth,permissions:['vo.submit']};
  const reviewed=await repository.reviewDirectVariationOrderOverlaps(a.client.id,created.variationOrder.id,{version:approved.variationOrder.version,reason:'Reviewed new VA evidence before renewed approval',reviewedEvidence:currentOverlap.records.map(({type,id})=>({type,id}))},{actor:auth.displayName,auth:submitOnly});
  assert.equal(reviewed.ok,true,reviewed.message);
  assert.equal(reviewed.variationOrder.status,'submitted');
  assert.equal(reviewed.variationOrder.approvedAt,null);
  assert.equal(reviewed.variationOrder.approvedBy,null);
  assert.ok(reviewed.variationOrder.audit.some(entry=>entry.action==='approve'));
  assert.equal(String(reviewed.variationOrder.audit.find(entry=>entry.action==='approve').createdAt),String(approved.variationOrder.audit.find(entry=>entry.action==='approve').createdAt));
  assert.equal(reviewed.variationOrder.audit.at(-1).action,'overlap_reviewed');
  assert.equal(reviewed.variationOrder.audit.at(-1).priorStatus,'approved');
  assert.equal(reviewed.variationOrder.audit.at(-1).newStatus,'submitted');
  await assert.rejects(()=>repository.transitionVariationOrder(a.client.id,created.variationOrder.id,'issue',{version:reviewed.variationOrder.version,comment:'Bypass approval'},{actor:auth.displayName,auth:submitOnly}),/permission/i);
  const reissued=await repository.approveAndIssueVariationOrder(a.client.id,created.variationOrder.id,{version:reviewed.variationOrder.version,comment:'Fresh CD approval after overlap review'},{actor:'Commercial Director',auth});
  assert.equal(reissued.ok,true,reissued.message);
  assert.equal(reissued.variationOrder.status,'issued');
  assert.equal(reissued.variationOrder.audit.filter(entry=>entry.action==='approve').length,2);
});

test("lifecycle, optimistic version, rejection and issued immutability", async (t) => {
  if (!isDbConfigured()) return t.skip("TEST_DATABASE_URL not configured");
  const lifecycleBody = { description: "Lifecycle", lines: [{ costCodeId: a.costCodeIds['5218'], costCode: "5218", description: "Addition", netValue: 1200 }] };
  let vo = (await repository.createDraftVariationOrder(a.client.id, body(a, lifecycleBody))).variationOrder;
  assert.equal((await repository.transitionVariationOrder(a.client.id, vo.id, "approve", { version: 1 })).status, 409);
  vo = (await repository.transitionVariationOrder(a.client.id, vo.id, "submit", { version: 1, actor: "QS" })).variationOrder;
  assert.equal((await repository.transitionVariationOrder(a.client.id, vo.id, "approve", { version: 1 })).status, 409);
  vo = (await repository.transitionVariationOrder(a.client.id, vo.id, "approve", { version: 2, actor: "CM" })).variationOrder;
  assert.ok(vo.approvedAt);
  assert.equal((await repository.transitionVariationOrder(a.client.id, vo.id, "issue", { version: 3 })).status, 400);
  vo = (await repository.transitionVariationOrder(a.client.id, vo.id, "issue", { version: 3, actor: "CD", comment: "Issued" })).variationOrder;
  assert.equal(vo.status, "issued");
  assert.match((await repository.transitionVariationOrder(a.client.id, vo.id, "submit", { version: 4 })).message, /immutable/i);

  const correction = await repository.createDraftVariationOrder(a.client.id, body(a, { ...lifecycleBody, description: "Correction", supersedesId: vo.id }));
  assert.equal(correction.ok, true, correction.message);
  assert.equal((await repository.createDraftVariationOrder(a.client.id, body(a, { reversesId: correction.variationOrder.id }))).status, 409);

  let rejected = (await repository.createDraftVariationOrder(a.client.id, body(a, { ...lifecycleBody, description: "Reject" }))).variationOrder;
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
    lines: [{ costCodeId: a.costCodeIds['5218'], costCode: "5218", description: "Reviewed line", netValue: 2500 }],
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
  vo = (await repository.updateDraftVariationOrder(a.client.id, vo.id, {
    version: vo.version, reference: vo.reference, description: vo.description,
    lines: vo.lines.map((line) => ({ ...line, costCodeId: a.costCodeIds['5218'] })),
  })).variationOrder;
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

async function createApprovedCe(seedData, value, label) {
  const id = `ce-vo-${randomUUID()}`;
  await pool.query(
    `INSERT INTO commercial_events
     (id,client_id,development_id,package_id,order_key,event_number,event_type,category,responsibility,description,value,status,supplier_id,cost_code)
     VALUES($1,$2,$3,$4,$5,$6,$7,'commercial','commercial',$8,$9,'approved',$10,'5218')`,
    [id, seedData.client.id, seedData.development, seedData.pkg.id, seedData.pkg.order_key,
      `CE-${randomUUID().slice(0, 8)}`, value < 0 ? "credit" : "variation", label, value, seedData.pkg.supplier_id]
  );
  return id;
}

async function lockHistoricCeLine(seedData, commercialEventId, amount) {
  const next = Number((await pool.query(
    "SELECT COALESCE(MAX(certificate_number),0)+1 AS next FROM package_payment_certificates WHERE client_id=$1 AND package_id=$2",
    [seedData.client.id, seedData.pkg.id]
  )).rows[0].next);
  await pool.query(
    `INSERT INTO package_payment_certificates
     (client_id,package_id,development_id,order_key,certificate_number,status,payload,
      gross_value,net_value,matrix_gross,commercial_event_gross,recovery_signed,retention,vat,retention_rate,vat_rate)
     VALUES($1,$2,$3,$4,$5,'locked',$6,$7,$7,0,$7,0,0,0,0.05,0.2)`,
    [seedData.client.id, seedData.pkg.id, seedData.development, seedData.pkg.order_key, next,
      JSON.stringify({ progress: {}, commercialLines: [{ id: `historic-${randomUUID()}`, commercialEventId, lineType: "valueInclusion", amountThisCertificate: amount }] }), amount]
  );
}

async function lockHistoricVoLine(seedData, variationOrderId, variationOrderLineId, amount) {
  const next = Number((await pool.query(
    "SELECT COALESCE(MAX(certificate_number),0)+1 AS next FROM package_payment_certificates WHERE client_id=$1 AND package_id=$2",
    [seedData.client.id, seedData.pkg.id]
  )).rows[0].next);
  await pool.query(
    `INSERT INTO package_payment_certificates
     (client_id,package_id,development_id,order_key,certificate_number,status,payload,
      gross_value,net_value,matrix_gross,commercial_event_gross,recovery_signed,retention,vat,retention_rate,vat_rate)
     VALUES($1,$2,$3,$4,$5,'locked',$6,$7,$7,0,$7,0,0,0,0.05,0.2)`,
    [seedData.client.id, seedData.pkg.id, seedData.development, seedData.pkg.order_key, next,
      JSON.stringify({ progress: {}, commercialLines: [{ id: `historic-vo-${randomUUID()}`, lineType: "valueInclusion", sourceType: "variationOrder", variationOrderId, variationOrderLineId, amountThisCertificate: amount }] }), amount]
  );
}

async function saveAllocations(seedData, vo, allocations) {
  return repository.updateDraftVariationOrder(seedData.client.id, vo.id, {
    version: vo.version,
    reference: vo.reference,
    description: vo.description,
    lines: vo.lines,
    sourceLineAllocations: allocations,
  }, { actor: "Allocation QS" });
}

test("single-line allocation and historic certification map automatically, including legacy issued compatibility", async (t) => {
  if (!isDbConfigured()) return t.skip("TEST_DATABASE_URL not configured");
  const s = await seed("AUTO");
  const ce = await createApprovedCe(s, 5000, "Single line historic");
  await lockHistoricCeLine(s, ce, 2000);
  let vo = (await repository.createDraftVariationOrder(s.client.id, body(s, {
    description: "Single line VO",
    lines: [{ costCodeId: s.costCodeIds['5218'], costCode: "5218", description: "Formal line", netValue: 4500 }],
    sourceCommercialEvents: [{ commercialEventId: ce, allocatedValue: 5000 }],
  }))).variationOrder;
  vo = (await repository.transitionVariationOrder(s.client.id, vo.id, "submit", { version: vo.version })).variationOrder;
  vo = (await repository.approveAndIssueVariationOrder(s.client.id, vo.id, { version: vo.version, comment: "Issue" })).variationOrder;
  assert.equal(vo.sourceLineAllocations[0].allocationMethod, "single_line_auto");
  assert.equal(vo.sourceLineAllocations[0].allocatedValue, 4500);
  assert.equal(vo.sourceLineAllocations[0].historicCertifiedValue, 2000);
  assert.equal(vo.lines[0].remainingCertifiableValue, 2500);
  let readiness = await repository.listCertificateReadyVariationOrderLines(s.client.id, s.pkg.id);
  assert.equal(readiness.find((line) => line.variationOrderLineId === vo.lines[0].id).remainingCertifiableValue, 2500);
  await lockHistoricVoLine(s, vo.id, vo.lines[0].id, 1000);
  readiness = await repository.listCertificateReadyVariationOrderLines(s.client.id, s.pkg.id);
  assert.equal(readiness.find((line) => line.variationOrderLineId === vo.lines[0].id).subsequentVoCertifiedValue, 1000);
  assert.equal(readiness.find((line) => line.variationOrderLineId === vo.lines[0].id).remainingCertifiableValue, 1500);
  await pool.query("DELETE FROM variation_order_line_commercial_event_allocations WHERE variation_order_id=$1", [vo.id]);
  const legacy = await repository.getVariationOrder(s.client.id, vo.id);
  assert.equal(legacy.sourceLineAllocations[0].allocationMethod, "single_line_auto");
  assert.equal(legacy.lines[0].remainingCertifiableValue, 1500);
});

test("multi-line authority is explicit; zero historic certification is automatic zero only", async (t) => {
  if (!isDbConfigured()) return t.skip("TEST_DATABASE_URL not configured");
  const s = await seed("MULTI_ZERO");
  const ce = await createApprovedCe(s, 2000, "Split authority");
  let vo = (await repository.createDraftVariationOrder(s.client.id, body(s, {
    description: "Split VO", lines: [
      { costCodeId: s.costCodeIds['5218'], costCode: "5218", description: "Line one", netValue: 1500 },
      { costCodeId: s.costCodeIds['5219'], costCode: "5219", description: "Line two", netValue: 500 },
    ], sourceCommercialEvents: [{ commercialEventId: ce, allocatedValue: 2000 }],
  }))).variationOrder;
  assert.equal((await repository.transitionVariationOrder(s.client.id, vo.id, "submit", { version: vo.version })).status, 409);
  let saved = await saveAllocations(s, vo, vo.lines.map((line) => ({
    variationOrderLineId: line.id, commercialEventId: ce,
    allocatedValue: line.netValue, historicCertifiedValue: 0,
  })));
  assert.equal(saved.ok, true, saved.message);
  vo = (await repository.transitionVariationOrder(s.client.id, vo.id, "submit", { version: saved.variationOrder.version })).variationOrder;
  vo = (await repository.approveAndIssueVariationOrder(s.client.id, vo.id, { version: vo.version, comment: "Issue" })).variationOrder;
  assert.deepEqual(vo.lines.map((line) => line.remainingCertifiableValue), [1500, 500]);
  assert.ok(vo.sourceLineAllocations.every((item) => item.historicCertifiedValue === 0));
});

test("multi-line partial historic certification requires explicit signed line allocation and derives remaining authority", async (t) => {
  if (!isDbConfigured()) return t.skip("TEST_DATABASE_URL not configured");
  const s = await seed("MULTI_HIST");
  const ce = await createApprovedCe(s, 2000, "Certified split authority");
  await lockHistoricCeLine(s, ce, 1000);
  let vo = (await repository.createDraftVariationOrder(s.client.id, body(s, {
    description: "Certified split VO", lines: [
      { costCodeId: s.costCodeIds['5218'], costCode: "5218", description: "First", netValue: 1200 },
      { costCodeId: s.costCodeIds['5219'], costCode: "5219", description: "Second", netValue: 800 },
    ], sourceCommercialEvents: [{ commercialEventId: ce, allocatedValue: 2000 }],
  }))).variationOrder;
  let saved = await saveAllocations(s, vo, [
    { variationOrderLineId: vo.lines[0].id, commercialEventId: ce, allocatedValue: 1200, historicCertifiedValue: 600 },
    { variationOrderLineId: vo.lines[1].id, commercialEventId: ce, allocatedValue: 800, historicCertifiedValue: 0 },
  ]);
  assert.equal((await repository.transitionVariationOrder(s.client.id, vo.id, "submit", { version: saved.variationOrder.version })).status, 409);
  vo = saved.variationOrder;
  saved = await saveAllocations(s, vo, [
    { variationOrderLineId: vo.lines[0].id, commercialEventId: ce, allocatedValue: 1200, historicCertifiedValue: 600 },
    { variationOrderLineId: vo.lines[1].id, commercialEventId: ce, allocatedValue: 800, historicCertifiedValue: 400 },
  ]);
  vo = (await repository.transitionVariationOrder(s.client.id, vo.id, "submit", { version: saved.variationOrder.version })).variationOrder;
  vo = (await repository.approveAndIssueVariationOrder(s.client.id, vo.id, { version: vo.version, comment: "Issue" })).variationOrder;
  assert.deepEqual(vo.lines.map((line) => line.remainingCertifiableValue), [600, 400]);
});

test("multiple sources allocate explicitly without inference; sign, over-allocation and isolation fail closed", async (t) => {
  if (!isDbConfigured()) return t.skip("TEST_DATABASE_URL not configured");
  const s = await seed("MANY");
  const positive = await createApprovedCe(s, 1500, "Positive source");
  const credit = await createApprovedCe(s, -500, "Credit source");
  let vo = (await repository.createDraftVariationOrder(s.client.id, body(s, {
    description: "Many-to-many VO", lines: [
      { costCodeId: s.costCodeIds['5218'], costCode: "5218", description: "Net addition", netValue: 1200 },
      { costCodeId: s.costCodeIds['5219'], costCode: "5219", description: "Net credit", netValue: -200 },
    ], sourceCommercialEvents: [{ commercialEventId: positive }, { commercialEventId: credit }],
  }))).variationOrder;
  let saved = await saveAllocations(s, vo, [
    { variationOrderLineId: vo.lines[0].id, commercialEventId: positive, allocatedValue: 1500, historicCertifiedValue: 0 },
    { variationOrderLineId: vo.lines[0].id, commercialEventId: credit, allocatedValue: -300, historicCertifiedValue: 0 },
    { variationOrderLineId: vo.lines[1].id, commercialEventId: credit, allocatedValue: -200, historicCertifiedValue: 0 },
  ]);
  assert.equal(saved.ok, true, saved.message);
  vo = (await repository.transitionVariationOrder(s.client.id, vo.id, "submit", { version: saved.variationOrder.version })).variationOrder;
  assert.equal(vo.status, "submitted");

  const invalidVo = (await repository.createDraftVariationOrder(s.client.id, body(s, {
    description: "Invalid allocation", lines: [{ costCodeId: s.costCodeIds['5218'], costCode: "5218", description: "Line", netValue: 1600 }],
    sourceCommercialEvents: [{ commercialEventId: positive }],
  }))).variationOrder;
  const invalid = await saveAllocations(s, invalidVo, [{ variationOrderLineId: invalidVo.lines[0].id, commercialEventId: positive, allocatedValue: 1600, historicCertifiedValue: 0 }]);
  assert.equal((await repository.transitionVariationOrder(s.client.id, invalidVo.id, "submit", { version: invalid.variationOrder.version })).status, 409);
});

test("multi-line historically over-certified authority issues with explicit capped line allocation and a source-level exception", async (t) => {
  if (!isDbConfigured()) return t.skip("TEST_DATABASE_URL not configured");
  const s = await seed("OVER_CERT");
  const ce = await createApprovedCe(s, 1000, "Historic exception");
  await lockHistoricCeLine(s, ce, 1200);
  let vo = (await repository.createDraftVariationOrder(s.client.id, body(s, {
    description: "Over-certified VO", lines: [
      { costCodeId: s.costCodeIds['5218'], costCode: "5218", description: "First authority", netValue: 600 },
      { costCodeId: s.costCodeIds['5219'], costCode: "5219", description: "Second authority", netValue: 400 },
    ], sourceCommercialEvents: [{ commercialEventId: ce, allocatedValue: 1000 }],
  }))).variationOrder;
  const saved = await saveAllocations(s, vo, [
    { variationOrderLineId: vo.lines[0].id, commercialEventId: ce, allocatedValue: 600, historicCertifiedValue: 600 },
    { variationOrderLineId: vo.lines[1].id, commercialEventId: ce, allocatedValue: 400, historicCertifiedValue: 400 },
  ]);
  vo = (await repository.transitionVariationOrder(s.client.id, vo.id, "submit", { version: saved.variationOrder.version })).variationOrder;
  vo = (await repository.approveAndIssueVariationOrder(s.client.id, vo.id, { version: vo.version, comment: "Issue with historic exception" })).variationOrder;
  assert.deepEqual(vo.lines.map((line) => line.remainingCertifiableValue), [0, 0]);
  assert.equal(vo.sourceCertificationExceptions[0].overCertifiedAmount, 200);
  assert.equal(vo.certificationReadiness.overCertifiedAmount, 200);
  assert.equal(vo.certificationReadiness.certifiable, false);
});
