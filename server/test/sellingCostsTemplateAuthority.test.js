const test=require('node:test');
const assert=require('node:assert/strict');
const request=require('supertest');
const createApp=require('../app');
const {pool,isDbConfigured}=require('../db');
const {prepareIntegrationTestDatabase}=require('./integrationTestSetup');
const {PERMISSIONS}=require('../auth/permissions');
const templateRepository=require('../services/sellingCostsTemplateRepository');

if(!isDbConfigured())test('Selling Costs template authority skipped without test database',()=>assert.ok(true));
else{
  let tenant,other,codeId,templateId;
  const principal=()=>({userId:'00000000-0000-0000-0000-000000000001',providerUserId:'selling-template-test',displayName:'Authenticated Owner',clientId:tenant, membershipId:'00000000-0000-0000-0000-000000000002',roleKey:'admin',roleName:'Admin',permissions:Object.values(PERMISSIONS),memberships:[]});
  const app=createApp({testPrincipal:principal});
  test.before(async()=>{await prepareIntegrationTestDatabase(pool);const db=await pool.query('SELECT current_database() db');assert.equal(db.rows[0].db,'buildlite_test');tenant=(await pool.query(`INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING id`,[`SC-T-${Date.now()}`,'Selling template tenant'])).rows[0].id;other=(await pool.query(`INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING id`,[`SC-O-${Date.now()}`,'Other tenant'])).rows[0].id;codeId=(await pool.query(`INSERT INTO cost_codes(client_id,code,description,is_active,version) VALUES($1,'SALE-A','Sales and marketing',true,1) RETURNING id`,[tenant])).rows[0].id;});
  test.after(async()=>{await pool.query('DELETE FROM client_selling_cost_templates WHERE client_id=$1',[tenant]);await pool.query('DELETE FROM cost_codes WHERE client_id IN($1,$2)',[tenant,other]);await pool.query('DELETE FROM clients WHERE id IN($1,$2)',[tenant,other]);});
  test('product standard has approved concepts and no customer Cost Code or money',async()=>{const res=await request(app).get('/api/selling-costs-templates/standard');assert.equal(res.status,200);assert.equal(res.body.lines.length,10);assert.equal(res.body.simpleDestination,null);assert.equal(res.body.simpleAssumptionPercent,2);assert.ok(res.body.lines.some(line=>line.forecastDriver==='QUANTITY_RATE'));assert.ok(res.body.lines.every(line=>line.costCode==null&&line.defaultLumpSum==null));});
  test('creates tenant copy then maps Simple mode by stable arbitrary Cost Code identity',async()=>{const created=await request(app).post('/api/selling-costs-templates').send({origin:'buildlite_standard',name:'Company Selling Costs',actor:'Spoofed actor'});assert.equal(created.status,201);templateId=created.body.id;assert.equal(created.body.lines.length,10);assert.equal(created.body.createdBy,'Authenticated Owner');const mapped=await request(app).put(`/api/selling-costs-templates/${templateId}`).send({version:created.body.version,simpleAssumptionPercent:1.85,simpleDestinationCostCodeId:codeId,isDefault:true});assert.equal(mapped.status,200);assert.equal(mapped.body.simpleDestination.id,codeId);assert.equal(mapped.body.simpleDestination.code,'SALE-A');assert.equal(mapped.body.simpleAssumptionPercent,1.85);assert.equal(mapped.body.updatedBy,'Authenticated Owner');});
  test('persists controlled Detailed quantity source, unit and stable destination',async()=>{const current=(await request(app).get(`/api/selling-costs-templates/${templateId}`)).body;const line=current.lines.find(item=>item.forecastDriver==='QUANTITY_RATE');const lines=current.lines.map(item=>item.id===line.id?{...item,quantitySource:'PRIVATE_SALE_PLOTS',unitCode:'PLOTS',defaultRate:275,costCodeId:codeId}:item);const saved=await request(app).put(`/api/selling-costs-templates/${templateId}`).send({version:current.version,lines});assert.equal(saved.status,200);const result=saved.body.lines.find(item=>item.id===line.id);assert.equal(result.quantitySource,'PRIVATE_SALE_PLOTS');assert.equal(result.unitCode,'PLOTS');assert.equal(result.defaultRate,275);assert.equal(result.costCode.id,codeId);});
  test('cross-tenant and inactive mappings fail closed',async()=>{const foreign=(await pool.query(`INSERT INTO cost_codes(client_id,code,description,is_active,version) VALUES($1,'FOREIGN','Foreign',true,1) RETURNING id`,[other])).rows[0].id;let current=(await request(app).get(`/api/selling-costs-templates/${templateId}`)).body;const cross=await request(app).put(`/api/selling-costs-templates/${templateId}`).send({version:current.version,simpleDestinationCostCodeId:foreign});assert.equal(cross.status,400);await pool.query('UPDATE cost_codes SET is_active=false WHERE id=$1',[codeId]);current=(await request(app).get(`/api/selling-costs-templates/${templateId}`)).body;const inactive=await request(app).put(`/api/selling-costs-templates/${templateId}`).send({version:current.version,simpleDestinationCostCodeId:codeId});assert.equal(inactive.status,400);await pool.query('UPDATE cost_codes SET is_active=true WHERE id=$1',[codeId]);});
  test('company writes require commercial_templates.manage',async()=>{const denied=createApp({testPrincipal:()=>({...principal(),roleKey:'commercial_manager',roleName:'Commercial Manager',permissions:[PERMISSIONS.COMMERCIAL_READ]})});const res=await request(denied).post('/api/selling-costs-templates').send({origin:'blank',name:'Denied'});assert.equal(res.status,403);assert.match(res.body.message,/commercial_templates\.manage/);});
  test('template service failure is controlled and subsequent requests remain serviceable',async()=>{
    const original=templateRepository.listTemplates;
    templateRepository.listTemplates=async()=>{throw new Error('deliberate template service failure');};
    try{
      const failed=await request(app).get('/api/selling-costs-templates');
      assert.equal(failed.status,500);
      assert.equal(failed.body.message,'Failed to load Selling Costs templates.');
    }finally{
      templateRepository.listTemplates=original;
    }
    const recovered=await request(app).get('/api/selling-costs-templates');
    assert.equal(recovered.status,200);
    assert.ok(Array.isArray(recovered.body));
    const unauthorised=createApp({testPrincipal:()=>null});
    assert.equal((await request(unauthorised).get('/api/selling-costs-templates')).status,401);
  });
}
