const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const createApp = require('../app');
const { pool, isDbConfigured } = require('../db');
const { PERMISSIONS } = require('../auth/permissions');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');

const migrationPath = path.join(__dirname, '..', 'migrations', '051_commercial_template_authority.sql');

test('Migration 051 grants company commercial-template authority only to Commercial Director and Admin', async (t) => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /commercial_templates\.manage/);
  assert.match(sql, /commercial_director/);
  assert.match(sql, /admin/);
  assert.doesNotMatch(sql, /commercial_manager/);
  assert.doesNotMatch(sql, /UPDATE\s+(client_prelims|client_selling|development_|cost_codes|cvr_)/i);
  if (!isDbConfigured()) return t.skip('TEST_DATABASE_URL not configured');
  await prepareIntegrationTestDatabase(pool);
  const db = await pool.query('SELECT current_database() db');
  assert.equal(db.rows[0].db, 'buildlite_test');
  const grants = await pool.query(`
    SELECT r.key
    FROM role_permissions rp
    JOIN roles r ON r.id=rp.role_id
    WHERE rp.permission_key='commercial_templates.manage'
    ORDER BY r.key
  `);
  assert.deepEqual(grants.rows.map((row) => row.key), ['admin', 'commercial_director']);
});

test('Prelims routes use authenticated template authority and cannot spoof actor provenance', async (t) => {
  if (!isDbConfigured()) return t.skip('TEST_DATABASE_URL not configured');
  await prepareIntegrationTestDatabase(pool);
  const tenant = (await pool.query(
    `INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING id`,
    [`CTA-${Date.now()}`, 'Commercial template authority tenant']
  )).rows[0].id;
  const principal = {
    userId: '00000000-0000-0000-0000-000000000011',
    providerUserId: 'commercial-template-director',
    displayName: 'Authenticated Commercial Director',
    clientId: tenant,
    membershipId: '00000000-0000-0000-0000-000000000012',
    roleKey: 'commercial_director',
    roleName: 'Commercial Director',
    permissions: [PERMISSIONS.COMMERCIAL_READ, PERMISSIONS.COMMERCIAL_TEMPLATES_MANAGE],
    memberships: [],
  };
  const app = createApp({ testPrincipal: principal });
  const denied = createApp({
    testPrincipal: { ...principal, roleKey: 'commercial_manager', roleName: 'Commercial Manager', permissions: [PERMISSIONS.COMMERCIAL_READ] },
  });
  try {
    assert.equal((await request(app).get('/api/prelims-templates/standard')).status, 200);
    assert.equal((await request(denied).get('/api/prelims-templates')).status, 200);
    const forbidden = await request(denied).post('/api/prelims-templates').send({ origin: 'blank', name: 'Denied' });
    assert.equal(forbidden.status, 403);
    assert.match(forbidden.body.message, /commercial_templates\.manage/);
    const created = await request(app).post('/api/prelims-templates').send({
      origin: 'blank',
      name: `Authenticated Prelims ${Date.now()}`,
      actor: 'Spoofed actor',
      createdBy: 'Spoofed creator',
      updatedBy: 'Spoofed updater',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.createdBy, principal.displayName);
    assert.equal(created.body.updatedBy, principal.displayName);
    const stored = await pool.query('SELECT created_by,updated_by FROM client_prelims_templates WHERE id=$1', [created.body.id]);
    assert.deepEqual(stored.rows[0], { created_by: principal.displayName, updated_by: principal.displayName });
    const sellingCreated = await request(app).post('/api/selling-costs-templates').send({
      origin: 'blank',
      name: `Director Selling Costs ${Date.now()}`,
      actor: 'Spoofed selling actor',
    });
    assert.equal(sellingCreated.status, 201);
    assert.equal(sellingCreated.body.createdBy, principal.displayName);
    const adminApp = createApp({
      testPrincipal: {
        ...principal,
        roleKey: 'admin',
        roleName: 'Admin',
        displayName: 'Authenticated Admin',
      },
    });
    const adminCreated = await request(adminApp).post('/api/prelims-templates').send({
      origin: 'blank',
      name: `Admin Prelims ${Date.now()}`,
    });
    assert.equal(adminCreated.status, 201);
    assert.equal(adminCreated.body.createdBy, 'Authenticated Admin');
    const qsApp = createApp({
      testPrincipal: { ...principal, roleKey: 'qs', roleName: 'QS', permissions: [PERMISSIONS.COMMERCIAL_READ] },
    });
    assert.equal((await request(qsApp).post('/api/prelims-templates').send({ origin: 'blank', name: 'QS denied' })).status, 403);
    assert.equal((await request(qsApp).post('/api/selling-costs-templates').send({ origin: 'blank', name: 'QS denied' })).status, 403);
    const otherTenant = (await pool.query(
      `INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING id`,
      [`CTA-O-${Date.now()}`, 'Other authority tenant']
    )).rows[0].id;
    const otherApp = createApp({ testPrincipal: { ...principal, clientId: otherTenant } });
    assert.equal((await request(otherApp).get(`/api/prelims-templates/${created.body.id}`)).status, 404);
    await pool.query('DELETE FROM clients WHERE id=$1', [otherTenant]);
  } finally {
    await pool.query('DELETE FROM client_selling_cost_templates WHERE client_id=$1', [tenant]);
    await pool.query('DELETE FROM client_prelims_templates WHERE client_id=$1', [tenant]);
    await pool.query('DELETE FROM clients WHERE id=$1', [tenant]);
  }
});
