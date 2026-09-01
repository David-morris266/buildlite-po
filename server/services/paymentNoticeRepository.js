const { pool, query } = require('../db');
const { noticeReadiness } = require('./paymentRulesV2');
const { dateOnly } = require('./paymentCertificateTimetable');

const money = value => { if(value==null||value==='')return null;const n=Number(value); return Number.isFinite(n)?Math.round(n*100)/100:null; };
const actor = body => body?.actor || body?.updatedBy || body?.createdBy || null;
const fail=(status,message)=>({ok:false,status,message});

async function authority(db,clientId,packageId,certificateId,{lock=false}={}) {
  const {rows}=await db.query(`SELECT c.*,p.development_id FROM package_payment_certificates c
    JOIN packages p ON p.id=c.package_id AND p.client_id=c.client_id
    WHERE c.client_id=$1 AND c.package_id=$2 AND c.id=$3 ${lock?'FOR UPDATE OF c':''}`,[clientId,packageId,certificateId]);
  const certificate=rows[0]; if(!certificate)return null;
  const deadline=(await db.query(`SELECT * FROM package_payment_certificate_deadline_snapshots
    WHERE client_id=$1 AND certificate_id=$2 AND stage='locked' ORDER BY captured_at DESC LIMIT 1`,[clientId,certificateId])).rows[0]||null;
  // Notice authority is frozen certificate authority. Current package/default terms must never
  // retrospectively reclassify a historic Locked certificate.
  const terms=deadline?.governing_terms_snapshot||{state:'not_captured',readiness:'unavailable',rulesSchemaVersion:null,paymentRules:null};
  return {certificate,deadline,terms,noticeReadiness:noticeReadiness(terms)};
}

function mapNotice(row,snapshots=[],audit=[]) { return row&&{
  id:row.id,certificateId:row.certificate_id,packageId:row.package_id,developmentId:row.development_id,
  type:row.notice_type,reference:row.notice_reference,status:row.status,version:Number(row.version),
  sourceNoticeId:row.source_notice_id||null,supersedesNoticeId:row.supersedes_notice_id||null,
  draft:row.draft_data||{},createdAt:row.created_at,updatedAt:row.updated_at,
  preparedSnapshot:snapshots.find(x=>x.stage==='prepared')||null,issuedSnapshot:snapshots.find(x=>x.stage==='issued')||null,
  audit:audit.map(x=>({action:x.action,actor:x.actor,detail:x.detail,at:x.created_at})),
}; }
function mapSnapshot(r){return r&&{id:r.id,stage:r.stage,attemptNumber:Number(r.attempt_number),reference:r.notice_reference,
  noticeMode:r.notice_mode,notifiedSum:money(r.notified_sum),intendedPayment:money(r.intended_payment),reduction:money(r.reduction),
  assessedGross:money(r.assessed_gross),retention:money(r.retention),recoveries:money(r.recoveries),vat:money(r.vat),assessedNet:money(r.assessed_net),
  paymentNoticeDeadline:dateOnly(r.payment_notice_deadline),payLessDeadline:dateOnly(r.pay_less_deadline),basisOfCalculation:r.basis_of_calculation,
  termsSnapshot:r.terms_snapshot,rulesSnapshot:r.rules_snapshot,timetableSnapshot:r.timetable_snapshot,applicationSnapshot:r.application_snapshot,
  intendedPaymentDecisionId:r.intended_payment_decision_id,capturedAt:r.captured_at,actor:r.actor};}
async function hydrate(db,clientId,row){
  const snaps=(await db.query(`SELECT * FROM package_payment_notice_snapshots WHERE client_id=$1 AND notice_id=$2 ORDER BY captured_at DESC`,[clientId,row.id])).rows.map(mapSnapshot);
  const audit=(await db.query(`SELECT * FROM package_payment_notice_audit WHERE client_id=$1 AND notice_id=$2 ORDER BY created_at`,[clientId,row.id])).rows;
  return mapNotice(row,snaps,audit);
}
async function audit(db,clientId,noticeId,action,body,detail={}){await db.query(`INSERT INTO package_payment_notice_audit(client_id,notice_id,action,actor,detail) VALUES($1,$2,$3,$4,$5)`,[clientId,noticeId,action,actor(body),JSON.stringify(detail)]);}

