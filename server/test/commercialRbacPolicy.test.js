const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { randomUUID } = require('node:crypto');
const createApp = require('../app');
const { pool } = require('../db');
const { createTestAuthAdapter } = require('../auth/authAdapters');
const { PERMISSIONS: P } = require('../auth/permissions');
const { prepareIntegrationTestDatabase, ensureActiveTestClient } = require('./integrationTestSetup');

const id = '00000000-0000-0000-0000-000000000099';
const principals = new Map();

async function rolePrincipal(roleKey) {
  if(principals.has(roleKey))return principals.get(roleKey);
  const result = await pool.query(
    `SELECT r.id role_id,r.name,array_agg(rp.permission_key ORDER BY rp.permission_key) permissions
       FROM roles r JOIN role_permissions rp ON rp.role_id=r.id
      WHERE r.key=$1 GROUP BY r.id`,
    [roleKey]
  );
  const row = result.rows[0];
  const clientId=await ensureActiveTestClient(pool);
  const providerUserId=`rbac-${roleKey}-${randomUUID()}`;
  const user=(await pool.query(`INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES('clerk',$1,$2,$3,'active') RETURNING id`,[providerUserId,`${providerUserId}@example.test`,`Authenticated ${row.name}`])).rows[0];
  const membership=(await pool.query(`INSERT INTO client_user_memberships(client_id,user_id,role_id,is_active) VALUES($1,$2,$3,true) RETURNING id`,[clientId,user.id,row.role_id])).rows[0];
  const principal={
    userId: user.id,
    providerUserId,
    displayName: `Authenticated ${row.name}`,
    clientId,
    membershipId: membership.id,
    roleKey,
    roleName: row.name,
    permissions: row.permissions,
    memberships: [],
  };
  principals.set(roleKey,principal);
  return principal;
}

async function expectDenied(app, method, route, body = {}) {
  const response = await request(app)[method](route).send(body);
  assert.equal(response.status, 403, `${method.toUpperCase()} ${route}: ${response.body?.message}`);
}

async function expectPastPermissionBoundary(app, method, route, body = {}) {
  const response = await request(app)[method](route).send(body);
  assert.notEqual(response.status, 401, `${method.toUpperCase()} ${route}`);
  assert.notEqual(response.status, 403, `${method.toUpperCase()} ${route}: ${response.body?.message}`);
}

test.before(async () => {
  await prepareIntegrationTestDatabase(pool);
});
test.after(async()=>{
  if(!principals.size)return;
  const userIds=[...principals.values()].map(item=>item.userId);
  await pool.query('ALTER TABLE authorization_action_audit DISABLE TRIGGER USER');
  await pool.query('DELETE FROM authorization_action_audit WHERE user_id=ANY($1::uuid[])',[userIds]);
  await pool.query('ALTER TABLE authorization_action_audit ENABLE TRIGGER USER');
  await pool.query('DELETE FROM client_user_memberships WHERE user_id=ANY($1::uuid[])',[userIds]);
  await pool.query('DELETE FROM buildlite_users WHERE id=ANY($1::uuid[])',[userIds]);
});

