const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyLegacyBudgetSource } = require('../services/cvrPeriodRepository');

const base = {
  client_id: '11111111-1111-4111-8111-111111111111',
  development_id: 'dev-legacy-budget-authority',
  status: 'draft',
};

test('legacy Draft with no Development Budget positively permits legacy import', async () => {
  const db = { query: async (sql) => {
    if (sql.includes('FROM developments')) return { rows: [{ id: base.development_id, development_name: 'Legacy', version: 1 }] };
    if (sql.includes('FROM development_budget_events')) return { rows: [] };
    if (sql.includes('FROM development_budget_milestones')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  assert.deepEqual(await classifyLegacyBudgetSource(base, db), {
    state: 'legacy_cvr', adopted: false, adoptionAvailable: false, importAvailable: true,
  });
});

test('budget authority lookup failure exposes explicit unavailable evidence and permits no mutation', async () => {
  const result = await classifyLegacyBudgetSource(base, { query: async () => { throw new Error('read failed'); } });
  assert.equal(result.state, 'authority_unavailable');
  assert.equal(result.authorityUnavailable, true);
  assert.equal(result.adoptionAvailable, false);
  assert.equal(result.importAvailable, false);
  assert.match(result.authorityMessage, /No budget action has been taken/);
});

test('read-only legacy period exposes neither recovery mutation', async () => {
  assert.deepEqual(await classifyLegacyBudgetSource({ ...base, status: 'locked' }, { query: async () => { throw new Error('must not query'); } }), {
    state: 'legacy_cvr', adopted: false, adoptionAvailable: false, importAvailable: false,
  });
});