async function getWorkspace(clientId,packageId,certificateId,dbArg=null,asOfDate=null){
  const db=dbArg||{query}; const auth=await authority(db,clientId,packageId,certificateId); if(!auth)return fail(404,'Certificate not found.');
  const rows=(await db.query(`SELECT * FROM package_payment_notices WHERE client_id=$1 AND package_id=$2 AND certificate_id=$3 ORDER BY created_at`,[clientId,packageId,certificateId])).rows;
  const notices=[];for(const row of rows)notices.push(await hydrate(db,clientId,row));
  const decisions=(await db.query(`SELECT * FROM package_intended_payment_decisions WHERE client_id=$1 AND package_id=$2 AND certificate_id=$3 ORDER BY decision_version DESC`,[clientId,packageId,certificateId])).rows.map(r=>({id:r.id,version:Number(r.decision_version),state:r.state,intendedAmount:money(r.intended_amount),source:r.source,basis:r.basis,actor:r.actor,createdAt:r.created_at,confirmedAt:r.confirmed_at}));
  const issuedPayment=notices.filter(n=>n.type==='payment_notice'&&n.status==='issued').at(-1)||null;
  const preparedPayment=notices.filter(n=>n.type==='payment_notice'&&n.status==='prepared').at(-1)||null;
  const applicableSnapshot=issuedPayment?.issuedSnapshot||preparedPayment?.preparedSnapshot||null;
  const applicable=applicableSnapshot?.notifiedSum;
  const confirmed=decisions.find(d=>d.state==='confirmed')||null;
  const reduction=applicable==null||!confirmed?null:money(applicable-confirmed.intendedAmount);
  let payLessState=auth.noticeReadiness.state==='ready'?'no_notified_sum':'configuration_unavailable';
  if(applicable!=null)payLessState=confirmed?(reduction>0?'review_required':'no_pay_less_indicated'):'no_intended_payment';
  const pl=notices.filter(n=>n.type==='pay_less_notice').at(-1); if(pl?.status==='prepared')payLessState='draft_prepared';if(pl?.status==='issued')payLessState='issued';
  const deadline=dateOnly(applicableSnapshot?.payLessDeadline||auth.deadline?.pay_less_notice_deadline||null);
  if(deadline&&asOfDate&&asOfDate>deadline&&payLessState==='review_required')payLessState='deadline_passed';
  return {ok:true,certificate:{id:auth.certificate.id,status:auth.certificate.status,number:auth.certificate.certificate_number,net:money(auth.certificate.net_value)},noticeConfiguration:auth.noticeReadiness,
    notices,decisions,payLess:{state:payLessState,notifiedSum:applicable??null,intendedPayment:confirmed?.intendedAmount??null,reduction,deadline},asOfDate:asOfDate||null};
}

async function createPaymentNotice(clientId,packageId,certificateId,body={}){
  const db=await pool.connect();try{await db.query('BEGIN');const auth=await authority(db,clientId,packageId,certificateId,{lock:true});
    if(!auth){await db.query('ROLLBACK');return fail(404,'Certificate not found.');} if(auth.certificate.status!=='locked'){await db.query('ROLLBACK');return fail(409,'Payment Notice authority requires a Locked certificate.');}
    if(auth.noticeReadiness.state!=='ready'||auth.noticeReadiness.mode==='certificate_only'){await db.query('ROLLBACK');return fail(409,'Payment Notice configuration is unavailable or certificate-only.');}
    const existing=(await db.query(`SELECT id,status FROM package_payment_notices WHERE client_id=$1 AND certificate_id=$2 AND notice_type='payment_notice' AND status NOT IN('superseded','voided')`,[clientId,certificateId])).rows[0];
    const supersedesId=body.supersedesNoticeId||null;
    if(existing&&(!supersedesId||existing.id!==supersedesId||existing.status!=='issued')){await db.query('ROLLBACK');return fail(409,'An active Payment Notice already exists. An Issued correction must explicitly supersede it.');}
    const ref=String(body.reference||`PN-${auth.certificate.certificate_number}`).trim();
    const suggested=money(auth.certificate.net_value);const row=(await db.query(`INSERT INTO package_payment_notices(client_id,development_id,package_id,certificate_id,notice_type,notice_reference,supersedes_notice_id,draft_data,created_by,updated_by)
      VALUES($1,$2,$3,$4,'payment_notice',$5,$6,$7,$8,$8) RETURNING *`,[clientId,auth.certificate.development_id,packageId,certificateId,ref,supersedesId,JSON.stringify({notifiedSum:body.notifiedSum??suggested,notifiedSumConfirmed:false,basisOfCalculation:body.basisOfCalculation||''}),actor(body)])).rows[0];
    await audit(db,clientId,row.id,'created',body,{suggestedNotifiedSum:suggested});await db.query('COMMIT');return {ok:true,notice:await hydrate({query:db.query.bind(db)},clientId,row)};
  }catch(e){await db.query('ROLLBACK');if(e.code==='23505')return fail(409,'Notice reference already exists.');throw e;}finally{db.release();}}

