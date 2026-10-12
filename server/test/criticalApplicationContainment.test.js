const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const createApp = require('../app');
const { createTestAuthAdapter } = require('../auth/authAdapters');
const { PERMISSIONS } = require('../auth/permissions');
const { pool, isDbConfigured } = require('../db');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');

const clients = [];
const poNumbers = [];
const supplierIds = [];

function principal(clientId, permissions, displayName = 'Authenticated Operator') {
  return {
    userId: randomUUID(),
    providerUserId: `containment-${randomUUID()}`,
    displayName,
    email: 'containment@example.invalid',
    clientId,
    membershipId: randomUUID(),
    roleKey: 'qs',
    roleName: 'QS',
    permissions,
    memberships: [],
  };
}

function appFor(clientId, permissions, displayName) {
  return createApp({ authAdapter: createTestAuthAdapter(principal(clientId, permissions, displayName)) });
}

async function makeClient(label) {
  const result = await pool.query(
    `INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING id`,
    [`CONTAIN_${randomUUID().slice(0, 8)}`, label]
  );
  clients.push(result.rows[0].id);
  return result.rows[0].id;
}

function poPayload(poNumber, supplier = null, overrides = {}) {
  return {
    poNumber,
    type: 'M',
    supplierId: supplier?.id || '',
    supplierSnapshot: supplier || { name: 'Containment Supplier' },
    title: 'Containment test order',
    costRef: { costCode: '1100' },
    items: [{ description: 'Consultancy', qty: 1, rate: 1000, amount: 1000, costCode: '1100' }],
    ...overrides,
  };
}

async function createApprovedSupplier(app, name) {
  const created = await request(app).post('/api/po/suppliers').send({ name });
  assert.equal(created.status, 201);
  supplierIds.push(created.body.id);
  const approved = await request(app).post(`/api/po/suppliers/${created.body.id}/approve`).send();
  assert.equal(approved.status, 200);
  return approved.body;
}

test.before(async () => {
  if (!isDbConfigured()) return;
  await prepareIntegrationTestDatabase(pool);
});

test.after(async () => {
  if (!isDbConfigured()) return;
  if (poNumbers.length) {
    await pool.query('DELETE FROM package_purchase_orders WHERE po_number=ANY($1::text[])', [poNumbers]);
    await pool.query('DELETE FROM purchase_order_terms_overrides WHERE po_number=ANY($1::text[])', [poNumbers]);
    await pool.query('DELETE FROM purchase_order_terms_bindings WHERE po_number=ANY($1::text[])', [poNumbers]);
    await pool.query('DELETE FROM purchase_orders WHERE po_number=ANY($1::text[])', [poNumbers]);
  }
  if (supplierIds.length) await pool.query('DELETE FROM suppliers WHERE id=ANY($1::text[])', [supplierIds]);
  if (clients.length) await pool.query('DELETE FROM clients WHERE id=ANY($1::uuid[])', [clients]);
});

test('PO and supplier mutations deny principals without the required authority', async t => {
  if (!isDbConfigured()) return t.skip('guarded buildlite_test is not configured');
  const clientId = await makeClient('Containment permission tenant');
  const app = appFor(clientId, []);
  assert.equal((await request(app).post('/api/po').send(poPayload(`M-DENIED-${Date.now()}`))).status, 403);
  assert.equal((await request(app).post('/api/po/suppliers').send({ name: 'Denied Supplier' })).status, 403);
});

