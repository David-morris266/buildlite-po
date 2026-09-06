const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProjection } = require('../services/variationAccountAuthorityRepository');
const { classifyVariationAssessmentAuthority, loadVariationAssessmentAuthority } = require('../services/variationAccountCertificateAuthority');

const allocation = (id, sourceType, amount, extra = {}) => ({ id, sourceType, allocatedAmount: amount, sourceReference: id, createdAt: id, ...extra });
function classify({ authority = 0, previous = 0, current = 0, paByAssessment = [] } = {}) {
  const allocations = authority ? [allocation('ce-1', 'commercial_event', authority)] : [];
  const projection = buildProjection({ item: { id: 'va', qsForecast: current + previous }, allocations, substitutions: [] });
  return classifyVariationAssessmentAuthority({ assessment: { id: 'current', previousCertified: previous, currentAssessment: current }, projection, paymentAuthorityByAssessment: new Map(paByAssessment) });
}

test('general authority supports current assessment after chronological prior certification', () => {
  for (const [authority, previous, current, supported, unapproved] of [[7000,0,4000,4000,0],[3000,0,4000,3000,1000],[5000,3000,4000,2000,2000],[10000,3000,4000,4000,0]]) {
    const result = classify({ authority, previous, current });
    assert.deepEqual([result.priorAuthority, result.unapprovedAmount], [supported, unapproved]);
  }
});

test('late CE covers historical certification before the current assessment', () => {
  const result = classify({ authority: 7000, previous: 4000, current: 2000 });
  assert.equal(result.priorGeneralAuthorityConsumption, 4000);
  assert.equal(result.authorityAvailableBeforeAssessment, 3000);
  assert.deepEqual([result.priorAuthority, result.unapprovedAmount], [2000, 0]);
});

test('prior assessment Payment Authority is reserved and never reused', () => {
  const priorPa = [['prior-assessment', 4000]];
  assert.deepEqual([classify({ previous: 4000, current: 2000, paByAssessment: priorPa }).priorAuthority, classify({ previous: 4000, current: 2000, paByAssessment: priorPa }).unapprovedAmount], [0, 2000]);
  const laterCe = classify({ authority: 7000, previous: 4000, current: 2000, paByAssessment: priorPa });
  assert.equal(laterCe.priorGeneralAuthorityConsumption, 0);
  assert.deepEqual([laterCe.priorAuthority, laterCe.unapprovedAmount], [2000, 0]);
});

test('credits use signed pence and opposing authority cannot cross-support', () => {
  for (const [authority, previous, current, supported, unapproved] of [[-5000,-2000,-2000,-2000,0],[-1000,-500,-1000,-500,-500],[1000,0,-250,0,-250],[0.03,0,0.02,0.02,0]]) {
    const result = classify({ authority, previous, current });
    assert.deepEqual([result.priorAuthority, result.unapprovedAmount], [supported, unapproved]);
  }
});

test('support evidence is deterministic and sums exactly to supported authority', () => {
  const allocations = [allocation('a', 'commercial_event', 1000), allocation('b', 'variation_order_line', 2500)];
  const projection = buildProjection({ item: { id: 'va', qsForecast: 3500 }, allocations, substitutions: [] });
  const result = classifyVariationAssessmentAuthority({ assessment: { id: 'current', previousCertified: 0, currentAssessment: 3000 }, projection });
  assert.deepEqual(result.supportingSources.map(item => [item.allocationId, item.appliedAmount]), [['a', 1000], ['b', 2000]]);
  assert.equal(result.supportingSources.reduce((sum, item) => sum + item.appliedAmount, 0), result.priorAuthority);
});

test('support evidence does not reuse the source portion consumed by prior certification', () => {
  const allocations = [allocation('a', 'commercial_event', 3000), allocation('b', 'variation_order_line', 4000)];
  const projection = buildProjection({ item: { id: 'va', qsForecast: 7000 }, allocations, substitutions: [] });
  const result = classifyVariationAssessmentAuthority({ assessment: { id: 'current', previousCertified: 4000, currentAssessment: 2000 }, projection });
  assert.deepEqual(result.supportingSources.map(item => [item.allocationId, item.appliedAmount]), [['b', 2000]]);
});