async function patchDraft(clientId,noticeId,body={}){const current=(await query(`SELECT * FROM package_payment_notices WHERE client_id=$1 AND id=$2`,[clientId,noticeId])).rows[0];if(!current)return fail(404,'Notice not found.');
  const basis=String(body.basisOfCalculation||'').trim();let draft;
  if(current.notice_type==='pay_less_notice'){
    if(!basis)return fail(400,'An explicit Pay Less basis of calculation is required.');
    draft={...(current.draft_data||{}),basisOfCalculation:basis,basisConfirmed:true};
  }else{
    const amount=money(body.notifiedSum);if(amount==null)return fail(400,'notifiedSum must be a signed amount to pence.');
    draft={notifiedSum:amount,notifiedSumConfirmed:body.notifiedSumConfirmed===true,basisOfCalculation:basis,basisConfirmed:!!basis};
  }
  const {rows}=await query(`UPDATE package_payment_notices SET draft_data=$3,status='draft',version=version+1,updated_by=$4,updated_at=NOW()
    WHERE client_id=$1 AND id=$2 AND status IN('draft','prepared') AND version=$5 RETURNING *`,[clientId,noticeId,JSON.stringify(draft),actor(body),Number(body.version)]);
  if(!rows[0])return fail(409,'Draft notice not found or version conflict.');await audit({query},clientId,noticeId,'draft_updated',body);return {ok:true,notice:await hydrate({query},clientId,rows[0])};}

async function insertSnapshot(db,auth,row,stage,body,decision=null,source=null){const draft=row.draft_data||{};const terms=auth.terms||{};const deadline=auth.deadline||{};
  if(row.notice_type==='payment_notice'&&draft.notifiedSumConfirmed!==true)throw Object.assign(new Error('Notified sum must be explicitly confirmed before Prepare.'),{status:400});
  if(row.notice_type==='pay_less_notice'&&auth.noticeReadiness.configuration?.basisOfCalculationRequired&&draft.basisConfirmed!==true)throw Object.assign(new Error('Pay Less basis of calculation must be explicitly confirmed before Prepare.'),{status:400});
  if(auth.noticeReadiness.configuration?.basisOfCalculationRequired&&!String(draft.basisOfCalculation||body.basisOfCalculation||'').trim())throw Object.assign(new Error('Basis of calculation is required before Prepare.'),{status:400});
  const notified=row.notice_type==='payment_notice'?money(draft.notifiedSum):money(source.notified_sum);const intended=decision?money(decision.intended_amount):null;const reduction=intended==null?null:money(notified-intended);
  const next=Number((await db.query(`SELECT COALESCE(MAX(attempt_number),0)+1 n FROM package_payment_notice_snapshots WHERE client_id=$1 AND notice_id=$2 AND stage=$3`,[row.client_id,row.id,stage])).rows[0].n);
  return (await db.query(`INSERT INTO package_payment_notice_snapshots(client_id,notice_id,development_id,package_id,certificate_id,notice_type,stage,attempt_number,notice_reference,notice_mode,terms_version_id,rules_schema_version,deadline_snapshot_id,source_notice_id,intended_payment_decision_id,intended_payment_decision_version,assessed_gross,retention,recoveries,vat,assessed_net,notified_sum,intended_payment,reduction,payment_notice_deadline,pay_less_deadline,basis_of_calculation,terms_snapshot,rules_snapshot,timetable_snapshot,application_snapshot,monetary_basis,calculator_version,actor)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34) RETURNING *`,[row.client_id,row.id,row.development_id,row.package_id,row.certificate_id,row.notice_type,stage,next,row.notice_reference,auth.noticeReadiness.mode,terms.termsVersionId||null,terms.rulesSchemaVersion||null,deadline.id||null,row.source_notice_id||null,decision?.id||null,decision?.decision_version||null,money(auth.certificate.gross_value),money(auth.certificate.retention),money(auth.certificate.recovery_signed),money(auth.certificate.vat),money(auth.certificate.net_value),notified,intended,reduction,deadline.payment_notice_deadline||null,deadline.pay_less_notice_deadline||null,String(draft.basisOfCalculation||body.basisOfCalculation||''),JSON.stringify(terms),JSON.stringify(terms.paymentRules||{}),JSON.stringify(deadline),deadline.application_snapshot?JSON.stringify(deadline.application_snapshot):null,JSON.stringify({gross:money(auth.certificate.gross_value),retention:money(auth.certificate.retention),recoveries:money(auth.certificate.recovery_signed),vat:money(auth.certificate.vat),net:money(auth.certificate.net_value)}),deadline.calculation_version||null,actor(body)])).rows[0];}

