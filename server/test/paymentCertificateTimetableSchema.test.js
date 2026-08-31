const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool, isDbConfigured } = require('../db');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');

const migration = path.join(__dirname,'..','migrations','028_payment_certificate_deadline_snapshots.sql');

test('migration 028 is additive, append-only and contains no historic backfill',()=>{
  const sql=fs.readFileSync(migration,'utf8');
  assert.match(sql,/ADD COLUMN IF NOT EXISTS contractual_valuation_date DATE/i);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS package_payment_certificate_deadline_snapshots/i);
  assert.match(sql,/BEFORE UPDATE OR DELETE/i);
  assert.doesNotMatch(sql,/INSERT INTO package_payment_certificate_deadline_snapshots\s+SELECT/i);
  assert.doesNotMatch(sql,/UPDATE package_payment_certificates\s+SET contractual_valuation_date/i);
});

test('migration 028 schema exposes tenant-scoped immutable timetable evidence',async t=>{
  if(!isDbConfigured())return t.skip();
  await prepareIntegrationTestDatabase(pool);
  await pool.query(fs.readFileSync(migration,'utf8'));
  const columns=await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='package_payment_certificate_deadline_snapshots'`);
  const names=new Set(columns.rows.map(row=>row.column_name));
  for(const name of ['client_id','certificate_id','package_id','development_id','stage','attempt_number','readiness','calculation_status','terms_version_id','application_id','anchor_type','cycle_inputs','reasons','captured_at'])assert.equal(names.has(name),true,name);
  const trigger=await pool.query(`SELECT 1 FROM pg_trigger WHERE tgrelid='package_payment_certificate_deadline_snapshots'::regclass AND tgname='trg_certificate_deadline_snapshot_immutable' AND NOT tgisinternal`);
  assert.equal(trigger.rowCount,1);
});
