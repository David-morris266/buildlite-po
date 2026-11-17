const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildValuationSchedule} = require('../services/paymentCertificateValuationSchedule');
const {hashCanonicalJson,CANONICAL_JSON_SHA256_V1} = require('../services/canonicalJsonIntegrity');
const {renderCommercialDocumentHtml,renderCommercialDocumentPdf} = require('../services/commercialDocumentRenderer');
// No database connection, migrations or hosted access: the production builder receives a SELECT-only adapter.
require.cache[require.resolve('../services/brandProfile')] = {exports:{getBrandContextForClient:async()=>({company:'Frozen Schedule Test',color:'#123456',logo:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='})}};
const {buildPaymentCertificateRenderPayload} = require('../services/paymentCertificateDocumentPayload');
const va = (amount=6200,previous=0,id='va1') => ({id:`assessment-${id}`,variationAccountItemId:id,variationReference:'VA-0001',description:'Additional hot water circulation pipework',signedAmount:amount,previousCertified:previous,cumulativeCertified:previous+amount,priorAuthority:0,authorityClassification:{supportingSources:[]}});
const cell = (amount=100,previous=0) => ({plotKey:'plot1',plotLabel:'Plot 1',stageKey:'firstFix',stageLabel:'First fix',previousValue:previous,thisCertificateValue:amount,certifiedToDateValue:previous+amount});
function certificate({amount=6200,number=1,items=[va()],cells=[],lines=[]}={}) {
  return {id:`cert${number}`,status:'locked',certificate_number:number,version:4,development_id:'dev',gross_value:amount,retention:310,recovery_signed:0,vat:0,net_value:5890,
    payload:{valuationSnapshot:{cells,...(!cells.length?{valuationBasis:'variation_only',variationOnlyConfirmation:{orderedWorks:0}}:{})},commercialLines:lines,
      sourceAuthoritySnapshot:{evidence:{variationAssessments:items,paymentDiscoveredItems:[],issuedVoLines:[]}},
      lockedApplicationSnapshot:{application:{applicationReference:'Central App 1',currentPeriodGrossClaimed:8500},comparison:{comparable:true}}}};
}
const commercial = (amount=200) => ({id:'commercial1',sourceType:'variationOrder',variationOrderLineId:'voLine',sourceReference:'VO-0001',description:'Extra depth',amountThisCertificate:amount,lineType:'valueInclusion'});
function decision(cert) {
  const snapshot={certificateId:cert.id,lines:[{assessmentId:'assessment-va1',exceptionalAuthorityDecision:'approve',exceptionalAuthorityReason:'Approved exceptional pipework',supports:[]}]};
  return {id:'pa1',decision_kind:'authority',source_snapshot:snapshot,source_snapshot_sha256:hashCanonicalJson(snapshot),source_snapshot_hash_scheme:CANONICAL_JSON_SHA256_V1,
    decision_lines:[{decision_id:'pa1',assessment_id:'assessment-va1',signed_new_commercial_authority:6200}]};
}
function adapter(cert,prior=[],decisions=[]) {
  const calls=[];
  return {calls,query:async(sql,params)=>{
    calls.push({sql,params}); assert.match(sql,/^SELECT /); assert.equal(params[0],'tenant');
    if(sql.includes('FROM package_payment_certificates')) return {rows:sql.includes('certificate_number<$3')?prior:[cert]};
    if(sql.includes('FROM packages')) return {rows:[{id:'pkg',development_id:'dev',supplier_id:'supplier',cost_code:'client-code'}]};
    if(sql.includes('FROM developments')) return {rows:[{id:'dev',development_name:'Welford Road'}]};
    if(sql.includes('FROM suppliers')) return {rows:[{name:'Central Plumbing & Heating Ltd'}]};
    if(sql.includes('FROM payment_authority_decisions')) return {rows:decisions};
    if(sql.includes('FROM payment_authority_decision_lines')) return {rows:decisions.flatMap(d=>d.decision_lines)};
    if(sql.includes('package_purchase_orders')||sql.includes('deadline_snapshots')) return {rows:[]};
    throw Error(`Unexpected query: ${sql}`);
  }};
}
test('variation-only production payload: exact Welford values, frozen description and exceptional authority, one application',async()=>{
  const cert=certificate(),db=adapter(cert,[],[decision(cert)]),before=JSON.stringify(cert);
  const result=await buildPaymentCertificateRenderPayload(db,{id:'tenant'},'pkg',cert.id);
  assert.equal(result.ok,true); const p=result.renderPayload,s=p.valuation.schedule;
  assert.deepEqual(s.totals,{previousCertified:0,thisCertificate:6200,certifiedToDate:6200});
  assert.equal(s.rows.length,1); assert.equal(s.rows[0].description,va().description);
  assert.match(s.rows[0].authority,/Exceptional Payment Authority granted at approval/);
  assert.match(s.rows[0].authority,/without prior formal authority at lock/);
  assert.doesNotMatch(s.rows[0].authority,/issued VO/);
  assert.equal(p.application.amountApplied,8500); assert.equal(p.application.difference,-2300);
  assert.equal(p.financials.retention,310); assert.equal(p.financials.netPayment,5890);
  assert.equal(JSON.stringify(cert),before);
  assert.ok(db.calls.every(c=>!c.sql.includes('FROM package_variation_account')&&!c.sql.includes('FROM variation_orders')));
  for(const type of ['payment_certificate','combined_certificate_payment_notice']){
    const html=renderCommercialDocumentHtml(type,type==='payment_certificate'?p:{certificate:p,presentation:p.presentation,notice:{}});
    assert.match(html,/VA-0001/); assert.match(html,/6,200\.00/); assert.match(html,/5,890\.00/);
    assert.match(html,/Total gross/); assert.match(html,/data:image\/png;base64/); assert.match(html,/Explicitly confirmed at zero/);
  }
});
test('ordered-only and mixed schedules retain plot/stage detail, supporting VO is not counted twice',()=>{
  const ordered=buildValuationSchedule(certificate({amount:100,items:[],cells:[cell()]}));
  assert.equal(ordered.rows[0].reference,'Plot 1'); assert.equal(ordered.rows[0].description,'First fix');
  const cert=certificate({amount:6500,cells:[cell()],lines:[commercial()]});
  cert.payload.sourceAuthoritySnapshot.evidence.variationAssessments[0].authorityClassification.supportingSources=[{sourceType:'variation_order_line',sourceReference:'VO-SUPPORT',appliedAmount:6200}];
  cert.payload.sourceAuthoritySnapshot.evidence.issuedVoLines=[{lineId:'commercial1',authorityStatus:'issued'}];
  const mixed=buildValuationSchedule(cert);
  assert.equal(mixed.rows.length,3); assert.equal(mixed.totals.thisCertificate,6500);
  assert.match(mixed.rows[2].authority,/VO-SUPPORT/); assert.match(mixed.rows[1].authority,/Formal issued VO/);
});
test('signed pence, omissions, previous and cumulative; prior inactive VA remains visible',()=>{
  const prior=certificate({amount:0.3,items:[va(0.1,0,'va1'),va(0.2,0,'va2')]});
  const current=certificate({number:2,amount:-0.05,items:[va(-0.05,0.1)]});
  const s=buildValuationSchedule(current,[prior]);
  assert.deepEqual(s.totals,{previousCertified:0.3,thisCertificate:-0.05,certifiedToDate:0.25});
  assert.equal(s.rows[0].certifiedToDate,0.05); assert.equal(s.rows[1].thisCertificate,0);
});
test('direct commercial history and recoveries do not double count gross',()=>{
  const prior=certificate({amount:200,items:[],lines:[commercial()]});
  const cert=certificate({number:2,amount:-20,items:[],lines:[commercial(-20),{lineType:'recoveryDeduction',amountThisCertificate:-50}]});
  assert.deepEqual(buildValuationSchedule(cert,[prior]).totals,{previousCertified:200,thisCertificate:-20,certifiedToDate:180});
});
test('incomplete detail falls back explicitly; genuine mismatches and duplicate sources remain rejected',()=>{
  for(const mutate of [c=>{delete c.payload.sourceAuthoritySnapshot;},c=>{c.payload.sourceAuthoritySnapshot.evidence.variationAssessments[0].description=null;},c=>{c.payload.sourceAuthoritySnapshot.evidence.variationAssessments[0].previousCertified=null;},c=>{delete c.payload.valuationSnapshot.variationOnlyConfirmation;}]){
    const c=certificate();mutate(c);const s=buildValuationSchedule(c);assert.equal(s.available,false);assert.match(s.message,/Detailed valuation schedule unavailable: incomplete historical frozen evidence\./);assert.deepEqual(s.rows,[]);assert.equal(s.totals.thisCertificate,6200);
  }
  for(const mutate of [c=>{c.gross_value=6200.01;},c=>{c.payload.sourceAuthoritySnapshot.evidence.variationAssessments.push(va());}]){const c=certificate();mutate(c);assert.throws(()=>buildValuationSchedule(c),/Frozen valuation detail unavailable/);}
});
test('independent matrix rounding is preserved and explicitly bridged to locked gross through three certificates',async()=>{
  const {calculateCertificateCellValues}=require('../services/paymentCertificateCalculations');
  const make=(number,previousCumulativePct,thisCertificatePct)=>{
    const frozen={...cell(),contractValue:1000.05,...calculateCertificateCellValues({contractValue:1000.05,previousCumulativePct,thisCertificatePct})};
    return certificate({number,amount:frozen.thisCertificateValue,items:[],cells:[frozen]});
  };
  const first=make(1,0,33.33),second=make(2,33.33,33.33),third=make(3,66.66,33.34);
  const before=JSON.stringify([first,second,third]);
  const s=buildValuationSchedule(second,[first]);
  assert.equal(s.rows[0].previousCertified,333.32);assert.equal(s.rows[0].thisCertificate,333.32);assert.equal(s.rows[0].certifiedToDate,666.63);
  assert.equal(s.rows[1].kind,'Matrix rounding reconciliation');assert.equal(s.rows[1].certifiedToDate,0.01);
  assert.equal(Object.is(s.rows[1].previousCertified,-0),false);
  assert.deepEqual(s.totals,{previousCertified:333.32,thisCertificate:333.32,certifiedToDate:666.64});
  const t=buildValuationSchedule(third,[first,second]);assert.equal(t.rows[0].previousCertified,666.63);assert.equal(t.rows[1].previousCertified,0.01);
  for(const schedule of [s,t]) for(const field of ['previousCertified','thisCertificate','certifiedToDate'])assert.equal(schedule.rows.reduce((sum,row)=>sum+Math.round(row[field]*100),0),Math.round(schedule.totals[field]*100));
  const p=(await buildPaymentCertificateRenderPayload(adapter(second,[first]),{id:'tenant'},'pkg',second.id)).renderPayload;
  for(const type of ['payment_certificate','combined_certificate_payment_notice']){
    const html=renderCommercialDocumentHtml(type,type==='payment_certificate'?p:{certificate:p,presentation:p.presentation,notice:{}});
    assert.match(html,/1,000\.05/);assert.match(html,/666\.63/);assert.match(html,/Matrix rounding reconciliation/);assert.match(html,/666\.64/);
    assert.doesNotMatch(html,/-\u00a30\.00/);
  }
  assert.equal(JSON.stringify([first,second,third]),before);
  // Even an additive value is invalid when frozen engine inputs prove otherwise.
  for(const amount of [666.64,666.65,667]){const wrong=structuredClone(second);wrong.payload.valuationSnapshot.cells[0].certifiedToDateValue=amount;assert.throws(()=>buildValuationSchedule(wrong,[first]),/frozen engine rounding convention/);}
  const wrongGross=structuredClone(second);wrongGross.gross_value=333.33;
  assert.throws(()=>buildValuationSchedule(wrongGross,[first]),/does not reconcile to frozen gross/);
});
test('legacy financial summaries survive and do not block a later independently frozen schedule',async()=>{
  // Genuine pre-source-snapshot shape, including the historical fixture's unmatched prior detail.
  const legacy=certificate({amount:1200,items:[],cells:[{plotLabel:'Plot 1',stageLabel:'Foundations',contractValue:2000,previousValue:500,thisCertificateValue:1000,certifiedToDateValue:1500}],lines:[{sourceType:'variationOrder',variationOrderReference:'VO-1',description:'Extra depth',amountThisCertificate:200}]});
  delete legacy.payload.sourceAuthoritySnapshot;
  const fallback=await buildPaymentCertificateRenderPayload(adapter(legacy),{id:'tenant'},'pkg',legacy.id);
  assert.equal(fallback.ok,true);assert.equal(fallback.renderPayload.financials.grossThisCertificate,1200);
  const html=renderCommercialDocumentHtml('payment_certificate',fallback.renderPayload);
  assert.match(html,/Detailed valuation schedule unavailable: incomplete historical frozen evidence\./);
  assert.doesNotMatch(html,/class="valuation-schedule"/);assert.match(html,/1,200\.00/);
  const later=certificate({number:2});const result=await buildPaymentCertificateRenderPayload(adapter(later,[legacy]),{id:'tenant'},'pkg',later.id);
  assert.equal(result.ok,true);const s=result.renderPayload.valuation.schedule;
  assert.equal(s.available,true);assert.equal(s.historyIncomplete,true);assert.equal(s.rows[0].thisCertificate,6200);
  assert.equal(s.zeroOrderedHistoryKnown,false);
  assert.equal(s.totals.previousCertified,1200);assert.equal(s.totals.certifiedToDate,7400);
  assert.match(renderCommercialDocumentHtml('payment_certificate',result.renderPayload),/VA-0001/);
  const direct=certificate({number:2,amount:200,items:[],lines:[commercial()]});
  const d=buildValuationSchedule(direct,[legacy]);assert.equal(d.rows[0].previousCertified,null);assert.equal(d.rows[0].certifiedToDate,null);
  const zero=certificate({amount:100,items:[],cells:[cell(),{...cell(0),plotKey:'empty',plotLabel:'Empty plot'}]});
  assert.equal(buildValuationSchedule(zero).rows.length,1);
  const unexplained=certificate({amount:100,items:[],cells:[cell(100,100)]});
  const untrusted=buildValuationSchedule(later,[unexplained]);
  assert.equal(untrusted.historyIncomplete,true);assert.ok(!untrusted.rows.some(row=>row.kind==='Matrix rounding reconciliation'));
});
test('inconsistent earlier certificates block generation rather than downgrade to incomplete history',async()=>{
  const later=certificate({number:2});
  const mismatch=certificate();mismatch.gross_value=6200.01;
  assert.throws(()=>buildValuationSchedule(later,[mismatch]),/does not reconcile to frozen gross/);
  const {calculateCertificateCellValues}=require('../services/paymentCertificateCalculations');
  const frozen={...cell(),contractValue:1000.05,...calculateCertificateCellValues({contractValue:1000.05,previousCumulativePct:0,thisCertificatePct:33.33})};
  frozen.certifiedToDateValue+=0.01;
  const corrupt=certificate({amount:frozen.thisCertificateValue,items:[],cells:[frozen]});
  assert.throws(()=>buildValuationSchedule(later,[corrupt]),/frozen engine rounding convention/);
  const result=await buildPaymentCertificateRenderPayload(adapter(later,[mismatch]),{id:'tenant'},'pkg',later.id);
  assert.equal(result.status,409);assert.match(result.message,/does not reconcile to frozen gross/);
});
test('approval snapshot integrity and decision lines are required; support alone does not imply exceptional grant',()=>{
  const c=certificate(),d=decision(c);d.source_snapshot.lines[0].exceptionalAuthorityReason='tampered';
  assert.throws(()=>buildValuationSchedule(c,[],[d]),/integrity/);
  const support=decision(c);support.decision_lines[0].signed_new_commercial_authority=0;
  assert.doesNotMatch(buildValuationSchedule(c,[],[support]).rows[0].authority,/Exceptional Payment Authority/);
  const missing=decision(c);missing.decision_lines=[];
  assert.throws(()=>buildValuationSchedule(c,[],[missing]),/decision line is missing/);
});
test('production payload refuses Draft but preserves complete financial summary when detail is unavailable',async()=>{
  const c=certificate();c.status='Draft';assert.equal((await buildPaymentCertificateRenderPayload(adapter(c),{id:'tenant'},'pkg',c.id)).status,409);
  c.status='locked';delete c.payload.sourceAuthoritySnapshot;
  const fallback=await buildPaymentCertificateRenderPayload(adapter(c),{id:'tenant'},'pkg',c.id);
  assert.equal(fallback.ok,true);assert.equal(fallback.renderPayload.valuation.schedule.available,false);assert.equal(fallback.renderPayload.financials.grossThisCertificate,6200);
  c.net_value=null;assert.match((await buildPaymentCertificateRenderPayload(adapter(c),{id:'tenant'},'pkg',c.id)).message,/Locked financial summary is incomplete/);c.net_value=5890;
  // A standalone notice renders its own frozen notice amounts, without a valuation table.
  assert.equal((await buildPaymentCertificateRenderPayload(adapter(c),{id:'tenant'},'pkg',c.id,{includeValuationSchedule:false})).ok,true);
});
test('long schedules render paginated branded PDF with shared table headers',async()=>{
  const items=Array.from({length:90},(_,i)=>({...va(1,0,`va${i}`),variationReference:`VA-${i}`,description:`Frozen valuation ${i} with a long description for pagination`}));
  const c=certificate({amount:90,items}),p=(await buildPaymentCertificateRenderPayload(adapter(c),{id:'tenant'},'pkg',c.id)).renderPayload;
  const pdf=await renderCommercialDocumentPdf('payment_certificate',p);
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  assert.ok((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length>1);
  const combined=await renderCommercialDocumentPdf('combined_certificate_payment_notice',{certificate:p,presentation:p.presentation,notice:{}});
  assert.ok((combined.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length>1);
});
test('combined production payload shares the reconciled certificate schedule; standalone historic notice stays available',async()=>{
  const {buildNoticeDocumentRenderPayload}=require('../services/paymentNoticeDocumentPayload');
  const cert=certificate(),base=adapter(cert),db={query:async(sql,params)=>sql.includes('FROM package_payment_notices')?{rows:[{
    id:'snapshot',notice_id:'notice',notice_reference:'PN-1',notice_mode:'certificate_as_payment_notice',notified_sum:5890,
    assessed_gross:6200,retention:310,recoveries:0,vat:0,assessed_net:5890,
  }]}:base.query(sql,params)};
  const result=await buildNoticeDocumentRenderPayload(db,{id:'tenant'},'pkg',cert.id,'combined_certificate_payment_notice');
  assert.equal(result.ok,true);assert.equal(result.renderPayload.certificate.valuation.schedule.totals.thisCertificate,6200);
  assert.match(renderCommercialDocumentHtml('combined_certificate_payment_notice',result.renderPayload),/VA-0001/);
  delete cert.payload.sourceAuthoritySnapshot;
  assert.equal((await buildNoticeDocumentRenderPayload(db,{id:'tenant'},'pkg',cert.id,'payment_notice')).ok,true);
  const legacy=await buildNoticeDocumentRenderPayload(db,{id:'tenant'},'pkg',cert.id,'combined_certificate_payment_notice');
  assert.equal(legacy.ok,true);assert.match(renderCommercialDocumentHtml('combined_certificate_payment_notice',legacy.renderPayload),/Detailed valuation schedule unavailable: incomplete historical frozen evidence\./);
});
test('production document repository preserves permissions, generated audit and existing issued binary',async()=>{
  const cert=certificate(),reads=adapter(cert),issuedBinary=Buffer.from('%PDF-1.4 original issued document');
  const calls=[];let issued=false,stored;
  const query=async(sql,params=[])=>{
    calls.push(sql);
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
    if(sql.includes('FROM commercial_documents'))return {rows:params[0]==='tenant'&&issued?[{id:'issued',status:'issued',binary_data:issuedBinary,mime_type:'application/pdf'}]:[]};
    if(sql.includes('INSERT INTO commercial_documents')){
      stored={render_payload:JSON.parse(params[11]),binary_data:params[14]};
      return {rows:[{id:'generated',status:'generated',version:1}]};
    }
    if(sql.includes('INSERT INTO commercial_document_audit'))return {rows:[]};
    return reads.query(sql,params);
  };
  const stub=(path,exports)=>{const id=require.resolve(path);require.cache[id]={id,filename:id,loaded:true,exports};};
  stub('../db',{query,pool:{query,connect:async()=>({query,release(){}})}});
  stub('../services/paymentNoticeDocumentPayload',{getDocumentEligibility:async()=>({ok:true}),buildNoticeDocumentRenderPayload:async()=>{throw Error('not used');}});
  const repo=require('../services/commercialDocumentRepository');
  await assert.rejects(()=>repo.generatePaymentCertificate({id:'tenant'},'pkg',cert.id,{}, {auth:{userId:'qs',permissions:[]}}),/Permission required/);
  assert.equal(calls.length,0);
  const auth={userId:'qs',permissions:['document.generate','document.view']};
  const result=await repo.generatePaymentCertificate({id:'tenant'},'pkg',cert.id,{actor:'QS'},{auth,render:async()=>Buffer.from('%PDF-1.4 new schedule')});
  assert.equal(result.ok,true);assert.equal(stored.render_payload.valuation.schedule.totals.thisCertificate,6200);
  assert.ok(calls.some(sql=>sql.includes('INSERT INTO commercial_document_audit')));
  issued=true;calls.length=0;
  const old=await repo.getBinary('tenant','issued',{auth});assert.deepEqual(old.binary,issuedBinary);
  assert.equal(calls.length,1);assert.ok(calls[0].startsWith('SELECT'));
  assert.equal((await repo.getBinary('other-tenant','issued',{auth})).status,404);
  const blocked=await repo.generatePaymentCertificate({id:'tenant'},'pkg',cert.id,{}, {auth,render:async()=>Buffer.from('%PDF-1.4 unused')});
  assert.equal(blocked.status,409);assert.match(blocked.message,/Issued Payment Certificate document already exists/);
  assert.ok(!calls.some(sql=>sql.startsWith('UPDATE')||sql.startsWith('DELETE')||sql.includes('INSERT INTO commercial_documents')));
});
