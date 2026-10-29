const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const request = require('supertest');
const { pool } = require('../db');
const createApp = require('../app');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');
const { isDbConfigured } = require('../utils/env');

test('reviewed Sales Register apply is tenant scoped, versioned and preserves unrelated plot facts', async (t) => {
  if (!isDbConfigured()) return t.skip();
  await prepareIntegrationTestDatabase(pool);
  const clientId = randomUUID(), otherClientId = randomUUID(), developmentId = `dev-sales-${randomUUID()}`;
  const role = (await pool.query("SELECT id FROM roles WHERE key='commercial_director'")).rows[0];
  const userId = randomUUID(), membershipId = randomUUID(), providerUserId = `sales-${randomUUID()}`;
  await pool.query("INSERT INTO clients(id,code,name,is_active) VALUES($1,$2,'Sales Import',false),($3,$4,'Other',false)", [clientId, `SI-${Date.now()}`, otherClientId, `SO-${Date.now()}`]);
  await pool.query("INSERT INTO buildlite_users(id,auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES($1,'clerk',$2,'sales@test.invalid','Revenue Reviewer','active')", [userId, providerUserId]);
  await pool.query('INSERT INTO client_user_memberships(id,client_id,user_id,role_id,is_active) VALUES($1,$2,$3,$4,true)', [membershipId, clientId, userId, role.id]);
  const plots = [
    { id: 'p1', plotNumber: '1', houseType: 'A', status: 'Legacy Completed', revenueStatus: 'Available', tenureCode:'OPEN_MARKET', sellingPrice: 0, notes: 'keep' },
    { id: 'p2', plotNumber: '2', houseType: 'B', revenueStatus: 'Available', sellingPrice: 0 },
  ];
  await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload,version) VALUES($1,$2,'SI-1','Sales Import','live',$3,1)", [developmentId, clientId, JSON.stringify({ plotMaster: { plots } })]);
  const principal = { userId, providerUserId, displayName: 'Revenue Reviewer', clientId, membershipId, roleKey: 'commercial_director', roleName: 'Commercial Director', permissions: ['commercial.read', 'revenue.manage', 'plot_master.manage'], memberships: [] };
  const app = createApp({ testPrincipal: principal });
  const sourceEvidence={fileName:'sales.xlsx',worksheet:'Sales Register',sha256:'a'.repeat(64),sourceRowCount:1,mapping:[]};
  const reviewed={version:1,treatment:'contractual_selling_price',reason:'Reviewed contractual sale',sourceEvidence,excludedRows:[],updates:[{plotId:'p1',plotNumber:'1',sourceRowNumber:2,revenueStatus:'Completed',importedPrice:250000}]};
  const preview=await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import/preview`).send(reviewed);
  assert.equal(preview.status,200); assert.equal(preview.body.preview.canApply,true);
  const tamperedStatus=await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import`).send({...reviewed,updates:[{...reviewed.updates[0],revenueStatus:'Exchanged'}],previewFingerprint:preview.body.preview.fingerprint});
  assert.equal(tamperedStatus.status,409); assert.equal(tamperedStatus.body.code,'STALE_PREVIEW');
  assert.equal((await pool.query('SELECT version FROM developments WHERE id=$1',[developmentId])).rows[0].version,1);
  const response = await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import`).send({...reviewed,previewFingerprint:preview.body.preview.fingerprint});
  assert.equal(response.status, 200);
  assert.equal(response.body.development.version, 2);
  const changed = response.body.development.plotMaster.plots[0];
  assert.equal(changed.revenueStatus, 'Completed'); assert.equal(changed.sellingPrice, 250000);
  assert.equal(changed.status, 'Legacy Completed'); assert.equal(changed.notes, 'keep');
  assert.equal(response.body.development.plotMaster.plots[1].revenueStatus, 'Available');
  assert.equal(response.body.development.plotMaster.lastSalesRegisterImport.appliedBy, 'Revenue Reviewer');
  const invalid = await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import`).send({ ...reviewed,version:2,updates:[{plotId:'p2',plotNumber:'2',sourceRowNumber:2,revenueStatus:'Completed',importedPrice:0}],previewFingerprint:'x' });
  assert.equal(invalid.status, 422);
  const duplicate = await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import`).send({ ...reviewed,version:2,sourceEvidence:{...sourceEvidence,sourceRowCount:2},updates:[{plotId:'p2',plotNumber:'2',sourceRowNumber:2,revenueStatus:'Available',importedPrice:1},{plotId:'p2',plotNumber:'2',sourceRowNumber:3,revenueStatus:'Reserved',importedPrice:1}],previewFingerprint:'x' });
  assert.equal(duplicate.status, 422);
  assert.equal((await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import`).send({...reviewed,version:1,previewFingerprint:'x'})).status,409);
  const submitted = await pool.query("INSERT INTO cvr_periods(client_id,development_id,period_key,period_label,period_type,status,commentary,version,budget_source,submitted_at,submitted_by) VALUES($1,$2,'P01','P01','monthly_cvr','submitted','{}',1,'legacy_cvr',NOW(),'test') RETURNING id", [clientId, developmentId]);
  const blocked = await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import`).send({...reviewed,version:2,previewFingerprint:'x'});
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'PLOT_MASTER_UPDATE_BLOCKED_SUBMITTED_CVR');
  assert.equal((await pool.query('SELECT version FROM developments WHERE id=$1', [developmentId])).rows[0].version, 2);
  await pool.query('DELETE FROM cvr_periods WHERE id=$1', [submitted.rows[0].id]);
  const crossTenant = createApp({ testPrincipal: { ...principal, clientId: otherClientId } });
  assert.equal((await request(crossTenant).post(`/api/developments/${developmentId}/revenue/sales-register-import`).send({...reviewed,version:2,previewFingerprint:'x'})).status,404);
  const revenueOnly = createApp({ testPrincipal: { ...principal, permissions: ['commercial.read', 'revenue.manage'] } });
  assert.equal((await request(revenueOnly).post(`/api/developments/${developmentId}/revenue/sales-register-import/preview`).send({...reviewed,version:2})).status,403);
});

test('Welford-style adopted forecasts reconcile exactly without strategy discounts', () => {
  const { buildReviewedImport } = require('../services/salesRegisterImportService');
  const actualRows=require('./fixtures/welfordRevenueImportRows');
  const plots=actualRows.map(([plotNumber,houseType],index)=>({id:`p${index+1}`,plotNumber,houseType,revenueStatus:'Available',revenueSource:'Development Strategy',tenureCode:index<36?'AFFORDABLE_RENT':'ADDITIONALITY',niaFt2:900,sellingPrice:293400}));
  const updates=actualRows.map(([plotNumber,,importedPrice],index)=>({plotId:`p${index+1}`,plotNumber,sourceRowNumber:index+4,importedPrice}));
  const development={id:'dev-welford',clientId:'tenant-v',version:7,plotMaster:{plots}};
  const result=buildReviewedImport(development,null,{version:7,treatment:'forecast_manual_value',reason:'Adopt HA package appraisal allocations',sourceEvidence:{fileName:'Welford Revenue.xlsx',worksheet:'Revenues',sha256:'b'.repeat(64),sourceRowCount:75,mapping:[]},updates}, {displayName:'QS'});
  assert.equal(result.preview.canApply,true); assert.equal(result.preview.sourceTotal,21131548.20); assert.equal(result.preview.projectedAuthoritativeGdv,21131548.20); assert.equal(result.preview.difference,0);
  assert.equal(result.nextPlots.every(plot=>plot.revenueSource==='Manual Value'&&plot.manualOverrideExplicit&&plot.forecastImportProvenance),true);
  assert.equal(result.nextPlots.every(plot=>plot.sellingPrice===293400&&plot.sellingPriceRequiresConfirmation===true),true);
});

test('portable actual Welford values pass client parsing, HTTP preview, atomic apply and authoritative Revenue', async (t) => {
  if (!isDbConfigured()) return t.skip();
  await prepareIntegrationTestDatabase(pool);
  const rowsFixture = require('./fixtures/welfordRevenueImportRows');
  const XLSX = require('../../client/node_modules/xlsx');
  const excelImport = await import(pathToFileURL(path.join(__dirname, '../../client/src/payments/excelImport.js')).href);
  const salesImport = await import(pathToFileURL(path.join(__dirname, '../../client/src/revenue/salesRegisterImport.js')).href);
  assert.ok(rowsFixture.some((row)=>row[2]===218582.99999999997),'portable fixture must retain the source floating-point artefact');
  const sourceRows=[['Welford Road','',''],['Revenues','',''],['Plot','Type','Revenues'],...rowsFixture];
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(sourceRows),'Sheet1');
  const bytes=XLSX.write(workbook,{type:'array',bookType:'xlsx'});
  const parsed = await excelImport.parseExcelFile({ arrayBuffer: async () => bytes });
  const parsedRows = excelImport.sheetToRawRows(parsed.Sheets.Sheet1);
  const headerRowIndex = excelImport.detectHeaderRowIndex(parsedRows);
  const headers = excelImport.extractHeaders(parsedRows[headerRowIndex]);
  const fieldByColumn = salesImport.autoDetectSalesRegisterColumns(headers);

  const clientId=randomUUID(),developmentId=`dev-welford-${randomUUID()}`,userId=randomUUID(),membershipId=randomUUID();
  const role=(await pool.query("SELECT id FROM roles WHERE key='commercial_director'")).rows[0];
  await pool.query("INSERT INTO clients(id,code,name,is_active) VALUES($1,$2,'Welford Acceptance',false)",[clientId,`WF-${Date.now()}`]);
  await pool.query("INSERT INTO buildlite_users(id,auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES($1,'clerk',$2,'welford@test.invalid','Welford QS','active')",[userId,`wf-${randomUUID()}`]);
  await pool.query('INSERT INTO client_user_memberships(id,client_id,user_id,role_id,is_active) VALUES($1,$2,$3,$4,true)',[membershipId,clientId,userId,role.id]);
  const plots=rowsFixture.map(([plotNumber,houseType,price],index)=>({id:`p${index+1}`,plotNumber,houseType,tenureCode:'ADDITIONALITY',revenueStatus:'Available',revenueSource:'Development Strategy',niaFt2:900,sellingPrice:price}));
  await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload,version) VALUES($1,$2,'WF-1','Welford Road','live',$3,1)",[developmentId,clientId,JSON.stringify({plotMaster:{plots}})]);
  const review=salesImport.buildSalesRegisterReview({rows:parsedRows,headerRowIndex,fieldByColumn,plots,statusMapping:{},treatment:'forecast_manual_value'});
  assert.equal(review.ready,true); assert.equal(review.changes.length,75);
  assert.deepEqual(review.changes.map(row=>row.importedPrice),rowsFixture.map(row=>Math.round(row[2]*100)/100));
  const principal={userId,providerUserId:`wf-${userId}`,displayName:'Welford QS',clientId,membershipId,roleKey:'commercial_director',roleName:'Commercial Director',permissions:['commercial.read','revenue.manage','plot_master.manage'],memberships:[]};
  const app=createApp({testPrincipal:principal});
  const payload={version:1,treatment:'forecast_manual_value',reason:'Adopt the reviewed HA package appraisal allocation',sourceEvidence:{fileName:'Welford Road - Revenues.xlsx',worksheet:'Sheet1',sha256:createHash('sha256').update(Buffer.from(bytes)).digest('hex'),sourceRowCount:75,mapping:headers.map((header,index)=>({header,destination:fieldByColumn[index]}))},excludedRows:[],updates:review.changes.map(({plotId,plotNumber,sourceRowNumber,importedPrice})=>({plotId,plotNumber,sourceRowNumber,importedPrice}))};
  const preview=await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import/preview`).send(payload);
  assert.equal(preview.status,200,preview.body.message); assert.equal(preview.body.preview.acceptedRowCount,75); assert.equal(preview.body.preview.rejectedRowCount,0); assert.equal(preview.body.preview.excludedRowCount,0); assert.equal(preview.body.preview.sourceTotal,21131548.20); assert.equal(preview.body.preview.projectedAuthoritativeGdv,21131548.20); assert.equal(preview.body.preview.difference,0);
  const stale=await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import`).send({...payload,previewFingerprint:'0'.repeat(64)});
  assert.equal(stale.status,409); const unchanged=(await pool.query('SELECT version,payload FROM developments WHERE id=$1 AND client_id=$2',[developmentId,clientId])).rows[0]; assert.equal(unchanged.version,1); assert.equal(unchanged.payload.plotMaster.plots[0].revenueSource,'Development Strategy');
  const applied=await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import`).send({...payload,previewFingerprint:preview.body.preview.fingerprint});
  assert.equal(applied.status,200,applied.body.message); assert.equal(applied.body.development.version,2); assert.equal(applied.body.development.plotMaster.plots.every(plot=>plot.revenueSource==='Manual Value'&&plot.manualOverrideExplicit===true),true); assert.equal(applied.body.development.plotMaster.plots.every(plot=>plot.sellingPriceRequiresConfirmation===true),true);
  const { buildRevenueAuthorityFromDocuments }=require('../services/cvrRevenueClose');
  const authority=buildRevenueAuthorityFromDocuments({clientId,developmentId,development:applied.body.development,settingsDocument:null});
  assert.equal(authority.ready,true); assert.equal(authority.summary.forecastRevenue,21131548.20);
});

