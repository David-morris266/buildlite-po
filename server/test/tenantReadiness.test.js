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

const readyCounts = { companySettings: 1, activeCostCodes: 2, allocatedCostCodes: 1, notApplicableCostCodes: 1, activeHeads: 2, categorizedHeads: 2, discoveryHeads: 2 };

test('GP10 readiness accepts reviewed commercial authority plus a Development', () => {
  const result = evaluateTenantReadiness({ ...readyCounts, developments: 1 });
  assert.equal(result.configured, true);
  assert.equal(result.policy, PILOT_READINESS_POLICY);
  assert.equal(result.establishedOperationalTenant, false);
});

test('GP10 readiness sends a genuinely empty tenant to Company Readiness', () => {
  const result = evaluateTenantReadiness({});
  assert.equal(result.configured, false);
  assert.deepEqual(result.reasons, ['company_settings_required', 'commercial_structure_required', 'active_cost_codes_required', 'development_required']);
});

test('Development existence does not hide incomplete hierarchy review', () => {
  const result = evaluateTenantReadiness({ companySettings: 1, activeCostCodes: 2, allocatedCostCodes: 1, notReviewedCostCodes: 1, activeHeads: 2, categorizedHeads: 2, discoveryHeads: 2, developments: 1 });
  assert.equal(result.configured, false);
  assert.equal(result.commerciallyReady, false);
  assert.equal(result.developmentExists, true);
  assert.ok(result.reasons.includes('cost_code_review_required'));
});

test('explicit Not Applicable is reviewed while Needs Attention fails closed', () => {
  assert.equal(evaluateTenantReadiness(readyCounts).hierarchyReviewComplete, true);
  const attention = evaluateTenantReadiness({ ...readyCounts, allocatedCostCodes: 0, needsAttentionCostCodes: 1 });
  assert.equal(attention.hierarchyReviewComplete, false);
  assert.ok(attention.reasons.includes('cost_code_attention_required'));
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
    return { rows: [{ client_code: 'tenant', client_name: 'Tenant Ltd', company_settings: '1', active_cost_codes: '2', allocated_cost_codes: '1', not_applicable_cost_codes: '1', not_reviewed_cost_codes: '0', needs_attention_cost_codes: '0', active_heads: '2', categorized_heads: '2', discovery_heads: '2', developments: '1', purchase_orders: '0', packages: '0', certificates: '0', cvr_periods: '0' }] };
  });
  assert.equal(result.configured, true);
  assert.deepEqual(calls[0].params, ['tenant-1']);
  assert.ok((calls[0].sql.match(/client_id\s*=\s*\$1/g) || []).length >= 10);
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
    const head = (await client.query(
      `INSERT INTO commercial_structure_heads(client_id,name,is_active) VALUES($1,'Plot Works',true) RETURNING id`,
      [tenant.id]
    )).rows[0];
    await client.query(`UPDATE cost_codes SET commercial_head_id=$1,commercial_head='Plot Works' WHERE client_id=$2 AND code='4330'`, [head.id, tenant.id]);
    await client.query(
      `INSERT INTO developments(id,client_id,job_number,development_name,status,payload)
       VALUES($1,$2,'GP1','GP-1 Development','live','{}')`,
      [`dev-gp1-${randomUUID()}`, tenant.id]
    );

    const result = await getTenantReadiness(tenant.id, client.query.bind(client));
    assert.equal(result.configured, false);
    assert.equal(result.counts.activeCostCodes, 1);
    assert.equal(result.counts.allocatedCostCodes, 1);
    assert.equal(result.counts.needsAttentionCostCodes, 0);
    assert.equal(result.counts.developments, 1);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

test.after(async () => {
  if (isDbConfigured()) await pool.end();
});
