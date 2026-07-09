import { describe, expect, it } from 'vitest';
import {
  calculateSystemForecast,
  calculateFinalForecast,
  enrichCvrForecastRow,
  validateCommercialAdjustment,
} from './cvrForecastEngine.js';
import { calculateCostToComplete, calculateVariance } from './cvrCalculations.js';

describe('calculateSystemForecast — Doc 40 hierarchy', () => {
  it('Rule 1: uses approved commitments when they exist', () => {
    expect(
      calculateSystemForecast({
        committed: 240000,
        actualCost: 100000,
        currentBudget: 250000,
      })
    ).toBe(240000);
  });

  it('Rule 2: uses current budget before actual cost when no commitment', () => {
    expect(
      calculateSystemForecast({
        committed: 0,
        actualCost: 40000,
        currentBudget: 200000,
      })
    ).toBe(200000);
  });

  it('Rule 3: uses actual cost when no commitment or budget', () => {
    expect(
      calculateSystemForecast({
        committed: null,
        actualCost: 10000,
        currentBudget: null,
      })
    ).toBe(10000);
  });

  it('Rule 4: returns zero when no commercial evidence exists', () => {
    expect(
      calculateSystemForecast({
        committed: null,
        actualCost: null,
        currentBudget: null,
      })
    ).toBe(0);
  });
});

describe('BL-012D Doc 40 scenarios', () => {
  it('Scenario A: budget with actuals, no commitment', () => {
    const systemForecast = calculateSystemForecast({
      committed: null,
      actualCost: 15000,
      currentBudget: 35000,
    });
    const finalForecast = calculateFinalForecast(systemForecast, 0);

    expect(systemForecast).toBe(35000);
    expect(finalForecast).toBe(35000);
    expect(calculateCostToComplete(finalForecast, 15000)).toBe(20000);
    expect(calculateVariance(35000, finalForecast)).toBe(0);
  });

  it('Scenario B: budget, commitment and actuals', () => {
    const systemForecast = calculateSystemForecast({
      committed: 32000,
      actualCost: 15000,
      currentBudget: 35000,
    });
    const finalForecast = calculateFinalForecast(systemForecast, 0);

    expect(systemForecast).toBe(32000);
    expect(finalForecast).toBe(32000);
    expect(calculateCostToComplete(finalForecast, 15000)).toBe(17000);
    expect(calculateVariance(35000, finalForecast)).toBe(3000);
  });

  it('Scenario C: actual cost only, no budget', () => {
    const systemForecast = calculateSystemForecast({
      committed: null,
      actualCost: 10000,
      currentBudget: null,
    });

    expect(systemForecast).toBe(10000);
  });

  it('Scenario D: commitment only, no budget or actual', () => {
    const systemForecast = calculateSystemForecast({
      committed: 25000,
      actualCost: null,
      currentBudget: null,
    });

    expect(systemForecast).toBe(25000);
  });

  it('Scenario E: commercial adjustment with zero system forecast', () => {
    const systemForecast = calculateSystemForecast({
      committed: null,
      actualCost: null,
      currentBudget: null,
    });
    const finalForecast = calculateFinalForecast(systemForecast, 8000);

    expect(systemForecast).toBe(0);
    expect(finalForecast).toBe(8000);
  });
});

describe('calculateFinalForecast', () => {
  it('adds commercial adjustment to system forecast', () => {
    expect(calculateFinalForecast(240000, 15000)).toBe(255000);
  });

  it('returns adjustment alone when system forecast is null (legacy)', () => {
    expect(calculateFinalForecast(null, 8000)).toBe(8000);
    expect(calculateFinalForecast(null, 0)).toBe(null);
  });
});

describe('validateCommercialAdjustment', () => {
  it('requires reason when adjustment is non-zero', () => {
    const result = validateCommercialAdjustment(18000, '');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('accepts zero adjustment without reason', () => {
    const result = validateCommercialAdjustment(0, '');
    expect(result.valid).toBe(true);
  });
});

describe('enrichCvrForecastRow', () => {
  it('prefers budget over actuals for system forecast when uncommitted', () => {
    const row = enrichCvrForecastRow({
      currentBudget: 35000,
      committed: null,
      actualCost: 15000,
      commercialAdjustment: 0,
      commercialReason: '',
    });

    expect(row.systemForecast).toBe(35000);
    expect(row.finalForecast).toBe(35000);
    expect(row.costToComplete).toBe(20000);
    expect(row.variance).toBe(0);
  });

  it('preserves manual adjustment while system forecast updates', () => {
    const row = enrichCvrForecastRow({
      currentBudget: 250000,
      committed: 240000,
      actualCost: 100000,
      commercialAdjustment: 15000,
      commercialReason: 'Expected Brickwork Variation',
    });

    expect(row.systemForecast).toBe(240000);
    expect(row.finalForecast).toBe(255000);
    expect(row.commercialAdjustment).toBe(15000);
    expect(row.costToComplete).toBe(155000);
    expect(row.variance).toBe(-5000);
    expect(row.adjustmentState).toBe('positive');
  });
});