async function transition(clientId,noticeId,actionName,body={}){const db=await pool.connect();try{await db.query('BEGIN');const row=(await db.query(`SELECT * FROM package_payment_notices WHERE client_id=$1 AND id=$2 FOR UPDATE`,[clientId,noticeId])).rows[0];if(!row){await db.query('ROLLBACK');return fail(404,'Notice not found.');}
    const auth=await authority(db,clientId,row.package_id,row.certificate_id,{lock:true});let decision=null,source=null;
    if(row.notice_type==='pay_less_notice'){source=(await db.query(`SELECT s.* FROM package_payment_notices n JOIN package_payment_notice_snapshots s ON s.notice_id=n.id AND s.stage='issued' WHERE n.client_id=$1 AND n.id=$2 AND n.status='issued'`,[clientId,row.source_notice_id])).rows[0];decision=(await db.query(`SELECT * FROM package_intended_payment_decisions WHERE client_id=$1 AND id=$2 AND state='confirmed'`,[clientId,row.draft_data?.intendedPaymentDecisionId])).rows[0];if(!source||!decision)throw Object.assign(new Error('Pay Less Notice requires an Issued Payment Notice and confirmed intended-payment decision.'),{status:409});}
    if(actionName==='prepare'){if(!['draft','prepared'].includes(row.status))throw Object.assign(new Error('Only a Draft or Prepared notice can be prepared.'),{status:409});const snap=await insertSnapshot(db,auth,row,'prepared',body,decision,source);await db.query(`UPDATE package_payment_notices SET status='prepared',version=version+1,updated_at=NOW(),updated_by=$3 WHERE client_id=$1 AND id=$2`,[clientId,noticeId,actor(body)]);await audit(db,clientId,noticeId,'prepared',body,{snapshotId:snap.id});}
    else {if(row.status!=='prepared')throw Object.assign(new Error('Issue requires a specific Prepared authority.'),{status:409});const prepared=(await db.query(`SELECT * FROM package_payment_notice_snapshots WHERE client_id=$1 AND notice_id=$2 AND stage='prepared' ORDER BY attempt_number DESC FOR UPDATE`,[clientId,noticeId])).rows[0];if(!prepared)throw Object.assign(new Error('Prepared authority not found.'),{status:409});if(row.notice_type==='pay_less_notice'&&auth.noticeReadiness.configuration?.basisOfCalculationRequired&&(row.draft_data?.basisConfirmed!==true||!String(prepared.basis_of_calculation||'').trim()))throw Object.assign(new Error('Pay Less basis of calculation must be explicitly confirmed before Issue.'),{status:409});const snap=(await db.query(`INSERT INTO package_payment_notice_snapshots(${['client_id','notice_id','development_id','package_id','certificate_id','notice_type','stage','attempt_number','notice_reference','notice_mode','terms_version_id','rules_schema_version','deadline_snapshot_id','source_notice_id','intended_payment_decision_id','intended_payment_decision_version','assessed_gross','retention','recoveries','vat','assessed_net','notified_sum','intended_payment','reduction','payment_notice_deadline','pay_less_deadline','basis_of_calculation','terms_snapshot','rules_snapshot','timetable_snapshot','application_snapshot','monetary_basis','schema_version','calculator_version','actor'].join(',')}) SELECT client_id,notice_id,development_id,package_id,certificate_id,notice_type,'issued',attempt_number,notice_reference,notice_mode,terms_version_id,rules_schema_version,deadline_snapshot_id,source_notice_id,intended_payment_decision_id,intended_payment_decision_version,assessed_gross,retention,recoveries,vat,assessed_net,notified_sum,intended_payment,reduction,payment_notice_deadline,pay_less_deadline,basis_of_calculation,terms_snapshot,rules_snapshot,timetable_snapshot,application_snapshot,monetary_basis,schema_version,calculator_version,$3 FROM package_payment_notice_snapshots WHERE id=$1 AND client_id=$2 RETURNING id`,[prepared.id,clientId,actor(body)])).rows[0];await db.query(`UPDATE package_payment_notices SET status='issued',version=version+1,updated_at=NOW(),updated_by=$3 WHERE client_id=$1 AND id=$2 AND status='prepared'`,[clientId,noticeId,actor(body)]);if(row.supersedes_notice_id){await db.query(`UPDATE package_payment_notices SET status='superseded',version=version+1,updated_at=NOW(),updated_by=$3 WHERE client_id=$1 AND id=$2 AND status='issued'`,[clientId,row.supersedes_notice_id,actor(body)]);await audit(db,clientId,row.supersedes_notice_id,'superseded',body,{byNoticeId:row.id});}await audit(db,clientId,noticeId,'issued',body,{snapshotId:snap.id,preparedSnapshotId:prepared.id});}
    await db.query('COMMIT');return {ok:true,workspace:await getWorkspace(clientId,row.package_id,row.certificate_id)};
  }catch(e){await db.query('ROLLBACK');return fail(e.status||500,e.message);}finally{db.release();}}

