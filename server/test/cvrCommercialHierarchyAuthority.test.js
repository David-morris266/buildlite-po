const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pool, isDbConfigured } = require('../db');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');
const hierarchy = require('../services/cvrCommercialHierarchySnapshot');
const periods = require('../services/cvrPeriodRepository');
const { buildCvrCloseCandidate } = require('../services/cvrCloseEngine');

const migration = name => fs.readFileSync(path.join(__dirname, '..', 'migrations', name), 'utf8');
let fixture;

async function applyIfMissing(table, file) {
  const exists = (await pool.query('SELECT to_regclass($1) name', [`public.${table}`])).rows[0].name;
  if (!exists) await pool.query(migration(file));
}

function fakeHierarchyRows() {
  return [
    { id:'two',code:'A',description:'Two level',is_active:true,commercial_head_id:'h1',reporting_group_id:'g1',head_id:'h1',head_name:'Custom Head',head_display_order:2,head_active:true,group_id:'g1',group_name:'Direct Group',group_display_order:1,group_active:true,group_head_id:'h1',group_family_id:null },
    { id:'three',code:'B',description:'Three level',is_active:true,commercial_head_id:'h2',commercial_family_id:'f2',reporting_group_id:'g2',head_id:'h2',head_name:'Build',head_active:true,family_id:'f2',family_name:'Envelope',family_active:true,family_head_id:'h2',group_id:'g2',group_name:'Brickwork',group_active:true,group_head_id:'h2',group_family_id:'f2' },
    { id:'empty',code:'C',description:'Unallocated',is_active:true },
    { id:'legacy',code:'D',description:'Legacy',is_active:true,commercial_head:'Old Head',reporting_group:'Old Group' },
    { id:'not-applicable',code:'NA',description:'Not applicable',is_active:true,trade:'Legacy control',hierarchy_review_disposition:'not_applicable' },
    { id:'archived',code:'E',description:'Archived',is_active:true,commercial_head_id:'ha',reporting_group_id:'ga',head_id:'ha',head_name:'Old Head',head_active:false,group_id:'ga',group_name:'Old Group',group_active:true,group_head_id:'ha',group_family_id:null },
    { id:'invalid',code:'F',description:'Invalid',is_active:true,commercial_head_id:'h1',reporting_group_id:'g2',head_id:'h1',head_name:'Custom Head',head_active:true,group_id:'g2',group_name:'Brickwork',group_active:true,group_head_id:'h2',group_family_id:'f2' },
  ];
}

test('resolution model preserves two/three-level authority and all explicit non-authoritative states', () => {
  const document = hierarchy.canonicalDocument(fakeHierarchyRows());
  const byCode = new Map(document.costCodes.map(row => [row.costCodeKey, row]));
  assert.equal(byCode.get('A').resolutionState, 'allocated');
  assert.equal(byCode.get('A').family, null);
  assert.equal(byCode.get('A').head.name, 'Custom Head');
  assert.equal(byCode.get('B').resolutionState, 'allocated');
  assert.equal(byCode.get('B').family.name, 'Envelope');
  assert.equal(byCode.get('C').resolutionState, 'unallocated');
  assert.equal(byCode.get('D').resolutionState, 'unresolved_legacy');
  assert.equal(byCode.get('D').head, null);
  assert.equal(byCode.get('NA').resolutionState, 'not_applicable');
  assert.equal(byCode.get('NA').head, null);
  assert.equal(byCode.get('NA').family, null);
  assert.equal(byCode.get('NA').reportingGroup, null);
  assert.equal(byCode.get('NA').legacyEvidence.reportingGroup, 'Legacy control');
  assert.equal(byCode.get('E').resolutionState, 'archived_assignment');
  assert.equal(byCode.get('F').resolutionState, 'invalid_assignment');
  assert.equal(hierarchy.resolveCostCodes(document, ['missing'])[0].resolutionState, 'missing_cost_code');
});

test('authority access fails closed instead of manufacturing an empty hierarchy', async () => {
  await assert.rejects(
    hierarchy.liveDocument({query: async () => { throw new Error('authority unavailable'); }}, 'tenant'),
    /authority unavailable/
  );
});

