const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'..','migrations','066_tenant_branding_assets.sql'),'utf8');

test('Migration 066 is additive, tenant-bound, object-storage-ready and performs no legacy backfill',()=>{
  for(const table of ['tenant_brand_assets','tenant_branding','tenant_branding_audit'])assert.match(sql,new RegExp(`CREATE TABLE ${table}`));
  assert.match(sql,/storage_provider TEXT[\s\S]*'postgres'[\s\S]*'object'/);
  assert.match(sql,/binary_data BYTEA/);assert.match(sql,/storage_key TEXT/);
  assert.match(sql,/FOREIGN KEY \(client_id,active_logo_asset_id\)/);
  assert.match(sql,/Tenant brand assets are immutable/);assert.match(sql,/Tenant branding audit is append-only/);
  assert.doesNotMatch(sql,/INSERT INTO tenant_brand_assets[\s\S]*SELECT/i);
  assert.doesNotMatch(sql,/client_brand_profiles/i);
  assert.doesNotMatch(sql,/logo_url/i);
});