async function createDecision(clientId,packageId,certificateId,body={}){const amount=money(body.intendedAmount);if(amount==null)return fail(400,'intendedAmount must be a signed amount to pence.');const db=await pool.connect();try{await db.query('BEGIN');const auth=await authority(db,clientId,packageId,certificateId,{lock:true});if(!auth){await db.query('ROLLBACK');return fail(404,'Certificate not found.');}const n=Number((await db.query(`SELECT COALESCE(MAX(decision_version),0)+1 n FROM package_intended_payment_decisions WHERE client_id=$1 AND certificate_id=$2`,[clientId,certificateId])).rows[0].n);const state=body.confirm===true?'confirmed':'proposed';const row=(await db.query(`INSERT INTO package_intended_payment_decisions(client_id,development_id,package_id,certificate_id,decision_version,state,intended_amount,source,basis,actor,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $6='confirmed' THEN NOW() END) RETURNING *`,[clientId,auth.certificate.development_id,packageId,certificateId,n,state,amount,body.source||'manual',body.basis||null,actor(body)])).rows[0];await db.query('COMMIT');return {ok:true,decision:{id:row.id,version:n,state,intendedAmount:amount}};}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}

async function createPayLess(clientId,packageId,certificateId,body={}){const db=await pool.connect();try{await db.query('BEGIN');const auth=await authority(db,clientId,packageId,certificateId,{lock:true});if(!auth?.noticeReadiness?.configuration?.payLessWorkflowSupported){await db.query('ROLLBACK');return fail(409,'Pay Less workflow is not configured.');}const source=(await db.query(`SELECT n.id,s.notified_sum,s.pay_less_deadline FROM package_payment_notices n JOIN package_payment_notice_snapshots s ON s.notice_id=n.id AND s.stage='issued' WHERE n.client_id=$1 AND n.certificate_id=$2 AND n.notice_type='payment_notice' AND n.status='issued' ORDER BY s.captured_at DESC LIMIT 1`,[clientId,certificateId])).rows[0];const decision=(await db.query(`SELECT * FROM package_intended_payment_decisions WHERE client_id=$1 AND certificate_id=$2 AND state='confirmed' ORDER BY decision_version DESC LIMIT 1`,[clientId,certificateId])).rows[0];if(!source||!decision){await db.query('ROLLBACK');return fail(409,'Pay Less review requires an Issued Payment Notice and confirmed intended payment.');}if(!source.pay_less_deadline){await db.query('ROLLBACK');return fail(409,'Pay Less deadline authority was not captured for this certificate.');}if(money(decision.intended_amount)>=money(source.notified_sum)){await db.query('ROLLBACK');return fail(409,'No Pay Less reduction is currently indicated.');}const ref=String(body.reference||`PLN-${auth.certificate.certificate_number}`).trim();const row=(await db.query(`INSERT INTO package_payment_notices(client_id,development_id,package_id,certificate_id,notice_type,notice_reference,source_notice_id,draft_data,created_by,updated_by) VALUES($1,$2,$3,$4,'pay_less_notice',$5,$6,$7,$8,$8) RETURNING *`,[clientId,auth.certificate.development_id,packageId,certificateId,ref,source.id,JSON.stringify({intendedPaymentDecisionId:decision.id,basisOfCalculation:'',basisConfirmed:false}),actor(body)])).rows[0];await audit(db,clientId,row.id,'created',body,{sourceNoticeId:source.id,decisionId:decision.id});await db.query('COMMIT');return {ok:true,notice:await hydrate({query:db.query.bind(db)},clientId,row)};}catch(e){await db.query('ROLLBACK');if(e.code==='23505')return fail(409,'An active Pay Less Notice or reference already exists.');throw e;}finally{db.release();}}

module.exports={getWorkspace,createPaymentNotice,patchDraft,prepare:(c,id,b)=>transition(c,id,'prepare',b),issue:(c,id,b)=>transition(c,id,'issue',b),createDecision,createPayLess};