test('recorded Payment Authority support usage reserves its exact CE source', () => {
  const allocations = [allocation('a', 'commercial_event', 3000), allocation('b', 'commercial_event', 4000)];
  const projection = buildProjection({ item: { id: 'va', qsForecast: 7000 }, allocations, substitutions: [] });
  const result = classifyVariationAssessmentAuthority({
    assessment: { id: 'current', previousCertified: 2000, currentAssessment: 4000 },
    projection,
    priorSupportByAllocation: new Map([['b', 2000]]),
  });
  assert.deepEqual(result.supportingSources.map(item => [item.allocationId, item.appliedAmount]), [['a', 3000], ['b', 1000]]);
  assert.deepEqual(result.priorRecordedSupportUsages, [{ allocationId: 'b', amount: 2000 }]);
});

test('existing projection applies CE to VO substitution and reversal before classification', () => {
  const allocations = [allocation('ce', 'commercial_event', 8000), allocation('vo', 'variation_order_line', 12000), allocation('reverse', 'variation_order_line', -2000, { allocationKind: 'reversal' })];
  const projection = buildProjection({ item: { id: 'va', qsForecast: 12000 }, allocations, substitutions: [{ predecessorAllocationId: 'ce', successorAllocationId: 'vo', substitutedAmount: 8000 }] });
  const result = classifyVariationAssessmentAuthority({ assessment: { id: 'current', previousCertified: 0, currentAssessment: 11000 }, projection });
  assert.equal(projection.effectiveRecognisedAuthority, 10000);
  assert.deepEqual([result.priorAuthority, result.unapprovedAmount], [10000, 1000]);
});

test('read loader resolves assessment-specific PA provenance while leaving later CE available', async () => {
  const assessment = { id: '00000000-0000-0000-0000-000000000001', variationAccountItemId: '00000000-0000-0000-0000-000000000002', previousCertified: 4000, currentAssessment: 2000 };
  const db = { query: async sql => {
    if (sql.includes('SELECT id,variation_reference')) return { rows: [{ id: assessment.variationAccountItemId, variation_reference: 'VA-1', current_qs_forecast: '7000.00' }] };
    if (sql.includes('LEFT JOIN payment_authority_decision_lines')) return { rows: [
      { id: '00000000-0000-0000-0000-000000000003', variation_account_item_id: assessment.variationAccountItemId, source_type: 'commercial_event', signed_allocated_amount: '7000.00', allocation_kind: 'authority', source_reference_snapshot: 'CE-1', created_at: '2026-01-02' },
      { id: '00000000-0000-0000-0000-000000000004', variation_account_item_id: assessment.variationAccountItemId, source_type: 'payment_authority', signed_allocated_amount: '4000.00', allocation_kind: 'authority', source_reference_snapshot: 'PA-1', payment_authority_assessment_id: '00000000-0000-0000-0000-000000000005', created_at: '2026-01-01' },
    ] };
    if (sql.includes('package_variation_account_authority_substitutions')) return { rows: [] };
    if (sql.includes('SELECT a.id,a.variation_account_item_id')) return { rows: [{ id: '00000000-0000-0000-0000-000000000005', variation_account_item_id: assessment.variationAccountItemId }] };
    if (sql.includes('payment_authority_support_usages')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const result = (await loadVariationAssessmentAuthority('client', 'package', 'certificate', [assessment], db)).get(assessment.id);
  assert.equal(result.priorAssessmentPaymentAuthority, 4000);
  assert.equal(result.priorGeneralAuthorityConsumption, 0);
  assert.deepEqual([result.priorAuthority, result.unapprovedAmount], [2000, 0]);
});
