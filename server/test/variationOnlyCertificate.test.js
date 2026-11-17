// In-memory repository adapter: exercises confirmation -> submit -> lock with no
// hosted/local database connection, schema changes, or migrations.
const test=require('node:test');const assert=require('node:assert/strict');
const tenant='11111111-1111-4111-8111-111111111111',pkg='22222222-2222-4222-8222-222222222222',cert='33333333-3333-4333-8333-333333333333';
const auth={userId:'qs',membershipId:'membership',providerUserId:'provider',displayName:'QS',permissions:['certificate.edit','certificate.submit','certificate.lock']};
const app={id:'rev2',applicationReference:'Central App 1',revisionNumber:2,applicationBasis:'current_period_gross',currentPeriodGrossClaimed:8500};
let row,assessment,matrix,calls,audits,saved,priorRows;
const stub=(path,exports)=>{const id=require.resolve(path);require.cache[id]={id,filename:id,loaded:true,exports};};
const db={release(){},async query(sql,params=[]){
  calls.push({sql,params});
  const compact=sql.replace(/\s+/g,' ').trim();
  if(compact==='BEGIN'){saved=structuredClone(row);return {rows:[]};}
  if(compact==='ROLLBACK'){row=saved;return {rows:[]};}
  if(compact.includes('SELECT * FROM packages'))return {rows:params[0]===pkg&&params[1]===tenant?[{id:pkg,client_id:tenant,development_id:'dev',order_key:'order'}]:[]};
  if(compact.includes('SELECT * FROM package_payment_certificates'))return {rows:params[0]===tenant&&params[1]===pkg&&(!compact.includes('id = $3')||params[2]===cert)?compact.includes('id = $3')?[row]:[...priorRows,row]:[]};
  if(compact.includes('SELECT * FROM package_order_matrices'))return {rows:matrix?[matrix]:[]};
  if(compact.includes('INSERT INTO package_payment_certificate_audit')){audits.push({action:params[2],comment:params[4]});return {rows:[]};}
  if(compact.startsWith('UPDATE package_payment_certificates')){
    if(compact.includes("status = 'submitted'")){row={...row,status:'submitted',payload:JSON.parse(params[4])};}
    else if(compact.includes("status = 'locked'")){
      row={...row,status:'locked',payload:JSON.parse(params[0])};
      ['gross_value','net_value','matrix_gross','commercial_event_gross','recovery_signed','retention','vat','retention_rate','vat_rate'].forEach((key,i)=>row[key]=params[i+1]);
    }else row={...row,payload:JSON.parse(params[0])};
    row.version++;return {rows:[row]};
  }
  return {rows:[]};
}};
stub('../db',{pool:{connect:async()=>db},query:db.query.bind(db)});
stub('../services/variationAccountCertificateAssessmentRepository',{listAssessments:async()=>[assessment],lockAssessments:async()=>{assessment={...assessment,status:'locked'};}});
stub('../services/variationAccountCertificateAuthority',{loadVariationAssessmentAuthority:async()=>new Map()});
stub('../services/paymentDiscoveredRepository',{listPaymentDiscoveredItems:async()=>[],lockPaymentDiscoveredItems:async()=>{}});
stub('../services/paymentApplicationRepository',{loadActiveApplicationForCertificate:async()=>app,mapRow:async()=>app});
stub('../services/subcontractTermsRepository',{snapshotForPackage:async()=>({})});
stub('../services/paymentCertificateTimetable',{timetableForRead:async()=>null,insertSubmissionSnapshot:async()=>{},copyLatestSubmissionToLocked:async()=>{},hasSubmissionHistory:async()=>false,loadApplication:async()=>({document:app})});
const repo=require('../services/paymentCertificateRepository');
const {buildLiveValuation,buildValuationSnapshot}=require('../services/paymentCertificateFinancials');
const {variationOnlyError}=require('../services/variationOnlyValuation');
const confirmation={orderedWorks:0,confirmedAt:'2026-11-17T00:00:00Z',confirmedBy:auth};
const lines=[{lineType:'valueInclusion',amountThisCertificate:6200}];
test.beforeEach(()=>{
 row={id:cert,client_id:tenant,package_id:pkg,development_id:'dev',order_key:'order',certificate_number:1,status:'draft',certificate_date:'2026-11-01',version:1,payload:{progress:{},commercialLines:[]}};
 assessment={id:'assessment',variationAccountItemId:'va1',variationReference:'VA-0001',applicationVariationLineId:'claim',currentAssessment:6200,previousCertified:0,cumulativeCertified:6200,basis:'Measured completed work',status:'draft'};
 matrix=null;calls=[];audits=[];priorRows=[];
});
test('no implicit zero; authenticated confirmation is durable, versioned, audited and not commercial authority',async()=>{
 let result=await repo.getCertificateForPackage(tenant,pkg,cert);assert.equal(result.certificate.totals,null);
 assert.equal((await repo.submitCertificateForPackage(tenant,pkg,cert,{version:1},{actor:'QS',auth})).status,400);
 result=await repo.patchCertificateForPackage(tenant,pkg,cert,{version:1,zeroOrderedWorksConfirmed:true},{actor:'QS',auth});
 assert.equal(result.ok,true,result.message);assert.equal(row.version,2);assert.equal(row.payload.variationOnlyConfirmation.confirmedBy.userId,'qs');
 assert.equal(result.certificate.totals.grossWorksThisCertificate,6200);assert.equal(result.certificate.totals.matrixGrossThisCertificate,0);
 assert.equal(result.certificate.sourceAuthority.unapprovedCertifiedGross,6200);assert.equal(result.certificate.sourceAuthority.variationAssessmentGross,6200);
 assert.match(audits[0].comment,/zeroOrderedWorksConfirmed/);
 assert.ok(!calls.some(c=>/INSERT INTO (package_order_matrices|commercial_events|variation_orders|purchase_orders)/.test(c.sql)));
});
test('submit and lock preserve 8500 once, 6200 assessed, -2300 difference, confirmation and frozen authority',async()=>{
 await repo.patchCertificateForPackage(tenant,pkg,cert,{version:1,zeroOrderedWorksConfirmed:true},{actor:'QS',auth});
 const submitted=await repo.submitCertificateForPackage(tenant,pkg,cert,{version:2},{actor:'QS',auth});assert.equal(submitted.ok,true,submitted.message);
 assert.equal(row.payload.submissionApplicationSnapshot.comparison.applicationCurrentGross,8500);
 assert.equal(row.payload.submissionApplicationSnapshot.comparison.difference,-2300);
 const locked=await repo.approveCertificateForPackage(tenant,pkg,cert,{version:3},{actor:'QS',auth});assert.equal(locked.ok,true,locked.message);
 const snapshot=structuredClone(row.payload);assert.equal(snapshot.valuationSnapshot.valuationBasis,'variation_only');assert.deepEqual(snapshot.valuationSnapshot.cells,[]);
 assert.equal(snapshot.valuationSnapshot.matrixId,null);assert.equal(snapshot.valuationSnapshot.totals.grossWorksThisCertificate,6200);
 assert.equal(snapshot.sourceAuthoritySnapshot.unapprovedCertifiedGross,6200);assert.equal(row.matrix_gross,0);assert.equal(assessment.status,'locked');
 assessment.currentAssessment=9999;const historic=await repo.getCertificateForPackage(tenant,pkg,cert);
 assert.equal(historic.certificate.grossValue,6200);assert.deepEqual(row.payload,snapshot);
 const rejected=await repo.patchCertificateForPackage(tenant,pkg,cert,{version:4,zeroOrderedWorksConfirmed:false},{actor:'QS',auth});assert.equal(rejected.status,409);
});
test('confirmation cannot be forged, cannot bypass permissions, tenant or version checks',async()=>{
 assert.equal((await repo.patchCertificateForPackage(tenant,pkg,cert,{version:1,variationOnlyConfirmation:confirmation},{auth})).status,400);
 await assert.rejects(repo.patchCertificateForPackage(tenant,pkg,cert,{version:1,zeroOrderedWorksConfirmed:true},{auth:{...auth,permissions:[]}}),{status:403});
 assert.equal((await repo.patchCertificateForPackage('99999999-9999-4999-8999-999999999999',pkg,cert,{version:1,zeroOrderedWorksConfirmed:true},{auth})).status,404);
 assert.equal((await repo.patchCertificateForPackage(tenant,pkg,cert,{version:99,zeroOrderedWorksConfirmed:true},{auth})).status,409);
});
test('progress, existing or failed matrix evidence block the route without changing facts',async()=>{
 row.payload.progress={'plot::stage':0};let result=await repo.patchCertificateForPackage(tenant,pkg,cert,{version:1,zeroOrderedWorksConfirmed:true},{auth});assert.equal(result.status,409);
  result=await repo.patchCertificateForPackage(tenant,pkg,cert,{version:1,progress:{},zeroOrderedWorksConfirmed:true},{auth});assert.equal(result.status,409);
 row.payload.progress={};matrix={id:'matrix',layout:'plot-stage',payload:{plots:[],stages:[]}};result=await repo.patchCertificateForPackage(tenant,pkg,cert,{version:1,zeroOrderedWorksConfirmed:true},{auth});assert.equal(result.status,409);
 assert.equal(row.payload.variationOnlyConfirmation,undefined);
 const original=db.query;db.query=async(sql,params)=>{if(sql.includes('FROM package_order_matrices'))throw new Error('matrix query failed');return original.call(db,sql,params);};
 try{await assert.rejects(repo.patchCertificateForPackage(tenant,pkg,cert,{version:1,zeroOrderedWorksConfirmed:true},{auth}),/matrix query failed/);}finally{db.query=original;}
});
test('previous certification, retention, recovery and VAT reuse the existing financial engine',()=>{
 const prior=[{status:'locked',matrixGross:0,grossValue:1000,retention:50,retentionRate:.05,valuationSnapshot:{valuationBasis:'variation_only',cells:[]}}];
 const result=buildLiveValuation({matrix:null,variationOnlyConfirmation:confirmation,lockedCertificates:prior,commercialLines:[...lines,{lineType:'recoveryDeduction',amountThisCertificate:-100}]});
 assert.equal(result.ok,true);assert.equal(result.totals.previousCertified,1000);assert.equal(result.totals.certifiedToDate,7200);assert.equal(result.totals.retention,310);assert.equal(result.totals.vat,1178);assert.equal(result.totals.netPayment,6968);
 assert.match(variationOnlyError({confirmation,lockedCertificates:[{matrixGross:500}]}),/Previous ordered-work/);
 assert.match(variationOnlyError({confirmation,lockedCertificates:[{grossValue:1000}]}),/unavailable/);
 assert.equal(buildValuationSnapshot({matrix:null,commercialLines:lines}).ok,false);
});
test('variation-only signed credits and zero-rate packages preserve financial conventions',()=>{
 const prior=[{status:'locked',matrixGross:0,grossValue:1000,retention:50,retentionRate:.05,valuationSnapshot:{valuationBasis:'variation_only',cells:[]}}];
 const credit=buildLiveValuation({matrix:null,variationOnlyConfirmation:confirmation,lockedCertificates:prior,commercialLines:[{lineType:'valueInclusion',amountThisCertificate:-500}]});
 assert.equal(credit.ok,true);assert.equal(credit.totals.retention,-25);assert.equal(credit.totals.vat,-95);assert.equal(credit.totals.netPayment,-570);assert.equal(credit.totals.certifiedToDate,500);
 const zeroRated=buildLiveValuation({matrix:null,variationOnlyConfirmation:confirmation,commercialLines:lines,pos:[{totals:{vatRate:0,retentionRate:0}}]});
 assert.equal(zeroRated.totals.retention,0);assert.equal(zeroRated.totals.vat,0);assert.equal(zeroRated.totals.netPayment,6200);
});
test('production locked-row mapping rejects authoritative non-zero matrix gross even with an empty variation-only snapshot',async()=>{
 row.certificate_number=2;
 priorRows=[{...structuredClone(row),id:'prior',certificate_number:1,status:'locked',matrix_gross:'500.00',gross_value:'1000.00',payload:{progress:{},commercialLines:[],valuationSnapshot:{valuationBasis:'variation_only',cells:[]}}}];
 const result=await repo.patchCertificateForPackage(tenant,pkg,cert,{version:1,zeroOrderedWorksConfirmed:true},{auth});
 assert.equal(result.status,409);assert.match(result.message,/Previous ordered-work certification prevents/);
 assert.equal(row.payload.variationOnlyConfirmation,undefined);
 // The same real mapping is used by submission and approval, including a
 // certificate whose confirmation was recorded before conflicting history.
 row.payload.variationOnlyConfirmation=confirmation;
 const live=await repo.getCertificateForPackage(tenant,pkg,cert);
 assert.equal(live.certificate.totals,null);assert.match(live.certificate.valuationUnavailableReason,/Previous ordered-work certification prevents/);
 const submitted=await repo.submitCertificateForPackage(tenant,pkg,cert,{version:1},{auth});
 assert.equal(submitted.status,409);assert.match(submitted.message,/Previous ordered-work certification prevents/);
 row.status='submitted';
 const locked=await repo.approveCertificateForPackage(tenant,pkg,cert,{version:1},{auth});
 assert.equal(locked.status,409);assert.match(locked.message,/Previous ordered-work certification prevents/);
 assert.equal(row.status,'submitted');
});
for(const matrixGross of [null,undefined])test(`production locked-row mapping keeps ${matrixGross} historical matrix gross unavailable`,async()=>{
 row.certificate_number=2;
 priorRows=[{...structuredClone(row),id:'prior',certificate_number:1,status:'locked',matrix_gross:matrixGross,gross_value:1000,payload:{progress:{},commercialLines:[]}}];
 const result=await repo.patchCertificateForPackage(tenant,pkg,cert,{version:1,zeroOrderedWorksConfirmed:true},{auth});
 assert.equal(result.status,409);assert.match(result.message,/evidence is unavailable/);
 assert.equal(row.payload.variationOnlyConfirmation,undefined);
});
