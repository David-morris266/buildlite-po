const test = require('node:test');
const assert = require('node:assert/strict');
const { buildChangeExposureByCostCode } = require('../services/cvrChangeExposure');
const { buildCvrCloseCandidate } = require('../services/cvrCloseEngine');
const { sourceOk } = require('../services/cvrCloseSources');

const submittedCe = (value) => ({ id:'ce-1',status:'submitted',costCode:'3100',value,expectedTreatment:'default' });
const linkedVa = (value) => ({ variationAccountItemId:'va-1',sourceCommercialEventId:'ce-1',costCode:'3100',vaExposureUplift:value });

test('Site Start absorbed linked CE/VA exposure is not counted twice and only increases flow through', () => {
  const absorbed = [{identity:'ce:ce-1',costCodeKey:'3100',amountPence:500000}];
  const unchanged = buildChangeExposureByCostCode([submittedCe(5000)],[linkedVa(5000)],absorbed);
  assert.equal(unchanged.totals.get('3100'),0);
  assert.equal(unchanged.evidence.get('3100')[0].absorbedAtSiteStart,5000);
  const increased = buildChangeExposureByCostCode([submittedCe(5000)],[linkedVa(7500)],absorbed);
  assert.equal(increased.totals.get('3100'),2500);
  const reduced = buildChangeExposureByCostCode([submittedCe(3000)],[linkedVa(3000)],absorbed);
  assert.equal(reduced.totals.get('3100'),0);
});

test('Site Start absorbed recovery exposure preserves direction and does not auto-release', () => {
  const absorbed = [{identity:'va:va-r',costCodeKey:'3100',amountPence:-500000}];
  const moreRecovery = buildChangeExposureByCostCode([], [{variationAccountItemId:'va-r',costCode:'3100',vaExposureUplift:-7500}], absorbed);
  assert.equal(moreRecovery.totals.get('3100'),-2500);
  const reducedRecovery = buildChangeExposureByCostCode([], [{variationAccountItemId:'va-r',costCode:'3100',vaExposureUplift:-3000}], absorbed);
  assert.equal(reducedRecovery.totals.get('3100'),0);
});

test('crossing from absorbed positive exposure to recovery preserves only the new signed exposure', () => {
  const absorbed = [{identity:'ce:ce-1',costCodeKey:'3100',amountPence:500000}];
  const crossed = buildChangeExposureByCostCode(
    [submittedCe(-1000)],
    [{variationAccountItemId:'va-1',sourceCommercialEventId:'ce-1',costCode:'3100',vaExposureUplift:-1000}],
    absorbed
  );
  assert.equal(crossed.totals.get('3100'),-1000);
  assert.equal(crossed.evidence.get('3100')[0].absorbedAtSiteStart,5000);
  assert.equal(crossed.evidence.get('3100')[0].incrementalExposure,-1000);
  assert.notEqual(crossed.totals.get('3100'),-6000);
});

test('crossing from absorbed recovery to positive exposure preserves only the new signed exposure', () => {
  const absorbed = [{identity:'ce:ce-1',costCodeKey:'3100',amountPence:-500000}];
  const crossed = buildChangeExposureByCostCode(
    [submittedCe(1000)],
    [{variationAccountItemId:'va-1',sourceCommercialEventId:'ce-1',costCode:'3100',vaExposureUplift:1000}],
    absorbed
  );
  assert.equal(crossed.totals.get('3100'),1000);
  assert.equal(crossed.evidence.get('3100')[0].absorbedAtSiteStart,-5000);
  assert.equal(crossed.evidence.get('3100')[0].incrementalExposure,1000);
  assert.notEqual(crossed.totals.get('3100'),6000);
});

test('late certificate and ledger facts remain authoritative after Site Start cutover', async () => {
  const budget = { positions: [{ costCode: '3100', costCodeId: 'cc-3100', description: 'Groundworks', originalPence: 10000000, currentPence: 10000000 }] };
  const candidate = await buildCvrCloseCandidate({
    clientId: 'client-1', developmentId: 'dev-1', periodId: 'p01', developmentBudgetDocument: budget,
    loadSources: async () => ({ ok: true, sources: {
      development: sourceOk({ id: 'dev-1' }),
      period: sourceOk({ periodKey: 'P01', periodType: 'monthly_cvr', budgetSource: { state: 'site_start_budget', document: budget } }),
      inputs: sourceOk([]),
      purchaseOrders: sourceOk([{ id: 'po-1', status: 'approved', type: 'S', supplierId: 'supplier-1', development: { id: 'dev-1' }, costRef: { costCode: '3100' }, subtotal: 80000 }]),
      commercialEvents: sourceOk([]), variationOrders: sourceOk([]),
      certificates: sourceOk([{ id: 'cert-late', orderKey: 'dev-1::supplier-1::3100', status: 'locked', grossValue: 30000, netValue: 30000, recoverySigned: 0, valuationSnapshot: { totals: { grossValue: 30000 } } }]),
      ledger: sourceOk([{ id: 'ledger-late', costCodeKey: '3100', netAmount: 40000 }]),
    } }),
  });
  assert.equal(candidate.ready, true);
  const row = candidate.snapshot.rows.find(item => item.costCodeKey === '3100');
  assert.equal(row.certified, 30000);
  assert.equal(row.actualCost, 40000);
  assert.equal(row.currentCost, 40000);
  assert.equal(row.finalForecast, 100000);
});