if (!isDbConfigured()) {
  test('CVR Commercial Structure integration skipped - test DB unavailable', () => assert.ok(true));
} else {
  test.before(async () => {
    await prepareIntegrationTestDatabase(pool);
    await applyIfMissing('commercial_structure_heads', '046_tenant_commercial_structure.sql');
    await applyIfMissing('cvr_period_hierarchy_submissions', '047_cvr_commercial_hierarchy_evidence.sql');
    const client = (await pool.query("INSERT INTO clients(code,name,is_active) VALUES($1,'Hierarchy CVR',false) RETURNING *", [`HCVR_${randomUUID().slice(0,8)}`])).rows[0];
    const other = (await pool.query("INSERT INTO clients(code,name,is_active) VALUES($1,'Other hierarchy',false) RETURNING *", [`HOTH_${randomUUID().slice(0,8)}`])).rows[0];
    const developmentId = `dev-${randomUUID()}`;
    await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,'HCVR','Hierarchy CVR','live','{}')", [developmentId, client.id]);
    const head = (await pool.query("INSERT INTO commercial_structure_heads(client_id,name,display_order) VALUES($1,'Tenant Custom',3) RETURNING *", [client.id])).rows[0];
    const direct = (await pool.query("INSERT INTO commercial_structure_reporting_groups(client_id,head_id,name,display_order) VALUES($1,$2,'Direct',4) RETURNING *", [client.id, head.id])).rows[0];
    const family = (await pool.query("INSERT INTO commercial_structure_families(client_id,head_id,name,display_order) VALUES($1,$2,'Family',5) RETURNING *", [client.id, head.id])).rows[0];
    const nested = (await pool.query("INSERT INTO commercial_structure_reporting_groups(client_id,head_id,family_id,name,display_order) VALUES($1,$2,$3,'Nested',6) RETURNING *", [client.id, head.id, family.id])).rows[0];
    await pool.query("INSERT INTO cost_codes(client_id,code,description,commercial_head_id,reporting_group_id,commercial_head,reporting_group,trade,is_active) VALUES($1,'TWO','Two',$2,$3,'Tenant Custom','Direct','Direct',true),($1,'EMPTY','Empty',NULL,NULL,NULL,NULL,NULL,true),($1,'LEGACY','Legacy',NULL,NULL,'Historic',NULL,'Historic Group',true)", [client.id, head.id, direct.id]);
    const notApplicable = (await pool.query("INSERT INTO cost_codes(client_id,code,description,trade,hierarchy_review_disposition,is_active) VALUES($1,'NOTAPP','Revenue control','Legacy revenue control','not_applicable',true) RETURNING *", [client.id])).rows[0];
    await pool.query("INSERT INTO cost_codes(client_id,code,description,commercial_head_id,commercial_family_id,reporting_group_id,commercial_head,commercial_family,reporting_group,trade,is_active) VALUES($1,'THREE','Three',$2,$3,$4,'Tenant Custom','Family','Nested','Nested',true)", [client.id, head.id, family.id, nested.id]);
    await pool.query("INSERT INTO cost_codes(client_id,code,description,is_active) VALUES($1,'OTHER','Other tenant',true)", [other.id]);
    const period = (await pool.query("INSERT INTO cvr_periods(client_id,development_id,period_key,period_label,status,commentary,version,budget_source) VALUES($1,$2,'P01','P01','draft','{}',1,'legacy_cvr') RETURNING *", [client.id, developmentId])).rows[0];
    const user = (await pool.query("INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES('clerk',$1,'hierarchy@test','Hierarchy QS','active') RETURNING *", [`hierarchy-${randomUUID()}`])).rows[0];
    const role = (await pool.query("SELECT id FROM roles WHERE key='qs'")).rows[0];
    const membership = (await pool.query('INSERT INTO client_user_memberships(client_id,user_id,role_id,is_active) VALUES($1,$2,$3,true) RETURNING *', [client.id, user.id, role.id])).rows[0];
    fixture = { client, other, developmentId, head, direct, family, nested, notApplicable, period, user, membership,
      auth:{clientId:client.id,userId:user.id,membershipId:membership.id,providerUserId:user.provider_user_id,displayName:user.display_name,roleKey:'qs',permissions:['commercial.read']} };
  });

  test.after(async () => { await pool.end(); });

  test('Draft authority is tenant-scoped and Submit freezes canonical hash and authenticated provenance', async () => {
    const draft = await periods.getCvrPeriod(fixture.client.id, fixture.developmentId, fixture.period.id);
    assert.equal(draft.period.commercialHierarchy.state, 'live');
    assert.deepEqual(draft.period.commercialHierarchy.document.costCodes.map(row => row.costCodeKey), ['EMPTY','LEGACY','NOTAPP','THREE','TWO']);
    assert.equal(draft.period.commercialHierarchy.document.costCodes.find(row => row.costCodeKey === 'TWO').family, null);
    assert.equal(draft.period.commercialHierarchy.document.costCodes.find(row => row.costCodeKey === 'NOTAPP').resolutionState, 'not_applicable');
    const submitted = await periods.submitCvrPeriod(fixture.client.id, fixture.developmentId, fixture.period.id, {}, { actor:'Hierarchy QS', auth:fixture.auth });
    assert.equal(submitted.ok, true, submitted.message);
    assert.equal(submitted.period.commercialHierarchy.state, 'submitted');
    assert.equal(submitted.period.commercialHierarchy.integrity.valid, true);
    const evidence = (await pool.query('SELECT * FROM cvr_period_hierarchy_submissions WHERE period_id=$1', [fixture.period.id])).rows[0];
    assert.equal(evidence.captured_by_user_id, fixture.user.id);
    assert.equal(evidence.captured_by_membership_id, fixture.membership.id);
    assert.equal(evidence.captured_by_role_key, 'qs');
    assert.equal(evidence.source_snapshot.costCodes.find(row => row.costCodeKey === 'NOTAPP').resolutionState, 'not_applicable');
    await pool.query("UPDATE commercial_structure_heads SET name='Renamed after Submit',display_order=9 WHERE id=$1", [fixture.head.id]);
    await pool.query("UPDATE cost_codes SET hierarchy_review_disposition=NULL WHERE id=$1", [fixture.notApplicable.id]);
    const reloaded = await periods.getCvrPeriod(fixture.client.id, fixture.developmentId, fixture.period.id);
    assert.equal(reloaded.period.commercialHierarchy.document.costCodes.find(row => row.costCodeKey === 'TWO').head.name, 'Tenant Custom');
    assert.equal(reloaded.period.commercialHierarchy.document.costCodes.find(row => row.costCodeKey === 'NOTAPP').resolutionState, 'not_applicable');
    await assert.rejects(pool.query("UPDATE cvr_period_hierarchy_submissions SET captured_by_display_name='Changed' WHERE id=$1", [evidence.id]), /immutable/i);
    const live = await hierarchy.liveDocument(pool, fixture.client.id);
    assert.equal(live.costCodes.find(row => row.costCodeKey === 'TWO').head.name, 'Renamed after Submit');
    assert.equal(live.costCodes.find(row => row.costCodeKey === 'NOTAPP').resolutionState, 'unresolved_legacy');
    assert.equal(live.costCodes.some(row => row.costCodeKey === 'OTHER'), false);

    const nextDevelopmentId = `dev-${randomUUID()}`;
    await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,'NEXT','Next hierarchy','live','{}')", [nextDevelopmentId, fixture.client.id]);
    const historic = (await pool.query("INSERT INTO cvr_periods(client_id,development_id,period_key,period_label,status,commentary,version,budget_source,submitted_at,approved_at) VALUES($1,$2,'P01','P01','locked','{}',1,'legacy_cvr',NOW(),NOW()) RETURNING *", [fixture.client.id, nextDevelopmentId])).rows[0];
    const historicRead = await periods.getCvrPeriod(fixture.client.id, nextDevelopmentId, historic.id);
    assert.deepEqual(historicRead.period.commercialHierarchy, {state:'legacy_not_captured',captured:false});
    const next = await periods.createCvrPeriod(fixture.client.id, nextDevelopmentId, {periodKey:'P02',periodLabel:'P02',reportingMonth:'2026-10-01'}, {actor:'Hierarchy QS'});
    assert.equal(next.ok, true, next.message);
    assert.equal(next.period.commercialHierarchy.state, 'live');
    assert.equal(next.period.commercialHierarchy.document.costCodes.find(row => row.costCodeKey === 'TWO').head.name, 'Renamed after Submit');
    assert.equal(next.period.commercialHierarchy.document.costCodes.find(row => row.costCodeKey === 'NOTAPP').resolutionState, 'unresolved_legacy');
  });

  test('hierarchy evidence changes labels only and leaves financial close totals unchanged', async () => {
    const baseSources = {development:{loaded:true,ready:true,value:{}},period:{loaded:true,ready:true,value:{periodKey:'P01',commentary:{}}},inputs:{loaded:true,ready:true,value:[]},purchaseOrders:{loaded:true,ready:true,value:[]},commercialEvents:{loaded:true,ready:true,value:[]},variationOrders:{loaded:true,ready:true,value:[]},certificates:{loaded:true,ready:true,value:[]},ledger:{loaded:true,ready:true,value:[{costCodeKey:'TWO',netAmount:105}]}};
    const loadSources = async () => ({ok:true,sources:baseSources});
    const without = await buildCvrCloseCandidate({clientId:fixture.client.id,developmentId:fixture.developmentId,periodId:fixture.period.id,loadSources});
    const live = await hierarchy.liveDocument(pool, fixture.client.id);
    const withHierarchy = await buildCvrCloseCandidate({clientId:fixture.client.id,developmentId:fixture.developmentId,periodId:fixture.period.id,loadSources,commercialHierarchyDocument:live});
    assert.deepEqual(withHierarchy.snapshot.rows.map(row => ({currentBudget:row.currentBudget,finalForecast:row.finalForecast,variance:row.variance})), without.snapshot.rows.map(row => ({currentBudget:row.currentBudget,finalForecast:row.finalForecast,variance:row.variance})));
    assert.equal(withHierarchy.snapshot.rows[0].commercialHead, 'Renamed after Submit');
    assert.equal(withHierarchy.snapshot.rows[0].commercialFamily, '');
    const submittedEvidence = (await pool.query('SELECT source_snapshot FROM cvr_period_hierarchy_submissions WHERE period_id=$1 ORDER BY attempt_number DESC LIMIT 1', [fixture.period.id])).rows[0].source_snapshot;
    const frozenClose = await buildCvrCloseCandidate({clientId:fixture.client.id,developmentId:fixture.developmentId,periodId:fixture.period.id,loadSources,commercialHierarchyDocument:submittedEvidence});
    assert.deepEqual(frozenClose.snapshot.rows.map(row => ({currentBudget:row.currentBudget,finalForecast:row.finalForecast,variance:row.variance})), without.snapshot.rows.map(row => ({currentBudget:row.currentBudget,finalForecast:row.finalForecast,variance:row.variance})));
  });
}
