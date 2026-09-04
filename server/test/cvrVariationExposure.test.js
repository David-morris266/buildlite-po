const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXCEPTIONS,
  calculateVariationExposure,
  loadVariationExposureFacts,
} = require('../services/cvrVariationExposure');

const item = (overrides = {}) => ({
  id: 'va-1', reference: 'VA-0001', status: 'active', version: 3,
  developmentId: 'dev-1', packageId: 'package-1', costCode: '4330',
  contractorValue: 20000, contractorClaim: 10000, qsForecast: 17000,
  ...overrides,
});
const allocation = (sourceType, amount, id = sourceType) => ({
  id, sourceType, allocatedAmount: amount, sourceReference: id,
  sourceStatus: sourceType === 'variation_order_line' ? 'issued' : 'approved',
});
const assessment = (amount, id = 'assessment-1') => ({
  id, certificateId: `certificate-${id}`, currentAssessment: amount,
  lockedAt: '2026-09-01T10:00:00Z',
});
const calculate = (overrides = {}) => calculateVariationExposure({
  item: item(overrides.item), packageCostCode: '4330', allocations: [],
  substitutions: [], lockedAssessments: [], ...overrides,
});

test('VA forecast with no authority or certification produces its forecast exposure', () => {
  const result = calculate();
  assert.equal(result.effectiveVaExposure, 17000);
  assert.equal(result.vaExposureUplift, 17000);
  assert.equal(result.remainingForecastExposure, 17000);
});

test('new Payment Authority and certification are evidence within forecast, not additions', () => {
  const result = calculate({
    allocations: [allocation('payment_authority', 8000)],
    lockedAssessments: [assessment(8000)],
  });
  assert.equal(result.effectiveRecognisedAuthority, 8000);
  assert.equal(result.effectiveVaExposure, 17000);
  assert.equal(result.vaExposureUplift, 17000);
  assert.equal(result.remainingForecastExposure, 9000);
});

test('Issued VO authority already in Current Contract leaves only residual VA uplift', () => {
  const result = calculate({
    allocations: [allocation('variation_order_line', 12000)],
    lockedAssessments: [assessment(8000)],
  });
  assert.equal(result.authorityAlreadyInCurrentContract, 12000);
  assert.equal(result.effectiveVaExposure, 17000);
  assert.equal(result.vaExposureUplift, 5000);
  assert.equal(result.remainingForecastExposure, 5000);
});

test('recognised authority floors exposure without rewriting QS Forecast', () => {
  const result = calculate({ item: item({ qsForecast: 10000 }), allocations: [allocation('variation_order_line', 12000)], lockedAssessments: [assessment(8000)] });
  assert.equal(result.qsForecast, 10000);
  assert.equal(result.effectiveVaExposure, 12000);
  assert.deepEqual(result.exceptions, [EXCEPTIONS.FORECAST_BELOW_RECOGNISED_AUTHORITY]);
});

test('Locked certification floors exposure and classifies both certification exceptions', () => {
  const result = calculate({ allocations: [allocation('variation_order_line', 12000)], lockedAssessments: [assessment(18000)] });
  assert.equal(result.effectiveVaExposure, 18000);
  assert.equal(result.remainingForecastExposure, 6000);
  assert.ok(result.exceptions.includes(EXCEPTIONS.FORECAST_BELOW_LOCKED_CERTIFICATION));
  assert.ok(result.exceptions.includes(EXCEPTIONS.CERTIFIED_ABOVE_FORECAST));
});

test('negative credits use the most negative directional exposure', () => {
  const result = calculate({ item: item({ qsForecast: -10000 }), allocations: [allocation('payment_authority', -6000)], lockedAssessments: [assessment(-4000)] });
  assert.equal(result.effectiveVaExposure, -10000);
  assert.equal(result.remainingForecastExposure, -4000);
  assert.equal(result.vaExposureUplift, -10000);
});

test('supported PA is not duplicated when only genuinely new PA is allocated', () => {
  const result = calculate({ allocations: [allocation('variation_order_line', 12000)], lockedAssessments: [assessment(8000)] });
  assert.equal(result.authorityComposition.effectivePaymentAuthority, 0);
  assert.equal(result.effectiveRecognisedAuthority, 12000);
  assert.equal(result.vaExposureUplift, 5000);
});

test('superseded CE authority is not claimed as still represented in Current Contract', () => {
  const result = calculate({
    allocations: [
      { ...allocation('commercial_event', 8000, 'ce'), representedInCurrentContract: false },
      allocation('variation_order_line', 12000, 'vo'),
    ],
  });
  assert.equal(result.effectiveRecognisedAuthority, 20000);
  assert.equal(result.authorityAlreadyInCurrentContract, 12000);
  assert.ok(result.exceptions.includes(EXCEPTIONS.FORECAST_BELOW_RECOGNISED_AUTHORITY));
});

