const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {randomUUID}=require('crypto');
const {pool,isDbConfigured}=require('../db');
const {prepareIntegrationTestDatabase}=require('./integrationTestSetup');
const repo=require('../services/paymentApplicationRepository');
const sql=(name)=>fs.readFileSync(path.join(__dirname,'..','migrations',name),'utf8');
const clients=[];
let a,b;

async function seed(label){
  const client=(await pool.query("INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING *",[`APP_${label}_${randomUUID().slice(0,8)}`,`Application ${label}`])).rows[0];clients.push(client.id);
  const development=`dev-app-${label}-${randomUUID()}`;
  await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,$3,$4,'live','{}')",[development,client.id,`JOB-${label}-${randomUUID().slice(0,6)}`,`Application ${label}`]);
  const pkg=(await pool.query("INSERT INTO packages(client_id,development_id,supplier_id,cost_code,order_key) VALUES($1,$2,$3,'5218',$4) RETURNING *",[client.id,development,`supplier-${label}`,`subcontract:${randomUUID()}`])).rows[0];
  const cert=(await pool.query("INSERT INTO package_payment_certificates(client_id,package_id,development_id,order_key,certificate_number,status,payload) VALUES($1,$2,$3,$4,1,'draft','{}') RETURNING *",[client.id,pkg.id,development,pkg.order_key])).rows[0];
  return {client,development,pkg,cert};
}

test.before(async()=>{if(!isDbConfigured())return;await prepareIntegrationTestDatabase(pool);for(const name of ['004_developments.sql','005_packages.sql','008_package_payment_certificates.sql','026_subcontract_payment_applications.sql'])await pool.query(sql(name));a=await seed('A');b=await seed('B');});
test.after(async()=>{if(isDbConfigured()&&clients.length)await pool.query('DELETE FROM clients WHERE id=ANY($1::uuid[])',[clients]);});

const body=(seed,overrides={})=>({certificateId:seed.cert.id,applicationReference:'APP-001',receivedAt:'2026-08-29',applicationBasis:'current_period_gross',currentPeriodGrossClaimed:1500,recordedBy:'QS',...overrides});

test('records nullable source facts, links package/certificate and isolates tenants',async(t)=>{if(!isDbConfigured())return t.skip('TEST_DATABASE_URL not configured');const created=await repo.createApplication(a.client.id,a.pkg.id,body(a));assert.equal(created.ok,true,created.message);assert.equal(created.application.currentPeriodGrossClaimed,1500);assert.equal(created.application.retentionStated,null);assert.equal((await repo.listApplications(a.client.id,a.pkg.id,a.cert.id)).applications.length,1);assert.equal((await repo.listApplications(b.client.id,a.pkg.id)).status,404);assert.equal((await repo.createApplication(a.client.id,a.pkg.id,body(a,{certificateId:b.cert.id,applicationReference:'BAD'}))).status,404);});

test('corrections create a superseding revision and preserve the original fact',async(t)=>{if(!isDbConfigured())return t.skip('TEST_DATABASE_URL not configured');const fixture=await seed('R');const first=(await repo.createApplication(fixture.client.id,fixture.pkg.id,body(fixture))).application;const revised=await repo.reviseApplication(fixture.client.id,fixture.pkg.id,first.id,body(fixture,{currentPeriodGrossClaimed:1400,comment:'Corrected source'}));assert.equal(revised.ok,true);assert.equal(revised.application.revisionNumber,2);assert.equal(revised.application.supersedesId,first.id);const rows=(await pool.query('SELECT status,current_period_gross_claimed FROM subcontract_payment_applications WHERE id=ANY($1::uuid[]) ORDER BY revision_number',[[first.id,revised.application.id]])).rows;assert.deepEqual(rows.map(r=>r.status),['superseded','recorded']);assert.deepEqual(rows.map(r=>Number(r.current_period_gross_claimed)),[1500,1400]);});

test('submitted and locked certificate linkage is immutable',async(t)=>{if(!isDbConfigured())return t.skip('TEST_DATABASE_URL not configured');const fixture=await seed('L');const first=(await repo.createApplication(fixture.client.id,fixture.pkg.id,body(fixture))).application;await pool.query("UPDATE package_payment_certificates SET status='submitted' WHERE id=$1",[fixture.cert.id]);assert.match((await repo.reviseApplication(fixture.client.id,fixture.pkg.id,first.id,body(fixture))).message,/immutable/i);assert.match((await repo.createApplication(fixture.client.id,fixture.pkg.id,body(fixture,{applicationReference:'APP-002'}))).message,/Draft/i);});

test('package-cycle application can be linked later to one Draft certificate',async(t)=>{if(!isDbConfigured())return t.skip('TEST_DATABASE_URL not configured');const fixture=await seed('P');const unlinked=(await repo.createApplication(fixture.client.id,fixture.pkg.id,{...body(fixture),certificateId:null})).application;assert.equal(unlinked.certificateId,null);const linked=await repo.linkApplication(fixture.client.id,fixture.pkg.id,unlinked.id,{certificateId:fixture.cert.id,actor:'QS'});assert.equal(linked.ok,true,linked.message);assert.equal(linked.application.certificateId,fixture.cert.id);});
