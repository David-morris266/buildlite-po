const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { randomUUID } = require('node:crypto');
const createApp = require('../app');
const { pool } = require('../db');
const { createTestAuthAdapter } = require('../auth/authAdapters');
const { PERMISSIONS: P } = require('../auth/permissions');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');

const clients=[];
const users=[];
const originalStrict=process.env.BUILDLITE_STRICT_SERVICE_AUTH;

const noticeConfiguration={
  paymentNoticeMode:'separate_payment_notice',paymentNoticeIssuer:'company',certificateDocumentConstitutesNotice:false,
  basisOfCalculationRequired:true,paymentNoticeDocumentIdentity:'payment_notice',payLessIssuer:'company',payLessWorkflowSupported:true,
};
const paymentRules={
  configurationState:'complete',ruleType:'uk_subcontract_payment_cycle',jurisdiction:'england_wales',timezone:'Europe/London',
  anchor:{type:'contractual_valuation_date'},dueDate:{relativeTo:'anchor',direction:'after',days:7,dayBasis:'calendar'},
  paymentNoticeDeadline:{relativeTo:'due_date',direction:'after',days:5,dayBasis:'calendar'},
  finalDateForPayment:{relativeTo:'due_date',direction:'after',days:28,dayBasis:'calendar'},
  payLessNoticeDeadline:{relativeTo:'final_date_for_payment',direction:'before',days:7,dayBasis:'calendar'},notice:noticeConfiguration,
};

async function seedTenant(label){
  const client=(await pool.query(`INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING *`,[`RBAC_NOTICE_${label}_${randomUUID().slice(0,6)}`,`RBAC Notice ${label}`])).rows[0];
  clients.push(client.id);
  const developmentId=`dev-rbac-notice-${randomUUID()}`;
  await pool.query(`INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,$3,$4,'live','{}')`,[developmentId,client.id,label,`Notice ${label}`]);
  const pkg=(await pool.query(`INSERT INTO packages(client_id,development_id,supplier_id,cost_code,order_key) VALUES($1,$2,'supplier','1000',$3) RETURNING *`,[client.id,developmentId,`subcontract:${randomUUID()}`])).rows[0];
  const certificate=(await pool.query(`INSERT INTO package_payment_certificates(client_id,package_id,development_id,order_key,certificate_number,status,certificate_date,contractual_valuation_date,payload,version,gross_value,net_value,matrix_gross,commercial_event_gross,recovery_signed,retention,vat,retention_rate,vat_rate)
    VALUES($1,$2,$3,$4,1,'locked','2026-09-01','2026-09-01','{}',3,1000,1040,1000,0,-100,50,190,.05,.2) RETURNING *`,[client.id,pkg.id,developmentId,pkg.order_key])).rows[0];
  const terms={state:'common',readiness:'configured',familyName:'Standard',termsVersionId:null,revisionNumber:4,rulesSchemaVersion:2,paymentRules};
  await pool.query(`INSERT INTO package_payment_certificate_deadline_snapshots(client_id,certificate_id,package_id,development_id,stage,attempt_number,certificate_version,readiness,calculation_status,calculation_version,rules_schema_version,anchor_type,anchor_value,contractual_valuation_date,due_date,payment_notice_deadline,final_date_for_payment,pay_less_notice_deadline,governing_terms_snapshot,application_snapshot,cycle_inputs,reasons,captured_by)
    VALUES($1,$2,$3,$4,'locked',1,3,'ready','calculated','payment-deadlines-v1',2,'contractual_valuation_date','2026-09-01','2026-09-01','2026-09-08','2026-09-13','2026-10-06','2026-09-29',$5,$6,'{}','[]','Authenticated QS')`,[client.id,certificate.id,pkg.id,developmentId,JSON.stringify(terms),JSON.stringify({id:randomUUID(),revisionNumber:2,applicationReference:`APP-${label}`})]);
  return {client,developmentId,pkg,certificate};
}