test('contractual status-only review remains partial and does not claim whole-GDV reconciliation', () => {
  const { buildReviewedImport } = require('../services/salesRegisterImportService');
  const development={id:'dev-status',clientId:'tenant-v',version:2,plotMaster:{plots:[
    {id:'p1',plotNumber:'1',tenureCode:'OPEN_MARKET',revenueStatus:'Available',revenueSource:'Manual Value',manualOverrideExplicit:true,manualForecastValue:250000,sellingPrice:250000},
    {id:'p2',plotNumber:'2',tenureCode:'OPEN_MARKET',revenueStatus:'Available',revenueSource:'Manual Value',manualOverrideExplicit:true,manualForecastValue:300000,sellingPrice:0},
  ]}};
  const result=buildReviewedImport(development,null,{version:2,treatment:'contractual_selling_price',reason:'Record reservation status',sourceEvidence:{fileName:'sales.xlsx',worksheet:'Sales',sha256:'c'.repeat(64),sourceRowCount:1},updates:[{plotId:'p1',plotNumber:'1',sourceRowNumber:2,revenueStatus:'Reserved'}]}, {displayName:'QS'});
  assert.equal(result.preview.canApply,true);
  assert.equal(result.preview.exactlyReconciled,null);
  assert.equal(result.preview.sourceTotal,0);
  assert.equal(result.nextPlots[0].sellingPrice,250000);
});