test('Migration 031 role grants implement the approved commercial authority matrix', async () => {
  const site = await rolePrincipal('site');
  const buyer = await rolePrincipal('buyer');
  const qs = await rolePrincipal('qs');
  const cm = await rolePrincipal('commercial_manager');
  const cd = await rolePrincipal('commercial_director');
  assert.ok(site.permissions.includes(P.CE_CREATE));
  for (const permission of [P.CE_EDIT,P.CE_SUBMIT,P.CE_APPROVE,P.CE_CLOSE,P.CE_EXPECTED_TREATMENT,P.CE_RECOVERY_WRITE_OFF,P.APPLICATION_RECORD]) assert.ok(!site.permissions.includes(permission));
  assert.ok(!buyer.permissions.includes(P.APPLICATION_RECORD));
  for (const permission of [P.CE_EDIT,P.CE_SUBMIT,P.CE_EXPECTED_TREATMENT,P.VO_CREATE,P.VO_EDIT,P.VO_SUBMIT,P.APPLICATION_RECORD,P.CERTIFICATE_CREATE,P.CERTIFICATE_EDIT,P.CERTIFICATE_SUBMIT,P.CERTIFICATE_DELETE_DRAFT,P.INTENDED_PAYMENT_PROPOSE,P.PAYMENT_NOTICE_PREPARE,P.PAY_LESS_PREPARE]) assert.ok(qs.permissions.includes(permission),permission);
  for (const permission of [P.CE_APPROVE,P.VO_APPROVE,P.VO_ISSUE,P.CERTIFICATE_REJECT,P.CERTIFICATE_LOCK,P.INTENDED_PAYMENT_CONFIRM,P.PAYMENT_NOTICE_ISSUE,P.PAY_LESS_ISSUE]) assert.ok(!qs.permissions.includes(permission),permission);
  for (const principal of [cm,cd]) for (const permission of [P.CE_APPROVE,P.CE_CLOSE,P.CE_RECOVERY_WRITE_OFF,P.VO_APPROVE,P.VO_ISSUE,P.CERTIFICATE_REJECT,P.CERTIFICATE_LOCK,P.INTENDED_PAYMENT_CONFIRM,P.PAYMENT_NOTICE_ISSUE,P.PAY_LESS_ISSUE]) assert.ok(principal.permissions.includes(permission),`${principal.roleKey}:${permission}`);
});