test('supplier identity and approval evidence are server-owned and tenant isolated', async t => {
  if (!isDbConfigured()) return t.skip('guarded buildlite_test is not configured');
  const tenantA = await makeClient('Containment supplier A');
  const tenantB = await makeClient('Containment supplier B');
  const permissions = [PERMISSIONS.PO_CREATE, PERMISSIONS.PO_EDIT, PERMISSIONS.PO_APPROVE];
  const forgedId = `sup-forged-${Date.now()}`;
  const body = {
    id: forgedId,
    name: 'Shared Named Supplier',
    approvedSupplier: true,
    approvalStatus: 'approved',
    approvalHistory: [{ action: 'APPROVED', by: 'Forged Browser Actor' }],
    createdBy: 'Forged Browser Actor',
  };
  const a = await request(appFor(tenantA, permissions, 'Tenant A Operator')).post('/api/po/suppliers').send(body);
  const b = await request(appFor(tenantB, permissions, 'Tenant B Operator')).post('/api/po/suppliers').send(body);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  supplierIds.push(a.body.id, b.body.id);
  assert.notEqual(a.body.id, forgedId);
  assert.notEqual(b.body.id, forgedId);
  assert.notEqual(a.body.id, b.body.id);
  assert.equal(a.body.approvalStatus, 'pending');
  assert.equal(a.body.approvedSupplier, false);
  assert.deepEqual(a.body.approvalHistory.map(entry => entry.action), ['CREATED_PENDING']);
  assert.equal(a.body.approvalHistory[0].by, 'Tenant A Operator');
  const approved = await request(appFor(tenantA, permissions, 'Authenticated Approver'))
    .post(`/api/po/suppliers/${a.body.id}/approve`)
    .send({ by: 'Forged Approver', approverName: 'Forged Approver' });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.approvalHistory.at(-1).by, 'Authenticated Approver');
  assert.equal(
    (await request(appFor(tenantB, permissions)).put(`/api/po/suppliers/${a.body.id}`).send({ name: 'Taken Over' })).status,
    404
  );

  const adminOnly = appFor(tenantB, [PERMISSIONS.TENANT_CONFIGURE], 'Tenant Administrator');
  const adminApproved = await request(adminOnly).post(`/api/po/suppliers/${b.body.id}/approve`).send();
  assert.equal(adminApproved.status, 200);
  assert.equal(adminApproved.body.approvalStatus, 'approved');
  assert.equal(adminApproved.body.approvalHistory.at(-1).by, 'Tenant Administrator');
});

