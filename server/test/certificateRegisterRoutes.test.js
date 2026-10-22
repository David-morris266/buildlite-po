const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../app');
const { createTestAuthAdapter } = require('../auth/authAdapters');
const { PERMISSIONS } = require('../auth/permissions');
const { pool, isDbConfigured } = require('../db');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');

const createdTenants = [];
async function removeRegisterTenant(tenant) {
  await pool.query('DELETE FROM package_payment_certificates WHERE client_id=$1', [tenant]);
  await pool.query('DELETE FROM package_purchase_orders WHERE client_id=$1', [tenant]);
  await pool.query('DELETE FROM packages WHERE client_id=$1', [tenant]);
  await pool.query('DELETE FROM suppliers WHERE client_id=$1', [tenant]);
  await pool.query('DELETE FROM developments WHERE client_id=$1', [tenant]);
  await pool.query('DELETE FROM clients WHERE id=$1', [tenant]);
}
async function createRegisterTenant(suffix) {
  const tenant = (await pool.query("INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING id", [`CERT_ROUTE_${suffix}_${Date.now()}`, `Route ${suffix}`])).rows[0].id;
  createdTenants.push(tenant);
  const developmentId = `cert-route-${suffix}-${Date.now()}`;
  const supplierId = `cert-route-supplier-${suffix}-${Date.now()}`;
  await pool.query('INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,$3,$4,$5,$6)', [developmentId, tenant, `ROUTE-${suffix}`, `Route Development ${suffix}`, 'live', {}]);
  await pool.query('INSERT INTO suppliers(id,name,payload,client_id) VALUES($1,$2,$3,$4)', [supplierId, `Route Supplier ${suffix}`, {}, tenant]);
  const packageRow = await pool.query(`INSERT INTO packages(client_id,development_id,supplier_id,cost_code,order_key,supplier_label,development_number,development_name,payload)
    VALUES($1,$2,$3,'100',$4,$5,$6,$7,$8) RETURNING id,order_key`, [tenant, developmentId, supplierId, `${developmentId}::${supplierId}::100`, `Route Supplier ${suffix}`, `ROUTE-${suffix}`, `Route Development ${suffix}`, {}]);
  await pool.query(`INSERT INTO package_payment_certificates(client_id,package_id,development_id,order_key,certificate_number,status,certificate_date,payload)
    VALUES($1,$2,$3,$4,1,'draft','2026-10-01','{}')`, [tenant, packageRow.rows[0].id, developmentId, packageRow.rows[0].order_key]);
  return { tenant, developmentId };
}

test('certificate register route requires commercial.read before repository execution', async () => {
  const app = createApp({ authAdapter: createTestAuthAdapter({ clientId: '00000000-0000-0000-0000-000000000099', userId: 'u', permissions: [] }) });
  const response = await request(app).get('/api/certificates');
  assert.equal(response.status, 403);
});

test('route derives tenant only from authenticated identity and ignores forged tenant inputs', { skip: !isDbConfigured() }, async () => {
  await prepareIntegrationTestDatabase(pool);
  const stale = await pool.query("SELECT id FROM clients WHERE code LIKE 'CERT_ROUTE_%'");
  for (const row of stale.rows) await removeRegisterTenant(row.id);
  const a = await createRegisterTenant('A');
  const b = await createRegisterTenant('B');
  try {
    const principal = { clientId: a.tenant, userId: 'route-user', membershipId: 'route-membership', permissions: [PERMISSIONS.COMMERCIAL_READ] };
    const app = createApp({ authAdapter: createTestAuthAdapter(principal) });
    const response = await request(app).get(`/api/certificates?clientId=${b.tenant}&tenantId=${b.tenant}`).set('X-BuildLite-Client-Id', b.tenant);
    assert.equal(response.status, 200);
    assert.equal(response.body.total, 1);
    assert.equal(response.body.items[0].developmentId, a.developmentId);
    assert.equal(response.body.items.some(item => item.developmentId === b.developmentId), false);
  } finally {
    for (const tenant of createdTenants.splice(0)) await removeRegisterTenant(tenant);
  }
});
