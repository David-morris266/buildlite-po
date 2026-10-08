#!/usr/bin/env node
require('../test/loadTestEnv');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Client}=require('pg');
const source=new URL(process.env.TEST_DATABASE_URL||'');
if(!['localhost','127.0.0.1','::1'].includes(source.hostname))throw new Error('Site Start migration rehearsal requires local TEST_DATABASE_URL credentials.');
const database=`buildlite_test_ss067_${process.pid}`;
const adminUrl=new URL(source);adminUrl.pathname='/postgres';
const targetUrl=new URL(source);targetUrl.pathname=`/${database}`;
const migrations=path.join(__dirname,'..','migrations');
const quote=name=>`"${String(name).replace(/"/g,'""')}"`;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
let target;
async function apply(db,file){await db.query('BEGIN');try{await db.query(fs.readFileSync(path.join(migrations,file),'utf8'));await db.query('INSERT INTO schema_migrations(filename) VALUES($1)',[file]);await db.query('COMMIT');}catch(error){await db.query('ROLLBACK');throw new Error(`${file}: ${error.message}`);}}
async function fixture(db){
  const client=(await db.query("INSERT INTO clients(code,name,is_active) VALUES('SS067','SS067 Rehearsal',false) RETURNING id")).rows[0];
  const user=(await db.query("INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES('clerk','ss067-user','ss067@test.invalid','SS067 Director','active') RETURNING id")).rows[0];
  const role=(await db.query("SELECT id FROM roles WHERE key='commercial_director'")).rows[0];
  const member=(await db.query('INSERT INTO client_user_memberships(client_id,user_id,role_id,is_active) VALUES($1,$2,$3,true) RETURNING id',[client.id,user.id,role.id])).rows[0];
  await db.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES('ss067-dev',$1,'SS067','SS067 Development','live','{}')",[client.id]);
  const cc=(await db.query("INSERT INTO cost_codes(client_id,code,description,is_active,version) VALUES($1,'1000','Legacy cost',true,1) RETURNING id",[client.id])).rows[0];
  const evidence={schemaVersion:'development_budget_event_v1',lines:[{lineNumber:1,costCodeId:cc.id,amountPence:10000000}]};
  const event=(await db.query(`INSERT INTO development_budget_events(client_id,development_id,sequence_number,event_type,effective_date,reference,reason,idempotency_key,source_snapshot,source_snapshot_sha256,source_snapshot_hash_scheme,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name,created_role_key,created_permission_key) VALUES($1,'ss067-dev',1,'opening_budget','2026-01-01','OPEN','Opening budget','ss067-open',$2,$3,'canonical_json_sha256_v1',$4,$5,'ss067-user','SS067 Director','commercial_director','development_budget.post') RETURNING id`,[client.id,JSON.stringify(evidence),digest(evidence),user.id,member.id])).rows[0];
  await db.query("INSERT INTO development_budget_event_lines(client_id,development_id,event_id,line_number,cost_code_id,signed_amount,explanation) VALUES($1,'ss067-dev',$2,1,$3,100000,'Opening')",[client.id,event.id,cc.id]);
  const period=(await db.query(`INSERT INTO cvr_periods(client_id,development_id,period_key,period_label,reporting_month,status,commentary,version,created_by,updated_by,submitted_at,submitted_by,approved_at,approved_by,budget_source) VALUES($1,'ss067-dev','P01','Period 01','2026-09-01','locked','{}',3,'SS067 Director','SS067 Director',NOW(),'SS067 Director',NOW(),'SS067 Director','development_budget') RETURNING id`,[client.id])).rows[0];
  const snapshot=(await db.query(`INSERT INTO cvr_period_snapshots(client_id,development_id,period_id,period_key,schema_version,current_budget,final_forecast,variance,created_by) VALUES($1,'ss067-dev',$2,'P01',1,100000,110000,-10000,'SS067 Director') RETURNING id`,[client.id,period.id])).rows[0];
  await db.query(`INSERT INTO cvr_period_snapshot_rows(client_id,snapshot_id,cost_code_key,cost_code_label,original_budget,current_budget,commercial_adjustment,system_forecast,final_forecast,variance) VALUES($1,$2,'1000','1000 - Legacy cost',100000,100000,10000,100000,110000,-10000)`,[client.id,snapshot.id]);
  const milestone={schemaVersion:'site_start_budget_milestone_v1',positions:[{costCodeId:cc.id,costCode:'1000',amountPence:10000000}],totalPence:10000000};
  await db.query(`INSERT INTO development_budget_milestones(client_id,development_id,milestone_type,opening_budget_event_id,approved_effective_date,reference,approval_reason,evidence_snapshot,evidence_hash_scheme,evidence_sha256,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name,created_role_key,created_permission_key) VALUES($1,'ss067-dev','site_start_budget',$2,'2026-01-01','SS-V1','Legacy milestone',$3,'canonical_json_sha256_v1',$4,$5,$6,'ss067-user','SS067 Director','commercial_director','development_budget.post')`,[client.id,event.id,JSON.stringify(milestone),digest(milestone),user.id,member.id]);
}
async function inventory(db){return (await db.query(`SELECT (SELECT COUNT(*) FROM cvr_periods)::int periods,(SELECT COUNT(*) FROM cvr_period_snapshots)::int snapshots,(SELECT COUNT(*) FROM cvr_period_snapshot_rows)::int snapshot_rows,(SELECT SUM(final_forecast) FROM cvr_period_snapshots)::numeric total,(SELECT evidence_sha256 FROM development_budget_milestones LIMIT 1) milestone_hash`)).rows[0];}
async function main(){
  let admin=new Client({connectionString:adminUrl.toString()});await admin.connect();if((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount)throw new Error('Disposable rehearsal database already exists.');await admin.query(`CREATE DATABASE ${quote(database)}`);await admin.end();
  try{
    target=new Client({connectionString:targetUrl.toString()});target.on('error',()=>{});await target.connect();if((await target.query('SELECT current_database() database')).rows[0].database!==database)throw new Error('Positive disposable database identity failed.');
    await target.query('CREATE TABLE schema_migrations(id SERIAL PRIMARY KEY,filename TEXT NOT NULL UNIQUE,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const files=fs.readdirSync(migrations).filter(file=>file.endsWith('.sql')).sort();for(const file of files.filter(file=>Number(file.slice(0,3))<=66))await apply(target,file);
    await target.query('BEGIN');try{await fixture(target);await target.query('COMMIT');}catch(error){await target.query('ROLLBACK');throw error;}const before=await inventory(target);await apply(target,'067_site_start_period_foundation.sql');const after=await inventory(target);
    const authority=(await target.query(`SELECT (SELECT period_type FROM cvr_periods LIMIT 1) period_type,(SELECT authority_version FROM development_budget_milestones LIMIT 1)::int authority_version,(SELECT COUNT(*) FROM development_land_appraisals)::int appraisals,(SELECT COUNT(*) FROM schema_migrations)::int migrations`)).rows[0];
    if(JSON.stringify(before)!==JSON.stringify(after)||authority.period_type!=='monthly_cvr'||authority.authority_version!==1||authority.appraisals!==0||authority.migrations!==67)throw new Error(`Historic evidence changed: ${JSON.stringify({before,after,authority})}`);
    console.log(JSON.stringify({database,frontierBefore:66,frontierAfter:67,before,after,authority,status:'PASS'}));
  } finally {
    if(target){await target.end().catch(()=>{});target=null;}
    admin=new Client({connectionString:adminUrl.toString()});await admin.connect();if((await admin.query('SELECT datname FROM pg_database WHERE datname=$1',[database])).rows[0]?.datname===database)await admin.query(`DROP DATABASE ${quote(database)}`);await admin.end();console.log(JSON.stringify({database,cleanup:'DROPPED'}));
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