test('approved supplier identity changes require reapproval while contact changes do not', async t => {
  if (!isDbConfigured()) return t.skip('guarded buildlite_test is not configured');
  const clientId = await makeClient('Containment supplier amendment tenant');
  const permissions = [PERMISSIONS.PO_CREATE, PERMISSIONS.PO_EDIT, PERMISSIONS.PO_SUBMIT, PERMISSIONS.PO_APPROVE];
  const app = appFor(clientId, permissions, 'Supplier Governance Operator');
  const supplier = await createApprovedSupplier(app, 'Stable Supplier Ltd');

  const contactOnly = await request(app).put(`/api/po/suppliers/${supplier.id}`).send({
    contactName: 'New Contact',
    contactEmail: 'new.contact@example.invalid',
  });
  assert.equal(contactOnly.status, 200);
  assert.equal(contactOnly.body.approvalStatus, 'approved');

  const historicNumber = `M-HISTORIC-SNAPSHOT-${Date.now()}`;
  poNumbers.push(historicNumber);
  assert.equal((await request(app).post('/api/po').send(poPayload(historicNumber, contactOnly.body))).status, 201);
  assert.equal((await request(app).post(`/api/po/${historicNumber}/request-approval`).send()).status, 200);
  assert.equal((await request(app).post(`/api/po/${historicNumber}/approve`).send({ status: 'Approved' })).status, 200);

  const changed = await request(app).put(`/api/po/suppliers/${supplier.id}`).send({
    name: 'Renamed Supplier Ltd',
    vatNumber: 'GB 999 888 777',
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.approvalStatus, 'pending');
  assert.equal(changed.body.approvedSupplier, false);
  const evidence = changed.body.approvalHistory.at(-1);
  assert.equal(evidence.action, 'IDENTITY_CHANGED_REAPPROVAL_REQUIRED');
  assert.equal(evidence.by, 'Supplier Governance Operator');
  assert.match(evidence.note, /name/);
  assert.match(evidence.note, /vatNumber/);
  const historic = (await pool.query(
    'SELECT payload FROM purchase_orders WHERE client_id=$1 AND po_number=$2',
    [clientId, historicNumber]
  )).rows[0].payload;
  assert.equal(historic.supplierSnapshot.name, 'Stable Supplier Ltd');
  assert.notEqual(historic.supplierSnapshot.vatNumber, 'GB 999 888 777');

  const number = `M-REAPPROVAL-${Date.now()}`;
  poNumbers.push(number);
  assert.equal((await request(app).post('/api/po').send(poPayload(number, changed.body))).status, 201);
  assert.equal((await request(app).post(`/api/po/${number}/request-approval`).send()).status, 400);
});

test('inactive and unknown supplier approval states fail closed', async t => {
  if (!isDbConfigured()) return t.skip('guarded buildlite_test is not configured');
  const clientId = await makeClient('Containment supplier state tenant');
  const permissions = [PERMISSIONS.PO_CREATE, PERMISSIONS.PO_SUBMIT, PERMISSIONS.PO_APPROVE];
  const app = appFor(clientId, permissions, 'Supplier State Operator');
  const supplier = await createApprovedSupplier(app, 'Stateful Supplier');
  const inactive = await request(appFor(clientId, [...permissions, PERMISSIONS.PO_EDIT], 'Supplier State Operator'))
    .put(`/api/po/suppliers/${supplier.id}`).send({ active: false });
  assert.equal(inactive.status, 200);
  const inactiveNumber = `M-INACTIVE-${Date.now()}`;
  poNumbers.push(inactiveNumber);
  assert.equal((await request(app).post('/api/po').send(poPayload(inactiveNumber, inactive.body))).status, 201);
  assert.equal((await request(app).post(`/api/po/${inactiveNumber}/request-approval`).send()).status, 400);

  const unknownId = `sup-unknown-${randomUUID()}`;
  supplierIds.push(unknownId);
  await pool.query(
    'INSERT INTO suppliers(id,name,payload,client_id) VALUES($1,$2,$3,$4)',
    [unknownId, 'Unknown State Supplier', { id: unknownId, name: 'Unknown State Supplier', approvalStatus: 'mystery', approvedSupplier: true }, clientId]
  );
  const unknownNumber = `M-UNKNOWN-${Date.now()}`;
  poNumbers.push(unknownNumber);
  assert.equal((await request(app).post('/api/po').send(poPayload(unknownNumber, { id: unknownId }))).status, 201);
  assert.equal((await request(app).post(`/api/po/${unknownNumber}/request-approval`).send()).status, 400);
});

test('PO approval decisions require an Issued and Pending lifecycle state', async t => {
  if (!isDbConfigured()) return t.skip('guarded buildlite_test is not configured');
  const clientId = await makeClient('Containment lifecycle transition tenant');
  const permissions = [PERMISSIONS.PO_CREATE, PERMISSIONS.PO_EDIT, PERMISSIONS.PO_SUBMIT, PERMISSIONS.PO_APPROVE];
  const app = appFor(clientId, permissions, 'Lifecycle Operator');
  const supplier = await createApprovedSupplier(app, 'Lifecycle Supplier');
  const number = `M-LIFECYCLE-${Date.now()}`;
  poNumbers.push(number);
  assert.equal((await request(app).post('/api/po').send(poPayload(number, supplier))).status, 201);
  assert.equal((await request(app).post(`/api/po/${number}/approve`).send({ status: 'Approved' })).status, 409);
  assert.equal((await request(app).post(`/api/po/${number}/approve`).send({ status: 'Rejected' })).status, 409);
  assert.equal((await request(app).post(`/api/po/${number}/request-approval`).send()).status, 200);
  assert.equal((await request(app).post(`/api/po/${number}/approve`).send({ status: 'Rejected' })).status, 200);
  assert.equal((await request(app).post(`/api/po/${number}/approve`).send({ status: 'Approved' })).status, 409);
  assert.equal((await request(app).put(`/api/po/${number}`).send({ title: 'Amended after rejection' })).status, 200);
  assert.equal((await request(app).post(`/api/po/${number}/request-approval`).send()).status, 200);
  assert.equal((await request(app).post(`/api/po/${number}/approve`).send({ status: 'Approved' })).status, 200);

  const archivedNumber = `M-ARCHIVED-${Date.now()}`;
  poNumbers.push(archivedNumber);
  const archived = poPayload(archivedNumber, supplier, {
    status: 'Draft', approval: { status: 'Draft', history: [] }, archived: true,
  });
  await pool.query('INSERT INTO purchase_orders(po_number,payload,client_id) VALUES($1,$2,$3)', [archivedNumber, archived, clientId]);
  assert.equal((await request(app).post(`/api/po/${archivedNumber}/request-approval`).send()).status, 409);
  assert.equal((await request(app).post(`/api/po/${archivedNumber}/approve`).send({ status: 'Approved' })).status, 409);
});

test('async PO database failures reach sanitised application error middleware', async t => {
  if (!isDbConfigured()) return t.skip('guarded buildlite_test is not configured');
  const clientId = await makeClient('Containment async failure tenant');
  const errors = [];
  const app = createApp({
    authAdapter: createTestAuthAdapter(principal(clientId, [PERMISSIONS.PO_CREATE], 'Async Test Operator')),
    errorLogger: (...args) => errors.push(args),
  });
  const originalQuery = pool.query;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  pool.query = function injectedFailure(text, params, callback) {
    if (String(text).includes('SELECT id, name, payload FROM suppliers')) {
      return Promise.reject(new Error('injected database detail must not leak'));
    }
    return originalQuery.call(pool, text, params, callback);
  };
  try {
    const response = await request(app).get('/api/po/suppliers');
    assert.equal(response.status, 500);
    assert.equal(response.body.message, 'An unexpected server error occurred.');
    assert.ok(response.body.referenceId);
    assert.doesNotMatch(JSON.stringify(response.body), /injected database detail/i);
    assert.equal(errors.length, 1);
  } finally {
    pool.query = originalQuery;
    if (originalNodeEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
  assert.equal((await request(app).get('/api/po/suppliers')).status, 200);
});

test('legacy suppliers without modern approval fields remain usable but tenant-owned', async t => {
  if (!isDbConfigured()) return t.skip('guarded buildlite_test is not configured');
  const clientId = await makeClient('Containment legacy supplier tenant');
  const supplierId = `sup-legacy-${randomUUID()}`;
  supplierIds.push(supplierId);
  await pool.query(
    `INSERT INTO suppliers(id,name,payload,client_id) VALUES($1,$2,$3,$4)`,
    [supplierId, 'Legacy Approved Supplier', { name: 'Legacy Approved Supplier' }, clientId]
  );
  const app = appFor(clientId, [PERMISSIONS.PO_CREATE, PERMISSIONS.PO_SUBMIT], 'Legacy PO Operator');
  const number = `M-LEGACY-SUP-${Date.now()}`;
  poNumbers.push(number);
  const created = await request(app).post('/api/po').send(poPayload(number, {
    id: supplierId,
    name: 'Forged Legacy Name',
  }));
  assert.equal(created.status, 201);
  assert.equal(created.body.supplierId, supplierId);
  assert.equal(created.body.supplierSnapshot.name, 'Legacy Approved Supplier');
  const submitted = await request(app).post(`/api/po/${number}/request-approval`).send();
  assert.equal(submitted.status, 200);
});

test('legacy supplier defaults do not fabricate identity changes', async t => {
  if (!isDbConfigured()) return t.skip('guarded buildlite_test is not configured');
  const clientId = await makeClient('Containment legacy defaults tenant');
  const supplierId = `sup-legacy-defaults-${randomUUID()}`;
  supplierIds.push(supplierId);
  await pool.query(
    `INSERT INTO suppliers(id,name,payload,client_id) VALUES($1,$2,$3,$4)`,
    [supplierId, 'Legacy Defaults Supplier', { name: 'Legacy Defaults Supplier' }, clientId]
  );
  const app = appFor(clientId, [PERMISSIONS.PO_EDIT, PERMISSIONS.PO_APPROVE], 'Legacy Supplier Editor');

  const contactOnly = await request(app).put(`/api/po/suppliers/${supplierId}`).send({
    contactName: 'Accounts Team',
    contactEmail: 'accounts@example.invalid',
  });
  assert.equal(contactOnly.status, 200);
  assert.equal(contactOnly.body.approvalStatus, 'approved');
  assert.equal(contactOnly.body.approvedSupplier, true);
  assert.equal(
    contactOnly.body.approvalHistory.some(entry => entry.action === 'IDENTITY_CHANGED_REAPPROVAL_REQUIRED'),
    false
  );

  const identityChange = await request(app).put(`/api/po/suppliers/${supplierId}`).send({
    vatNumber: 'GB123456789',
  });
  assert.equal(identityChange.status, 200);
  assert.equal(identityChange.body.approvalStatus, 'pending');
  assert.equal(identityChange.body.approvedSupplier, false);
  const evidence = identityChange.body.approvalHistory.filter(
    entry => entry.action === 'IDENTITY_CHANGED_REAPPROVAL_REQUIRED'
  );
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].by, 'Legacy Supplier Editor');
  assert.match(evidence[0].note, /vatNumber/);
  assert.doesNotMatch(evidence[0].note, /termsDays|supplierType|defaultVat/);
});

test('global PO-number collisions fail closed without transferring tenant ownership', async t => {
  if (!isDbConfigured()) return t.skip('guarded buildlite_test is not configured');
  const tenantA = await makeClient('Containment PO A');
  const tenantB = await makeClient('Containment PO B');
  const permissions = [PERMISSIONS.PO_CREATE, PERMISSIONS.PO_EDIT];
  const number = `M-COLLIDE-${Date.now()}`;
  poNumbers.push(number);
  const appA = appFor(tenantA, [...permissions, PERMISSIONS.PO_APPROVE], 'Tenant A Creator');
  const appB = appFor(tenantB, [...permissions, PERMISSIONS.PO_APPROVE], 'Tenant B Creator');
  const supplierA = await createApprovedSupplier(appA, 'Collision Supplier A');
  const supplierB = await createApprovedSupplier(appB, 'Collision Supplier B');
  const first = await request(appA)
    .post('/api/po')
    .send(poPayload(number, supplierA, {
      status: 'Approved',
      approval: { status: 'Approved', history: [{ action: 'APPROVED', by: 'Forged' }] },
      createdBy: 'Forged',
    }));
  assert.equal(first.status, 201);
  assert.equal(first.body.status, 'Draft');
  assert.equal(first.body.approval.status, 'Draft');
  assert.deepEqual(first.body.approval.history.map(entry => entry.action), ['CREATED']);
  assert.equal(first.body.approval.history[0].by, 'Tenant A Creator');

  const collision = await request(appB).post('/api/po').send(poPayload(number, supplierB));
  assert.equal(collision.status, 409);
  const stored = (await pool.query('SELECT client_id,payload FROM purchase_orders WHERE po_number=$1', [number])).rows[0];
  assert.equal(stored.client_id, tenantA);
  assert.equal(stored.payload.status, 'Draft');
  assert.equal((await request(appFor(tenantB, permissions)).put(`/api/po/${number}`).send({ title: 'Taken Over' })).status, 404);
});

test('PO supplier snapshots are authoritative through create, edit, submit and approval', async t => {
  if (!isDbConfigured()) return t.skip('guarded buildlite_test is not configured');
  const clientId = await makeClient('Containment snapshot tenant');
  const permissions = [PERMISSIONS.PO_CREATE, PERMISSIONS.PO_EDIT, PERMISSIONS.PO_SUBMIT, PERMISSIONS.PO_APPROVE];
  const app = appFor(clientId, permissions, 'Snapshot Operator');
  const supplier = await createApprovedSupplier(app, 'Authoritative Architect');
  const other = await createApprovedSupplier(app, 'Other Supplier');
  const number = `M-SNAPSHOT-${Date.now()}`;
  poNumbers.push(number);

  const mismatch = await request(app).post('/api/po').send(poPayload(`${number}-BAD`, supplier, {
    supplierSnapshot: { id: other.id, name: 'Forged Mismatch' },
  }));
  assert.equal(mismatch.status, 400);

  const created = await request(app).post('/api/po').send(poPayload(number, supplier, {
    supplierSnapshot: { id: supplier.id, name: 'Forged Browser Name', approvedSupplier: true },
  }));
  assert.equal(created.status, 201);
  assert.equal(created.body.supplierSnapshot.name, 'Authoritative Architect');

  const edited = await request(app).put(`/api/po/${number}`).send({
    supplierId: supplier.id,
    supplierSnapshot: { id: supplier.id, name: 'Forged Edit Name' },
    title: 'Edited safely',
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.supplierSnapshot.name, 'Authoritative Architect');

  await pool.query(`UPDATE purchase_orders SET payload=jsonb_set(payload,'{supplierSnapshot,name}','"Forged Stored Name"') WHERE po_number=$1`, [number]);
  const submitted = await request(app).post(`/api/po/${number}/request-approval`).send();
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.supplierSnapshot.name, 'Authoritative Architect');

  await pool.query(`UPDATE purchase_orders SET payload=jsonb_set(payload,'{supplierSnapshot,name}','"Forged Before Approval"') WHERE po_number=$1`, [number]);
  const approved = await request(app).post(`/api/po/${number}/approve`).send({ status: 'Approved' });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.supplierId, supplier.id);
  assert.equal(approved.body.supplierSnapshot.name, 'Authoritative Architect');
});