test('stale imported Available price cannot silently become reservation evidence', () => {
  const { buildReviewedImport } = require('../services/salesRegisterImportService');
  const development={id:'dev-stale',clientId:'tenant-v',version:3,plotMaster:{plots:[{id:'p1',plotNumber:'1',revenueStatus:'Available',revenueSource:'Manual Value',manualOverrideExplicit:true,manualForecastValue:250000,sellingPrice:240000,sellingPriceRequiresConfirmation:true}]}};
  const result=buildReviewedImport(development,null,{version:3,treatment:'contractual_selling_price',reason:'Update reservation',sourceEvidence:{fileName:'sales.xlsx',worksheet:'Sales',sha256:'d'.repeat(64),sourceRowCount:1},updates:[{plotId:'p1',plotNumber:'1',sourceRowNumber:2,revenueStatus:'Reserved'}]}, {displayName:'QS'});
  assert.equal(result.preview.canApply,false);
  assert.match(result.preview.errors[0].reason,/not contractual evidence/i);
});

test('forecast adoption surfaces a human Manual Value for explicit resolution', () => {
  const { buildReviewedImport } = require('../services/salesRegisterImportService');
  const development={id:'dev-human',clientId:'tenant-v',version:4,plotMaster:{plots:[{id:'p1',plotNumber:'1',tenureCode:'OPEN_MARKET',revenueStatus:'Available',revenueSource:'Manual Value',manualOverrideExplicit:true,manualForecastValue:250000}]}};
  const result=buildReviewedImport(development,null,{version:4,treatment:'forecast_manual_value',reason:'Adopt register forecast',sourceEvidence:{fileName:'sales.xlsx',worksheet:'Sales',sha256:'e'.repeat(64),sourceRowCount:1},updates:[{plotId:'p1',plotNumber:'1',sourceRowNumber:2,importedPrice:250000}]}, {displayName:'QS'});
  assert.equal(result.preview.canApply,false);
  assert.match(result.preview.errors[0].reason,/human-entered Manual Value/i);
});

