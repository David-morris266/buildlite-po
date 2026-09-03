const { pool, query } = require('../db');
const { assertServicePermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');
const { noticeReadiness } = require('./paymentRulesV2');
const { toPence, fromPence } = require('./variationAccountAuthorityRepository');
const { CANONICAL_JSON_SHA256_V1, hashCanonicalJson, verifyJsonIntegrity } = require('./canonicalJsonIntegrity');

const fail = (status, message) => ({ ok: false, status, message });
const money = value => fromPence(toPence(value));
const actor = auth => [auth.userId, auth.membershipId, auth.providerUserId, auth.displayName];
const clean = value => String(value ?? '').trim();
function requireActor(auth, permission) {
  assertServicePermission(auth, permission);
  if (!auth?.userId || !auth?.membershipId || !auth?.providerUserId) {
    const error = new Error('Authenticated BuildLite identity is required.'); error.status = 401; throw error;
  }
}

async function loadLockedFacts(db, clientId, certificateId, lock = false) {
  const certificate = (await db.query(`SELECT c.*,p.development_name,p.supplier_label,p.cost_code,p.payload package_payload
    FROM package_payment_certificates c JOIN packages p ON p.id=c.package_id AND p.client_id=c.client_id
    WHERE c.client_id=$1 AND c.id=$2${lock ? ' FOR UPDATE OF c' : ''}`, [clientId, certificateId])).rows[0];
  if (!certificate) return null;
  const deadline = (await db.query(`SELECT * FROM package_payment_certificate_deadline_snapshots
    WHERE client_id=$1 AND certificate_id=$2 AND stage='locked' ORDER BY captured_at DESC LIMIT 1`, [clientId, certificateId])).rows[0] || null;
  const issued = async type => (await db.query(`SELECT s.* FROM package_payment_notice_snapshots s
    JOIN package_payment_notices n ON n.id=s.notice_id AND n.client_id=s.client_id
    WHERE s.client_id=$1 AND s.certificate_id=$2 AND s.notice_type=$3 AND s.stage='issued' AND n.status='issued'
    ORDER BY s.captured_at DESC LIMIT 1`, [clientId, certificateId, type])).rows[0] || null;
  const paymentNotice = await issued('payment_notice');
  const payLess = await issued('pay_less_notice');
  const intended = (await db.query(`SELECT * FROM package_intended_payment_decisions
    WHERE client_id=$1 AND certificate_id=$2 AND state='confirmed' ORDER BY decision_version DESC LIMIT 1`, [clientId, certificateId])).rows[0] || null;
  const assessments = (await db.query(`SELECT a.*,v.variation_reference,v.description FROM package_variation_account_certificate_assessments a
    JOIN package_variation_account_items v ON v.id=a.variation_account_item_id AND v.client_id=a.client_id
    WHERE a.client_id=$1 AND a.certificate_id=$2 AND a.status='locked' ORDER BY v.variation_reference,a.id`, [clientId, certificateId])).rows;
  const prior = (await db.query(`SELECT
      COALESCE(SUM(d.signed_cash_amount),0) cash,
      COALESCE((SELECT SUM(l.signed_new_commercial_authority)
        FROM payment_authority_decision_lines l
        WHERE l.client_id=$1 AND l.certificate_id=$2),0) commercial
    FROM payment_authority_decisions d
    WHERE d.client_id=$1 AND d.certificate_id=$2`, [clientId, certificateId])).rows[0];
  return { certificate, deadline, paymentNotice, payLess, intended, assessments,
    priorCash: money(prior.cash), priorCommercialAuthority: money(prior.commercial),
    readiness: noticeReadiness(deadline?.governing_terms_snapshot || {}) };
}

function conciseQueueReason(reasons = []) {
  if (reasons.some(reason => reason.includes('Pay Less'))) return 'Pay Less required';
  if (reasons.some(reason => reason.includes('unavailable') || reason.includes('indeterminate') || reason.includes('No Locked'))) return 'Source data incomplete';
  if (reasons.some(reason => reason.includes('Payment Notice'))) return 'Notice issue';
  return 'Needs review';
}

function eligibility(facts) {
  const reasons = [];
  if (facts.certificate.status !== 'locked') reasons.push('Certificate is not Locked.');
  if (facts.readiness.state !== 'ready') reasons.push('Payment Notice authority is unavailable or indeterminate.');
  if (facts.readiness.mode !== 'certificate_as_payment_notice' && !facts.paymentNotice) reasons.push('An Issued Payment Notice is required.');
  const notifiedSum = facts.paymentNotice ? money(facts.paymentNotice.notified_sum) : money(facts.certificate.net_value);
  const intendedPayment = facts.intended ? money(facts.intended.intended_amount) : notifiedSum;
  if (toPence(intendedPayment) < toPence(notifiedSum) && !facts.payLess) reasons.push('A valid Issued Pay Less Notice is required for the reduced intended payment.');
  if (!facts.assessments.length) reasons.push('No Locked Variation Account assessment is available.');
  if (toPence(intendedPayment) === toPence(facts.priorCash)) reasons.push('Payment Authority cash is already fully granted.');
  return { eligible: reasons.length === 0, reasons, noticeMode: facts.readiness.mode, notifiedSum, intendedPayment, payLessReduction: fromPence(toPence(notifiedSum) - toPence(intendedPayment)) };
}

async function supportOptions(db, clientId, assessment) {
  const rows = (await db.query(`SELECT a.*,
    COALESCE((SELECT SUM(s.signed_substituted_amount) FROM package_variation_account_authority_substitutions s WHERE s.client_id=a.client_id AND s.predecessor_allocation_id=a.id),0) substituted,
    COALESCE((SELECT SUM(u.signed_applied_amount) FROM payment_authority_support_usages u WHERE u.client_id=a.client_id AND u.authority_allocation_id=a.id),0) used,
    COALESCE((SELECT SUM(ABS(r.signed_allocated_amount)) FROM package_variation_account_authority_allocations r WHERE r.client_id=a.client_id AND r.reverses_allocation_id=a.id),0) reversed
    FROM package_variation_account_authority_allocations a
    WHERE a.client_id=$1 AND a.variation_account_item_id=$2 AND a.allocation_kind='authority' AND a.source_type IN('commercial_event','variation_order_line')
    ORDER BY a.created_at,a.id`, [clientId, assessment.variation_account_item_id])).rows;
  return rows.map(row => ({ id: row.id, sourceType: row.source_type, reference: row.source_reference_snapshot,
    availableAmount: fromPence(toPence(row.signed_allocated_amount)-Math.sign(toPence(row.signed_allocated_amount))*(Math.abs(toPence(row.substituted))+Math.abs(toPence(row.used))+Math.abs(toPence(row.reversed)))) }))
    .filter(row => toPence(row.availableAmount) !== 0);
}
async function priorResolved(db,clientId,assessmentId){const row=(await db.query(`SELECT
 COALESCE((SELECT SUM(signed_new_commercial_authority) FROM payment_authority_decision_lines WHERE client_id=$1 AND assessment_id=$2),0) new_authority,
 COALESCE((SELECT SUM(u.signed_applied_amount) FROM payment_authority_support_usages u JOIN payment_authority_decision_lines l ON l.id=u.decision_line_id AND l.client_id=u.client_id WHERE u.client_id=$1 AND l.assessment_id=$2),0) support`,[clientId,assessmentId])).rows[0];return toPence(row.new_authority)+toPence(row.support);}

async function listQueue(clientId, auth) {
  requireActor(auth, PERMISSIONS.PAYMENT_APPROVAL_RUN_VIEW);
  const certificates = (await query(`SELECT id FROM package_payment_certificates WHERE client_id=$1 AND status='locked' ORDER BY approved_at,id`, [clientId])).rows;
  const items = [];
  for (const { id } of certificates) {
    const facts = await loadLockedFacts({ query }, clientId, id);
    const ready = eligibility(facts);
    const lines = [];
    for (const assessment of facts.assessments) {
      const snapshot = assessment.source_authority_snapshot || {};
      const resolved=await priorResolved({query},clientId,assessment.id);lines.push({ assessmentId: assessment.id, variationAccountItemId: assessment.variation_account_item_id,
        reference: assessment.variation_reference, description: assessment.description,
        assessment: money(assessment.signed_current_assessment), unapprovedAtLock: money(snapshot.unapprovedAmount || 0),previouslyResolved:fromPence(resolved),unresolvedAmount:fromPence(toPence(snapshot.unapprovedAmount||0)-resolved),
        existingSupportOptions: await supportOptions({ query }, clientId, assessment) });
    }
    const unapprovedAtLock = fromPence(lines.reduce((sum, line) => sum + toPence(line.unresolvedAmount), 0));
    const fullyAuthorised = toPence(facts.priorCash) !== 0 && toPence(facts.priorCash) === toPence(ready.intendedPayment);
    const workflowState = fullyAuthorised ? 'authorised' : ready.eligible ? 'ready' : 'needs_review';
    items.push({ id, certificateId: id, certificateVersion: Number(facts.certificate.version), certificateNumber: Number(facts.certificate.certificate_number),
      development: facts.certificate.development_name, subcontractor: facts.certificate.supplier_label,
      packageTrade: facts.certificate.package_payload?.description || facts.certificate.cost_code, costCode: facts.certificate.cost_code,
      finalPaymentDate: facts.deadline?.final_date_for_payment || null, gross: money(facts.certificate.gross_value),
      retention: money(facts.certificate.retention), recoveries: money(facts.certificate.recovery_signed), vat: money(facts.certificate.vat), net: money(facts.certificate.net_value),
      priorCashAuthority: facts.priorCash, authorisedCashAmount: facts.priorCash,
      authorisedNewCommercialAuthority: facts.priorCommercialAuthority, unapprovedAtLock,
      newCommercialAuthorityProposed: unapprovedAtLock,
      cashAmountProposed: fromPence(toPence(ready.intendedPayment) - toPence(facts.priorCash)), releaseStatus: 'not_released',
      workflowState, statusSummary: fullyAuthorised ? 'Authority already granted' : ready.eligible ? 'Ready' : conciseQueueReason(ready.reasons),
      severity: workflowState, ...ready, lines });
  }
  const rank = { ready: 0, needs_review: 1, authorised: 2 };
  return items.sort((a, b) => (rank[a.workflowState] - rank[b.workflowState])
    || String(a.finalPaymentDate || '9999').localeCompare(String(b.finalPaymentDate || '9999'))
    || Math.abs(b.unapprovedAtLock) - Math.abs(a.unapprovedAtLock));
}

async function approveRun(clientId, body, auth) {
  requireActor(auth, PERMISSIONS.PAYMENT_AUTHORITY_APPROVE);
  const inputs=body.decisions||[], runKey=clean(body.idempotencyKey);
  if(!runKey||!inputs.length)return fail(400,'Run idempotency key and at least one decision are required.');
  const db=await pool.connect();
  try{
    let run=(await db.query('SELECT * FROM payment_authority_runs WHERE client_id=$1 AND idempotency_key=$2',[clientId,runKey])).rows[0];
    if(run&&run.status!=='draft')return {ok:true,status:200,runId:run.id,runStatus:run.status,results:run.summary?.results||[],idempotent:true};
    if(!run){run=(await db.query(`INSERT INTO payment_authority_runs(client_id,run_reference,idempotency_key,created_by_user_id,
      created_by_membership_id,created_by_provider_user_id,created_by_display_name) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(client_id,idempotency_key) DO NOTHING RETURNING *`,[clientId,clean(body.reference)||`PAR-${Date.now()}`,runKey,...actor(auth)])).rows[0];
      if(!run)run=(await db.query('SELECT * FROM payment_authority_runs WHERE client_id=$1 AND idempotency_key=$2',[clientId,runKey])).rows[0];
      else await db.query(`INSERT INTO payment_authority_audit(client_id,run_id,action,detail,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name) VALUES($1,$2,'run_created','{}',$3,$4,$5,$6)`,[clientId,run.id,...actor(auth)]);}
    const results=[];
    for(const input of inputs){
      try{await db.query('BEGIN');const result=await approveDecision(db,clientId,run.id,input,auth);if(!result.ok)throw Object.assign(new Error(result.message),{status:result.status});await db.query('COMMIT');results.push({certificateId:input.certificateId,...result});}
      catch(error){await db.query('ROLLBACK');results.push({certificateId:input.certificateId,ok:false,status:error.status||500,message:error.message});await db.query(`INSERT INTO payment_authority_audit(client_id,run_id,action,detail,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name) VALUES($1,$2,'row_failed',$3,$4,$5,$6,$7)`,[clientId,run.id,JSON.stringify({certificateId:input.certificateId,message:error.message}),...actor(auth)]);}
    }
    const runStatus=results.every(result=>result.ok)?'completed':'completed_with_exceptions';
    await db.query(`UPDATE payment_authority_runs SET status=$3,summary=$4,completed_at=NOW() WHERE client_id=$1 AND id=$2 AND status='draft'`,[clientId,run.id,runStatus,JSON.stringify({results})]);
    await db.query(`INSERT INTO payment_authority_audit(client_id,run_id,action,detail,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name) VALUES($1,$2,'run_completed',$3,$4,$5,$6,$7)`,[clientId,run.id,JSON.stringify({runStatus,results}),...actor(auth)]);
    return {ok:true,status:200,runId:run.id,runStatus,results};
  }finally{db.release();}
}

async function reverseDecision(clientId,decisionId,body,auth){
  requireActor(auth,PERMISSIONS.PAYMENT_AUTHORITY_REVERSE);
  const reason=clean(body.reason),key=clean(body.idempotencyKey);if(!reason||!key)return fail(400,'Reversal reason and idempotency key are required.');
  const db=await pool.connect();try{await db.query('BEGIN');
    const original=(await db.query(`SELECT * FROM payment_authority_decisions WHERE client_id=$1 AND id=$2 AND decision_kind='authority' FOR UPDATE`,[clientId,decisionId])).rows[0];
    if(!original){await db.query('ROLLBACK');return fail(404,'Original Payment Authority not found.');}
    if((await db.query('SELECT 1 FROM payment_authority_decisions WHERE client_id=$1 AND reverses_decision_id=$2',[clientId,decisionId])).rows[0]){await db.query('ROLLBACK');return fail(409,'Payment Authority has already been reversed.');}
    const run=(await db.query(`INSERT INTO payment_authority_runs(client_id,run_reference,idempotency_key,status,summary,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name,completed_at) VALUES($1,$2,$3,'completed','{}',$4,$5,$6,$7,NOW()) RETURNING *`,[clientId,`PAR-REV-${Date.now()}`,`run:${key}`,...actor(auth)])).rows[0];
    const reversalSnapshot=original.source_snapshot;
    const reversal=(await db.query(`INSERT INTO payment_authority_decisions(client_id,run_id,development_id,package_id,certificate_id,certificate_version,decision_kind,reverses_decision_id,signed_cash_amount,certified_gross,retention,recoveries,vat,certificate_net,notified_sum,intended_payment,pay_less_reduction,final_payment_date,intended_payment_decision_id,intended_payment_decision_version,payment_notice_snapshot_id,pay_less_snapshot_id,deadline_snapshot_id,notice_mode,reason,source_snapshot,source_snapshot_sha256,source_snapshot_hash_scheme,idempotency_key,approved_by_user_id,approved_by_membership_id,approved_by_provider_user_id,approved_by_display_name,approved_role_key)
      SELECT client_id,$3,development_id,package_id,certificate_id,certificate_version,'reversal',id,-signed_cash_amount,certified_gross,retention,recoveries,vat,certificate_net,notified_sum,intended_payment,pay_less_reduction,final_payment_date,intended_payment_decision_id,intended_payment_decision_version,payment_notice_snapshot_id,pay_less_snapshot_id,deadline_snapshot_id,notice_mode,$4,source_snapshot,$5,$6,$7,$8,$9,$10,$11,$12 FROM payment_authority_decisions WHERE id=$2 AND client_id=$1 RETURNING *`,[clientId,decisionId,run.id,reason,hashCanonicalJson(reversalSnapshot),CANONICAL_JSON_SHA256_V1,key,...actor(auth),auth.roleKey])).rows[0];
    const lines=(await db.query('SELECT * FROM payment_authority_decision_lines WHERE client_id=$1 AND decision_id=$2',[clientId,decisionId])).rows;
    for(const old of lines){const line=(await db.query(`INSERT INTO payment_authority_decision_lines(client_id,decision_id,package_id,certificate_id,variation_account_item_id,assessment_id,signed_assessment,signed_unapproved_at_lock,signed_existing_support,signed_unresolved_amount,signed_new_commercial_authority,basis,source_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9,$10,$11) RETURNING *`,[clientId,reversal.id,old.package_id,old.certificate_id,old.variation_account_item_id,old.assessment_id,old.signed_assessment,old.signed_unapproved_at_lock,-Number(old.signed_new_commercial_authority),reason,old.source_snapshot])).rows[0];
      const allocation=(await db.query(`SELECT * FROM package_variation_account_authority_allocations WHERE client_id=$1 AND payment_authority_decision_line_id=$2 AND allocation_kind='authority'`,[clientId,old.id])).rows[0];
      if(allocation)await db.query(`INSERT INTO package_variation_account_authority_allocations(client_id,development_id,package_id,variation_account_item_id,source_type,future_source_id,payment_authority_decision_line_id,signed_allocated_amount,allocation_kind,reverses_allocation_id,reason,source_status_snapshot,source_value_snapshot,source_reference_snapshot,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name) VALUES($1,$2,$3,$4,'payment_authority',$5::text,$5::uuid,$6,'reversal',$7,$8,'reversed',$6,$9,$10,$11,$12,$13)`,[clientId,original.development_id,old.package_id,old.variation_account_item_id,line.id,-Number(old.signed_new_commercial_authority),allocation.id,reason,allocation.source_reference_snapshot,...actor(auth)]);}
    await db.query(`INSERT INTO payment_authority_audit(client_id,run_id,decision_id,action,detail,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name) VALUES($1,$2,$3,'reversed',$4,$5,$6,$7,$8)`,[clientId,run.id,reversal.id,JSON.stringify({reversesDecisionId:decisionId}),...actor(auth)]);
    await db.query('COMMIT');return {ok:true,status:201,decisionId:reversal.id};
  }catch(error){await db.query('ROLLBACK');if(error.code==='23505')return fail(409,'Duplicate reversal request.');throw error;}finally{db.release();}
}

async function approveDecision(db, clientId, runId, input, auth) {
  const facts = await loadLockedFacts(db, clientId, input.certificateId, true);
  if (!facts) return fail(404, 'Certificate not found.');
  const ready = eligibility(facts);
  if (!ready.eligible) return fail(409, ready.reasons.join(' '));
  if (Number(input.certificateVersion) !== Number(facts.certificate.version)) return fail(409, 'Certificate version changed; refresh the Approval Run.');
  const reason = clean(input.reason), key = clean(input.idempotencyKey);
  if (!reason || !key) return fail(400, 'Approval reason and idempotency key are required.');
  const duplicate = (await db.query('SELECT id FROM payment_authority_decisions WHERE client_id=$1 AND idempotency_key=$2', [clientId, key])).rows[0];
  if (duplicate) return { ok: true, status: 200, decisionId: duplicate.id, idempotent: true };
  const cash = toPence(input.cashAmount), remainingCash = toPence(ready.intendedPayment) - toPence(facts.priorCash);
  if (!cash || Math.sign(cash) !== Math.sign(remainingCash) || Math.abs(cash) > Math.abs(remainingCash)) return fail(409, 'Cash authority exceeds the unresolved intended payment.');
  const requested = new Map((input.lines || []).map(line => [line.assessmentId, line]));
  const frozen = [];
  for (const assessment of facts.assessments) {
    const line = requested.get(assessment.id), snapshot = assessment.source_authority_snapshot || {};
    if (!line) return fail(400, 'Every Locked VA assessment requires an explicit decision line.');
    const unapproved = toPence(snapshot.unapprovedAmount || 0)-(await priorResolved(db,clientId,assessment.id)), options = await supportOptions(db, clientId, assessment), supports = [];
    let supported = 0;
    for (const usage of line.supportUsages || []) {
      const source = options.find(option => option.id === usage.allocationId), amount = toPence(usage.amount);
      if (!source || !amount || Math.sign(amount) !== Math.sign(unapproved) || Math.abs(amount) > Math.abs(toPence(source.availableAmount))) return fail(409, 'Existing CE/VO support is invalid or exceeds available authority.');
      supported += amount; supports.push({ source, amount: fromPence(amount) });
    }
    const newly = toPence(line.newCommercialAuthority);
    if ((supported || newly) && Math.sign(supported || newly) !== Math.sign(unapproved)) return fail(409, 'Authority sign must match the locked assessment.');
    if (Math.abs(supported + newly) > Math.abs(unapproved)) return fail(409, 'Support plus new Payment Authority exceeds the locked unapproved assessment.');
    if (!clean(line.basis)) return fail(400, 'Each VA decision line requires a basis.');
    frozen.push({ assessment, snapshot, unapproved, supported, newly, supports, basis: clean(line.basis) });
  }
  const sourceSnapshot = { certificateId: facts.certificate.id, certificateVersion: Number(facts.certificate.version), noticeMode: ready.noticeMode,
    deadlineSnapshotId: facts.deadline?.id || null, paymentNoticeSnapshotId: facts.paymentNotice?.id || null, payLessSnapshotId: facts.payLess?.id || null,
    intendedPaymentDecisionId: facts.intended?.id || null, intendedPaymentDecisionVersion: facts.intended?.decision_version || null,
    lines: frozen.map(item => ({ assessmentId: item.assessment.id, sourceAuthoritySnapshot: item.snapshot, supports: item.supports })) };
  const c = facts.certificate;
  const decision = (await db.query(`INSERT INTO payment_authority_decisions(
    client_id,run_id,development_id,package_id,certificate_id,certificate_version,signed_cash_amount,certified_gross,retention,recoveries,vat,certificate_net,
    notified_sum,intended_payment,pay_less_reduction,final_payment_date,intended_payment_decision_id,intended_payment_decision_version,
    payment_notice_snapshot_id,pay_less_snapshot_id,deadline_snapshot_id,notice_mode,reason,source_snapshot,source_snapshot_sha256,source_snapshot_hash_scheme,idempotency_key,
    approved_by_user_id,approved_by_membership_id,approved_by_provider_user_id,approved_by_display_name,approved_role_key)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32) RETURNING *`,
    [clientId,runId,c.development_id,c.package_id,c.id,c.version,fromPence(cash),c.gross_value,c.retention,c.recovery_signed,c.vat,c.net_value,
      ready.notifiedSum,ready.intendedPayment,ready.payLessReduction,facts.deadline?.final_date_for_payment||null,facts.intended?.id||null,
      facts.intended?.decision_version||null,facts.paymentNotice?.id||null,facts.payLess?.id||null,facts.deadline?.id||null,ready.noticeMode,
      reason,JSON.stringify(sourceSnapshot),hashCanonicalJson(sourceSnapshot),CANONICAL_JSON_SHA256_V1,key,...actor(auth),auth.roleKey])).rows[0];
  for (const item of frozen) {
    const line = (await db.query(`INSERT INTO payment_authority_decision_lines(client_id,decision_id,package_id,certificate_id,
      variation_account_item_id,assessment_id,signed_assessment,signed_unapproved_at_lock,signed_existing_support,signed_unresolved_amount,
      signed_new_commercial_authority,basis,source_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [clientId,decision.id,c.package_id,c.id,item.assessment.variation_account_item_id,item.assessment.id,item.assessment.signed_current_assessment,
        fromPence(item.unapproved),fromPence(item.supported),fromPence(item.unapproved-item.supported),fromPence(item.newly),item.basis,JSON.stringify(item.snapshot)])).rows[0];
    for (const support of item.supports) await db.query(`INSERT INTO payment_authority_support_usages
      (client_id,decision_line_id,authority_allocation_id,signed_applied_amount,source_snapshot) VALUES($1,$2,$3,$4,$5)`,
      [clientId,line.id,support.source.id,support.amount,JSON.stringify(support.source)]);
    if (item.newly) await db.query(`INSERT INTO package_variation_account_authority_allocations(client_id,development_id,package_id,
      variation_account_item_id,source_type,future_source_id,payment_authority_decision_line_id,signed_allocated_amount,reason,
      source_status_snapshot,source_value_snapshot,source_reference_snapshot,created_by_user_id,created_by_membership_id,
      created_by_provider_user_id,created_by_display_name) VALUES($1,$2,$3,$4,'payment_authority',$5::text,$5::uuid,$6,$7,'approved',$6,$8,$9,$10,$11,$12)`,
      [clientId,c.development_id,c.package_id,item.assessment.variation_account_item_id,line.id,fromPence(item.newly),item.basis,
        `Payment Authority · Certificate ${c.certificate_number}`,...actor(auth)]);
  }
  await db.query(`INSERT INTO payment_authority_audit(client_id,run_id,decision_id,action,detail,actor_user_id,actor_membership_id,
    actor_provider_user_id,actor_display_name) VALUES($1,$2,$3,'approved',$4,$5,$6,$7,$8)`,
    [clientId,runId,decision.id,JSON.stringify({cashAmount:fromPence(cash)}),...actor(auth)]);
  return {ok:true,status:201,decisionId:decision.id};
}

module.exports = { listQueue, approveRun, reverseDecision, loadLockedFacts, eligibility, supportOptions, conciseQueueReason,
  verifyDecisionSnapshot: decision => verifyJsonIntegrity(decision.source_snapshot, decision.source_snapshot_sha256, decision.source_snapshot_hash_scheme) };
