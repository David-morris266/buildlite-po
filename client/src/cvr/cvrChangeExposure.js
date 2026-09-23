import { normaliseCostCodeKey } from './cvrCalculations';
import { effectiveExpectedLiability } from '../commercialEvents/commercialEventExpectedLiability';

const pence = value => Math.round((Number(value) || 0) * 100);
const money = value => Math.round(value) / 100;

export function buildChangeExposureByCostCode(events = [], variationItems = []) {
  const submitted = new Map(events.filter(event => event.status === 'submitted').map(event => [String(event.id), event]));
  const consumed = new Set();
  const totals = new Map();
  const evidence = new Map();
  const blockers = [];
  const add = (key, amount, item) => {
    totals.set(key, money(pence(totals.get(key)) + pence(amount)));
    evidence.set(key, [...(evidence.get(key) || []), item]);
  };
  for (const va of variationItems) {
    const key = normaliseCostCodeKey(va.costCode);
    if (!key || va.vaExposureUplift == null) continue;
    const ceId = va.sourceCommercialEventId ? String(va.sourceCommercialEventId) : null;
    const ce = ceId ? submitted.get(ceId) : null;
    if (!ce) { add(key, va.vaExposureUplift, { linked: false, va, resultingExposure: Number(va.vaExposureUplift) || 0 }); continue; }
    consumed.add(ceId);
    const treatment = String(ce.expectedTreatment || 'default');
    const expected = effectiveExpectedLiability(ce);
    if (treatment === 'hold' || treatment === 'exclude') { add(key, 0, { linked: true, commercialEvent: ce, va, resultingExposure: 0, suppressedByTreatment: true }); continue; }
    const values = [pence(expected), pence(va.vaExposureUplift)].filter(Boolean);
    if (new Set(values.map(Math.sign)).size > 1) { blockers.push({ reason: 'linked_exposure_opposing_signs', commercialEventId: ceId, variationAccountItemId: va.variationAccountItemId }); continue; }
    const amount = values.length ? money(values[0] > 0 ? Math.max(...values) : Math.min(...values)) : 0;
    add(key, amount, { linked: true, commercialEvent: ce, va, expectedLiability: expected, resultingExposure: amount });
  }
  for (const [id, ce] of submitted) if (!consumed.has(id)) {
    const key = normaliseCostCodeKey(ce.costCode);
    if (key) { const amount = effectiveExpectedLiability(ce); add(key, amount, { linked: false, commercialEvent: ce, resultingExposure: amount }); }
  }
  return { totals, evidence, blockers };
}