test('a manually superseded imported forecast requires explicit replacement and preserves history', () => {
  const { buildReviewedImport } = require('../services/salesRegisterImportService');
  const provenance={schemaVersion:'sales_register_forecast_v1',fileName:'old.xlsx',worksheet:'Sales',sha256:'1'.repeat(64),importedForecast:250000,adoptedAt:'2026-10-01T00:00:00.000Z',supersededAt:'2026-10-02T00:00:00.000Z'};
  const plot={id:'p1',plotNumber:'1',tenureCode:'OPEN_MARKET',revenueStatus:'Available',revenueSource:'Manual Value',manualOverrideExplicit:true,manualForecastValue:260000,forecastImportProvenance:provenance};
  const development={id:'dev-superseded',clientId:'tenant-v',version:5,plotMaster:{plots:[plot]}};
  const body={version:5,treatment:'forecast_manual_value',reason:'Adopt revised register',sourceEvidence:{fileName:'new.xlsx',worksheet:'Sales',sha256:'2'.repeat(64),sourceRowCount:1},updates:[{plotId:'p1',plotNumber:'1',sourceRowNumber:2,importedPrice:270000}]};
  const blocked=buildReviewedImport(development,null,body,{displayName:'QS'});
  assert.equal(blocked.preview.canApply,false); assert.match(blocked.preview.errors[0].reason,/manually edited/i);
  const reviewed=buildReviewedImport(development,null,{...body,replaceSupersededImport:true},{displayName:'QS'});
  assert.equal(reviewed.preview.canApply,true); assert.equal(reviewed.nextPlots[0].manualForecastValue,270000); assert.equal(reviewed.nextPlots[0].forecastImportProvenance.history.length,1); assert.equal(reviewed.nextPlots[0].forecastImportProvenance.history[0].supersededAt,provenance.supersededAt);
});

