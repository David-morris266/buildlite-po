const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateDevelopmentCommercialReadiness } = require('../services/developmentCommercialReadiness');

function facts(overrides = {}) {
  return {
    costCodes: { available: true, activeCount: 2 },
    periods: { available: true, rows: [] },
    budget: { available: true, exists: true, integrityValid: true },
    revenue: { available: true, ready: true, plotCount: 2, sparse: false },
    variationExposure: { available: true, blockers: [], itemCount: 0 },
    purchaseOrders: { available: true, count: 0 }, packages: { available: true, count: 0 },
    certificates: { available: true, count: 0 }, commercialEvents: { available: true, count: 0 },
    ledger: { available: true, count: 1 }, prelims: { available: true, count: 1 },
    sellingCosts: { available: true, count: 1 }, ...overrides,
  };
}

test('creation requires authoritative active cost codes', () => {
  const empty = evaluateDevelopmentCommercialReadiness(facts({ costCodes: { available: true, activeCount: 0 } }));
  assert.equal(empty.canCreateFirstCvr, false);
  assert.equal(empty.items.find(entry => entry.key === 'cost_code_master').blocksDraftCreation, true);
  assert.equal(empty.items.find(entry => entry.key === 'cost_code_master').draftCreationRequirement, true);
  const unavailable = evaluateDevelopmentCommercialReadiness(facts({ costCodes: { available: false } }));
  assert.equal(unavailable.canCreateFirstCvr, false);
  assert.equal(unavailable.items.find(entry => entry.key === 'cost_code_master').sourceAvailable, false);
  assert.equal(unavailable.items.find(entry => entry.key === 'cost_code_master').blocksDraftCreation, true);
});

test('new development requires verified Development Budget authority', () => {
  const missing = evaluateDevelopmentCommercialReadiness(facts({ budget: { available: true, exists: false, integrityValid: false } }));
  assert.equal(missing.canCreateFirstCvr, false);
  assert.equal(missing.items.find(entry => entry.key === 'development_budget').blocksDraftCreation, true);
  assert.equal(missing.items.find(entry => entry.key === 'development_budget').draftCreationRequirement, true);
  assert.equal(evaluateDevelopmentCommercialReadiness(facts({ budget: { available: false } })).canCreateFirstCvr, false);
});

test('period-source failure blocks creation without becoming a setup requirement', () => {
  const result = evaluateDevelopmentCommercialReadiness(facts({ periods: { available: false } }));
  const periods = result.items.find(entry => entry.key === 'cvr_periods');
  assert.equal(result.canCreateFirstCvr, false);
  assert.equal(periods.blocksDraftCreation, true);
  assert.equal(periods.draftCreationRequirement, false);
});

test('Revenue needs attention without blocking a working Draft', () => {
  const result = evaluateDevelopmentCommercialReadiness(facts({ revenue: { available: true, ready: false, reason: 'Revenue settings are missing.' } }));
  assert.equal(result.overallState, 'needs_attention');
  assert.equal(result.canCreateFirstCvr, true);
  assert.equal(result.items.find(entry => entry.key === 'revenue').state, 'needs_attention');
  assert.equal(result.items.find(entry => entry.key === 'revenue').blocksDraftCreation, false);
});

test('Forecast Pending VA remains a completion blocker without blocking Draft creation', () => {
  const result = evaluateDevelopmentCommercialReadiness(facts({
    variationExposure: { available: true, itemCount: 1, blockers: [{ reference: 'VA-0001', reason: 'forecast_unassessed' }] },
  }));
  assert.equal(result.overallState, 'blocker');
  assert.equal(result.canCreateFirstCvr, true);
  assert.equal(result.items.find(entry => entry.key === 'variation_exposure').blocksCompletion, true);
  assert.equal(result.items.find(entry => entry.key === 'variation_exposure').blocksDraftCreation, false);
});

test('zero operational facts are truthful zeros rather than blockers', () => {
  const result = evaluateDevelopmentCommercialReadiness(facts({ ledger: { available: true, count: 0 } }));
  for (const key of ['purchase_orders', 'packages', 'certificates', 'commercial_events']) {
    assert.equal(result.items.find(entry => entry.key === key).state, 'ready');
  }
  assert.equal(result.items.find(entry => entry.key === 'ledger').state, 'needs_attention');
  assert.equal(result.canCreateFirstCvr, true);
});

test('optional Prelims and Selling Costs absence needs attention without blocking creation', () => {
  const result = evaluateDevelopmentCommercialReadiness(facts({ prelims: { available: true, count: 0 }, sellingCosts: { available: true, count: 0 } }));
  assert.equal(result.items.find(entry => entry.key === 'prelims').state, 'needs_attention');
  assert.equal(result.items.find(entry => entry.key === 'selling_costs').state, 'needs_attention');
  for (const key of ['prelims', 'selling_costs']) assert.equal(result.items.find(entry => entry.key === key).blocksDraftCreation, false);
  assert.equal(result.canCreateFirstCvr, true);
});

test('established legacy CVR compatibility survives absent Development Budget', () => {
  const result = evaluateDevelopmentCommercialReadiness(facts({
    periods: { available: true, rows: [{ periodKey: 'P01', status: 'locked', budgetSource: 'legacy_cvr' }] },
    budget: { available: true, exists: false, integrityValid: false },
  }));
  assert.equal(result.establishedLegacy, true);
  assert.equal(result.canCreateFirstCvr, true);
  assert.equal(result.items.find(entry => entry.key === 'development_budget').state, 'needs_attention');
});

test('an existing open period is the creation blocker and resolution target', () => {
  const result = evaluateDevelopmentCommercialReadiness(facts({
    periods: { available: true, rows: [{ periodKey: 'P02', status: 'draft', budgetSource: 'development_budget' }] },
    prelims: { available: true, count: 0 }, sellingCosts: { available: true, count: 0 },
  }));
  assert.equal(result.canCreateFirstCvr, false);
  assert.equal(result.overallState, 'needs_attention');
  assert.equal(result.hasCvrHistory, true);
  assert.equal(result.items.find(entry => entry.key === 'cvr_periods').workflowState, true);
  assert.equal(result.items.find(entry => entry.key === 'cvr_periods').blocksDraftCreation, true);
  assert.equal(result.items.find(entry => entry.key === 'cvr_periods').resolutionTarget.periodKey, 'P02');
  assert.equal(result.items.find(entry => entry.key === 'prelims').state, 'needs_attention');
  assert.equal(result.items.find(entry => entry.key === 'selling_costs').state, 'needs_attention');
});