test('approved POs cannot be edited, rejected or deleted', async t => {
  if (!isDbConfigured()) return t.skip('guarded buildlite_test is not configured');
  const clientId = await makeClient('Containment lifecycle tenant');
  const permissions = [
    PERMISSIONS.PO_CREATE,
    PERMISSIONS.PO_EDIT,
    PERMISSIONS.PO_SUBMIT,
    PERMISSIONS.PO_APPROVE,
    PERMISSIONS.PO_DELETE_DRAFT,
  ];
  const app = appFor(clientId, permissions, 'Governed PO Operator');
  const supplier = await createApprovedSupplier(app, 'Governed Supplier');
  const number = `M-LOCKED-${Date.now()}`;
  poNumbers.push(number);
  assert.equal((await request(app).post('/api/po').send(poPayload(number, supplier))).status, 201);
  const submitted = await request(app).post(`/api/po/${number}/request-approval`).send({ by: 'Forged Submitter' });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.approval.history.at(-1).by, 'Governed PO Operator');
  assert.equal((await request(app).post(`/api/po/${number}/approve`).send({ status: 'Approved' })).status, 200);
  assert.equal((await request(app).put(`/api/po/${number}`).send({ title: 'Mutated' })).status, 409);
  assert.equal((await request(app).post(`/api/po/${number}/approve`).send({ status: 'Rejected' })).status, 409);
  assert.equal((await request(app).delete(`/api/po/${number}`)).status, 409);
  assert.equal((await request(app).post(`/api/po/${number}/approve`).send({ status: 'Approved' })).status, 200);
});

