import { describe, expect, it } from 'vitest';
import { buildStoryboardExplanation, buildStoryboardBridge } from './cvrStoryboardEvidence';

const evidence = (items) => ({ captured: true, commitment: { items, reconciliation: 'reconciled' } });
const vo = (amount) => ({ type: 'variation_order', id: 'vo-1', reference: 'S0016/VO-0001', includedAmount: amount });

describe('CVR Storyboard commercial explanation', () => {
  const reconciliationRow = { committed: 100, uncommittedForecast: 0, systemForecast: 100,
    finalForecast: 100, changeExposure: 0, commercialAdjustment: 0,
    displayMetadata: { commercialEvidence: evidence([]) } };

  it('accepts a known numeric zero residual as reconciled', () => {
    const result = buildStoryboardExplanation({ row: reconciliationRow, movement: {
      comparable: true, movement: 10, residual: 0,
      bridge: { systemForecast: 10, changeExposure: 0, commercialAdjustment: 0, committed: 10 },
      previousCommercialEvidence: evidence([]),
    } });
    expect(result.reconciliationConfirmed).toBe(true);
    expect(result.financialRemainder).toBe(0);
    expect(result.financialUnreconciled).toBe(false);
  });

  it('retains a known numeric non-zero residual as a genuine warning', () => {
    const result = buildStoryboardExplanation({ row: reconciliationRow, movement: {
      comparable: true, movement: 10, residual: 2,
      bridge: { systemForecast: 8, changeExposure: 0, commercialAdjustment: 0, committed: 8 },
      previousCommercialEvidence: evidence([]),
    } });
    expect(result.title).toBe('Forecast movement needs reconciliation');
    expect(result.financialRemainder).toBe(2);
    expect(result.text).toContain('+£2.00 remains to be reviewed');
  });

  it('derives a zero residual from complete authoritative components when residual is null', () => {
    const result = buildStoryboardExplanation({ row: reconciliationRow, movement: {
      comparable: true, movement: 10, residual: null,
      bridge: { systemForecast: 8, changeExposure: 3, commercialAdjustment: -1, committed: 8 },
      previousCommercialEvidence: evidence([]),
    } });
    expect(result.reconciliationConfirmed).toBe(true);
    expect(result.financialRemainder).toBe(0);
    expect(result.financialUnreconciled).toBe(false);
  });

  it('derives and warns on a non-zero residual from complete authoritative components', () => {
    const result = buildStoryboardExplanation({ row: reconciliationRow, movement: {
      comparable: true, movement: 10, residual: null,
      bridge: { systemForecast: 8, changeExposure: 0, commercialAdjustment: 0, committed: 8 },
      previousCommercialEvidence: evidence([]),
    } });
    expect(result.reconciliationConfirmed).toBe(true);
    expect(result.financialRemainder).toBe(2);
    expect(result.title).toBe('Forecast movement needs reconciliation');
  });

  it('does not claim reconciliation when residual and required components are unavailable', () => {
    const result = buildStoryboardExplanation({ row: reconciliationRow, movement: {
      comparable: true, movement: 10, residual: null,
      bridge: { systemForecast: 10, changeExposure: null, commercialAdjustment: 0, committed: 10 },
      previousCommercialEvidence: evidence([]),
    } });
    expect(result.reconciliationConfirmed).toBe(false);
    expect(result.financialRemainder).toBeNull();
    expect(result.title).toBe('Forecast reconciliation cannot be confirmed');
    expect(result.text).toContain('Reconciliation cannot be confirmed for this comparison.');
  });

  it('explains Welford fencing commitment absorption without claiming EFC movement', () => {
    const previous = { committed: 125894.54, uncommittedForecast: 1271.66, finalForecast: 127166.2,
      displayMetadata: { commercialEvidence: evidence([]) } };
    const current = { committed: 126894.54, uncommittedForecast: 271.66, finalForecast: 127166.2,
      changeExposure: 0, commercialAdjustment: 0,
      displayMetadata: { commercialEvidence: evidence([vo(1000)]) } };
    const result = buildStoryboardExplanation({ row: current, movement: {
      comparable: true, movement: 0, bridge: buildStoryboardBridge(current, previous),
      previousCommercialEvidence: evidence([]),
    } });
    expect(result.text).toContain('S0016/VO-0001 increased commitment by £1,000.00');
    expect(result.text).toContain('existing allowance absorbed the commitment change');
    expect(result.text).toContain('Uncommitted moved by −£1,000.00');
    expect(result.text).toContain('EFC remained £127,166.20');
  });

  it('explains Welford drainage uplift only when evidence and authoritative bridge reconcile', () => {
    const previous = { committed: 351716.53, uncommittedForecast: 0, systemForecast: 351716.53, finalForecast: 351716.53,
      displayMetadata: { commercialEvidence: evidence([]) } };
    const current = { committed: 353466.53, uncommittedForecast: 0, systemForecast: 353466.53, finalForecast: 353466.53,
      changeExposure: 0, commercialAdjustment: 0,
      displayMetadata: { commercialEvidence: evidence([vo(1750)]) } };
    const result = buildStoryboardExplanation({ row: current, movement: {
      comparable: true, movement: 1750, bridge: buildStoryboardBridge(current, previous),
      previousCommercialEvidence: evidence([]),
    } });
    expect(result.text).toContain('S0016/VO-0001 increased commitment by £1,750.00');
    expect(result.text).toContain('System Forecast +£1,750.00');
    expect(result.text).toContain('EFC +£1,750.00');
    expect(result.text).toContain('current EFC of £353,466.53');
  });

  it('treats legacy Site Start attribution limits as evidence context, not a false financial warning', () => {
    const current = { committed: 353466.53, uncommittedForecast: 0, systemForecast: 353466.53,
      finalForecast: 353466.53, changeExposure: 0, commercialAdjustment: 0,
      displayMetadata: { commercialEvidence: evidence([vo(1750)]) } };
    const result = buildStoryboardExplanation({ row: current, movement: {
      comparable: true, movement: 1750, unexplained: true, residual: null, awaitingExplanation: 1750,
      bridge: { committed: 1750, systemForecast: 1750, changeExposure: 0,
        commercialAdjustment: 0, uncommittedForecast: 0 }, previousCommercialEvidence: null,
    } });
    expect(result.title).toBe('EFC increased by £1,750.00');
    expect(result.financialUnreconciled).toBe(false);
    expect(result.reconciliationConfirmed).toBe(true);
    expect(result.attributionLimited).toBe(true);
    expect(result.evidenceNote).toContain('financial movement reconciles');
    expect(result.text).not.toContain('needs reconciliation');
    expect(result.text).not.toContain('does not reconcile');
  });

  it('does not substitute live evidence when a legacy historic snapshot lacks capture', () => {
    const row = { finalForecast: 100, committed: 90, changeExposure: 0, commercialAdjustment: 0, displayMetadata: {} };
    const result = buildStoryboardExplanation({ row, siteStart: true });
    expect(result.evidenceCaptured).toBe(false);
  });

  it('does not attribute a VO when previous record evidence was not captured', () => {
    const current = { committed: 1100, uncommittedForecast: 0, finalForecast: 1100, changeExposure: 0,
      commercialAdjustment: 0, displayMetadata: { commercialEvidence: evidence([vo(100)]) } };
    const result = buildStoryboardExplanation({ row: current, movement: { comparable: true, movement: 100,
      bridge: { committed: 100, systemForecast: 100, changeExposure: 0, commercialAdjustment: 0 },
      previousCommercialEvidence: null } });
    expect(result.text).not.toContain('S0016/VO-0001 increased');
    expect(result.text).toContain('Commitment changed');
  });

  it('does not label an unexplained remainder as explained', () => {
    const current = { committed: 100, uncommittedForecast: 0, finalForecast: 150, changeExposure: 0,
      commercialAdjustment: 0, displayMetadata: { commercialEvidence: evidence([]) } };
    const result = buildStoryboardExplanation({ row: current, movement: { comparable: true, movement: 50,
      unexplained: true, residual: 50, bridge: { committed: 0, systemForecast: 0, changeExposure: 0, commercialAdjustment: 0 },
      previousCommercialEvidence: evidence([]) } });
    expect(result.title).toBe('Forecast movement needs reconciliation');
    expect(result.financialUnreconciled).toBe(true);
    expect(result.text).toContain('System Forecast');
    expect(result.text).toContain('Change Exposure');
    expect(result.text).toContain('Projected Adjustment');
  });

  it('does not name one VO when offsetting PO, CE and VO commitment evidence all changed', () => {
    const prior = evidence([
      { type: 'purchase_order', id: 'S0016', reference: 'S0016', includedAmount: 1000 },
      { type: 'commercial_event', id: 'ce-1', reference: 'CE-0001', includedAmount: 250 },
    ]);
    const currentEvidence = evidence([
      { type: 'purchase_order', id: 'S0016', reference: 'S0016', includedAmount: 1100 },
      { type: 'commercial_event', id: 'ce-1', reference: 'CE-0001', includedAmount: 0 },
      { type: 'variation_order', id: 'vo-1', reference: 'S0016/VO-0001', includedAmount: 400 },
    ]);
    const current = { committed: 1500, uncommittedForecast: 0, systemForecast: 1500,
      finalForecast: 1500, changeExposure: 0, commercialAdjustment: 0,
      displayMetadata: { commercialEvidence: currentEvidence } };
    const result = buildStoryboardExplanation({ row: current, movement: { comparable: true,
      movement: 250, bridge: { committed: 250, systemForecast: 250, changeExposure: 0,
        commercialAdjustment: 0, uncommittedForecast: 0 }, previousCommercialEvidence: prior } });
    expect(result.text).not.toContain('S0016/VO-0001 increased commitment');
    expect(result.text).toContain('Commitment changed by +£250.00');
  });
});
