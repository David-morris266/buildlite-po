const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pool, isDbConfigured } = require('../db');
const { assertActiveTestDatabase } = require('../utils/testDatabaseGuard');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '071_tenant_purchase_order_numbering.sql'),
  'utf8'
);

const A = '10000000-0000-0000-0000-000000000001';
const B = '10000000-0000-0000-0000-000000000002';

async function sandbox({ purchasePrimaryKey = true, termsForeignKeys = true } = {}) {
  const db = await pool.connect();
  const schema = `po071_${randomUUID().replaceAll('-', '')}`;
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET search_path TO ${schema}, public`);
  await db.query(`
    CREATE TABLE clients(id UUID PRIMARY KEY);
    INSERT INTO clients VALUES('${A}'),('${B}');
    CREATE TABLE purchase_orders(
      po_number TEXT ${purchasePrimaryKey ? 'PRIMARY KEY' : 'NOT NULL'},
      payload JSONB NOT NULL,
      client_id UUID REFERENCES clients(id)
    );
    CREATE UNIQUE INDEX uq_purchase_orders_client_po_number
      ON purchase_orders(client_id,po_number) WHERE client_id IS NOT NULL;
    CREATE TABLE purchase_order_terms_overrides(
      client_id UUID NOT NULL REFERENCES clients(id),
      po_number TEXT NOT NULL,
      PRIMARY KEY(client_id,po_number)
      ${termsForeignKeys ? `, CONSTRAINT purchase_order_terms_overrides_po_number_fkey
        FOREIGN KEY(po_number) REFERENCES purchase_orders(po_number) ON DELETE CASCADE` : ''}
    );
    CREATE TABLE purchase_order_terms_bindings(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID NOT NULL REFERENCES clients(id),
      po_number TEXT NOT NULL,
      UNIQUE(client_id,po_number)
      ${termsForeignKeys ? `, CONSTRAINT purchase_order_terms_bindings_po_number_fkey
        FOREIGN KEY(po_number) REFERENCES purchase_orders(po_number) ON DELETE CASCADE` : ''}
    );
  `);
  return {
    db,
    schema,
    async close() {
      await db.query('SET search_path TO public');
      await db.query(`DROP SCHEMA ${schema} CASCADE`);
      db.release();
    },
  };
}

async function expectBlocked(fixture, pattern) {
  await assert.rejects(
    fixture.db.query(`BEGIN; ${migration} COMMIT;`),
    pattern
  );
  await fixture.db.query('ROLLBACK');
  const primary = (await fixture.db.query(
    `SELECT pg_get_constraintdef(oid) definition FROM pg_constraint
     WHERE conrelid='purchase_orders'::regclass AND conname='purchase_orders_pkey'`
  )).rows[0]?.definition;
  assert.equal(primary, 'PRIMARY KEY (po_number)');
  const sequence = await fixture.db.query(
    `SELECT count(*)::int count FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=current_schema() AND c.relname='purchase_order_number_sequences'`
  );
  assert.equal(sequence.rows[0].count, 0);
}

test.before(async () => {
  if (isDbConfigured()) await assertActiveTestDatabase(pool);
});
test('migration 071 preserves records, converts terms FKs and permits duplicate displayed numbers across tenants', async t => {
  if (!isDbConfigured()) return t.skip();
  const fixture = await sandbox();
  try {
    await fixture.db.query(
      `INSERT INTO purchase_orders VALUES('S0007',$1,$2)`,
      [{ poNumber: 'S0007', status: 'Approved' }, A]
    );
    await fixture.db.query(
      `INSERT INTO purchase_order_terms_overrides(client_id,po_number) VALUES($1,'S0007')`,
      [A]
    );
    await fixture.db.query(
      `INSERT INTO purchase_order_terms_bindings(client_id,po_number) VALUES($1,'S0007')`,
      [A]
    );
    await fixture.db.query(migration);
    const primary = (await fixture.db.query(
      `SELECT pg_get_constraintdef(oid) definition FROM pg_constraint
       WHERE conrelid='purchase_orders'::regclass AND conname='purchase_orders_pkey'`
    )).rows[0].definition;
    assert.equal(primary, 'PRIMARY KEY (client_id, po_number)');
    await fixture.db.query(
      `INSERT INTO purchase_orders(client_id,po_number,payload)
       VALUES($1,'S0007',$2)`,
      [B, { poNumber: 'S0007', status: 'Draft' }]
    );
    assert.equal(Number((await fixture.db.query(
      "SELECT count(*) count FROM purchase_orders WHERE po_number='S0007'"
    )).rows[0].count), 2);
    const sequence = (await fixture.db.query(
      'SELECT next_number FROM purchase_order_number_sequences WHERE client_id=$1 AND order_type=$2',
      [A, 'S']
    )).rows[0];
    assert.equal(Number(sequence.next_number), 8);
    await fixture.db.query(
      "INSERT INTO purchase_orders(client_id,po_number,payload) VALUES($1,'S0008','{}')",
      [A]
    );
    await assert.rejects(
      fixture.db.query(
        "INSERT INTO purchase_order_terms_overrides(client_id,po_number) VALUES($1,'S0008')",
        [B]
      ),
      /foreign key/i
    );
  } finally {
    await fixture.close();
  }
});

test('migration 071 preserves an existing higher tenant/type counter during backfill', async t => {
  if (!isDbConfigured()) return t.skip();
  const fixture = await sandbox();
  try {
    await fixture.db.query(
      `CREATE TABLE purchase_order_number_sequences (
        client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        order_type TEXT NOT NULL CHECK (order_type IN ('S','M','P')),
        next_number BIGINT NOT NULL CHECK (next_number > 0),
        PRIMARY KEY (client_id, order_type)
      )`
    );
    await fixture.db.query(
      `INSERT INTO purchase_order_number_sequences(client_id,order_type,next_number)
       VALUES($1,'S',42)`,
      [A]
    );
    await fixture.db.query(
      `INSERT INTO purchase_orders VALUES('S0007',$1,$2)`,
      [{ poNumber: 'S0007', status: 'Approved' }, A]
    );
    await fixture.db.query(migration);
    const row = (await fixture.db.query(
      `SELECT next_number FROM purchase_order_number_sequences
       WHERE client_id=$1 AND order_type='S'`,
      [A]
    )).rows[0];
    assert.equal(Number(row.next_number), 42);
  } finally {
    await fixture.close();
  }
});

test('migration 071 fails atomically for null tenant PO evidence', async t => {
  if (!isDbConfigured()) return t.skip();
  const fixture = await sandbox();
  try {
    await fixture.db.query("INSERT INTO purchase_orders VALUES('M0001','{}',NULL)");
    await expectBlocked(fixture, /null client_id/i);
  } finally { await fixture.close(); }
});

test('migration 071 fails atomically for duplicate tenant numbers', async t => {
  if (!isDbConfigured()) return t.skip();
  const fixture = await sandbox({ purchasePrimaryKey: false, termsForeignKeys: false });
  try {
    await fixture.db.query('DROP INDEX uq_purchase_orders_client_po_number');
    await fixture.db.query(
      "INSERT INTO purchase_orders VALUES('P0001','{}',$1),('P0001','{}',$1)",
      [A]
    );
    await assert.rejects(fixture.db.query(`BEGIN; ${migration} COMMIT;`), /duplicate tenant/i);
    await fixture.db.query('ROLLBACK');
    assert.equal(Number((await fixture.db.query('SELECT count(*) count FROM purchase_orders')).rows[0].count), 2);
  } finally { await fixture.close(); }
});

test('migration 071 fails atomically for cross-tenant terms evidence', async t => {
  if (!isDbConfigured()) return t.skip();
  const fixture = await sandbox();
  try {
    await fixture.db.query("INSERT INTO purchase_orders VALUES('S0001','{}',$1)", [A]);
    await fixture.db.query(
      "INSERT INTO purchase_order_terms_overrides(client_id,po_number) VALUES($1,'S0001')",
      [B]
    );
    await expectBlocked(fixture, /orphan or cross-tenant.*overrides/i);
  } finally { await fixture.close(); }
});

test('migration 071 fails atomically for cross-tenant terms binding evidence', async t => {
  if (!isDbConfigured()) return t.skip();
  const fixture = await sandbox();
  try {
    await fixture.db.query("INSERT INTO purchase_orders VALUES('S0002','{}',$1)", [A]);
    await fixture.db.query(
      "INSERT INTO purchase_order_terms_bindings(client_id,po_number) VALUES($1,'S0002')",
      [B]
    );
    await expectBlocked(fixture, /orphan or cross-tenant.*bindings/i);
  } finally { await fixture.close(); }
});

test('migration 071 fails atomically for unexpected Purchase Order foreign keys', async t => {
  if (!isDbConfigured()) return t.skip();
  const fixture = await sandbox();
  try {
    await fixture.db.query(`
      CREATE TABLE unexpected_po_reference(
        po_number TEXT REFERENCES purchase_orders(po_number)
      )
    `);
    await expectBlocked(fixture, /unexpected purchase_orders foreign keys/i);
  } finally { await fixture.close(); }
});
