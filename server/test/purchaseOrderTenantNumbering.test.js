const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../app');
const { createTestAuthAdapter } = require('../auth/authAdapters');
const { PERMISSIONS } = require('../auth/permissions');
const { pool, isDbConfigured } = require('../db');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');

const clients = [];
const suppliers = [];

function principal(req) {
  return {
    provider: 'test',
    providerUserId: 'po-numbering-user',
    userId: '00000000-0000-0000-0000-000000000001',
    clientId: req.get('X-BuildLite-Client-Id'),
    displayName: 'PO Numbering Tester',
    email: 'po-numbering@example.invalid',
    permissions: Object.values(PERMISSIONS),
    capabilityKeys: [],
  };
}

const app = createApp({ authAdapter: createTestAuthAdapter(principal) });

async function seedTenant(label) {
  const code = `PO_NUM_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const client = (await pool.query(
    'INSERT INTO clients(code,name,is_active) VALUES($1,$2,FALSE) RETURNING id,code,name',
    [code, `PO Numbering ${label}`]
  )).rows[0];
  const supplierId = `supplier-${code}`;
  const supplier = {
    id: supplierId,
    name: `${label} Supplier`,
    active: true,
    approvalStatus: 'approved',
    approvedSupplier: true,
  };
  await pool.query(
    'INSERT INTO suppliers(id,name,payload,client_id) VALUES($1,$2,$3,$4)',
    [supplierId, supplier.name, supplier, client.id]
  );
  clients.push(client.id);
  suppliers.push(supplierId);
  return { client, supplier };
}

function poBody(supplier, type = 'M') {
  return {
    type,
    supplierId: supplier.id,
    supplierSnapshot: { id: supplier.id },
    title: `${type} order`,
    items: [{ description: 'UAT item', qty: 1, rate: 10, amount: 10, costCode: '5000' }],
  };
}

function postPo(fixture, body) {
  return request(app)
    .post('/api/po')
    .set('X-BuildLite-Client-Id', fixture.client.id)
    .send(body);
}

test.before(async () => {
  if (!isDbConfigured()) return;
  await prepareIntegrationTestDatabase(pool);
});
test.after(async () => {
  if (!isDbConfigured() || !clients.length) return;
  await pool.query('DELETE FROM purchase_orders WHERE client_id=ANY($1::uuid[])', [clients]);
  await pool.query('DELETE FROM purchase_order_number_sequences WHERE client_id=ANY($1::uuid[])', [clients]);
  await pool.query('DELETE FROM suppliers WHERE client_id=ANY($1::uuid[])', [clients]);
  await pool.query('DELETE FROM clients WHERE id=ANY($1::uuid[])', [clients]);
});

test('two tenants independently allocate S0001, M0001 and P0001', async t => {
  if (!isDbConfigured()) return t.skip();
  const a = await seedTenant('A');
  const b = await seedTenant('B');
  for (const type of ['S', 'M', 'P']) {
    const [left, right] = await Promise.all([
      postPo(a, poBody(a.supplier, type)),
      postPo(b, poBody(b.supplier, type)),
    ]);
    assert.equal(left.status, 201, left.text);
    assert.equal(right.status, 201, right.text);
    assert.equal(left.body.poNumber, `${type}0001`);
    assert.equal(right.body.poNumber, `${type}0001`);
  }
});

test('concurrent same-tenant creation is sequential and client supplied numbers are rejected', async t => {
  if (!isDbConfigured()) return t.skip();
  const fixture = await seedTenant('CONCURRENT');
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => postPo(fixture, poBody(fixture.supplier, 'M')))
  );
  assert.deepEqual(responses.map(r => r.status), Array(8).fill(201));
  assert.deepEqual(
    responses.map(r => r.body.poNumber).sort(),
    Array.from({ length: 8 }, (_, index) => `M${String(index + 1).padStart(4, '0')}`)
  );
  const forged = await postPo(fixture, { ...poBody(fixture.supplier), poNumber: 'M9999' });
  assert.equal(forged.status, 400);
  assert.match(forged.body.message, /allocated by BuildLite/i);
  assert.equal(Number((await pool.query(
    'SELECT count(*) count FROM purchase_orders WHERE client_id=$1 AND po_number=$2',
    [fixture.client.id, 'M9999']
  )).rows[0].count), 0);
});

test('an existing Purchase Order type cannot change after number allocation', async t => {
  if (!isDbConfigured()) return t.skip();
  const fixture = await seedTenant('IMMUTABLE_TYPE');
  const created = await postPo(fixture, poBody(fixture.supplier, 'M'));
  assert.equal(created.status, 201, created.text);
  const changed = await request(app)
    .put(`/api/po/${created.body.poNumber}`)
    .set('X-BuildLite-Client-Id', fixture.client.id)
    .send({ type: 'S' });
  assert.equal(changed.status, 400, changed.text);
  assert.match(changed.body.message, /type cannot be changed/i);
  const stored = (await pool.query(
    `SELECT payload FROM purchase_orders WHERE client_id=$1 AND po_number=$2`,
    [fixture.client.id, created.body.poNumber]
  )).rows[0].payload;
  assert.equal(stored.type, 'M');
  assert.equal(stored.poNumber, 'M0001');
});

test('archived, rejected and deleted committed numbers are never reused while failed validation consumes none', async t => {
  if (!isDbConfigured()) return t.skip();
  const fixture = await seedTenant('NO_REUSE');
  const first = await postPo(fixture, poBody(fixture.supplier));
  assert.equal(first.status, 201, first.text);
  assert.equal(first.body.poNumber, 'M0001');
  await pool.query(
    `UPDATE purchase_orders SET payload=jsonb_set(payload,'{archived}','true')
     WHERE client_id=$1 AND po_number=$2`,
    [fixture.client.id, 'M0001']
  );
  const rejected = await postPo(fixture, poBody(fixture.supplier));
  assert.equal(rejected.status, 201, rejected.text);
  assert.equal(rejected.body.poNumber, 'M0002');
  await pool.query(
    `UPDATE purchase_orders SET payload=jsonb_set(payload,'{status}','"Rejected"')
     WHERE client_id=$1 AND po_number=$2`,
    [fixture.client.id, 'M0002']
  );
  const deletable = await postPo(fixture, poBody(fixture.supplier));
  assert.equal(deletable.status, 201, deletable.text);
  assert.equal(deletable.body.poNumber, 'M0003');
  const removed = await request(app)
    .delete('/api/po/M0003')
    .set('X-BuildLite-Client-Id', fixture.client.id);
  assert.equal(removed.status, 200, removed.text);

  const invalid = await postPo(fixture, { ...poBody(fixture.supplier), supplierId: 'missing', supplierSnapshot: { id: 'missing' } });
  assert.equal(invalid.status, 400);
  const second = await postPo(fixture, poBody(fixture.supplier));
  assert.equal(second.status, 201, second.text);
  assert.equal(second.body.poNumber, 'M0004');
  const sequence = (await pool.query(
    'SELECT next_number FROM purchase_order_number_sequences WHERE client_id=$1 AND order_type=$2',
    [fixture.client.id, 'M']
  )).rows[0];
  assert.equal(Number(sequence.next_number), 5);
});

test('a database failure after allocation rolls back both the PO and counter', async t => {
  if (!isDbConfigured()) return t.skip();
  const fixture = await seedTenant('ROLLBACK');
  await pool.query(`
    CREATE OR REPLACE FUNCTION reject_po_numbering_test_insert() RETURNS trigger AS $$
    BEGIN
      IF NEW.client_id='${fixture.client.id}'::uuid THEN
        RAISE EXCEPTION 'forced PO insert failure';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_reject_po_numbering_test_insert
      BEFORE INSERT ON purchase_orders
      FOR EACH ROW EXECUTE FUNCTION reject_po_numbering_test_insert();
  `);
  try {
    const failed = await postPo(fixture, poBody(fixture.supplier));
    assert.equal(failed.status, 500);
    assert.equal(Number((await pool.query(
      'SELECT count(*) count FROM purchase_orders WHERE client_id=$1',
      [fixture.client.id]
    )).rows[0].count), 0);
    assert.equal(Number((await pool.query(
      'SELECT count(*) count FROM purchase_order_number_sequences WHERE client_id=$1',
      [fixture.client.id]
    )).rows[0].count), 0);
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS trg_reject_po_numbering_test_insert ON purchase_orders');
    await pool.query('DROP FUNCTION IF EXISTS reject_po_numbering_test_insert()');
  }
  const created = await postPo(fixture, poBody(fixture.supplier));
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.poNumber, 'M0001');
});

test('tenant-scoped routes cannot resolve another tenant duplicate number', async t => {
  if (!isDbConfigured()) return t.skip();
  const a = await seedTenant('ISOLATION_A');
  const b = await seedTenant('ISOLATION_B');
  const [left, right] = await Promise.all([
    postPo(a, poBody(a.supplier, 'S')),
    postPo(b, poBody(b.supplier, 'S')),
  ]);
  assert.equal(left.status, 201);
  assert.equal(right.status, 201);
  const aRead = await request(app).get('/api/po/S0001').set('X-BuildLite-Client-Id', a.client.id);
  const bRead = await request(app).get('/api/po/S0001').set('X-BuildLite-Client-Id', b.client.id);
  assert.equal(aRead.body.supplierId, a.supplier.id);
  assert.equal(bRead.body.supplierId, b.supplier.id);
});