test('a Draft PO with governed downstream evidence cannot be deleted', async t => {
  if (!isDbConfigured()) return t.skip('guarded buildlite_test is not configured');
  const clientId = await makeClient('Containment dependency tenant');
  const app = appFor(clientId, [PERMISSIONS.PO_CREATE, PERMISSIONS.PO_APPROVE, PERMISSIONS.PO_DELETE_DRAFT]);
  const supplier = await createApprovedSupplier(app, 'Dependency Supplier');
  const number = `S-DEPENDENCY-${Date.now()}`;
  poNumbers.push(number);
  assert.equal((await request(app).post('/api/po').send(poPayload(number, supplier, { type: 'S' }))).status, 201);
  await pool.query(
    `INSERT INTO purchase_order_terms_bindings(client_id,po_number,resolved_source,binding_event,bound_by)
     VALUES($1,$2,'unconfigured','po_approval','Containment Test')`,
    [clientId, number]
  );
  const deletion = await request(app).delete(`/api/po/${number}`);
  assert.equal(deletion.status, 409);
  assert.match(deletion.body.message, /dependencies/i);
  assert.equal(Number((await pool.query('SELECT count(*) count FROM purchase_orders WHERE po_number=$1', [number])).rows[0].count), 1);
});

test('legacy Approved evidence blocks edit, submit, reject and delete even when top-level status is stale', async t => {
  if (!isDbConfigured()) return t.skip('guarded buildlite_test is not configured');
  const clientId = await makeClient('Containment legacy authority tenant');
  const permissions = [PERMISSIONS.PO_EDIT, PERMISSIONS.PO_SUBMIT, PERMISSIONS.PO_APPROVE, PERMISSIONS.PO_DELETE_DRAFT];
  const app = appFor(clientId, permissions, 'Legacy Guard Operator');
  const number = `M-LEGACY-APPROVED-${Date.now()}`;
  poNumbers.push(number);
  const payload = poPayload(number, { id: 'legacy-supplier', name: 'Historic Supplier' }, {
    status: 'Draft',
    approval: { status: 'Approved', history: [] },
  });
  await pool.query('INSERT INTO purchase_orders(po_number,payload,client_id) VALUES($1,$2,$3)', [number, payload, clientId]);
  assert.equal((await request(app).put(`/api/po/${number}`).send({ title: 'Forbidden' })).status, 409);
  assert.equal((await request(app).post(`/api/po/${number}/request-approval`).send()).status, 409);
  assert.equal((await request(app).post(`/api/po/${number}/approve`).send({ status: 'Rejected' })).status, 409);
  assert.equal((await request(app).delete(`/api/po/${number}`)).status, 409);
});

