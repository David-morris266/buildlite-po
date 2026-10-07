const test = require('node:test');
const assert = require('node:assert/strict');

const { developmentBudgetBaselineBlockers } = require('../services/cvrPeriodRepository');

const document = {
  positions: [
    { costCodeId: 'cost-2000', costCode: '2000', originalPence: 6600000, currentPence: 6600000 },
    { costCodeId: 'cost-3010', costCode: '3010', originalPence: 0, currentPence: 12000000 },
    { costCodeId: 'cost-zero', costCode: '9990', originalPence: 0, currentPence: 0 },
  ],
};

test('Development Budget baseline accepts authoritative close rows without persisted CVR inputs', () => {
  const blockers = developmentBudgetBaselineBlockers(document, {
    ready: true,
    snapshot: { rows: [{ costCodeKey: '2000' }, { costCodeKey: '3010' }] },
  });
  assert.deepEqual(blockers, []);
});

test('Development Budget baseline identifies each non-zero position missing from close rows', () => {
  const blockers = developmentBudgetBaselineBlockers(document, {
    ready: true,
    snapshot: { rows: [{ costCodeKey: '2000' }] },
  });
  assert.deepEqual(blockers, [{
    source: 'developmentBudget',
    reason: 'development_budget_cost_row_missing',
    costCodeId: 'cost-3010',
    costCodeKey: '3010',
  }]);
});

test('Development Budget baseline does not replace existing close-source readiness authority', () => {
  assert.deepEqual(developmentBudgetBaselineBlockers(document, {
    ready: false,
    blockers: [{ source: 'ledger', reason: 'unavailable' }],
  }), []);
});
