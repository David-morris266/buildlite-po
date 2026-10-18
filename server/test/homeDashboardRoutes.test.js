const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { randomUUID } = require('node:crypto');
const createApp = require('../app');
const { pool } = require('../db');
const { createTestAuthAdapter } = require('../auth/authAdapters');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');
const { assertActiveTestDatabase } = require('../utils/testDatabaseGuard');
const { PERMISSIONS: P } = require('../auth/permissions');

const createdClients = [];
const principal = clientId => ({ userId: randomUUID(), membershipId: randomUUID(), providerUserId: `home-${clientId}`, displayName: 'Dashboard User', roleKey: 'commercial_manager', clientId, permissions: [P.COMMERCIAL_READ] });

test.before(async () => {
  await assertActiveTestDatabase(pool);
  await prepareIntegrationTestDatabase(pool);
});

test.after(async () => {
  if (createdClients.length) await pool.query('DELETE FROM clients WHERE id=ANY($1::uuid[])', [createdClients]);
  await pool.end();
});

test('GET /api/home/dashboard derives tenant identity and does not disclose another tenant', async () => {
  const tenantA = (await pool.query(`INSERT INTO clients(code,name,is_active) VALUES($1,$2,true) RETURNING id`, [`HOME_A_${Date.now()}`, 'Home A'])).rows[0];
  const tenantB = (await pool.query(`INSERT INTO clients(code,name,is_active) VALUES($1,$2,true) RETURNING id`, [`HOME_B_${Date.now()}`, 'Home B'])).rows[0];
  createdClients.push(tenantA.id, tenantB.id);
  await pool.query(`INSERT INTO developments(id,client_id,job_number,development_name,status) VALUES
    ($1,$2,'A-1','Tenant A Live','live'),($3,$2,'A-2','Tenant A Complete','complete'),($4,$5,'B-1','Tenant B Live','live'),($6,$5,'B-2','Tenant B Live 2','live')`,
  [`home-a-${Date.now()}`, tenantA.id, `home-a2-${Date.now()}`, `home-b-${Date.now()}`, tenantB.id, `home-b2-${Date.now()}`]);
  const app = createApp({ authAdapter: createTestAuthAdapter(principal(tenantA.id)) });
  const response = await request(app).get('/api/home/dashboard').query({ clientId: tenantB.id }).set('X-BuildLite-Client-Id', tenantB.id);
  assert.equal(response.status, 200);
  assert.equal(response.body.overview.metrics.liveDevelopments.value, 1);
  assert.equal(response.body.overview.metrics.cvrAwaitingApproval.state, 'restricted');
  assert.equal(response.body.overview.metrics.certificatesRequiringReview.state, 'restricted');
  assert.equal(response.body.activity.state, 'ready');
});

test('GET /api/home/dashboard requires an authenticated principal', async () => {
  const app = createApp({ authAdapter: createTestAuthAdapter(null) });
  assert.equal((await request(app).get('/api/home/dashboard')).status, 401);
});

test('permitted payment sections reconcile their governed empty queues without becoming unavailable', async () => {
  const client = (await pool.query(`INSERT INTO clients(code,name,is_active) VALUES($1,$2,true) RETURNING id`, [`HOME_QUEUE_${Date.now()}`, 'Home Queue'])).rows[0];
  createdClients.push(client.id);
  const permitted = principal(client.id);
  permitted.permissions = [P.COMMERCIAL_READ, P.CVR_LOCK, P.PAYMENT_APPROVAL_RUN_VIEW, P.PAYMENT_RELEASE_EXECUTE];
  const response = await request(createApp({ authAdapter: createTestAuthAdapter(permitted) })).get('/api/home/dashboard');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.overview.metrics.certificatesRequiringReview, { state: 'ready', value: 0 });
  assert.equal(response.body.attention.state, 'ready');
  assert.deepEqual(response.body.attention.items, []);
});
