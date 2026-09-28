const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const createApp = require('../app');
const {pool} = require('../db');
const {prepareIntegrationTestDatabase} = require('./integrationTestSetup');

const app = createApp();
const ids = {development:null, codes:[]};
let clientId;

test.before(async () => {
  await prepareIntegrationTestDatabase(pool);
  await pool.query('ALTER TABLE ledger_cost_code_resolution_audit DISABLE TRIGGER trg_ledger_resolution_audit_immutable');
  await pool.query(`DELETE FROM ledger_cost_code_resolution_audit WHERE development_id IN (SELECT id FROM developments WHERE development_name='Ledger resolution test')`);
  await pool.query('ALTER TABLE ledger_cost_code_resolution_audit ENABLE TRIGGER trg_ledger_resolution_audit_immutable');
  await pool.query(`DELETE FROM ledger_transactions WHERE development_id IN (SELECT id FROM developments WHERE development_name='Ledger resolution test')`);
  await pool.query(`DELETE FROM ledger_import_batches WHERE development_id IN (SELECT id FROM developments WHERE development_name='Ledger resolution test')`);
  await pool.query(`DELETE FROM developments WHERE development_name='Ledger resolution test'`);
  await pool.query(`DELETE FROM cost_codes WHERE element IN ('Test 4020','Test 6210','Test 9997')`);
  clientId = (await pool.query('SELECT id FROM clients WHERE is_active=TRUE ORDER BY created_at LIMIT 1')).rows[0].id;
  ids.development = crypto.randomUUID();
  await pool.query(`INSERT INTO developments(id,client_id,job_number,development_name,status,payload)
    VALUES($1,$2,$3,'Ledger resolution test','Active','{}')`, [ids.development,clientId,`LED-${Date.now()}`]);
  for (const [code,eligible] of [['4020',true],['6210',true],['9997',false]]) {
    const row=(await pool.query(`INSERT INTO cost_codes(client_id,code,element,is_active,allow_ledger_import)
      VALUES($1,$2,$3,TRUE,$4) RETURNING id`,[clientId,code,`Test ${code}`,eligible])).rows[0];
    ids.codes.push({code,id:row.id});
  }
});

test.after(async () => {
  if (ids.development) {
    await pool.query('ALTER TABLE ledger_cost_code_resolution_audit DISABLE TRIGGER trg_ledger_resolution_audit_immutable');
    await pool.query('DELETE FROM ledger_cost_code_resolution_audit WHERE development_id=$1',[ids.development]);
    await pool.query('ALTER TABLE ledger_cost_code_resolution_audit ENABLE TRIGGER trg_ledger_resolution_audit_immutable');
    await pool.query('DELETE FROM ledger_transactions WHERE development_id=$1',[ids.development]);
    await pool.query('DELETE FROM ledger_import_batches WHERE development_id=$1',[ids.development]);
    await pool.query('DELETE FROM developments WHERE id=$1',[ids.development]);
  }
  if (ids.codes.length) await pool.query('DELETE FROM cost_codes WHERE id=ANY($1::uuid[])',[ids.codes.map((item)=>item.id)]);
  await pool.end();
});

const auth = (call) => call.set('X-BuildLite-Client-Id', clientId);
const transaction = (invoice,costCodeKey,netAmount) => ({supplier:'Willow Supplier',invoiceNumber:invoice,transactionDate:'2026-09-28',costCodeKey,netAmount,vatAmount:netAmount*0.2,grossAmount:netAmount*1.2});

test('mixed import preserves source evidence, allocates eligible rows and resolves with audit', async () => {
  const payload={originalFileName:'willow.csv',sourceProfile:'test',transactions:[
    transaction('PL-0100','4020',-750), transaction('PL-0099','9998',1250), transaction('PL-0098','9997',500),
  ]};
  const imported=await auth(request(app).post(`/api/developments/${ids.development}/ledger/batches`)).send(payload);
  assert.equal(imported.status,201,JSON.stringify(imported.body));
  assert.deepEqual(imported.body.transactions.map((row)=>row.resolutionStatus),['resolved','unresolved','unresolved']);
  assert.equal(imported.body.transactions[1].sourceCostCodeKey,'9998');

  const totals=await auth(request(app).get(`/api/developments/${ids.development}/ledger/totals`));
  assert.equal(totals.body.sourceTotalNet,1000);
  assert.equal(totals.body.allocatedTotalNet,-750);
  assert.equal(totals.body.unresolvedTotalNet,1750);
  assert.equal(totals.body.unresolvedCount,2);
  assert.equal(totals.body.actualCostByCostCode['4020'],-750);
  assert.equal(totals.body.actualCostByCostCode['9998'],undefined);

  const unresolved=imported.body.transactions[1];
  const target=ids.codes.find((item)=>item.code==='6210');
  const resolved=await auth(request(app).post(`/api/developments/${ids.development}/ledger/transactions/${unresolved.id}/resolve`)).send({resolvedCostCodeId:target.id,version:unresolved.resolutionVersion,reason:'Reviewed supplier coding'});
  assert.equal(resolved.status,200,JSON.stringify(resolved.body));
  assert.equal(resolved.body.resolutionStatus,'resolved');
  assert.equal(resolved.body.sourceCostCodeKey,'9998');
  assert.equal(resolved.body.costCodeKey,'6210');

  const stale=await auth(request(app).post(`/api/developments/${ids.development}/ledger/transactions/${unresolved.id}/resolve`)).send({resolvedCostCodeId:target.id,version:1,reason:'stale'});
  assert.equal(stale.status,409);
  const audit=await pool.query('SELECT * FROM ledger_cost_code_resolution_audit WHERE transaction_id=$1',[unresolved.id]);
  assert.equal(audit.rowCount,1);
  assert.equal(audit.rows[0].source_cost_code_key,'9998');

  const duplicate=await auth(request(app).post(`/api/developments/${ids.development}/ledger/batches`)).send(payload);
  assert.equal(duplicate.status,409);
  assert.equal((await pool.query('SELECT count(*)::int count FROM ledger_transactions WHERE development_id=$1',[ids.development])).rows[0].count,3);
});
