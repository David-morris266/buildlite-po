const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {pool,isDbConfigured}=require('../db');
const {prepareIntegrationTestDatabase}=require('./integrationTestSetup');
const {putRevenueSettings}=require('../services/revenueSettingsRepository');
const {PERMISSIONS}=require('../auth/permissions');

let fixture;
if(!isDbConfigured()) test('Summary Revenue authority skipped — TEST_DATABASE_URL not configured',()=>assert.ok(true));
else {
  test.before(async()=>{
    await prepareIntegrationTestDatabase(pool);
    const client=(await pool.query(`INSERT INTO clients(code,name,is_active) VALUES($1,'Summary Revenue test',false) RETURNING *`,[`REV_${randomUUID().slice(0,8)}`])).rows[0];
    const developmentId=`dev-summary-${randomUUID()}`;
    await pool.query(`INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,$3,'Summary Revenue','live','{}')`,[developmentId,client.id,`REV-${randomUUID()}`]);
    const user=(await pool.query(`INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES('clerk',$1,'summary@test','Authenticated Revenue QS','active') RETURNING *`,[`provider-${randomUUID()}`])).rows[0];
    const role=(await pool.query(`SELECT id FROM roles WHERE key='qs'`)).rows[0];
    const membership=(await pool.query(`INSERT INTO client_user_memberships(client_id,user_id,role_id,is_active) VALUES($1,$2,$3,true) RETURNING *`,[client.id,user.id,role.id])).rows[0];
    fixture={client,developmentId,user,membership,auth:{clientId:client.id,userId:user.id,membershipId:membership.id,providerUserId:user.provider_user_id,displayName:user.display_name,roleKey:'qs',permissions:[PERMISSIONS.REVENUE_MANAGE]}};
  });
  test.after(async()=>{if(fixture){await pool.query('DELETE FROM clients WHERE id=$1',[fixture.client.id]);await pool.query('DELETE FROM buildlite_users WHERE id=$1',[fixture.user.id]);}});

  test('authenticated provenance overrides forged actor and optimistic concurrency is enforced',async()=>{
    const created=await putRevenueSettings(fixture.client.id,fixture.developmentId,{version:0,actor:'Forged Director',revenueMode:'summary',summaryRevenueLines:[{id:'line-1',description:'Private Sales',forecastRevenue:123.45}]},{auth:fixture.auth});
    assert.equal(created.status,201);
    assert.equal(created.settings.updatedBy,'Authenticated Revenue QS');
    assert.equal(created.settings.updatedByMembershipId,fixture.membership.id);
    const stale=await putRevenueSettings(fixture.client.id,fixture.developmentId,{version:0,revenueMode:'summary',summaryRevenueLines:[{id:'line-1',description:'Private Sales',forecastRevenue:1}]},{auth:fixture.auth});
    assert.equal(stale.status,409);
  });

  test('switching Summary to Sales Register uses full close-candidate readiness',async()=>{
    const developmentId=`dev-summary-switch-${randomUUID()}`;
    await pool.query(`INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,$3,'Summary switch','live',$4::jsonb)`,[
      developmentId,fixture.client.id,`REV-${randomUUID()}`,JSON.stringify({plotMaster:{plots:[
        {id:'duplicate',plotNumber:'1',revenueStatus:'Available',revenueSource:'Manual Value',manualForecastValue:100},
        {id:'duplicate',plotNumber:'2',revenueStatus:'Available',revenueSource:'Manual Value',manualForecastValue:200},
      ]}}),
    ]);
    const created=await putRevenueSettings(fixture.client.id,developmentId,{version:0,revenueMode:'summary',summaryRevenueLines:[{id:'line-1',description:'Private Sales',forecastRevenue:300}]},{auth:fixture.auth});
    assert.equal(created.status,201);
    const blocked=await putRevenueSettings(fixture.client.id,developmentId,{version:1,revenueMode:'sales_register',summaryRevenueLines:created.settings.summaryRevenueLines},{auth:fixture.auth});
    assert.equal(blocked.status,409);
    assert.ok(blocked.blockers.some((item)=>item.reason==='duplicate-plot-id'));
  });

  test('Summary edits and mode switching fail while a CVR is Submitted',async()=>{
    await pool.query(`INSERT INTO cvr_periods(client_id,development_id,period_key,period_label,status,submitted_at,submitted_by) VALUES($1,$2,'P01','P01','submitted',NOW(),'Authenticated Revenue QS')`,[fixture.client.id,fixture.developmentId]);
    const blocked=await putRevenueSettings(fixture.client.id,fixture.developmentId,{version:1,revenueMode:'summary',summaryRevenueLines:[{id:'line-1',description:'Private Sales',forecastRevenue:200}]},{auth:fixture.auth});
    assert.equal(blocked.status,409);
    assert.match(blocked.message,/Submitted/);
    const switchBlocked=await putRevenueSettings(fixture.client.id,fixture.developmentId,{version:1,revenueMode:'sales_register',summaryRevenueLines:[{id:'line-1',description:'Private Sales',forecastRevenue:123.45}]},{auth:fixture.auth});
    assert.equal(switchBlocked.status,409);
  });
}
