import { describe, expect, it } from 'vitest';
import { attributeCvrMovementRow, movementExplanationFingerprint } from './cvrMovementAttribution';
import { normalizeCvrSnapshotRow } from './cvrSnapshotMapper';

const component = (key, movement) => ({ key, label: key, available: true, movement });
const row = (components) => ({ costCodeKey: '4120', components });
const period = (movementExplanations = []) => ({
  id: 'period-current', commercialCommentary: { movementExplanations },
});
const previousPeriod = { id: 'period-previous', snapshot: { id: 'snapshot-previous' } };

describe('deterministic CVR movement attribution', () => {
  it('attributes CE creation, value and hold/include changes by stable CE identity', () => {
    const result = attributeCvrMovementRow({
      row: row([component('expectedLiability', 150)]),
      previous: { expectedLiabilityProvenance: [{ ceId: 'ce-1', ceReference: 'CE-001', effectiveExpectedAmount: 100 }] },
      current: { expectedLiabilityProvenance: [{ ceId: 'ce-1', ceReference: 'CE-001', effectiveExpectedAmount: 250, expectedTreatment: 'override', reason: 'Revised risk' }] },
      currentPeriod: period(), previousPeriod,
    });
    expect(result.components[0].attributions[0]).toMatchObject({ sourceId: 'ce-1', amount: 150, description: 'Revised risk' });
    expect(result.components[0].unattributed).toBe(0);
    expect(result).toMatchObject({ automaticallyAttributed: 150, qsExplained: 0, awaitingExplanation: 0 });
  });

  it('caps overlapping CE claims at the signed component movement', () => {
    const result = attributeCvrMovementRow({
      row: row([component('expectedLiability', 100)]), previous: { expectedLiabilityProvenance: [] },
      current: { expectedLiabilityProvenance: [
        { ceId: 'ce-1', effectiveExpectedAmount: 75 }, { ceId: 'ce-2', effectiveExpectedAmount: 75 },
      ] }, currentPeriod: period(), previousPeriod,
    });
    expect(result.components[0].attributions.reduce((sum, item) => sum + item.amount, 0)).toBe(100);
    expect(result.components[0].unattributed).toBe(0);
  });

  it('groups an explicit CE to approved commitment transition across components without net double count', () => {
    const result = attributeCvrMovementRow({
      row: row([component('systemForecast', 100), component('expectedLiability', -100)]),
      previous: { expectedLiabilityProvenance: [{ ceId: 'ce-12', ceReference: 'CE-0012', effectiveExpectedAmount: 100 }] },
      current: { expectedLiabilityProvenance: [], commercialEventEvidence: [{ ceId: 'ce-12', status: 'approved', issuedVariationOrderId: 'vo-12' }] },
      currentPeriod: period(), previousPeriod,
    });
    expect(result.components[0].attributions[0].transitionGroupId).toBe('ce-authority-transition:ce-12');
    expect(result.components[1].attributions[0].transitionGroupId).toBe('ce-authority-transition:ce-12');
    expect(result.automaticallyAttributed).toBe(0);
    expect(result.awaitingExplanation).toBe(0);
  });

  it('attributes a production-shaped frozen-to-live VA bridge only with exact immutable history', () => {
    const previous = normalizeCvrSnapshotRow({ costCodeKey: '4180', variationExposureItems: [{
      variationAccountItemId: 'va-1', reference: 'VA-0001', itemVersion: 1,
      qsForecast: 7000, effectiveVaExposure: 7000,
      authorityAlreadyInCurrentContract: 7000, vaExposureUplift: 0,
    }] });
    const current = { variationExposureItems: [{
      variationAccountItemId: 'va-1', reference: 'VA-0001', description: 'Revised valley detail',
      itemVersion: 2, qsForecast: 8000, effectiveVaExposure: 8000,
      authorityAlreadyInCurrentContract: 7000, vaExposureUplift: 1000,
      forecastHistory: [{ id: 'history-2', priorValue: 7000, newValue: 8000,
        itemVersion: 2, reason: 'UAT test — revised VA forecast' }],
    }] };
    const result = attributeCvrMovementRow({ row: row([component('vaExposureUplift', 1000)]),
      previous, current, currentPeriod: period(), previousPeriod });
    expect(result.components[0]).toMatchObject({ attributed: 1000, unattributed: 0 });
    expect(result.components[0].attributions[0]).toMatchObject({
      sourceId: 'va-1', reference: 'VA-0001 — Revised valley detail', amount: 1000,
      description: 'UAT test — revised VA forecast',
    });
  });

  it.each([
    ['missing previous item', [], [{ itemVersion: 2, priorValue: 7000, newValue: 8000 }]],
    ['missing history', null, []],
    ['non-contiguous history', null, [{ itemVersion: 2, priorValue: 6500, newValue: 8000, reason: 'Gap' }]],
    ['ambiguous history', null, [{ itemVersion: 2, priorValue: 7000, newValue: 8000, reason: 'A' }, { itemVersion: 2, priorValue: 7000, newValue: 8000, reason: 'B' }]],
  ])('leaves VA movement unattributed for %s', (_name, previousOverride, history) => {
    const previousItems = previousOverride || [{ variationAccountItemId: 'va-1', itemVersion: 1,
      qsForecast: 7000, effectiveVaExposure: 7000, authorityAlreadyInCurrentContract: 7000, vaExposureUplift: 0 }];
    const result = attributeCvrMovementRow({ row: row([component('vaExposureUplift', 1000)]),
      previous: { variationExposureItems: previousItems }, current: { variationExposureItems: [{
        variationAccountItemId: 'va-1', itemVersion: 2, qsForecast: 8000,
        effectiveVaExposure: 8000, authorityAlreadyInCurrentContract: 7000,
        vaExposureUplift: 1000, forecastHistory: history,
      }] }, currentPeriod: period(), previousPeriod });
    expect(result.components[0]).toMatchObject({ attributions: [], unattributed: 1000 });
  });

  it('accepts a deterministic multi-revision chain without double counting', () => {
    const result = attributeCvrMovementRow({ row: row([component('vaExposureUplift', 1000)]),
      previous: { variationExposureItems: [{ variationAccountItemId: 'va-1', itemVersion: 1,
        qsForecast: 7000, effectiveVaExposure: 7000, authorityAlreadyInCurrentContract: 7000, vaExposureUplift: 0 }] },
      current: { variationExposureItems: [{ variationAccountItemId: 'va-1', itemVersion: 3,
        qsForecast: 8000, effectiveVaExposure: 8000, authorityAlreadyInCurrentContract: 7000,
        vaExposureUplift: 1000, forecastHistory: [
          { itemVersion: 2, priorValue: 7000, newValue: 7500, reason: 'First revision' },
          { itemVersion: 3, priorValue: 7500, newValue: 8000, reason: 'Second revision' },
        ] }] }, currentPeriod: period(), previousPeriod });
    expect(result.components[0]).toMatchObject({ attributed: 1000, unattributed: 0 });
    expect(result.components[0].attributions).toHaveLength(1);
    expect(result.components[0].attributions[0].evidence).toHaveLength(2);
  });

  it('fails closed when forecast history changes but uplift causality or component amount does not reconcile', () => {
    const base = { variationAccountItemId: 'va-1', itemVersion: 1, qsForecast: 7000,
      effectiveVaExposure: 7000, authorityAlreadyInCurrentContract: 7000, vaExposureUplift: 0 };
    const current = { variationAccountItemId: 'va-1', itemVersion: 2, qsForecast: 8000,
      effectiveVaExposure: 7000, authorityAlreadyInCurrentContract: 7000, vaExposureUplift: 0,
      forecastHistory: [{ itemVersion: 2, priorValue: 7000, newValue: 8000, reason: 'No uplift' }] };
    const noUplift = attributeCvrMovementRow({ row: row([component('vaExposureUplift', 1000)]),
      previous: { variationExposureItems: [base] }, current: { variationExposureItems: [current] },
      currentPeriod: period(), previousPeriod });
    expect(noUplift.components[0].attributions).toEqual([]);
    const wrongComponent = attributeCvrMovementRow({ row: row([component('vaExposureUplift', 500)]),
      previous: { variationExposureItems: [base] }, current: { variationExposureItems: [{ ...current,
        effectiveVaExposure: 8000, vaExposureUplift: 1000 }] }, currentPeriod: period(), previousPeriod });
    expect(wrongComponent.components[0]).toMatchObject({ attributions: [], unattributed: 500 });
  });

  it('uses adjustment delta reason, including adoption history, but not an unexplained clearing', () => {
    const adopted = attributeCvrMovementRow({ row: row([component('commercialAdjustment', 50)]), previous: { commercialAdjustment: 0 }, current: { costCodeKey: '4120', commercialAdjustment: 50, adjustmentHistory: [{ id: 'adopt-1', source: 'prelims_adoption', previousAdjustment: 0, newAdjustment: 50, reason: 'Adopted prelims' }] }, currentPeriod: period(), previousPeriod });
    expect(adopted.components[0].attributions[0]).toMatchObject({ sourceType: 'prelims_adoption', amount: 50, reference: 'Prelims adoption' });
    const cleared = attributeCvrMovementRow({ row: row([component('commercialAdjustment', -50)]), previous: { commercialAdjustment: 50 }, current: { costCodeKey: '4120', commercialAdjustment: 0 }, currentPeriod: period(), previousPeriod });
    expect(cleared.components[0].unattributed).toBe(-50);
  });

  it('keeps PO-like System Forecast movement unattributed and certificate/ledger deltas supporting only', () => {
    const result = attributeCvrMovementRow({ row: row([component('systemForecast', 500)]),
      previous: { certified: 10, actualCost: 10 }, current: { certified: 20, actualCost: 40 }, currentPeriod: period(), previousPeriod });
    expect(result.components[0]).toMatchObject({ attributions: [], unattributed: 500 });
    expect(result.supportingActivity.map((item) => item.sourceType)).toEqual(['certificate_activity', 'ledger_activity']);
  });

  it('matches whole-residual explanations only while the comparison fingerprint remains current', () => {
    const baseRow = row([component('systemForecast', 500)]);
    const fingerprint = movementExplanationFingerprint({ previousPeriod, row: baseRow, component: baseRow.components[0] });
    const saved = { costCodeKey: '4120', component: 'systemForecast', fingerprint, unexplainedAmount: 500, reason: 'Revised planting scope' };
    const current = attributeCvrMovementRow({ row: baseRow, current: {}, previous: {}, currentPeriod: period([saved]), previousPeriod });
    expect(current.components[0].explanation).toMatchObject({ stale: false, reason: 'Revised planting scope' });
    expect(current).toMatchObject({ automaticallyAttributed: 0, qsExplained: 500, awaitingExplanation: 0 });
    const changedRow = row([component('systemForecast', 600)]);
    const changed = attributeCvrMovementRow({ row: changedRow, current: {}, previous: {}, currentPeriod: period([saved]), previousPeriod });
    expect(changed.components[0].explanation.stale).toBe(true);
    expect(changed).toMatchObject({ qsExplained: 0, awaitingExplanation: 600 });
  });

  it('partitions automatic, QS-explained and awaiting amounts exactly once with signed reconciliation', () => {
    const components = [
      component('commercialAdjustment', 1000),
      component('systemForecast', 500),
      component('expectedLiability', -200),
    ];
    const movementRow = row(components);
    movementRow.movement = 1300;
    movementRow.residual = 0;
    const systemFingerprint = movementExplanationFingerprint({
      previousPeriod,
      row: movementRow,
      component: components[1],
    });
    const result = attributeCvrMovementRow({
      row: movementRow,
      previous: { commercialAdjustment: 0, expectedLiabilityProvenance: [] },
      current: {
        costCodeKey: '4120',
        commercialAdjustment: 1000,
        adjustmentReason: 'Recorded adjustment reason',
        expectedLiabilityProvenance: [],
      },
      currentPeriod: period([{
        costCodeKey: '4120', component: 'systemForecast', fingerprint: systemFingerprint,
        unexplainedAmount: 500, reason: 'QS explanation',
      }]),
      previousPeriod,
    });
    expect(result).toMatchObject({
      automaticallyAttributed: 1000,
      qsExplained: 500,
      awaitingExplanation: -200,
      awaitingExplanationMagnitude: 200,
      managementMovement: 1300,
      managementReconciles: true,
    });
  });

  it('keeps a valid component explanation current when another component changes', () => {
    const system = component('systemForecast', 500);
    const movementRow = row([system, component('commercialAdjustment', 1000)]);
    movementRow.movement = 1500;
    movementRow.residual = 0;
    const fingerprint = movementExplanationFingerprint({ previousPeriod, row: movementRow, component: system });
    const result = attributeCvrMovementRow({
      row: movementRow,
      previous: { commercialAdjustment: 0 },
      current: { costCodeKey: '4120', commercialAdjustment: 1000, adjustmentReason: 'New adjustment' },
      currentPeriod: period([{
        costCodeKey: '4120', component: 'systemForecast', fingerprint,
        unexplainedAmount: 500, reason: 'Still-valid system explanation',
      }]),
      previousPeriod,
    });
    expect(result.components[0].explanation.stale).toBe(false);
    expect(result).toMatchObject({
      automaticallyAttributed: 1000, qsExplained: 500, awaitingExplanation: 0,
      managementMovement: 1500, managementReconciles: true,
    });
  });
});
