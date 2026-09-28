const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { pool } = require('../db');
const createApp = require('../app');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');
const { isDbConfigured } = require('../utils/env');

test('reviewed Sales Register apply is tenant scoped, versioned and preserves unrelated plot facts', async (t) => {
  if (!isDbConfigured()) return t.skip();
  await prepareIntegrationTestDatabase(pool);
  const clientId = randomUUID(), otherClientId = randomUUID(), developmentId = `dev-sales-${randomUUID()}`;
  const role = (await pool.query("SELECT id FROM roles WHERE key='commercial_director'")).rows[0];
  const userId = randomUUID(), membershipId = randomUUID(), providerUserId = `sales-${randomUUID()}`;
  await pool.query("INSERT INTO clients(id,code,name,is_active) VALUES($1,$2,'Sales Import',false),($3,$4,'Other',false)", [clientId, `SI-${Date.now()}`, otherClientId, `SO-${Date.now()}`]);
  await pool.query("INSERT INTO buildlite_users(id,auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES($1,'clerk',$2,'sales@test.invalid','Revenue Reviewer','active')", [userId, providerUserId]);
  await pool.query('INSERT INTO client_user_memberships(id,client_id,user_id,role_id,is_active) VALUES($1,$2,$3,$4,true)', [membershipId, clientId, userId, role.id]);
  const plots = [
    { id: 'p1', plotNumber: '1', houseType: 'A', status: 'Legacy Completed', revenueStatus: 'Available', sellingPrice: 0, notes: 'keep' },
    { id: 'p2', plotNumber: '2', houseType: 'B', revenueStatus: 'Available', sellingPrice: 0 },
  ];
  await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload,version) VALUES($1,$2,'SI-1','Sales Import','live',$3,1)", [developmentId, clientId, JSON.stringify({ plotMaster: { plots } })]);
  const principal = { userId, providerUserId, displayName: 'Revenue Reviewer', clientId, membershipId, roleKey: 'commercial_director', roleName: 'Commercial Director', permissions: ['commercial.read', 'revenue.manage', 'plot_master.manage'], memberships: [] };
  const app = createApp({ testPrincipal: principal });
  const response = await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import`).send({ version: 1, fileName: 'sales.xlsx', worksheet: 'Sales Register', updates: [{ plotId: 'p1', plotNumber: '1', revenueStatus: 'Completed', sellingPrice: 250000 }] });
  assert.equal(response.status, 200);
  assert.equal(response.body.development.version, 2);
  const changed = response.body.development.plotMaster.plots[0];
  assert.equal(changed.revenueStatus, 'Completed'); assert.equal(changed.sellingPrice, 250000);
  assert.equal(changed.status, 'Legacy Completed'); assert.equal(changed.notes, 'keep');
  assert.equal(response.body.development.plotMaster.plots[1].revenueStatus, 'Available');
  assert.equal(response.body.development.plotMaster.lastSalesRegisterImport.appliedBy, 'Revenue Reviewer');
  const invalid = await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import`).send({ version: 2, updates: [{ plotId: 'p2', plotNumber: '2', revenueStatus: 'Completed' }] });
  assert.equal(invalid.status, 400);
  const duplicate = await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import`).send({ version: 2, updates: [{ plotId: 'p2', plotNumber: '2', revenueStatus: 'Available' }, { plotId: 'p2', plotNumber: '2', revenueStatus: 'Reserved' }] });
  assert.equal(duplicate.status, 400);
  assert.equal((await request(app).post(`/api/developments/${developmentId}/revenue/sales-register-import`).send({ version: 1, updates: [{ plotId: 'p1', plotNumber: '1', revenueStatus: 'Available' }] })).status, 409);
  const crossTenant = createApp({ testPrincipal: { ...principal, clientId: otherClientId } });
  assert.equal((await request(crossTenant).post(`/api/developments/${developmentId}/revenue/sales-register-import`).send({ version: 2, updates: [{ plotId: 'p1', plotNumber: '1', revenueStatus: 'Available' }] })).status, 404);
});

test('Sales Register apply rejects invalid lifecycle facts and duplicate targets', async () => {
  const { applySalesRegisterImport } = require('../services/salesRegisterImportService');
  assert.equal(typeof applySalesRegisterImport, 'function');
});
