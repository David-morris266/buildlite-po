const crypto = require('node:crypto');
const { pool, query } = require('../db');
const { noticeReadiness } = require('./paymentRulesV2');
const { londonDate } = require('./paymentNoticeReadiness');
const { dateOnly } = require('./paymentCertificateTimetable');
const { hashCanonicalJson, CANONICAL_JSON_SHA256_V1 } = require('./canonicalJsonIntegrity');
const { buildPaymentCertificateRenderPayload } = require('./paymentCertificateDocumentPayload');
const storage = require('./commercialDocumentStorage');
const { assertServicePermission, resolveBuildLitePrincipal } = require('../auth/authorization');
const { PERMISSIONS:P } = require('../auth/permissions');

const enabled = () => process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED === 'true';
const requiredPermissions = [P.PAYMENT_NOTICE_PREPARE,P.DOCUMENT_GENERATE];
const clean = value => String(value ?? '').trim();
const financialHash = c => hashCanonicalJson(Object.fromEntries(['gross_value','retention','recovery_signed','vat','net_value'].map(key=>[key,c[key]==null?null:Number(c[key])])));
const actor = auth => ({userId:auth.userId,membershipId:auth.membershipId,providerUserId:auth.providerUserId,displayName:auth.displayName,roleKey:auth.roleKey});
function basisFor(c) {
  return `Certificate ${c.certificate_number}: measured works and individual variation assessments in the frozen certificate valuation. Gross GBP ${Number(c.gross_value).toFixed(2)}; retention GBP ${Number(c.retention).toFixed(2)}; recovery/contra GBP ${Number(c.recovery_signed).toFixed(2)}; VAT GBP ${Number(c.vat).toFixed(2)}; net GBP ${Number(c.net_value).toFixed(2)}. The locked valuation and assessment reasons form the calculation evidence.`;
}
function evaluatePreparation(facts, auth, confirmed, now=new Date()) {
  const c=facts.certificate, d=facts.deadline, terms=d?.governing_terms_snapshot || {}, config=noticeReadiness(terms);
  const reasons=[];
  if (facts.paymentNotice) return {outcome:'existing_notice',reasons:['An issued Payment Notice already exists; no duplicate initial notice will be prepared.']};
  if (config.state==='ready' && config.mode==='certificate_only') return {outcome:'not_required',reasons:[]};
  if (config.state!=='ready' || config.configuration?.paymentNoticeIssuer!=='company') reasons.push('Governing terms do not support company initial Payment Notice preparation.');
  if (!terms.termsVersionId || !d?.id || d.readiness!=='ready' || d.calculation_status!=='calculated') reasons.push('Frozen bound terms or calculated deadline evidence is incomplete.');
  if (c.status!=='locked') reasons.push('A Locked certificate is required.');
  if (!c.payload?.lockedGoverningTermsSnapshot || hashCanonicalJson(c.payload.lockedGoverningTermsSnapshot)!==hashCanonicalJson(terms)) reasons.push('Frozen terms evidence does not agree.');
  if (['gross_value','retention','recovery_signed','vat','net_value'].some(key=>c[key]==null || clean(c[key])==='' || !Number.isFinite(Number(c[key])))) reasons.push('Frozen financial evidence is incomplete.');
  const deadline=dateOnly(d?.payment_notice_deadline);
  if (!deadline || deadline<londonDate(now)) reasons.push('The Payment Notice deadline is missing or has passed; commercial review is required.');
  if (facts.intended && Number(facts.intended.intended_amount)!==Number(c.net_value)) reasons.push('A different intended-payment position requires existing notice/reduction controls.');
  if (!auth?.userId || !auth.membershipId || requiredPermissions.some(key=>!auth.permissions?.includes(key))) reasons.push('Payment Notice preparation and document generation permissions are required.');
  if (confirmed!==true) reasons.push('The approver has not confirmed the disclosed notice preparation.');
  const basis=reasons.length?null:basisFor(c);
  return {outcome:reasons.length?'exception':'prepare',reasons,notifiedSum:reasons.length?null:Number(c.net_value),basis,
    disclosureHash:reasons.length?null:hashCanonicalJson({sum:Number(c.net_value),basis,termsHash:hashCanonicalJson(terms),deadline,financialHash:financialHash(c)}),
    documentType:config.mode==='certificate_as_payment_notice'?'combined_certificate_payment_notice':'payment_notice'};
}
async function evaluateForApproval(db,clientId,facts,auth,confirmed) {
  const plan=evaluatePreparation(facts,auth,confirmed);
  if(plan.outcome==='prepare' && (await db.query(`SELECT 1 FROM package_payment_notices WHERE client_id=$1 AND certificate_id=$2 AND notice_type='payment_notice' AND status NOT IN ('voided','superseded')`,[clientId,facts.certificate.id])).rowCount)
    return {outcome:'exception',reasons:['Existing notice evidence requires review; no duplicate initial notice is authorised.']};
  if(plan.outcome==='prepare' && (await db.query("SELECT 1 FROM payment_notice_instructions WHERE client_id=$1 AND certificate_id=$2 AND outcome='prepare'",[clientId,facts.certificate.id])).rowCount)
    return {outcome:'exception',reasons:['An authorised initial notice preparation already exists. Review its current job/document; do not create another initial instruction.']};
  return plan;
}
const signed = row => ({clientId:row.client_id,decisionId:row.decision_id,certificateId:row.certificate_id,packageId:row.package_id,deadlineSnapshotId:row.deadline_snapshot_id,outcome:row.outcome,notifiedSum:row.notified_sum==null?null:Number(row.notified_sum),basis:row.basis,ownerMembershipId:row.owner_membership_id,authority:row.authority});
async function resultForDecision(db,clientId,decisionId) {
  const row=(await db.query(`SELECT i.id,i.outcome,i.authority,j.id job_id,j.status,j.document_id,j.attempts,j.failures
    FROM payment_notice_instructions i LEFT JOIN payment_notice_preparation_jobs j ON j.client_id=i.client_id AND j.instruction_id=i.id
    WHERE i.client_id=$1 AND i.decision_id=$2`,[clientId,decisionId])).rows[0];
  return row ? {instructionId:row.id,outcome:row.outcome,jobId:row.job_id||null,status:row.status||row.outcome,documentId:row.document_id||null,reasons:row.authority.reasons||[],owner:row.authority.actor,attempts:row.attempts||0,failures:row.failures||[]} : null;
}
async function persist(db,clientId,decision,facts,auth,plan) {
  const c=facts.certificate;
  const active=(await db.query(`SELECT id,status FROM package_payment_notices WHERE client_id=$1 AND certificate_id=$2 AND notice_type='payment_notice' AND status NOT IN ('voided','superseded')`,[clientId,c.id])).rows;
  if (plan.outcome==='prepare' && active.length) plan={outcome:'exception',reasons:['Existing notice evidence requires review; no second initial notice will be prepared.']};
  let presentation=null;
  if (plan.outcome==='prepare') {
    const built=await buildPaymentCertificateRenderPayload(db,{id:clientId},c.package_id,c.id,{includeValuationSchedule:false});
    if (!built.ok) plan={outcome:'exception',reasons:[built.message]};
    else presentation=built.renderPayload.presentation;
  }
  const row={client_id:clientId,decision_id:decision.id,certificate_id:c.id,package_id:c.package_id,deadline_snapshot_id:facts.deadline?.id||null,outcome:plan.outcome,notified_sum:plan.notifiedSum??null,basis:plan.basis||null,owner_membership_id:auth.membershipId,
    authority:{schemaVersion:1,authorityRule:'approval_led_initial_notice_v1',companyPolicyVersion:null,actor:actor(auth),reasons:plan.reasons,documentType:plan.documentType||null,certificateVersion:Number(c.version),financialHash:financialHash(c),certificatePayloadHash:hashCanonicalJson(c.payload),termsHash:hashCanonicalJson(facts.deadline?.governing_terms_snapshot||{}),deadline:dateOnly(facts.deadline?.payment_notice_deadline),presentation,approvalSourceHash:decision.source_snapshot_sha256,existingNoticeSnapshotId:facts.paymentNotice?.id||null}};
  const instruction=(await db.query(`INSERT INTO payment_notice_instructions(client_id,decision_id,certificate_id,package_id,deadline_snapshot_id,outcome,notified_sum,basis,authority,authority_sha256,hash_scheme,owner_membership_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[clientId,decision.id,c.id,c.package_id,row.deadline_snapshot_id,row.outcome,row.notified_sum,row.basis,JSON.stringify(row.authority),hashCanonicalJson(signed(row)),CANONICAL_JSON_SHA256_V1,auth.membershipId])).rows[0];
  if (instruction.outcome==='prepare') await db.query('INSERT INTO payment_notice_preparation_jobs(client_id,instruction_id) VALUES($1,$2)',[clientId,instruction.id]);
  return resultForDecision(db,clientId,decision.id);
}
async function claim(db, clientId=null) {
  return (await db.query(`WITH candidate AS (SELECT j.id FROM payment_notice_preparation_jobs j
    JOIN payment_notice_instructions i ON i.client_id=j.client_id AND i.id=j.instruction_id
    WHERE ($1::uuid IS NULL OR j.client_id=$1) AND ((j.status='pending' AND j.available_at<=NOW()) OR (j.status='running' AND j.lease_until<NOW())) AND j.attempts<3
    AND NOT EXISTS(SELECT 1 FROM package_payment_notices n WHERE n.client_id=i.client_id AND n.certificate_id=i.certificate_id AND n.notice_type='payment_notice')
    AND NOT EXISTS(SELECT 1 FROM payment_authority_decisions r WHERE r.client_id=i.client_id AND r.reverses_decision_id=i.decision_id)
    ORDER BY j.available_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1)
    UPDATE payment_notice_preparation_jobs j SET status='running',attempts=j.attempts+1,lease_token=gen_random_uuid(),lease_until=NOW()+INTERVAL '120 seconds',updated_at=NOW(),
    failures=CASE WHEN j.status='running' THEN j.failures || jsonb_build_array(jsonb_build_object('at',NOW(),'reason','Previous runner lease expired; preparation recovered.')) ELSE j.failures END
    FROM candidate c WHERE j.id=c.id RETURNING j.*`,[clientId])).rows[0]||null;
}
async function failJob(job,message) {
  await query(`UPDATE payment_notice_preparation_jobs j SET status=CASE WHEN attempts>=3 OR EXISTS(
    SELECT 1 FROM payment_notice_instructions i WHERE i.id=j.instruction_id AND i.client_id=j.client_id AND
     (EXISTS(SELECT 1 FROM package_payment_notices n WHERE n.client_id=i.client_id AND n.certificate_id=i.certificate_id AND n.notice_type='payment_notice') OR
      EXISTS(SELECT 1 FROM payment_authority_decisions r WHERE r.client_id=i.client_id AND r.reverses_decision_id=i.decision_id))) THEN 'failed' ELSE 'pending' END,
    lease_token=NULL,lease_until=NULL,available_at=NOW()+INTERVAL '30 seconds',updated_at=NOW(),failures=failures || $4::jsonb
    WHERE id=$1 AND client_id=$2 AND lease_token=$3 AND status='running'`,[job.id,job.client_id,job.lease_token,JSON.stringify([{at:new Date().toISOString(),reason:message}])]);
}
async function buildInstructionPayload(db,job) {
  const i=(await db.query('SELECT * FROM payment_notice_instructions WHERE client_id=$1 AND id=$2',[job.client_id,job.instruction_id])).rows[0];
  if (!i || i.outcome!=='prepare' || i.hash_scheme!==CANONICAL_JSON_SHA256_V1 || hashCanonicalJson(signed(i))!==i.authority_sha256) throw new Error('Notice instruction integrity verification failed.');
  const principal=await resolveBuildLitePrincipal({providerUserId:i.authority.actor.providerUserId},i.client_id,db);
  if (principal.userId!==i.authority.actor.userId || principal.membershipId!==i.owner_membership_id) throw new Error('Preparation owner membership changed; commercial review required.');
  for(const permission of requiredPermissions) assertServicePermission(principal,permission);
  const decision=(await db.query('SELECT * FROM payment_authority_decisions WHERE client_id=$1 AND id=$2 FOR SHARE',[i.client_id,i.decision_id])).rows[0];
  if (!decision || decision.source_snapshot_sha256!==i.authority.approvalSourceHash || hashCanonicalJson(decision.source_snapshot)!==decision.source_snapshot_sha256) throw new Error('Approval integrity verification failed.');
  if ((await db.query('SELECT 1 FROM payment_authority_decisions WHERE client_id=$1 AND reverses_decision_id=$2',[i.client_id,i.decision_id])).rowCount) throw new Error('Payment Approval was reversed; preparation requires review.');
  if ((await db.query(`SELECT 1 FROM package_payment_notices WHERE client_id=$1 AND certificate_id=$2 AND notice_type='payment_notice'`,[i.client_id,i.certificate_id])).rowCount) throw new Error('Manual notice history requires review; automated preparation is permanently blocked for this certificate.');
  const combined=i.authority.documentType==='combined_certificate_payment_notice';
  const built=await buildPaymentCertificateRenderPayload(db,{id:i.client_id},i.package_id,i.certificate_id,{includeValuationSchedule:combined});
  if (!built.ok) throw new Error(built.message);
  const c=(await db.query('SELECT * FROM package_payment_certificates WHERE client_id=$1 AND id=$2 FOR SHARE',[i.client_id,i.certificate_id])).rows[0];
  const d=(await db.query('SELECT * FROM package_payment_certificate_deadline_snapshots WHERE client_id=$1 AND id=$2',[i.client_id,i.deadline_snapshot_id])).rows[0];
  if (!d || !dateOnly(d.payment_notice_deadline) || dateOnly(d.payment_notice_deadline)<londonDate(new Date())) throw new Error('Notice deadline has passed or is unavailable; commercial review is required before preparation.');
  if (Number(c.version)!==i.authority.certificateVersion || financialHash(c)!==i.authority.financialHash || hashCanonicalJson(c.payload)!==i.authority.certificatePayloadHash || hashCanonicalJson(d?.governing_terms_snapshot||{})!==i.authority.termsHash) throw new Error('Frozen certificate or terms evidence does not match the instruction.');
  const reference=`PN-${i.id}`;
  const notice={reference,status:'prepared',notifiedSum:Number(i.notified_sum),basisOfCalculation:i.basis,
    assessed:{gross:Number(c.gross_value),retention:Number(c.retention),recoveries:Number(c.recovery_signed),vat:Number(c.vat),net:Number(c.net_value)},
    timetable:{contractualValuationDate:dateOnly(d.contractual_valuation_date),dueDate:dateOnly(d.due_date),paymentNoticeDeadline:dateOnly(d.payment_notice_deadline),finalDateForPayment:dateOnly(d.final_date_for_payment)},terms:d.governing_terms_snapshot,
    preparedBy:i.authority.actor.displayName,preparationOnly:true};
  const payload={...(combined?built.renderPayload:{}),schemaVersion:2,templateVersion:combined?'combined-certificate-payment-notice-v1':'payment-notice-v1',
    document:{type:i.authority.documentType,reference,generatedAt:new Date().toISOString()},presentation:i.authority.presentation,
    sourceCertificate:{...built.renderPayload.authority,reference:built.documentReference},notice,
    ...(combined?{certificate:{...built.renderPayload,presentation:i.authority.presentation}}:{})};
  return {instruction:i,payload,reference,sourceSnapshotIds:{...built.sourceSnapshotIds,noticeInstructionId:i.id,approvalDecisionId:i.decision_id,deadlineSnapshotId:i.deadline_snapshot_id}};
}
async function processOne({render,signal,clientId=null}={}) {
  if(!enabled() || signal?.aborted)return false;
  // Expired final attempts must become visible failures rather than stranded jobs.
  await query(`UPDATE payment_notice_preparation_jobs SET status='failed',lease_token=NULL,lease_until=NULL,updated_at=NOW(),failures=failures || jsonb_build_array(jsonb_build_object('at',NOW(),'reason','Runner lease expired after final attempt; authorised retry required.')) WHERE status='running' AND lease_until<NOW() AND attempts>=3`);
  const job=await claim({query},clientId); if(!job)return false;
  const db=await pool.connect();
  try {
    const built=await buildInstructionPayload(db,job);
    const binary=Buffer.from(await (render||require('./commercialDocumentRenderer').renderCommercialDocumentPdf)(built.instruction.authority.documentType,built.payload,{signal,timeoutMs:45000}));
    if (!binary.length) throw new Error('PDF renderer returned an empty document.');
    if(signal?.aborted || !enabled())throw new Error('Preparation interrupted by shutdown or disabled configuration; safe retry required.');
    await db.query('BEGIN');
    // Manual recovery locks certificate then job. Use the same order to avoid deadlock.
    // NO KEY UPDATE also permits a reversal's FK KEY SHARE while we recheck its decision.
    await db.query('SELECT id FROM package_payment_certificates WHERE client_id=$1 AND id=(SELECT certificate_id FROM payment_notice_instructions WHERE client_id=$1 AND id=$2) FOR NO KEY UPDATE',[job.client_id,job.instruction_id]);
    const lease=(await db.query(`SELECT * FROM payment_notice_preparation_jobs WHERE client_id=$1 AND id=$2 AND status='running' AND lease_token=$3 AND lease_until>NOW() FOR UPDATE`,[job.client_id,job.id,job.lease_token])).rows[0];
    if(!lease){await db.query('ROLLBACK');return true;}
    // Revalidate after rendering; do not persist a document against withdrawn authority.
    await buildInstructionPayload(db,job);
    const i=built.instruction;
    const row=await storage.insert(db,{clientId:i.client_id,developmentId:built.payload.sourceCertificate.developmentId,packageId:i.package_id,certificateId:i.certificate_id,
      documentType:i.authority.documentType,documentReference:built.reference,sourceAuthorityType:'authorised_payment_notice_instruction',sourceAuthorityId:i.id,sourceSnapshotIds:built.sourceSnapshotIds,documentSchemaVersion:2,
      templateVersion:built.payload.templateVersion,renderPayload:built.payload,recipientSnapshot:built.payload.presentation.payee,pageCount:(binary.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length||null,binary,sha256:crypto.createHash('sha256').update(binary).digest('hex'),actor:i.authority.actor.displayName,generatedAt:built.payload.document.generatedAt});
    await db.query(`INSERT INTO commercial_document_audit(client_id,document_id,action,actor,detail) VALUES($1,$2,'prepared_from_approval',$3,$4)`,[i.client_id,row.id,i.authority.actor.displayName,JSON.stringify({instructionId:i.id,decisionId:i.decision_id,sha256:row.sha256,execution:'api_background_runner',actor:i.authority.actor})]);
    await db.query(`UPDATE payment_notice_preparation_jobs SET status='completed',document_id=$4,lease_token=NULL,lease_until=NULL,updated_at=NOW() WHERE client_id=$1 AND id=$2 AND lease_token=$3`,[job.client_id,job.id,job.lease_token,row.id]);
    await db.query('COMMIT');return true;
  } catch(error) {await db.query('ROLLBACK');await failJob(job,error.message);return true;}
  finally {db.release();}
}
async function retry(clientId,instructionId,auth) {
  for(const permission of requiredPermissions)assertServicePermission(auth,permission);
  let result;
  try {result=await query(`UPDATE payment_notice_preparation_jobs j SET status='pending',attempts=0,available_at=NOW(),updated_at=NOW(),failures=failures || $3::jsonb
    FROM payment_notice_instructions i WHERE j.client_id=$1 AND j.instruction_id=$2 AND j.status='failed' AND i.client_id=j.client_id AND i.id=j.instruction_id
    AND NOT EXISTS(SELECT 1 FROM package_payment_notices n WHERE n.client_id=i.client_id AND n.certificate_id=i.certificate_id AND n.notice_type='payment_notice')
    AND NOT EXISTS(SELECT 1 FROM payment_authority_decisions r WHERE r.client_id=i.client_id AND r.reverses_decision_id=i.decision_id)
    RETURNING j.id`,[clientId,instructionId,JSON.stringify([{at:new Date().toISOString(),reason:'Authorised manual retry',actor:actor(auth)}])]);}
  catch(error){if(error.code==='P0001')return {ok:false,status:409,message:'Manual notice history or reversed approval prevents automated retry.'};throw error;}
  return {ok:result.rowCount>0,status:result.rowCount?200:409,message:result.rowCount?'Preparation queued; no notice has been issued or sent.':'Only a failed preparation without manual notice history or reversed approval can be retried.'};
}
module.exports={enabled,requiredPermissions,basisFor,evaluatePreparation,evaluateForApproval,persist,resultForDecision,claim,processOne,retry,buildInstructionPayload};