async function principal(clientId,roleKey){
  const role=(await pool.query(`SELECT r.id,r.name,array_agg(rp.permission_key ORDER BY rp.permission_key) permissions FROM roles r JOIN role_permissions rp ON rp.role_id=r.id WHERE r.key=$1 GROUP BY r.id`,[roleKey])).rows[0];
  const providerUserId=`notice-${roleKey}-${randomUUID()}`;
  const user=(await pool.query(`INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES('clerk',$1,$2,$3,'active') RETURNING id`,[providerUserId,`${providerUserId}@example.test`,`Notice ${role.name}`])).rows[0];
  users.push(user.id);
  const membership=(await pool.query(`INSERT INTO client_user_memberships(client_id,user_id,role_id,is_active) VALUES($1,$2,$3,true) RETURNING id`,[clientId,user.id,role.id])).rows[0];
  return {userId:user.id,providerUserId,displayName:`Notice ${role.name}`,clientId,membershipId:membership.id,roleKey,roleName:role.name,permissions:role.permissions,memberships:[]};
}

function permissionRows(userIds){
  return pool.query(`SELECT user_id,permission_key,resource_params FROM authorization_action_audit WHERE user_id=ANY($1::uuid[]) ORDER BY authorized_at`,[userIds]).then(result=>result.rows);
}

test.before(async()=>{await prepareIntegrationTestDatabase(pool);process.env.BUILDLITE_STRICT_SERVICE_AUTH='1';});
test.after(async()=>{
  process.env.BUILDLITE_STRICT_SERVICE_AUTH=originalStrict;
  if(users.length){
    await pool.query('ALTER TABLE authorization_action_audit DISABLE TRIGGER USER');
    await pool.query('DELETE FROM authorization_action_audit WHERE user_id=ANY($1::uuid[])',[users]);
    await pool.query('ALTER TABLE authorization_action_audit ENABLE TRIGGER USER');
  }
  if(clients.length){
    await pool.query('ALTER TABLE commercial_documents DISABLE TRIGGER USER');
    await pool.query('ALTER TABLE package_payment_notice_snapshots DISABLE TRIGGER USER');
    await pool.query('ALTER TABLE package_payment_certificate_deadline_snapshots DISABLE TRIGGER USER');
    await pool.query('ALTER TABLE package_intended_payment_decisions DISABLE TRIGGER USER');
    await pool.query('DELETE FROM commercial_document_audit WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM commercial_documents WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM package_payment_notice_audit WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM package_payment_notice_snapshots WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM package_payment_notices WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM package_intended_payment_decisions WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM package_payment_certificate_deadline_snapshots WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM package_payment_certificates WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM packages WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM developments WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM client_user_memberships WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM buildlite_users WHERE id=ANY($1::uuid[])',[users]);
    await pool.query('DELETE FROM clients WHERE id=ANY($1::uuid[])',[clients]);
    await pool.query('ALTER TABLE commercial_documents ENABLE TRIGGER USER');
    await pool.query('ALTER TABLE package_payment_notice_snapshots ENABLE TRIGGER USER');
    await pool.query('ALTER TABLE package_payment_certificate_deadline_snapshots ENABLE TRIGGER USER');
    await pool.query('ALTER TABLE package_intended_payment_decisions ENABLE TRIGGER USER');
  }
});

