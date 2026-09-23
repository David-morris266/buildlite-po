import { describe, expect, it } from 'vitest';
import { enrichCvrForecastRow } from './cvrForecastEngine';
import { buildCvrTotals } from './cvrCalculations';

const row = (overrides = {}) => enrichCvrForecastRow({
  currentBudget: 100, committed: 0, certified: 0, actualCost: 0, manualAccrual: 0,
  expectedLiability: 0, vaExposureUplift: 0, commercialAdjustment: 0, ...overrides,
});
const fields = ({ recognisedObligation, uncommittedForecast, systemForecast, finalForecast, costToComplete }) =>
  ({ recognisedObligation, uncommittedForecast, systemForecast, finalForecast, costToComplete });

describe('GP9-001A CVR baseline retention parity', () => {
  it('proves scenarios A-F, I and J', () => {
    expect([
      row(), row({ committed: 80 }), row({ committed: 100 }), row({ committed: 110 }),
      row({ committed: 80, expectedLiability: 15 }),
      row({ committed: 110, expectedLiability: 15 }),
      row({ committed: 80, actualCost: 110 }),
      row({ currentBudget: 120, committed: 80 }),
    ].map(fields)).toEqual([
      { recognisedObligation: 0, uncommittedForecast: 100, systemForecast: 100, finalForecast: 100, costToComplete: 100 },
      { recognisedObligation: 80, uncommittedForecast: 20, systemForecast: 100, finalForecast: 100, costToComplete: 100 },
      { recognisedObligation: 100, uncommittedForecast: 0, systemForecast: 100, finalForecast: 100, costToComplete: 100 },
      { recognisedObligation: 110, uncommittedForecast: 0, systemForecast: 110, finalForecast: 110, costToComplete: 110 },
      { recognisedObligation: 80, uncommittedForecast: 20, systemForecast: 100, finalForecast: 115, costToComplete: 115 },
      { recognisedObligation: 110, uncommittedForecast: 0, systemForecast: 110, finalForecast: 125, costToComplete: 125 },
      { recognisedObligation: 110, uncommittedForecast: 0, systemForecast: 110, finalForecast: 110, costToComplete: 0 },
      { recognisedObligation: 80, uncommittedForecast: 40, systemForecast: 120, finalForecast: 120, costToComplete: 120 },
    ]);
  });

  it('uses certified/current cost floors and preserves signed exposure credits', () => {
    expect(fields(row({ committed: 80, certified: 105 }))).toMatchObject({ recognisedObligation: 105, uncommittedForecast: 0, systemForecast: 105, finalForecast: 105 });
    expect(fields(row({ committed: 80, certified: 90, actualCost: 108, manualAccrual: 2 }))).toMatchObject({ recognisedObligation: 110, systemForecast: 110, finalForecast: 110, costToComplete: 0 });
    expect(row({ committed: 110, vaExposureUplift: -10 }).finalForecast).toBe(100);
    expect(row({ committed: 110, vaExposureUplift: -10, commercialAdjustment: -20 }).finalForecast).toBe(100);
  });

  it('floors favourable adjustment at obligation and sums uncommitted per Cost Code', () => {
    expect(row({ committed: 110, commercialAdjustment: -20 }).finalForecast).toBe(110);
    expect(row({ committed: 80, commercialAdjustment: -20 }).finalForecast).toBe(80);
    const totals = buildCvrTotals([row({ committed: 110 }), row({ committed: 80 })]);
    expect(totals).toMatchObject({ recognisedObligation: 190, uncommittedForecast: 20, systemForecast: 210 });
  });
});
