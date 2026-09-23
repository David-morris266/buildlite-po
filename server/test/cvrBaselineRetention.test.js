const test = require('node:test');
const assert = require('node:assert/strict');
const {
  enrichCvrForecastRow,
  buildCvrTotals,
} = require('../services/cvrCloseFormulas');

const row = (overrides = {}) => enrichCvrForecastRow({
  currentBudget: 100,
  committed: 0,
  certified: 0,
  actualCost: 0,
  manualAccrual: 0,
  expectedLiability: 0,
  vaExposureUplift: 0,
  commercialAdjustment: 0,
  ...overrides,
});

test('GP9-001A retains baseline and derives obligation/uncommitted scenarios A-F, I and J', () => {
  assert.deepEqual(
    [
      row(),
      row({ committed: 80 }),
      row({ committed: 100 }),
      row({ committed: 110 }),
      row({ committed: 80, expectedLiability: 15 }),
      row({ committed: 110, expectedLiability: 15 }),
      row({ committed: 80, actualCost: 110 }),
      row({ currentBudget: 120, committed: 80 }),
    ].map(({ recognisedObligation, uncommittedForecast, systemForecast, finalForecast, costToComplete }) =>
      ({ recognisedObligation, uncommittedForecast, systemForecast, finalForecast, costToComplete })),
    [
      { recognisedObligation: 0, uncommittedForecast: 100, systemForecast: 100, finalForecast: 100, costToComplete: 100 },
      { recognisedObligation: 80, uncommittedForecast: 20, systemForecast: 100, finalForecast: 100, costToComplete: 100 },
      { recognisedObligation: 100, uncommittedForecast: 0, systemForecast: 100, finalForecast: 100, costToComplete: 100 },
      { recognisedObligation: 110, uncommittedForecast: 0, systemForecast: 110, finalForecast: 110, costToComplete: 110 },
      { recognisedObligation: 80, uncommittedForecast: 20, systemForecast: 100, finalForecast: 115, costToComplete: 115 },
      { recognisedObligation: 110, uncommittedForecast: 0, systemForecast: 110, finalForecast: 125, costToComplete: 125 },
      { recognisedObligation: 110, uncommittedForecast: 0, systemForecast: 110, finalForecast: 110, costToComplete: 0 },
      { recognisedObligation: 80, uncommittedForecast: 40, systemForecast: 120, finalForecast: 120, costToComplete: 120 },
    ]
  );
});

test('certified and current cost independently establish the unavoidable floor', () => {
  const certified = row({ committed: 80, certified: 105 });
  assert.deepEqual(
    pick(certified),
    { recognisedObligation: 105, uncommittedForecast: 0, systemForecast: 105, finalForecast: 105, costToComplete: 105 }
  );
  const incurred = row({ committed: 80, certified: 90, actualCost: 108, manualAccrual: 2 });
  assert.deepEqual(
    pick(incurred),
    { recognisedObligation: 110, uncommittedForecast: 0, systemForecast: 110, finalForecast: 110, costToComplete: 0 }
  );
});

const pick = ({ recognisedObligation, uncommittedForecast, systemForecast, finalForecast, costToComplete }) =>
  ({ recognisedObligation, uncommittedForecast, systemForecast, finalForecast, costToComplete });

test('favourable adjustment cannot undercut obligation but can release residual baseline', () => {
  assert.equal(row({ committed: 110, commercialAdjustment: -20 }).finalForecast, 110);
  assert.equal(row({ committed: 80, commercialAdjustment: -20 }).finalForecast, 80);
});

test('signed VA credit remains effective while favourable adjustment is floored separately', () => {
  assert.equal(row({ committed: 110, vaExposureUplift: -10 }).finalForecast, 100);
  assert.equal(row({ committed: 110, vaExposureUplift: -10, commercialAdjustment: -20 }).finalForecast, 100);
});

test('totals sum Cost Code-level uncommitted values without cross-code netting', () => {
  const totals = buildCvrTotals([
    row({ currentBudget: 100, committed: 110 }),
    row({ currentBudget: 100, committed: 80 }),
  ]);
  assert.equal(totals.uncommittedForecast, 20);
  assert.equal(totals.recognisedObligation, 190);
  assert.equal(totals.systemForecast, 210);
});
