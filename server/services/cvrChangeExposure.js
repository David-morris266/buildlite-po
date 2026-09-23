const { effectiveExpectedLiability, normalizeTreatment } = require('./commercialEventExpectedLiability');
const { normaliseCostCodeKey, roundMoney } = require('./cvrCloseFormulas');

const pence = value => Math.round((Number(value) || 0) * 100);
const money = value => Math.round(value) / 100;

function directionalEnvelope(values) {
  const material = values.map(pence).filter(Boolean);
  if (!material.length) return { ok: true, value: 0 };
  const signs = new Set(material.map(Math.sign));
  if (signs.size > 1) return { ok: false, value: null };
  return { ok: true, value: money(material[0] > 0 ? Math.max(...material) : Math.min(...material)) };
}

function buildChangeExposureByCostCode(events = [], variationItems = []) {
  const submitted = new Map((events || []).filter(event => event.status === 'submitted')
    .map(event => [String(event.id), event]));
  const consumed = new Set();
  const totals = new Map();
  const evidence = new Map();
  const blockers = [];
  const add = (key, amount, item) => {
    totals.set(key, money(pence(totals.get(key)) + pence(amount)));
    evidence.set(key, [...(evidence.get(key) || []), item]);
  };

  for (const va of variationItems || []) {
    const key = normaliseCostCodeKey(va.costCode);
    if (!key || va.vaExposureUplift == null) continue;
    const ceId = va.sourceCommercialEventId ? String(va.sourceCommercialEventId) : null;
    const ce = ceId ? submitted.get(ceId) : null;
    if (!ce) {
      add(key, va.vaExposureUplift, { linked: false, va, resultingExposure: roundMoney(va.vaExposureUplift) ?? 0 });
      continue;
    }
    consumed.add(ceId);
    const treatment = normalizeTreatment(ce.expectedTreatment);
    const expected = effectiveExpectedLiability(ce);
    const held = treatment === 'hold' || treatment === 'exclude';
    const envelope = held ? { ok: true, value: 0 } : directionalEnvelope([expected, va.vaExposureUplift]);
    if (!envelope.ok) {
      blockers.push({ source: 'changeExposure', reason: 'linked_exposure_opposing_signs', commercialEventId: ceId, variationAccountItemId: va.variationAccountItemId });
      continue;
    }
    add(key, envelope.value, { linked: true, commercialEvent: ce, va, expectedLiability: expected, expectedTreatment: treatment, resultingExposure: envelope.value, suppressedByTreatment: held });
  }

  for (const [ceId, ce] of submitted) {
    if (consumed.has(ceId)) continue;
    const key = normaliseCostCodeKey(ce.costCode);
    if (!key) continue;
    const expected = effectiveExpectedLiability(ce);
    add(key, expected, { linked: false, commercialEvent: ce, expectedLiability: expected, expectedTreatment: normalizeTreatment(ce.expectedTreatment), resultingExposure: expected });
  }
  return { totals, evidence, blockers };
}

module.exports = { directionalEnvelope, buildChangeExposureByCostCode };
