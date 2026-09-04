const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { pool, isDbConfigured } = require('../db');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');
const {
  PILOT_READINESS_POLICY,
  evaluateTenantReadiness,
  getTenantReadiness,
} = require('../services/tenantReadiness');

test('GP-1 readiness accepts the pilot minimum', () => {
  const result = evaluateTenantReadiness({ activeCostCodes: 1, developments: 1 });
  assert.equal(result.configured, true);
  assert.equal(result.policy, PILOT_READINESS_POLICY);
  assert.equal(result.establishedOperationalTenant, false);
});

test('GP-1 readiness sends a genuinely empty tenant to setup', () => {
  const result = evaluateTenantReadiness({});
  assert.equal(result.configured, false);
  assert.deepEqual(result.reasons, ['active_cost_codes_required', 'development_required']);
});

test('established operational history always wins over newer pilot criteria', () => {
  for (const field of ['purchaseOrders', 'packages', 'certificates', 'cvrPeriods']) {
    const result = evaluateTenantReadiness({ [field]: 1 });
    assert.equal(result.configured, true, field);
    assert.equal(result.establishedOperationalTenant, true, field);
  }
});

test('readiness query is tenant-scoped and maps database counts', async () => {
  const calls = [];
  const result = await getTenantReadiness('tenant-1', async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ client_code: 'tenant', client_name: 'Tenant Ltd', active_cost_codes: '2', developments: '1', purchase_orders: '0', packages: '0', certificates: '0', cvr_periods: '0' }] };
  });
  assert.equal(result.configured, true);
  assert.deepEqual(calls[0].params, ['tenant-1']);
  assert.equal((calls[0].sql.match(/WHERE client_id = \$1/g) || []).length, 6);
  assert.deepEqual(result.tenant, { code: 'tenant', name: 'Tenant Ltd' });
});

test('readiness executes against the production-aligned cost_codes schema', async t => {
  if (!isDbConfigured()) return t.skip('TEST_DATABASE_URL not configured');
  await prepareIntegrationTestDatabase(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = (await client.query(
      `INSERT INTO clients(code,name,is_active) VALUES($1,$2,true) RETURNING id`,
      [`GP1_${randomUUID().slice(0, 8)}`, 'GP-1 readiness test']
    )).rows[0];
    await client.query(
      `INSERT INTO cost_codes(client_id,code,is_active) VALUES($1,'4330',true)`,
      [tenant.id]
    );
    await client.query(
      `INSERT INTO developments(id,client_id,job_number,development_name,status,payload)
       VALUES($1,$2,'GP1','GP-1 Development','live','{}')`,
      [`dev-gp1-${randomUUID()}`, tenant.id]
    );

    const result = await getTenantReadiness(tenant.id, client.query.bind(client));
    assert.equal(result.configured, true);
    assert.equal(result.counts.activeCostCodes, 1);
    assert.equal(result.counts.developments, 1);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

test.after(async () => {
  if (isDbConfigured()) await pool.end();
});