test('concurrent lifecycle mutations cannot overwrite or delete an approved PO', async t => {
  if (!isDbConfigured()) return t.skip('guarded buildlite_test is not configured');
  const clientId = await makeClient('Containment concurrency tenant');
  const permissions = [PERMISSIONS.PO_CREATE, PERMISSIONS.PO_EDIT, PERMISSIONS.PO_SUBMIT, PERMISSIONS.PO_APPROVE, PERMISSIONS.PO_DELETE_DRAFT];
  const app = appFor(clientId, permissions, 'Concurrency Operator');
  const supplier = await createApprovedSupplier(app, 'Concurrency Supplier');

  const number = `M-RACE-${Date.now()}`;
  poNumbers.push(number);
  assert.equal((await request(app).post('/api/po').send(poPayload(number, supplier, { title: 'Original' }))).status, 201);
  assert.equal((await request(app).post(`/api/po/${number}/request-approval`).send()).status, 200);
  const [approval, edit, rejection] = await Promise.all([
    request(app).post(`/api/po/${number}/approve`).send({ status: 'Approved' }),
    request(app).put(`/api/po/${number}`).send({ title: 'Concurrent edit' }),
    request(app).post(`/api/po/${number}/approve`).send({ status: 'Rejected' }),
  ]);
  assert.equal(approval.status, 200);
  assert.ok([200, 409].includes(edit.status));
  assert.ok([200, 409].includes(rejection.status));
  const stored = (await pool.query('SELECT payload FROM purchase_orders WHERE po_number=$1', [number])).rows[0].payload;
  assert.equal(stored.status, 'Approved');
  assert.equal(stored.approval.status, 'Approved');
  assert.equal(stored.approval.history.filter(entry => entry.action === 'APPROVED').length, 1);
  const approvedIndex = stored.approval.history.findIndex(entry => entry.action === 'APPROVED');
  assert.equal(stored.approval.history.slice(approvedIndex + 1).some(entry => ['UPDATED', 'REJECTED'].includes(entry.action)), false);

  const deleteNumber = `M-RACE-DELETE-${Date.now()}`;
  poNumbers.push(deleteNumber);
  assert.equal((await request(app).post('/api/po').send(poPayload(deleteNumber, supplier))).status, 201);
  assert.equal((await request(app).post(`/api/po/${deleteNumber}/request-approval`).send()).status, 200);
  const [approveDeleteRace, deletion] = await Promise.all([
    request(app).post(`/api/po/${deleteNumber}/approve`).send({ status: 'Approved' }),
    request(app).delete(`/api/po/${deleteNumber}`),
  ]);
  assert.ok([[200, 409], [404, 200]].some(([approveStatus, deleteStatus]) => approveDeleteRace.status === approveStatus && deletion.status === deleteStatus));
  const remaining = (await pool.query('SELECT payload FROM purchase_orders WHERE po_number=$1', [deleteNumber])).rows[0]?.payload;
  if (remaining) assert.equal(remaining.status, 'Approved');
});

