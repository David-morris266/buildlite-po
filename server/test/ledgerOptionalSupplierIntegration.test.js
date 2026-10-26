const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const createApp = require('../app');
const { createTestAuthAdapter } = require('../auth/authAdapters');
const { PERMISSIONS } = require('../auth/permissions');
const { pool } = require('../db');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');

const migration070 = path.join(__dirname, '..', 'migrations', '070_ledger_optional_supplier.sql');
const ids = { development: null, costCodes: [] };
let clientId;
let principal;
let app;

function ledgerUrl(suffix = 'batches') {
  return `/api/developments/${ids.development}/ledger/${suffix}`;
}

test.before(async () => {
  await prepareIntegrationTestDatabase(pool);
  const membership = (await pool.query(
    `SELECT m.client_id, u.id user_id, u.provider_user_id, u.display_name
     FROM client_user_memberships m
     JOIN buildlite_users u ON u.id=m.user_id
     WHERE m.id='00000000-0000-0000-0000-000000000002'`
  )).rows[0];
  clientId = membership.client_id;
  principal = {
    userId: membership.user_id,
    providerUserId: membership.provider_user_id,
    displayName: membership.display_name,
    clientId,
    membershipId: '00000000-0000-0000-0000-000000000002',
    roleKey: 'commercial_manager',
    roleName: 'Commercial Manager',
    capabilityKeys: [],
    permissions: [PERMISSIONS.COMMERCIAL_READ, PERMISSIONS.LEDGER_MANAGE],
    memberships: [],
  };
  app = createApp({ authAdapter: createTestAuthAdapter(principal) });
  ids.development = crypto.randomUUID();
  await pool.query(
    `INSERT INTO developments(id,client_id,job_number,development_name,status,payload)
     VALUES($1,$2,$3,'Ledger optional supplier test','Active','{}')`,
    [ids.development, clientId, `LED70-${Date.now()}`]
  );
  for (const code of [`L70A${Date.now()}`, `L70B${Date.now()}`]) {
    const inserted = await pool.query(
      `INSERT INTO cost_codes(client_id,code,element,is_active,allow_ledger_import)
       VALUES($1,$2,$3,TRUE,TRUE) RETURNING id,code`,
      [clientId, code, `Ledger 070 ${code}`]
    );
    ids.costCodes.push(inserted.rows[0]);
  }
});

test.after(async () => {
  if (ids.development) {
    await pool.query('DELETE FROM ledger_transactions WHERE development_id=$1', [ids.development]);
    await pool.query('DELETE FROM ledger_import_batches WHERE development_id=$1', [ids.development]);
    await pool.query('DELETE FROM developments WHERE id=$1', [ids.development]);
  }
  if (ids.costCodes.length) {
    await pool.query('DELETE FROM cost_codes WHERE id=ANY($1::uuid[])', [ids.costCodes.map((item) => item.id)]);
  }
  await pool.end();
});

test('migration 070, split invoices and supplier-less journals preserve signed Cost to Date', async () => {
  const supplierColumn = await pool.query(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_name='ledger_transactions' AND column_name='supplier'`
  );
  const supplierConstraint = await pool.query(
    `SELECT pg_get_constraintdef(oid) definition FROM pg_constraint
     WHERE conname='chk_ledger_transactions_supplier'
       AND conrelid='ledger_transactions'::regclass`
  );
  assert.equal(supplierColumn.rows[0].is_nullable, 'NO');
  assert.match(supplierConstraint.rows[0].definition, /supplier = ''::text/);

  const [gas, electricity] = ids.costCodes;
  const imported = await request(app).post(ledgerUrl()).send({
    originalFileName: 'sage-project-profitability.csv',
    sourceProfile: 'Sage Project Profitability',
    transactions: [
      { supplier: 'Fincher Utilities', invoiceNumber: 'INV-77', transactionDate: '2026-09-01', costCodeKey: gas.code, netAmount: 100, vatAmount: 20, description: 'Gas allocation', reference: 'SAGE-1', documentType: 'PI' },
      { supplier: 'Fincher Utilities', invoiceNumber: 'INV-77', transactionDate: '2026-09-01', costCodeKey: electricity.code, netAmount: 200, vatAmount: 40, description: 'Electricity allocation', reference: 'SAGE-2', documentType: 'PI' },
      { supplier: '', transactionDate: '2026-09-02', costCodeKey: electricity.code, netAmount: -25.5, vatAmount: -5.1, description: 'Accrual reversal', reference: 'JNL-42', documentType: 'Journal' },
    ],
  });
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  assert.equal(imported.body.transactions.length, 3);
  assert.deepEqual(
    imported.body.transactions.map((item) => [item.supplier, item.reference, item.netAmount]),
    [['Fincher Utilities', 'SAGE-1', 100], ['Fincher Utilities', 'SAGE-2', 200], ['', 'JNL-42', -25.5]]
  );

  const beforeReapply = await pool.query(
    'SELECT id,supplier,fingerprint FROM ledger_transactions WHERE batch_id=$1 ORDER BY created_at,id',
    [imported.body.batch.id]
  );
  await pool.query(fs.readFileSync(migration070, 'utf8'));
  const afterReapply = await pool.query(
    'SELECT id,supplier,fingerprint FROM ledger_transactions WHERE batch_id=$1 ORDER BY created_at,id',
    [imported.body.batch.id]
  );
  assert.deepEqual(afterReapply.rows, beforeReapply.rows);

  const totals = await request(app).get(ledgerUrl('totals'));
  assert.equal(totals.status, 200);
  assert.equal(totals.body.totalNet, 274.5);
  assert.equal(totals.body.actualCostByCostCode[gas.code], 100);
  assert.equal(totals.body.actualCostByCostCode[electricity.code], 174.5);
});

test('supplier-less validation, permission authority and duplicate rollback fail closed', async () => {
  const code = ids.costCodes[0].code;
  const missingReference = await request(app).post(ledgerUrl()).send({
    transactions: [{ supplier: '', transactionDate: '2026-10-01', costCodeKey: code, netAmount: 10 }],
  });
  assert.equal(missingReference.status, 400);
  assert.match(missingReference.body.message, /reference is required/i);

  const whitespaceSupplier = await request(app).post(ledgerUrl()).send({
    transactions: [{ supplier: '   ', reference: 'JNL-SPACE', transactionDate: '2026-10-01', costCodeKey: code, netAmount: 10 }],
  });
  assert.equal(whitespaceSupplier.status, 400);
  assert.match(whitespaceSupplier.body.message, /supplier must be blank/i);

  const denied = createApp({ authAdapter: createTestAuthAdapter({ ...principal, permissions: [PERMISSIONS.COMMERCIAL_READ] }) });
  assert.equal((await request(denied).post(ledgerUrl()).send({ transactions: [] })).status, 403);

  const journal = { supplier: '', reference: 'JNL-99', documentType: 'Journal', transactionDate: '2026-10-01', costCodeKey: code, netAmount: 10, description: 'Internal journal' };
  assert.equal((await request(app).post(ledgerUrl()).send({ transactions: [journal] })).status, 201);
  const beforeCount = Number((await pool.query('SELECT count(*) count FROM ledger_transactions WHERE development_id=$1', [ids.development])).rows[0].count);
  const duplicate = await request(app).post(ledgerUrl()).send({
    transactions: [journal, { ...journal, reference: 'JNL-100', netAmount: 99 }],
  });
  assert.equal(duplicate.status, 409);
  const afterCount = Number((await pool.query('SELECT count(*) count FROM ledger_transactions WHERE development_id=$1', [ids.development])).rows[0].count);
  assert.equal(afterCount, beforeCount);
});
