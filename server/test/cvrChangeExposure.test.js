const test = require('node:test');
const assert = require('node:assert/strict');
const { directionalEnvelope, buildChangeExposureByCostCode } = require('../services/cvrChangeExposure');

const ce = (id, amount, extra = {}) => ({
  id, status: 'submitted', costCode: '4100', relationshipType: 'variation',
  value: amount, expectedTreatment: 'default', ...extra,
});
const va = (id, amount, sourceCommercialEventId = null, extra = {}) => ({
  variationAccountItemId: id, costCode: '4100', vaExposureUplift: amount,
  sourceCommercialEventId, ...extra,
});
const total = result => result.totals.get('4100') || 0;

test('same-direction linked CE and VA use one directional envelope', () => {
  assert.equal(total(buildChangeExposureByCostCode([ce('ce-1', 20000)], [va('va-1', 20000, 'ce-1')])), 20000);
  assert.equal(total(buildChangeExposureByCostCode([ce('ce-1', 20000)], [va('va-1', 30000, 'ce-1')])), 30000);
  assert.equal(total(buildChangeExposureByCostCode([ce('ce-1', 30000)], [va('va-1', 20000, 'ce-1')])), 30000);
});

test('Submitted CE Expected Liability and its identity-linked VA converge at the greater forecast', () => {
  const expectedFive=ce('ce-hg002',20000,{expectedTreatment:'override',expectedAmount:5000});
  assert.equal(total(buildChangeExposureByCostCode([expectedFive],[va('va-hg002',5000,'ce-hg002')])),5000);
  assert.equal(total(buildChangeExposureByCostCode([expectedFive],[va('va-hg002',7500,'ce-hg002')])),7500);
  assert.equal(total(buildChangeExposureByCostCode([expectedFive],[va('va-hg002',7500)])),12500);
});

test('unlinked evidence remains additive without code/package inference', () => {
  const result = buildChangeExposureByCostCode([ce('ce-1', 20000)], [va('va-1', 20000)]);
  assert.equal(total(result), 40000);
  assert.equal(result.evidence.get('4100').every(item => item.linked === false), true);
});

test('override, hold and exclude remain authoritative for linked evidence', () => {
  assert.equal(total(buildChangeExposureByCostCode([
    ce('ce-1', 20000, { expectedTreatment: 'override', expectedAmount: 12000 }),
  ], [va('va-1', 20000, 'ce-1')])), 20000);
  for (const treatment of ['hold', 'exclude']) {
    const result = buildChangeExposureByCostCode([ce('ce-1', 20000, { expectedTreatment: treatment })], [va('va-1', 20000, 'ce-1')]);
    assert.equal(total(result), 0);
    assert.equal(result.evidence.get('4100')[0].suppressedByTreatment, true);
  }
});

test('signed same-direction credits use directional envelope and opposing signs fail closed', () => {
  assert.deepEqual(directionalEnvelope([-20000, -30000]), { ok: true, value: -30000 });
  const blocked = buildChangeExposureByCostCode([ce('ce-1', 20000)], [va('va-1', -20000, 'ce-1')]);
  assert.equal(blocked.blockers[0].reason, 'linked_exposure_opposing_signs');
  assert.equal(total(blocked), 0);
});

test('approved linked CE is not re-added; VA supplies only its authority residual', () => {
  const result = buildChangeExposureByCostCode([
    ce('ce-1', 20000, { status: 'approved' }),
  ], [va('va-1', 10000, 'ce-1', { amountAlreadyInCurrentContract: 20000 })]);
  assert.equal(total(result), 10000);
  assert.equal(result.evidence.get('4100')[0].linked, false);
});