test('authenticated QS and CM complete Payment Notice, Intended Payment and Pay Less routes',async()=>{
  const fixture=await seedTenant('FLOW');
  const qsPrincipal=await principal(fixture.client.id,'qs');
  const cmPrincipal=await principal(fixture.client.id,'commercial_manager');
  const qs=createApp({authAdapter:createTestAuthAdapter(qsPrincipal)});
  const cm=createApp({authAdapter:createTestAuthAdapter(cmPrincipal)});
  const certificateBefore=(await pool.query('SELECT gross_value,net_value,retention,vat,version FROM package_payment_certificates WHERE id=$1',[fixture.certificate.id])).rows[0];

  let response=await request(qs).post(`/api/packages/${fixture.pkg.id}/certificates/${fixture.certificate.id}/payment-notices`).send({actor:'Forged Creator'});
  assert.equal(response.status,201,response.body?.message);let payment=response.body.notice;assert.equal(payment.status,'draft');assert.equal(payment.developmentId,fixture.developmentId);
  response=await request(qs).patch(`/api/payment-notices/${payment.id}`).send({version:payment.version,notifiedSum:1000,notifiedSumConfirmed:true,basisOfCalculation:'QS locked-certificate assessment',actor:'Forged Editor'});
  assert.equal(response.status,200,response.body?.message);payment=response.body.notice;assert.equal(payment.draft.notifiedSum,1000);
  response=await request(qs).post(`/api/payment-notices/${payment.id}/prepare`).send({actor:'Forged Preparer'});
  assert.equal(response.status,200,response.body?.message);payment=response.body.workspace.notices.find(item=>item.id===payment.id);assert.equal(payment.status,'prepared');assert.equal(payment.preparedSnapshot.actor,qsPrincipal.displayName);
  response=await request(cm).post(`/api/payment-notices/${payment.id}/issue`).send({actor:'Forged Issuer'});
  assert.equal(response.status,200,response.body?.message);payment=response.body.workspace.notices.find(item=>item.id===payment.id);assert.equal(payment.status,'issued');assert.equal(payment.issuedSnapshot.actor,cmPrincipal.displayName);

  response=await request(qs).post(`/api/packages/${fixture.pkg.id}/certificates/${fixture.certificate.id}/intended-payments`).send({confirm:false,intendedAmount:800,basis:'QS proposal',actor:'Forged Proposer'});
  assert.equal(response.status,201,response.body?.message);assert.equal(response.body.decision.state,'proposed');
  response=await request(cm).post(`/api/packages/${fixture.pkg.id}/certificates/${fixture.certificate.id}/intended-payments`).send({confirm:true,intendedAmount:800,basis:'CM confirmation',actor:'Forged Confirmer'});
  assert.equal(response.status,201,response.body?.message);assert.equal(response.body.decision.state,'confirmed');

  response=await request(qs).post(`/api/packages/${fixture.pkg.id}/certificates/${fixture.certificate.id}/pay-less-notices`).send({actor:'Forged Creator'});
  assert.equal(response.status,201,response.body?.message);let payLess=response.body.notice;assert.equal(payLess.status,'draft');
  response=await request(qs).patch(`/api/payment-notices/${payLess.id}`).send({version:payLess.version,basisOfCalculation:'£200 reduction following commercial review',actor:'Forged Editor'});
  assert.equal(response.status,200,response.body?.message);payLess=response.body.notice;assert.equal(payLess.draft.basisConfirmed,true);
  response=await request(qs).post(`/api/payment-notices/${payLess.id}/prepare`).send({actor:'Forged Preparer'});
  assert.equal(response.status,200,response.body?.message);payLess=response.body.workspace.notices.find(item=>item.id===payLess.id);assert.equal(payLess.status,'prepared');assert.equal(payLess.preparedSnapshot.actor,qsPrincipal.displayName);
  response=await request(cm).post(`/api/payment-notices/${payLess.id}/issue`).send({actor:'Forged Issuer'});
  assert.equal(response.status,200,response.body?.message);payLess=response.body.workspace.notices.find(item=>item.id===payLess.id);assert.equal(payLess.status,'issued');assert.equal(payLess.issuedSnapshot.actor,cmPrincipal.displayName);

  const decisions=(await pool.query('SELECT state,actor,client_id,development_id FROM package_intended_payment_decisions WHERE certificate_id=$1 ORDER BY decision_version',[fixture.certificate.id])).rows;
  assert.deepEqual(decisions.map(row=>row.state),['proposed','confirmed']);
  assert.deepEqual(decisions.map(row=>row.actor),[qsPrincipal.displayName,cmPrincipal.displayName]);
  assert.ok(decisions.every(row=>row.client_id===fixture.client.id&&row.development_id===fixture.developmentId));
  const domain=(await pool.query(`SELECT notice_id,action,actor FROM package_payment_notice_audit WHERE notice_id=ANY($1::uuid[]) ORDER BY created_at`,[[payment.id,payLess.id]])).rows;
  assert.ok(domain.some(row=>row.notice_id===payment.id&&row.action==='issued'&&row.actor===cmPrincipal.displayName));
  assert.ok(domain.some(row=>row.notice_id===payLess.id&&row.action==='issued'&&row.actor===cmPrincipal.displayName));
  const permissions=await permissionRows([qsPrincipal.userId,cmPrincipal.userId]);
  const keys=permissions.map(row=>row.permission_key);
  for(const expected of [P.PAYMENT_NOTICE_PREPARE,P.PAYMENT_NOTICE_ISSUE,P.INTENDED_PAYMENT_PROPOSE,P.INTENDED_PAYMENT_CONFIRM,P.PAY_LESS_PREPARE,P.PAY_LESS_ISSUE])assert.ok(keys.includes(expected),expected);
  assert.equal(permissions.filter(row=>row.user_id===qsPrincipal.userId&&row.permission_key===P.INTENDED_PAYMENT_CONFIRM).length,0);
  assert.equal(permissions.filter(row=>row.user_id===cmPrincipal.userId&&row.permission_key===P.INTENDED_PAYMENT_PROPOSE).length,0);
  const certificateAfter=(await pool.query('SELECT gross_value,net_value,retention,vat,version FROM package_payment_certificates WHERE id=$1',[fixture.certificate.id])).rows[0];
  assert.deepEqual(certificateAfter,certificateBefore);
});

