import { describe, expect, it } from 'vitest';
import {
  calculateCostToComplete,
  calculateVariance,
  enrichCvrRow,
} from './cvrCalculations.js';

describe('CVR derived calculations', () => {
  it('calculates cost to complete from final forecast and actuals', () => {
    expect(calculateCostToComplete(255000, 100000)).toBe(155000);
  });

  it('calculates variance from current budget and final forecast', () => {
    expect(calculateVariance(250000, 255000)).toBe(-5000);
  });

  it('treats missing budget as zero for variance', () => {
    expect(calculateVariance(null, 50000)).toBe(-50000);
  });
});

describe('enrichCvrRow facade', () => {
  it('delegates to forecast engine', () => {
    const row = enrichCvrRow({
      currentBudget: 200000,
      committed: null,
      actualCost: 40000,
      commercialAdjustment: 0,
      commercialReason: '',
    });

    expect(row.systemForecast).toBe(200000);
    expect(row.finalForecast).toBe(200000);
    expect(row.costToComplete).toBe(160000);
  });
});