test('Site and QS Commercial Event boundaries follow the approved policy without denied writes', async () => {
  const sitePrincipal=await rolePrincipal('site'), qsPrincipal=await rolePrincipal('qs');
  const site=createApp({authAdapter:createTestAuthAdapter(sitePrincipal)}),qs=createApp({authAdapter:createTestAuthAdapter(qsPrincipal)});
  const cm=createApp({authAdapter:createTestAuthAdapter(await rolePrincipal('commercial_manager'))});
  const pkg=(await pool.query(`SELECT p.id,p.order_key,p.development_id FROM packages p WHERE p.client_id=$1 LIMIT 1`,[sitePrincipal.clientId])).rows[0];
  assert.ok(pkg,'A guarded Package fixture is required.');
  const before=Number((await pool.query('SELECT count(*) n FROM commercial_events')).rows[0].n);
  const payload={developmentId:pkg.development_id,packageId:pkg.order_key,eventType:'contraCharge',category:'design',responsibility:'employer',description:'Site-originated RBAC event',notes:'Site observation',attachments:[{id:'site-photo-1'}],costCode:'FORGED',poNumber:'FORGED',supplierId:'FORGED',arbitraryCommercialAuthority:'forged',value:999999,financialTreatment:'recoverableDeduction',vatTreatment:'zeroRated',linkedEventId:'ce-forged',recoveryPackageId:id,potentialContraCharge:true,potentialContraChargeNotes:'forged',relationshipType:'recovery',recoveredAmount:500,certificateStatus:'fullyIncluded',recoveryStatus:'fullyRecovered',raisedBy:'Forged Raised By',expectedTreatment:'override',expectedAmount:999999,actor:'Forged Browser Actor'};
  const created=await request(site).post('/api/commercial-events').send(payload);
  assert.equal(created.status,201,created.body?.message);
  const eventId=created.body.id;
  try {
    assert.equal(created.body.createdBy,sitePrincipal.displayName);
    assert.equal(created.body.raisedBy,sitePrincipal.displayName);
    assert.equal(created.body.eventType,'variation');
    assert.equal(created.body.value,0);
    assert.equal(created.body.financialTreatment,null);
    assert.equal(created.body.vatTreatment,'standard');
    assert.equal(created.body.linkedEventId,null);
    assert.equal(created.body.recoveryPackageId,null);
    assert.equal(created.body.potentialContraCharge,false);
    assert.equal(created.body.relationshipType,null);
    assert.equal(created.body.recoveredAmount,0);
    assert.equal(created.body.certificateStatus,'notIncluded');
    assert.equal(created.body.recoveryStatus,'notApplicable');
    assert.equal(created.body.costCode,(await pool.query('SELECT cost_code FROM packages WHERE id=$1',[pkg.id])).rows[0].cost_code);
    assert.notEqual(created.body.poNumber,'FORGED');
    assert.notEqual(created.body.supplierId,'FORGED');
    assert.equal(created.body.notes,'Site observation');
    assert.deepEqual(created.body.attachments,[{id:'site-photo-1'}]);
    assert.equal(created.body.arbitraryCommercialAuthority,undefined);
    for(const [method,route] of [['put',`/api/commercial-events/${eventId}`],['post',`/api/commercial-events/${eventId}/submit`],['patch',`/api/commercial-events/${eventId}/expected-liability`],['post',`/api/commercial-events/${eventId}/create-linked-recovery`],['post',`/api/commercial-events/${eventId}/approve`]]) await expectDenied(site,method,route,{version:created.body.version,actor:'Forged'});
    assert.equal(Number((await pool.query('SELECT count(*) n FROM commercial_events')).rows[0].n),before+1);
    const edited=await request(qs).put(`/api/commercial-events/${eventId}`).send({...created.body,description:'QS assessed event',value:100,version:created.body.version,raisedBy:'Forged Replacement',actor:'Forged Browser Actor'});
    assert.equal(edited.status,200,edited.body?.message);
    assert.equal(edited.body.updatedBy,qsPrincipal.displayName);
    assert.equal(edited.body.raisedBy,sitePrincipal.displayName);
    const submitted=await request(qs).post(`/api/commercial-events/${eventId}/submit`).send({version:edited.body.version,actor:'Forged Browser Actor'});
    assert.equal(submitted.status,200,submitted.body?.message);
    assert.equal(submitted.body.updatedBy,qsPrincipal.displayName);
    for(const action of ['approve','reject','close','dismiss-potential-contra']) await expectDenied(qs,'post',`/api/commercial-events/${eventId}/${action}`,{actor:'Forged'});
    const approved=await request(cm).post(`/api/commercial-events/${eventId}/approve`).send({version:submitted.body.version,actor:'Forged Browser Actor'});
    assert.equal(approved.status,200,approved.body?.message);
    assert.equal(approved.body.updatedBy,'Authenticated Commercial Manager');
    const actors=(await pool.query(`SELECT actor FROM commercial_event_audit WHERE commercial_event_id=$1 ORDER BY created_at`,[eventId])).rows.map(row=>row.actor);
    assert.ok(actors.includes(sitePrincipal.displayName));
    assert.ok(actors.includes(qsPrincipal.displayName));
    assert.ok(actors.includes('Authenticated Commercial Manager'));
    assert.ok(!actors.includes('Forged Browser Actor'));
  } finally {
    await pool.query('DELETE FROM commercial_event_audit WHERE commercial_event_id=$1',[eventId]);
    await pool.query('DELETE FROM commercial_events WHERE id=$1',[eventId]);
  }
});

test('VO, matrix, application and certificate boundaries distinguish preparation from approval', async () => {
  const site=createApp({authAdapter:createTestAuthAdapter(await rolePrincipal('site'))});
  const buyer=createApp({authAdapter:createTestAuthAdapter(await rolePrincipal('buyer'))});
  const qs=createApp({authAdapter:createTestAuthAdapter(await rolePrincipal('qs'))});
  const cm=createApp({authAdapter:createTestAuthAdapter(await rolePrincipal('commercial_manager'))});
  for(const [method,route] of [['post','/api/variation-orders'],['put',`/api/variation-orders/${id}`],['post',`/api/variation-orders/${id}/submit`]]) await expectPastPermissionBoundary(qs,method,route,{version:1});
  for(const action of ['approve','reject','issue','approve-and-issue']) await expectDenied(qs,'post',`/api/variation-orders/${id}/${action}`,{version:1});
  for(const action of ['approve','reject','issue','approve-and-issue']) await expectPastPermissionBoundary(cm,'post',`/api/variation-orders/${id}/${action}`,{version:1});
  await expectDenied(buyer,'put',`/api/packages/${id}/matrix`,{});
  await expectPastPermissionBoundary(qs,'put',`/api/packages/${id}/matrix`,{});
  for(const app of [site,buyer]) await expectDenied(app,'post',`/api/packages/${id}/payment-applications`,{});
  await expectPastPermissionBoundary(qs,'post',`/api/packages/${id}/payment-applications`,{});
  for(const [method,route] of [['post',`/api/packages/${id}/certificates`],['patch',`/api/packages/${id}/certificates/${id}`],['post',`/api/packages/${id}/certificates/${id}/submit`],['delete',`/api/packages/${id}/certificates/${id}`]]) await expectPastPermissionBoundary(qs,method,route,{version:1});
  for(const action of ['approve','reject']) await expectDenied(qs,'post',`/api/packages/${id}/certificates/${id}/${action}`,{version:1});
  for(const action of ['approve','reject']) await expectPastPermissionBoundary(cm,'post',`/api/packages/${id}/certificates/${id}/${action}`,{version:1});
});