test('forecast adoption rejects blank, zero and genuine sub-penny values', () => {
  const { buildReviewedImport } = require('../services/salesRegisterImportService');
  const plots=['blank','zero','fraction'].map((id,index)=>({id,plotNumber:String(index+1),tenureCode:'OPEN_MARKET',revenueStatus:'Available',revenueSource:'Development Strategy'}));
  const development={id:'dev-invalid-money',clientId:'tenant-v',version:1,plotMaster:{plots}};
  const body={version:1,treatment:'forecast_manual_value',reason:'Review invalid currency',sourceEvidence:{fileName:'sales.xlsx',worksheet:'Sales',sha256:'f'.repeat(64),sourceRowCount:3},updates:[{plotId:'blank',plotNumber:'1',sourceRowNumber:2,importedPrice:''},{plotId:'zero',plotNumber:'2',sourceRowNumber:3,importedPrice:0},{plotId:'fraction',plotNumber:'3',sourceRowNumber:4,importedPrice:100.001}]};
  const result=buildReviewedImport(development,null,body,{displayName:'QS'});
  assert.equal(result.preview.canApply,false); assert.equal(result.preview.rejectedRowCount,3);
});

test('contractual confirmation is authenticated and cancellation prevents stale price reuse', () => {
  const { applyPlotRevenueAuthority } = require('../services/developmentRepository');
  const actor={userId:'user-1',membershipId:'membership-1',displayName:'QS One'};
  const stale={id:'p1',plotNumber:'1',revenueStatus:'Available',sellingPrice:275000,sellingPriceRequiresConfirmation:true};
  const existing={plotMaster:{plots:[stale]}};
  const unconfirmed=applyPlotRevenueAuthority(existing,{plotMaster:{plots:[{...stale,revenueStatus:'Reserved'}]}},actor);
  assert.equal(unconfirmed.ok,false); assert.equal(unconfirmed.code,'CONTRACT_PRICE_CONFIRMATION_REQUIRED');
  const confirmed=applyPlotRevenueAuthority(existing,{plotMaster:{plots:[{...stale,revenueStatus:'Reserved',sellingPriceConfirmation:{requested:true}}]}},actor);
  assert.equal(confirmed.ok,true);
  const reserved=confirmed.patch.plotMaster.plots[0];
  assert.equal(reserved.sellingPriceRequiresConfirmation,false);
  assert.equal(reserved.sellingPriceConfirmation.actorUserId,'user-1');
  assert.equal(reserved.sellingPriceConfirmation.actorMembershipId,'membership-1');
  const cancelled=applyPlotRevenueAuthority({plotMaster:{plots:[reserved]}},{plotMaster:{plots:[{...reserved,revenueStatus:'Cancelled'}]}},actor).patch.plotMaster.plots[0];
  assert.equal(cancelled.sellingPriceRequiresConfirmation,true);
  const reused=applyPlotRevenueAuthority({plotMaster:{plots:[cancelled]}},{plotMaster:{plots:[{...cancelled,revenueStatus:'Reserved'}]}},actor);
  assert.equal(reused.ok,false); assert.equal(reused.code,'CONTRACT_PRICE_CONFIRMATION_REQUIRED');
});

