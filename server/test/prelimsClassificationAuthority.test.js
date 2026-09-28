const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveEffectivePrelimsClassification } = require('../services/prelimsClassificationAuthority');

test('active Commercial Head category takes precedence over contradictory legacy Prelims classification', () => {
  const modernPrelims = resolveEffectivePrelimsClassification({ costCodeKey: 'A', classification: { costCodeKey: 'A', exists: true, semanticGroup: 'BUILD' }, costCode: { head_active: true, buildlite_category: 'PRELIMINARIES' } });
  assert.equal(modernPrelims.semanticGroup, 'PRELIMS');
  assert.equal(modernPrelims.authority, 'commercial_head_category');
  const modernOther = resolveEffectivePrelimsClassification({ costCodeKey: 'B', classification: { costCodeKey: 'B', exists: true, semanticGroup: 'PRELIMS' }, costCode: { head_active: true, buildlite_category: 'HOUSE_BUILD' } });
  assert.equal(modernOther.semanticGroup, 'HOUSE_BUILD');
});

test('legacy classification remains the fallback when usable modern category authority is absent', () => {
  const legacy = { costCodeKey: 'C', exists: true, semanticGroup: 'PRELIMS', forecastDriver: 'STANDARD_CVR' };
  assert.equal(resolveEffectivePrelimsClassification({ costCodeKey: 'C', classification: legacy, costCode: { head_active: false, buildlite_category: 'PRELIMINARIES' } }), legacy);
  assert.deepEqual(resolveEffectivePrelimsClassification({ costCodeKey: 'D' }), { costCodeKey: 'D', exists: false, semanticGroup: 'UNCLASSIFIED', forecastDriver: 'STANDARD_CVR', authority: 'legacy_default' });
});