test('Payment Release cash is not an exposure input', () => {
  const base = calculate({ allocations: [allocation('payment_authority', 8000)], lockedAssessments: [assessment(8000)] });
  const withIgnoredCashFact = calculate({ allocations: [allocation('payment_authority', 8000)], lockedAssessments: [assessment(8000)], paymentRelease: 9120 });
  assert.deepEqual(withIgnoredCashFact, base);
});

test('opposing signs fail closed without silently netting', () => {
  const result = calculate({ allocations: [allocation('payment_authority', -6000)] });
  assert.equal(result.ready, false);
  assert.equal(result.effectiveVaExposure, null);
  assert.equal(result.vaExposureUplift, null);
  assert.ok(result.exceptions.includes(EXCEPTIONS.OPPOSING_SIGN_EXPOSURE));
});

test('canonical package cost-code mismatch fails closed', () => {
  const result = calculate({ packageCostCode: '4331' });
  assert.equal(result.ready, false);
  assert.ok(result.exceptions.includes(EXCEPTIONS.COST_CODE_MAPPING_AMBIGUOUS));
});

test('zero facts remain a ready exact-zero exposure', () => {
  const result = calculate({ item: item({ qsForecast: 0 }) });
  assert.equal(result.ready, true);
  assert.equal(result.effectiveVaExposure, 0);
  assert.equal(result.vaExposureUplift, 0);
  assert.equal(result.remainingForecastExposure, 0);
  assert.deepEqual(result.exceptions, []);
});

test('incomplete authority provenance fails closed', () => {
  const result = calculate({ allocations: [{ id: 'allocation', sourceType: 'payment_authority', allocatedAmount: 8000 }] });
  assert.equal(result.ready, false);
  assert.equal(result.effectiveVaExposure, null);
  assert.ok(result.exceptions.includes(EXCEPTIONS.INCOMPLETE_SOURCE_PROVENANCE));
});

test('penny arithmetic and substitutions/reversals remain exact', () => {
  const result = calculate({
    item: item({ qsForecast: 17.03 }),
    allocations: [
      allocation('commercial_event', 8.01, 'ce'),
      allocation('variation_order_line', 12.02, 'vo'),
      { ...allocation('payment_authority', -2.01, 'pa-reversal'), allocationKind: 'reversal' },
    ],
    substitutions: [{ id: 'sub', predecessorAllocationId: 'ce', successorAllocationId: 'vo', substitutedAmount: 8.01 }],
    lockedAssessments: [assessment(8.02)],
  });
  assert.equal(result.effectiveRecognisedAuthority, 10.01);
  assert.equal(result.authorityAlreadyInCurrentContract, 12.02);
  assert.equal(result.effectiveVaExposure, 17.03);
  assert.equal(result.vaExposureUplift, 5.01);
  assert.equal(result.remainingForecastExposure, 7.02);
});

test('loader returns deterministic source/version facts from persisted-shape rows', async () => {
  const responses = [
    [{ id: 'va-uuid', variation_reference: 'VA-0001', status: 'active', version: 4, development_id: 'dev-1', package_id: 'package-uuid', cost_code: '4330', package_cost_code: '4330', current_contractor_value: '20000.00', current_qs_forecast: '17000.00' }],
    [{ id: 'allocation-uuid', variation_account_item_id: 'va-uuid', source_type: 'payment_authority', signed_allocated_amount: '8000.00', allocation_kind: 'authority', source_status_snapshot: 'approved', source_value_snapshot: '8000.00', source_reference_snapshot: 'PA-1' }],
    [],
    [{ id: 'assessment-uuid', certificate_id: 'certificate-uuid', variation_account_item_id: 'va-uuid', application_variation_line_id: 'line-uuid', signed_current_assessment: '8000.00', previous_certified_at_lock: '0.00', cumulative_certified_at_lock: '8000.00', source_authority_snapshot: {}, locked_at: '2026-09-01', locked_by_user_id: 'user-uuid', version: 1 }],
    [{ variation_account_item_id: 'va-uuid', contractor_claim: '10000.00' }],
    [],
  ];
  const db = { query: async () => ({ rows: responses.shift() }) };
  const [result] = await loadVariationExposureFacts(db, 'client-uuid', 'dev-1');
  assert.equal(result.contractorClaim, 10000);
  assert.equal(result.effectiveVaExposure, 17000);
  assert.equal(result.effectiveRecognisedAuthority, 8000);
  assert.deepEqual(result.sourceVersions, {
    variationAccountItemVersion: 4,
    allocationIds: ['allocation-uuid'], substitutionIds: [], lockedAssessmentIds: ['assessment-uuid'],
  });
});