test('tenant-scoped notice and commercial-document routes do not disclose foreign evidence',async()=>{
  const tenantA=await seedTenant('TENANT_A');
  const tenantB=await seedTenant('TENANT_B');
  const qsPrincipal=await principal(tenantA.client.id,'qs');
  const cmPrincipal=await principal(tenantA.client.id,'commercial_manager');
  const qs=createApp({authAdapter:createTestAuthAdapter(qsPrincipal)});
  const cm=createApp({authAdapter:createTestAuthAdapter(cmPrincipal)});
  const foreignNotice=(await pool.query(`INSERT INTO package_payment_notices(client_id,development_id,package_id,certificate_id,notice_type,notice_reference,draft_data,created_by,updated_by) VALUES($1,$2,$3,$4,'payment_notice',$5,$6,'Tenant B','Tenant B') RETURNING *`,[tenantB.client.id,tenantB.developmentId,tenantB.pkg.id,tenantB.certificate.id,`PN-FOREIGN-${randomUUID()}`,JSON.stringify({notifiedSum:1040,notifiedSumConfirmed:true,basisOfCalculation:'Foreign evidence'})])).rows[0];
  const foreignDocument=(await pool.query(`INSERT INTO commercial_documents(client_id,development_id,package_id,certificate_id,document_type,document_reference,source_authority_type,source_authority_id,source_snapshot_ids,document_schema_version,template_version,render_payload,recipient_snapshot,binary_data,sha256,generated_by) VALUES($1,$2,$3,$4,'payment_notice',$5,'issued_payment_notice',$6,'{}',1,'test','{}','{}',$7,$8,'Tenant B') RETURNING id`,[tenantB.client.id,tenantB.developmentId,tenantB.pkg.id,tenantB.certificate.id,`DOC-FOREIGN-${randomUUID()}`,foreignNotice.id,Buffer.from('%PDF-test'),'0'.repeat(64)])).rows[0];
  const before={status:foreignNotice.status,version:Number(foreignNotice.version),audit:Number((await pool.query('SELECT count(*) n FROM package_payment_notice_audit WHERE notice_id=$1',[foreignNotice.id])).rows[0].n)};
  const responses=[
    await request(qs).get(`/api/packages/${tenantB.pkg.id}/certificates/${tenantB.certificate.id}/payment-authority`),
    await request(qs).patch(`/api/payment-notices/${foreignNotice.id}`).send({version:1,notifiedSum:1,notifiedSumConfirmed:true,basisOfCalculation:'Attack'}),
    await request(qs).post(`/api/payment-notices/${foreignNotice.id}/prepare`).send({}),
    await request(cm).post(`/api/payment-notices/${foreignNotice.id}/issue`).send({}),
    await request(qs).get(`/api/commercial-documents/${foreignDocument.id}`),
    await request(qs).get(`/api/commercial-documents/${foreignDocument.id}/pdf`),
  ];
  for(const response of responses){assert.ok([403,404].includes(response.status),`${response.status}: ${response.body?.message}`);assert.doesNotMatch(String(response.body?.message||''),/Tenant B|Foreign evidence|DOC-FOREIGN/);}
  const after=(await pool.query('SELECT status,version FROM package_payment_notices WHERE id=$1',[foreignNotice.id])).rows[0];
  assert.deepEqual({status:after.status,version:Number(after.version)}, {status:before.status,version:before.version});
  assert.equal(Number((await pool.query('SELECT count(*) n FROM package_payment_notice_audit WHERE notice_id=$1',[foreignNotice.id])).rows[0].n),before.audit);
  assert.equal(Number((await pool.query('SELECT count(*) n FROM commercial_document_audit WHERE document_id=$1',[foreignDocument.id])).rows[0].n),0);
});
