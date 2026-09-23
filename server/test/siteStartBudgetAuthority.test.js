const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { pool, isDbConfigured } = require('../db');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');
const repo = require('../services/developmentBudgetRepository');
const { verifyJsonIntegrity } = require('../services/canonicalJsonIntegrity');
const { PERMISSIONS } = require('../auth/permissions');

if (!isDbConfigured()) test('Site Start Budget authority skipped — test DB unavailable', () => assert.ok(true));
else {
  let fixture;
  test.before(async () => {
    await prepareIntegrationTestDatabase(pool);
    const client = (await pool.query('INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING *', [`SSB_${randomUUID().slice(0, 8)}`, 'Site Start test'])).rows[0];
    const developmentId = `dev-site-start-${randomUUID()}`;
    await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,$3,'Site Start Development','live','{}')", [developmentId, client.id, `SSB-${randomUUID()}`]);
    const user = (await pool.query("INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES('clerk',$1,'site-start@test','Site Start QS','active') RETURNING *", [`provider-${randomUUID()}`])).rows[0];
    const role = (await pool.query("SELECT id FROM roles WHERE key='qs'")).rows[0];
    const membership = (await pool.query('INSERT INTO client_user_memberships(client_id,user_id,role_id,is_active) VALUES($1,$2,$3,true) RETURNING *', [client.id, user.id, role.id])).rows[0];
    const costCode = (await pool.query("INSERT INTO cost_codes(client_id,code,description,commercial_head,reporting_group,hierarchy_mode,is_active) VALUES($1,'1000','Land','Land','Land','two-level',true) RETURNING *", [client.id])).rows[0];
    const auth = { clientId: client.id, userId: user.id, membershipId: membership.id, providerUserId: user.provider_user_id, displayName: user.display_name, roleKey: 'qs', permissions: [PERMISSIONS.COMMERCIAL_READ, PERMISSIONS.DEVELOPMENT_BUDGET_POST] };
    fixture = { client, developmentId, user, membership, costCode, auth };
  });

  test.after(async () => {
    if (!fixture) return;
    await pool.query('ALTER TABLE development_budget_milestones DISABLE TRIGGER USER');
    await pool.query('DELETE FROM development_budget_milestones WHERE client_id=$1', [fixture.client.id]);
    await pool.query('ALTER TABLE development_budget_milestones ENABLE TRIGGER USER');
    await pool.query('ALTER TABLE development_budget_event_lines DISABLE TRIGGER USER');
    await pool.query('ALTER TABLE development_budget_events DISABLE TRIGGER USER');
    await pool.query('DELETE FROM development_budget_event_lines WHERE client_id=$1', [fixture.client.id]);
    await pool.query('DELETE FROM development_budget_events WHERE client_id=$1', [fixture.client.id]);
    await pool.query('ALTER TABLE development_budget_event_lines ENABLE TRIGGER USER');
    await pool.query('ALTER TABLE development_budget_events ENABLE TRIGGER USER');
    await pool.query('DELETE FROM cost_codes WHERE client_id=$1', [fixture.client.id]);
    await pool.query('DELETE FROM developments WHERE id=$1', [fixture.developmentId]);
    await pool.query('DELETE FROM client_user_memberships WHERE id=$1', [fixture.membership.id]);
    await pool.query('DELETE FROM clients WHERE id=$1', [fixture.client.id]);
    await pool.query('DELETE FROM buildlite_users WHERE id=$1', [fixture.user.id]);
  });

  test('explicit confirmation references and freezes the Opening Budget without duplicating money', async () => {
    const opening = await repo.postEvent(fixture.client.id, fixture.developmentId, { eventType: 'opening_budget', effectiveDate: '2026-01-01', reference: 'OPEN', reason: 'Approved opening', idempotencyKey: `open-${randomUUID()}`, lines: [{ costCodeId: fixture.costCode.id, amount: '100.00' }] }, fixture.auth);
    assert.equal(opening.authority.siteStartBudget.confirmed, false);
    const confirmed = await repo.confirmSiteStartBudget(fixture.client.id, fixture.developmentId, { approvedEffectiveDate: '2026-01-15', reference: 'BOARD-SSB', approvalReason: 'Approved at site commencement' }, fixture.auth);
    assert.equal(confirmed.status, 201);
    assert.equal(confirmed.authority.siteStartBudget.openingBudgetEventId, opening.event.id);
    assert.equal(confirmed.authority.siteStartBudget.totalBudget, 100);
    assert.equal(confirmed.authority.siteStartBudget.createdBy.membershipId, fixture.membership.id);
    assert.equal(verifyJsonIntegrity(confirmed.authority.siteStartBudget.evidenceSnapshot, confirmed.authority.siteStartBudget.evidenceSha256, confirmed.authority.siteStartBudget.evidenceHashScheme).valid, true);
    assert.equal(Number((await pool.query('SELECT count(*) n FROM development_budget_event_lines WHERE client_id=$1', [fixture.client.id])).rows[0].n), 1);
    assert.equal((await repo.confirmSiteStartBudget(fixture.client.id, fixture.developmentId, { approvedEffectiveDate: '2026-01-15', reference: 'DUP', approvalReason: 'Duplicate' }, fixture.auth)).status, 409);
    await repo.postEvent(fixture.client.id, fixture.developmentId, { eventType: 'addition', effectiveDate: '2026-02-01', reference: 'ADD', reason: 'Later movement', idempotencyKey: `add-${randomUUID()}`, lines: [{ costCodeId: fixture.costCode.id, amount: '25.00' }] }, fixture.auth);
    const after = (await repo.getAuthority(fixture.client.id, fixture.developmentId, fixture.auth)).authority;
    assert.equal(after.siteStartBudget.totalBudget, 100);
    assert.equal(after.totalCurrentBudget, 125);
    await assert.rejects(pool.query('UPDATE development_budget_milestones SET reference=$1 WHERE id=$2', ['rewrite', confirmed.milestoneId]), /append-only/i);
  });
}