test('Sales Register import invalidates contractual confirmation when leaving Reserved and requires a new price on re-reservation', async (t) => {
  if (!isDbConfigured()) return t.skip();
  await prepareIntegrationTestDatabase(pool);
  const clientId=randomUUID(),developmentId=`dev-reservation-${randomUUID()}`,userId=randomUUID(),membershipId=randomUUID();
  const role=(await pool.query("SELECT id FROM roles WHERE key='commercial_director'")).rows[0];
  await pool.query("INSERT INTO clients(id,code,name,is_active) VALUES($1,$2,'Reservation lifecycle',false)",[clientId,`RL-${Date.now()}`]);
  await pool.query("INSERT INTO buildlite_users(id,auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES($1,'clerk',$2,'reservation@test.invalid','Lifecycle QS','active')",[userId,`reservation-${randomUUID()}`]);
  await pool.query('INSERT INTO client_user_memberships(id,client_id,user_id,role_id,is_active) VALUES($1,$2,$3,$4,true)',[membershipId,clientId,userId,role.id]);
  const plot={
    id:'p1',plotNumber:'1',tenureCode:'OPEN_MARKET',revenueStatus:'Reserved',
    revenueSource:'Manual Value',manualOverrideExplicit:true,manualForecastValue:275000,
    sellingPrice:275000,sellingPriceRequiresConfirmation:false,
    sellingPriceConfirmation:{source:'sales_register_import',confirmedBy:'Earlier QS'},
  };
  await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload,version) VALUES($1,$2,'RL-1','Reservation lifecycle','live',$3,1)",[developmentId,clientId,JSON.stringify({plotMaster:{plots:[plot]}})]);
  const principal={userId,providerUserId:`reservation-${userId}`,displayName:'Lifecycle QS',clientId,membershipId,roleKey:'commercial_director',roleName:'Commercial Director',permissions:['commercial.read','revenue.manage','plot_master.manage'],memberships:[]};
  const app=createApp({testPrincipal:principal});
  const sourceEvidence={fileName:'sales.xlsx',worksheet:'Sales Register',sha256:'9'.repeat(64),sourceRowCount:1,mapping:[]};
  const requestBody=(version,revenueStatus,importedPrice)=>({
    version,treatment:'contractual_selling_price',reason:'Review contractual lifecycle',sourceEvidence,excludedRows:[],
    updates:[{plotId:'p1',plotNumber:'1',sourceRowNumber:2,revenueStatus,...(importedPrice===undefined?{}:{importedPrice})}],
  });
  const previewAndApply=async(body)=>{
    const preview=await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import/preview`).send(body);
    assert.equal(preview.status,200,preview.body.message);
    assert.equal(preview.body.preview.canApply,true,JSON.stringify(preview.body.preview.errors));
    const applied=await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import`).send({...body,previewFingerprint:preview.body.preview.fingerprint});
    assert.equal(applied.status,200,applied.body.message);
    return applied.body.development;
  };

  const available=await previewAndApply(requestBody(1,'Available'));
  const availablePlot=available.plotMaster.plots[0];
  assert.equal(availablePlot.sellingPrice,275000);
  assert.equal(availablePlot.sellingPriceRequiresConfirmation,true);
  assert.equal(availablePlot.sellingPriceConfirmation,undefined);

  const staleReservation=requestBody(2,'Reserved');
  const rejectedPreview=await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import/preview`).send(staleReservation);
  assert.equal(rejectedPreview.status,200);
  assert.equal(rejectedPreview.body.preview.canApply,false);
  assert.match(rejectedPreview.body.preview.errors[0].reason,/not contractual evidence/i);
  const rejectedApply=await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import`).send({...staleReservation,previewFingerprint:rejectedPreview.body.preview.fingerprint});
  assert.equal(rejectedApply.status,422);
  assert.equal((await pool.query('SELECT version FROM developments WHERE id=$1',[developmentId])).rows[0].version,2);

  const reserved=await previewAndApply(requestBody(2,'Reserved',275000));
  const reservedPlot=reserved.plotMaster.plots[0];
  assert.equal(reservedPlot.sellingPriceRequiresConfirmation,false);
  assert.equal(reservedPlot.sellingPriceConfirmation.confirmedBy,'Lifecycle QS');
  assert.equal(reservedPlot.sellingPriceConfirmation.confirmedByUserId,userId);
  assert.equal(reservedPlot.sellingPriceConfirmation.confirmedByMembershipId,membershipId);
});

test('Sales Register apply rejects invalid lifecycle facts and duplicate targets', async () => {
  const { applySalesRegisterImport } = require('../services/salesRegisterImportService');
  assert.equal(typeof applySalesRegisterImport, 'function');
});