test('intended-payment and statutory-notice boundaries separate prepare and issue authority', async () => {
  const qs=createApp({authAdapter:createTestAuthAdapter(await rolePrincipal('qs'))});
  const cm=createApp({authAdapter:createTestAuthAdapter(await rolePrincipal('commercial_manager'))});
  await expectPastPermissionBoundary(qs,'post',`/api/packages/${id}/certificates/${id}/intended-payments`,{confirm:false,intendedAmount:1});
  await expectDenied(qs,'post',`/api/packages/${id}/certificates/${id}/intended-payments`,{confirm:true,intendedAmount:1});
  await expectPastPermissionBoundary(cm,'post',`/api/packages/${id}/certificates/${id}/intended-payments`,{confirm:true,intendedAmount:1});
  await expectPastPermissionBoundary(qs,'post',`/api/packages/${id}/certificates/${id}/payment-notices`,{});
  await expectPastPermissionBoundary(qs,'post',`/api/packages/${id}/certificates/${id}/pay-less-notices`,{});
  await expectDenied(qs,'post',`/api/payment-notices/${id}/issue`,{});
  await expectPastPermissionBoundary(cm,'post',`/api/payment-notices/${id}/issue`,{});
});

test('persisted notice type, not caller input, selects the exact preparation permission', async () => {
  const authority=(await pool.query(`SELECT c.client_id,c.development_id,c.package_id,c.id certificate_id
    FROM package_payment_certificates c LIMIT 1`)).rows[0];
  assert.ok(authority,'A guarded certificate fixture is required.');
  const notices=[];
  try {
    for(const type of ['payment_notice','pay_less_notice']) {
      const row=(await pool.query(`INSERT INTO package_payment_notices
        (client_id,development_id,package_id,certificate_id,notice_type,notice_reference)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[authority.client_id,authority.development_id,authority.package_id,authority.certificate_id,type,`RBAC-${type}-${randomUUID()}`])).rows[0];
      notices.push({id:row.id,type});
    }
    const qsPrincipal=await rolePrincipal('qs');
    const base={...qsPrincipal,permissions:[P.PAYMENT_NOTICE_PREPARE]};
    const paymentOnly=createApp({authAdapter:createTestAuthAdapter(base)});
    const payLessOnly=createApp({authAdapter:createTestAuthAdapter({...base,permissions:[P.PAY_LESS_PREPARE]})});
    const payLess=notices.find(item=>item.type==='pay_less_notice');
    const payment=notices.find(item=>item.type==='payment_notice');
    const spoofedPayLess=await request(paymentOnly).patch(`/api/payment-notices/${payLess.id}`).send({noticeType:'payment_notice',version:1});
    assert.equal(spoofedPayLess.status,403);
    assert.match(spoofedPayLess.body.message,/pay_less\.prepare/);
    const spoofedPayment=await request(payLessOnly).patch(`/api/payment-notices/${payment.id}`).send({noticeType:'pay_less_notice',version:1});
    assert.equal(spoofedPayment.status,403);
    assert.match(spoofedPayment.body.message,/payment_notice\.prepare/);
    const paymentPatched=await request(paymentOnly).patch(`/api/payment-notices/${payment.id}`).send({noticeType:'pay_less_notice',notifiedSum:1,notifiedSumConfirmed:true,version:1});
    assert.equal(paymentPatched.status,200,paymentPatched.body?.message);
    const payLessPatched=await request(payLessOnly).patch(`/api/payment-notices/${payLess.id}`).send({noticeType:'payment_notice',basisOfCalculation:'Authenticated QS basis',version:1});
    assert.equal(payLessPatched.status,200,payLessPatched.body?.message);
    const cmPrincipal=await rolePrincipal('commercial_manager');
    const cm=createApp({authAdapter:createTestAuthAdapter(cmPrincipal)});
    const issueAttempt=await request(cm).post(`/api/payment-notices/${payLess.id}/issue`).send({noticeType:'payment_notice'});
    assert.equal(issueAttempt.status,409,issueAttempt.body?.message);
    const audit=(await pool.query(`SELECT permission_key,resource_params->>'noticeId' notice_id FROM authorization_action_audit WHERE user_id=ANY($1::uuid[]) AND resource_params->>'noticeId'=ANY($2::text[])`,[[qsPrincipal.userId,cmPrincipal.userId],notices.map(item=>item.id)])).rows;
    assert.ok(audit.some(row=>row.notice_id===payment.id&&row.permission_key===P.PAYMENT_NOTICE_PREPARE));
    assert.ok(audit.some(row=>row.notice_id===payLess.id&&row.permission_key===P.PAY_LESS_PREPARE));
    assert.ok(audit.some(row=>row.notice_id===payLess.id&&row.permission_key===P.PAY_LESS_ISSUE));
  } finally {
    if(notices.length){
      const noticeIds=notices.map(item=>item.id);
      await pool.query('ALTER TABLE package_payment_notice_audit DISABLE TRIGGER USER');
      await pool.query('DELETE FROM package_payment_notice_audit WHERE notice_id=ANY($1::uuid[])',[noticeIds]);
      await pool.query('ALTER TABLE package_payment_notice_audit ENABLE TRIGGER USER');
      await pool.query('DELETE FROM package_payment_notices WHERE id=ANY($1::uuid[])',[noticeIds]);
    }
  }
});

test('intended-payment confirmation records confirmation authority rather than proposal authority',async()=>{
  const cmPrincipal=await rolePrincipal('commercial_manager');
  const cm=createApp({authAdapter:createTestAuthAdapter(cmPrincipal)});
  const authority=(await pool.query(`SELECT package_id,id certificate_id FROM package_payment_certificates WHERE client_id=$1 LIMIT 1`,[cmPrincipal.clientId])).rows[0];
  assert.ok(authority,'A guarded certificate fixture is required.');
  let decisionId=null;
  try{
    const response=await request(cm).post(`/api/packages/${authority.package_id}/certificates/${authority.certificate_id}/intended-payments`).send({confirm:true,intendedAmount:1,actor:'Forged Confirmer'});
    assert.equal(response.status,201,response.body?.message);
    decisionId=response.body.decision?.id||response.body.id;
    const audit=(await pool.query(`SELECT permission_key FROM authorization_action_audit WHERE user_id=$1 AND resource_params->>'certificateId'=$2 ORDER BY authorized_at DESC LIMIT 1`,[cmPrincipal.userId,authority.certificate_id])).rows[0];
    assert.equal(audit?.permission_key,P.INTENDED_PAYMENT_CONFIRM);
    const persisted=(await pool.query(`SELECT state,actor FROM package_intended_payment_decisions WHERE id=$1`,[decisionId])).rows[0];
    assert.equal(persisted.state,'confirmed');
    assert.equal(persisted.actor,cmPrincipal.displayName);
  }finally{
    if(decisionId)await pool.query('DELETE FROM package_intended_payment_decisions WHERE id=$1',[decisionId]);
  }
});

test('strict service authority preserves authenticated QS evidence through CE to Draft VO creation', async () => {
  const qsPrincipal=await rolePrincipal('qs');
  const qs=createApp({authAdapter:createTestAuthAdapter(qsPrincipal)});
  const cm=createApp({authAdapter:createTestAuthAdapter(await rolePrincipal('commercial_manager'))});
  const site=createApp({authAdapter:createTestAuthAdapter(await rolePrincipal('site'))});
  const buyer=createApp({authAdapter:createTestAuthAdapter(await rolePrincipal('buyer'))});
  const pkg=(await pool.query(`SELECT p.id,p.order_key,p.development_id FROM packages p
    WHERE p.client_id=$1 AND EXISTS(SELECT 1 FROM package_purchase_orders ppo WHERE ppo.client_id=p.client_id AND ppo.package_id=p.id) LIMIT 1`,[qsPrincipal.clientId])).rows[0];
  assert.ok(pkg,'A Package with authoritative source PO is required.');
  let eventId=null,variationOrderId=null;
  const original=process.env.BUILDLITE_STRICT_SERVICE_AUTH;
  process.env.BUILDLITE_STRICT_SERVICE_AUTH='1';
  try {
    const created=await request(qs).post('/api/commercial-events').send({developmentId:pkg.development_id,packageId:pkg.order_key,eventType:'variation',category:'design',responsibility:'employer',description:'Strict CE to VO authority',value:125,actor:'Forged QS'});
    assert.equal(created.status,201,created.body?.message);
    eventId=created.body.id;
    const submitted=await request(qs).post(`/api/commercial-events/${eventId}/submit`).send({version:created.body.version,actor:'Forged QS'});
    assert.equal(submitted.status,200,submitted.body?.message);
    const approved=await request(cm).post(`/api/commercial-events/${eventId}/approve`).send({version:submitted.body.version,actor:'Forged CM'});
    assert.equal(approved.status,200,approved.body?.message);
    const beforeDenied=Number((await pool.query('SELECT count(*) n FROM variation_orders WHERE client_id=$1',[qsPrincipal.clientId])).rows[0].n);
    for(const unpermitted of [site,buyer]){
      const denied=await request(unpermitted).post(`/api/variation-orders/from-commercial-event/${eventId}`).send({actor:'Forged VO Creator'});
      assert.equal(denied.status,403,denied.body?.message);
    }
    assert.equal(Number((await pool.query('SELECT count(*) n FROM variation_orders WHERE client_id=$1',[qsPrincipal.clientId])).rows[0].n),beforeDenied);
    const response=await request(qs).post(`/api/variation-orders/from-commercial-event/${eventId}`).send({actor:'Forged VO Creator'});
    assert.equal(response.status,201,response.body?.message);
    variationOrderId=response.body.id;
    const persisted=(await pool.query('SELECT status,created_by FROM variation_orders WHERE client_id=$1 AND id=$2',[qsPrincipal.clientId,variationOrderId])).rows[0];
    assert.equal(persisted.status,'draft');
    assert.equal(persisted.created_by,qsPrincipal.displayName);
    const audit=(await pool.query(`SELECT actor FROM variation_order_audit WHERE client_id=$1 AND variation_order_id=$2 AND action='created'`,[qsPrincipal.clientId,variationOrderId])).rows[0];
    assert.equal(audit.actor,qsPrincipal.displayName);
  } finally {
    process.env.BUILDLITE_STRICT_SERVICE_AUTH=original;
    if(variationOrderId) {
      await pool.query('DELETE FROM variation_order_audit WHERE variation_order_id=$1',[variationOrderId]);
      await pool.query('DELETE FROM variation_order_commercial_events WHERE variation_order_id=$1',[variationOrderId]);
      await pool.query('DELETE FROM variation_order_lines WHERE variation_order_id=$1',[variationOrderId]);
      await pool.query('DELETE FROM variation_orders WHERE id=$1',[variationOrderId]);
    }
    if(eventId) {
      await pool.query('DELETE FROM commercial_event_audit WHERE commercial_event_id=$1',[eventId]);
      await pool.query('DELETE FROM commercial_events WHERE id=$1',[eventId]);
    }
  }
});

test('strict QS and CM/CD Variation Order lifecycle persists successful preparation and decisions',async()=>{
  const qsPrincipal=await rolePrincipal('qs');
  const qs=createApp({authAdapter:createTestAuthAdapter(qsPrincipal)});
  const cm=createApp({authAdapter:createTestAuthAdapter(await rolePrincipal('commercial_manager'))});
  const cd=createApp({authAdapter:createTestAuthAdapter(await rolePrincipal('commercial_director'))});
  const pkg=(await pool.query(`SELECT p.id,p.order_key,p.development_id,p.supplier_id,ppo.po_number,cc.id cost_code_id,cc.code cost_code FROM packages p JOIN package_purchase_orders ppo ON ppo.client_id=p.client_id AND ppo.package_id=p.id JOIN cost_codes cc ON cc.client_id=p.client_id AND lower(cc.code)=lower(p.cost_code) WHERE p.client_id=$1 AND cc.is_active LIMIT 1`,[qsPrincipal.clientId])).rows[0];
  assert.ok(pkg,'A Package with source PO and active Cost Code is required.');
  const createdIds=[];
  const eventIds=[];
  const create=async description=>{
    let event=await request(qs).post('/api/commercial-events').send({developmentId:pkg.development_id,packageId:pkg.order_key,eventType:'variation',category:'commercial',responsibility:'commercial',description,value:125});
    assert.equal(event.status,201,event.body?.message);eventIds.push(event.body.id);
    event=await request(qs).post(`/api/commercial-events/${event.body.id}/submit`).send({version:event.body.version});
    assert.equal(event.status,200,event.body?.message);
    event=await request(cm).post(`/api/commercial-events/${event.body.id}/approve`).send({version:event.body.version});
    assert.equal(event.status,200,event.body?.message);
    const response=await request(qs).post(`/api/variation-orders/from-commercial-event/${event.body.id}`).send({});
    assert.equal(response.status,201,response.body?.message);createdIds.push(response.body.id);
    const reviewed=await request(qs).put(`/api/variation-orders/${response.body.id}`).send({version:response.body.version,reference:response.body.reference,description,lines:[{costCodeId:pkg.cost_code_id,costCode:pkg.cost_code,description,netValue:125}]});
    assert.equal(reviewed.status,200,reviewed.body?.message);return reviewed.body;
  };
  try{
    let sequential=await create('RBAC sequential VO');
    let response=await request(qs).put(`/api/variation-orders/${sequential.id}`).send({version:sequential.version,reference:sequential.reference,description:'RBAC sequential VO edited',lines:sequential.lines,actor:'Forged Editor'});
    assert.equal(response.status,200,response.body?.message);sequential=response.body;assert.equal(sequential.updatedBy,qsPrincipal.displayName);
    response=await request(qs).post(`/api/variation-orders/${sequential.id}/submit`).send({version:sequential.version,actor:'Forged Submitter'});
    assert.equal(response.status,200,response.body?.message);sequential=response.body;assert.equal(sequential.status,'submitted');
    const denied=await request(qs).post(`/api/variation-orders/${sequential.id}/approve`).send({version:sequential.version,actor:'Forged Approver'});
    assert.equal(denied.status,403);assert.equal((await pool.query('SELECT status FROM variation_orders WHERE id=$1',[sequential.id])).rows[0].status,'submitted');
    response=await request(cm).post(`/api/variation-orders/${sequential.id}/approve`).send({version:sequential.version,actor:'Forged Approver'});
    assert.equal(response.status,200,response.body?.message);sequential=response.body;assert.equal(sequential.status,'approved');
    response=await request(cd).post(`/api/variation-orders/${sequential.id}/issue`).send({version:sequential.version,comment:'Issue accepted',actor:'Forged Issuer'});
    assert.equal(response.status,200,response.body?.message);assert.equal(response.body.status,'issued');assert.equal(response.body.issuedBy,(await rolePrincipal('commercial_director')).displayName);

    let rejected=await create('RBAC rejected VO');
    rejected=(await request(qs).post(`/api/variation-orders/${rejected.id}/submit`).send({version:rejected.version})).body;
    response=await request(cm).post(`/api/variation-orders/${rejected.id}/reject`).send({version:rejected.version,comment:'Return for correction'});
    assert.equal(response.status,200,response.body?.message);assert.equal(response.body.status,'rejected');

    let combined=await create('RBAC combined VO');
    combined=(await request(qs).post(`/api/variation-orders/${combined.id}/submit`).send({version:combined.version})).body;
    const cdPrincipal=await rolePrincipal('commercial_director');
    const approveOnly=createApp({authAdapter:createTestAuthAdapter({...cdPrincipal,permissions:[P.VO_APPROVE]})});
    const partial=await request(approveOnly).post(`/api/variation-orders/${combined.id}/approve-and-issue`).send({version:combined.version,comment:'Incomplete authority'});
    assert.equal(partial.status,403,partial.body?.message);
    assert.equal((await pool.query('SELECT status FROM variation_orders WHERE id=$1',[combined.id])).rows[0].status,'submitted');
    response=await request(cd).post(`/api/variation-orders/${combined.id}/approve-and-issue`).send({version:combined.version,comment:'Combined authority'});
    assert.equal(response.status,200,response.body?.message);assert.equal(response.body.status,'issued');
    assert.deepEqual(response.body.audit.slice(-2).map(entry=>entry.action),['approve','issue']);
  }finally{
    if(createdIds.length){
      await pool.query('DELETE FROM variation_order_audit WHERE variation_order_id=ANY($1::uuid[])',[createdIds]);
      await pool.query('DELETE FROM variation_order_commercial_events WHERE variation_order_id=ANY($1::uuid[])',[createdIds]);
      await pool.query('DELETE FROM variation_order_lines WHERE variation_order_id=ANY($1::uuid[])',[createdIds]);
      await pool.query('DELETE FROM variation_orders WHERE id=ANY($1::uuid[])',[createdIds]);
    }
    if(eventIds.length){
      await pool.query('DELETE FROM commercial_event_audit WHERE commercial_event_id=ANY($1::text[])',[eventIds]);
      await pool.query('DELETE FROM commercial_events WHERE id=ANY($1::text[])',[eventIds]);
    }
  }
});

test('unauthenticated requests fail and the retired legacy certificate mutation is 404 in production', async () => {
  const anonymous=createApp({authAdapter:createTestAuthAdapter(null)});
  assert.equal((await request(anonymous).post('/api/commercial-events').send({})).status,401);
  const original=process.env.NODE_ENV;
  process.env.NODE_ENV='production';
  try {
    const qs=createApp({authAdapter:createTestAuthAdapter(await rolePrincipal('qs'))});
    const before=Number((await pool.query('SELECT count(*) n FROM payment_certificates')).rows[0].n);
    const response=await request(qs).post('/api/payments/certificates').send({actor:'Forged'});
    assert.equal(response.status,404);
    assert.equal(Number((await pool.query('SELECT count(*) n FROM payment_certificates')).rows[0].n),before);
  } finally { process.env.NODE_ENV=original; }
});

test('authoritative services fail closed when direct callers omit permission evidence', async () => {
  const original=process.env.BUILDLITE_STRICT_SERVICE_AUTH;
  process.env.BUILDLITE_STRICT_SERVICE_AUTH='1';
  try {
    const ce=require('../services/commercialEventRepository');
    const vo=require('../services/variationOrderRepository');
    const matrix=require('../services/orderMatrixRepository');
    const applications=require('../services/paymentApplicationRepository');
    const certificates=require('../services/paymentCertificateRepository');
    const notices=require('../services/paymentNoticeRepository');
    const calls=[
      ()=>ce.createCommercialEvent('tenant',{}),
      ()=>vo.createDraftVariationOrder('tenant',{}),
      ()=>matrix.upsertMatrixForPackage('tenant',id,{},1),
      ()=>applications.createApplication('tenant',id,{}),
      ()=>certificates.createCertificateForPackage('tenant',id,{}),
      ()=>notices.createPaymentNotice('tenant',id,id,{}),
      ()=>notices.createDecision('tenant',id,id,{confirm:false}),
    ];
    for(const invoke of calls) await assert.rejects(Promise.resolve().then(invoke),error=>error.status===401||error.status===403);
  } finally { process.env.BUILDLITE_STRICT_SERVICE_AUTH=original; }
});