test('Commercial Event import requires approval authority and is unavailable in production', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalImportFlag = process.env.BUILDLITE_ENABLE_CE_IMPORT;
  const originalServerTest = process.env.BUILDLITE_SERVER_TEST;
  process.env.BUILDLITE_SERVER_TEST = '1';
  delete process.env.BUILDLITE_ENABLE_CE_IMPORT;
  try {
  const denied = appFor(randomUUID(), [], 'Unprivileged Importer');
  const deniedResponse = await request(denied).post('/api/commercial-events/import').send({
    events: [{ id: 'CE-FORGED', status: 'Approved', auditHistory: [{ by: 'Forged' }] }],
  });
  assert.equal(deniedResponse.status, 403);
  assert.match(deniedResponse.body.message, /ce\.approve/);

  const disabled = await request(appFor(randomUUID(), [PERMISSIONS.CE_APPROVE], 'Approved Importer'))
    .post('/api/commercial-events/import')
    .send({ events: [{ id: 'CE-FORGED', status: 'Approved' }] });
  assert.equal(disabled.status, 404);

  process.env.NODE_ENV = 'production';
  process.env.BUILDLITE_ENABLE_CE_IMPORT = '1';
    const unavailable = await request(appFor(randomUUID(), [PERMISSIONS.CE_APPROVE], 'Approved Importer'))
      .post('/api/commercial-events/import')
      .send({ events: [{ id: 'CE-FORGED', status: 'Approved' }] });
    assert.equal(unavailable.status, 404);
  } finally {
    if (originalNodeEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalImportFlag == null) delete process.env.BUILDLITE_ENABLE_CE_IMPORT;
    else process.env.BUILDLITE_ENABLE_CE_IMPORT = originalImportFlag;
    if (originalServerTest == null) delete process.env.BUILDLITE_SERVER_TEST;
    else process.env.BUILDLITE_SERVER_TEST = originalServerTest;
  }
});
