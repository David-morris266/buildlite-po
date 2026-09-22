import { describe, expect, it } from 'vitest';
import {
  appendManualAdjustmentHistory,
  resolveCommercialAdjustmentOwnership,
} from './cvrCommercialAdjustmentOwnership';

function adoptedRow(source = 'prelims_adoption') {
  const prelims = source === 'prelims_adoption';
  return {
    commercialAdjustment: 57000,
    commercialReason: prelims ? 'Prelims forecast adopted — 2027-02' : 'Selling Costs forecast adopted — 2027-02',
    displayMetadata: {
      [prelims ? 'prelimsAdoption' : 'sellingCostsAdoption']: {
        adoptedAdjustment: 57000,
        adoptedAt: '2026-09-19T13:32:00.000Z',
        adoptedBy: 'David Morris',
        reportingMonth: '2027-02',
        superseded: false,
      },
    },
    adjustmentHistory: [{
      source,
      newAdjustment: 57000,
      newReason: prelims ? 'Prelims forecast adopted — 2027-02' : 'Selling Costs forecast adopted — 2027-02',
      date: '2026-09-19T13:32:00.000Z',
      user: 'David Morris',
    }],
  };
}

describe('commercial adjustment ownership', () => {
  it('recognises the current Site Prelims adoption and separates reporting context', () => {
    expect(resolveCommercialAdjustmentOwnership(adoptedRow())).toMatchObject({
      kind: 'workflow', sourceLabel: 'Site Prelims', reasonLabel: 'Site Prelims forecast adopted',
      changedBy: 'David Morris', reportingPeriodLabel: 'February 2027', tabId: 'prelims',
    });
  });

  it('recognises equivalent Selling Costs ownership', () => {
    expect(resolveCommercialAdjustmentOwnership(adoptedRow('selling_costs_adoption'))).toMatchObject({
      kind: 'workflow', sourceLabel: 'Selling Costs', tabId: 'selling-costs',
    });
  });

  it('does not treat a historic adoption as current after manual supersession', () => {
    const row = adoptedRow();
    row.commercialAdjustment = 62000;
    row.commercialReason = 'Revised staffing risk';
    row.adjustmentHistory.push({ source: 'manual_adjustment', newAdjustment: 62000, reason: row.commercialReason });
    expect(resolveCommercialAdjustmentOwnership(row)).toEqual({ kind: 'manual' });
  });

  it('fails back to manual when current values no longer match adoption evidence', () => {
    const row = adoptedRow();
    row.commercialReason = 'Later manual reason';
    expect(resolveCommercialAdjustmentOwnership(row)).toEqual({ kind: 'manual' });
  });

  it('appends manual supersession without rewriting the adoption evidence', () => {
    const row = adoptedRow();
    const history = appendManualAdjustmentHistory(row.adjustmentHistory, {
      id: 'adj-manual-1', date: '2026-09-20T10:00:00.000Z', user: 'QS',
      previousAdjustment: 57000, newAdjustment: 62000,
      previousReason: row.commercialReason, newReason: 'Revised staffing risk',
    });
    expect(history[0]).toBe(row.adjustmentHistory[0]);
    expect(history[1]).toMatchObject({
      source: 'manual_adjustment', previousAdjustment: 57000, newAdjustment: 62000,
      newReason: 'Revised staffing risk',
    });
    expect(resolveCommercialAdjustmentOwnership({
      ...row, commercialAdjustment: 62000, commercialReason: 'Revised staffing risk', adjustmentHistory: history,
    })).toEqual({ kind: 'manual' });
  });
});
