import { describe, expect, it } from 'vitest';
import { buildCvrPeriodComparison, formatSignedMovement } from './cvrPeriodMovement';

const hierarchy = (costCodes, state = 'locked') => ({
  status: state === 'locked' ? 'locked' : 'draft',
  ...(state === 'locked'
    ? { snapshot: { commercialHierarchy: { state: 'locked', captured: true, document: { costCodes } } } }
    : { commercialHierarchy: { state: 'live', captured: false, document: { costCodes } } }),
});
const evidence = (key, head = 'Build', group = 'Brickwork', resolutionState = 'allocated') => ({
  costCodeKey: key, resolutionState,
  head: resolutionState === 'allocated' ? { id: `h-${head}`, name: head } : null,
  family: null,
  reportingGroup: resolutionState === 'allocated' ? { id: `g-${group}`, name: group } : null,
});
const row = (key, finalForecast, values = {}) => ({
  id: key, costCodeKey: key, costCodeLabel: key.toUpperCase(), description: `${key} work`,
  currentBudget: values.currentBudget ?? 100, finalForecast,
  systemForecast: values.systemForecast ?? finalForecast,
  expectedLiability: values.expectedLiability ?? 0,
  expectedLiabilityCaptured: values.expectedLiabilityCaptured ?? true,
  vaExposureUplift: values.vaExposureUplift ?? 0,
  commercialAdjustment: values.commercialAdjustment ?? 0,
  adjustmentReason: values.adjustmentReason || '', variance: (values.currentBudget ?? 100) - finalForecast,
});
const model = (rows, extra = {}) => ({
  ready: true, unavailable: false, historic: extra.historic ?? false,
  historicUnavailable: false, snapshot: extra.snapshot || null, rows,
  summary: { finalForecast: rows.reduce((sum, item) => sum + item.finalForecast, 0) },
});

describe('CVR period movement comparison', () => {
  it('uses exact-pence current-minus-previous and reconciles the four authoritative components', () => {
    const previous = row('4120', 100.01, { systemForecast: 90.01, expectedLiability: 5, vaExposureUplift: 2, commercialAdjustment: 3 });
    const current = row('4120', 110.04, { systemForecast: 95.02, expectedLiability: 7.01, vaExposureUplift: 3, commercialAdjustment: 5.01, adjustmentReason: 'Revised QS risk' });
    const report = buildCvrPeriodComparison({ currentModel: model([current]), previousModel: model([previous], { historic: true, snapshot: {} }), currentPeriod: hierarchy([evidence('4120')], 'live'), previousPeriod: hierarchy([evidence('4120')]) });
    expect(report.rows[0].movement).toBe(10.03);
    expect(report.rows[0].components.map((item) => item.movement)).toEqual([5.01, 2.01, 1, 2.01]);
    expect(report.rows[0].residual).toBe(0);
    expect(report.rows[0].adjustmentReason).toBe('Revised QS risk');
    expect(report.reconciles).toBe(true);
  });

  it('ranks adverse and favourable movement independently from variance to Budget', () => {
    const prior = [row('a', 100), row('b', 100), row('c', 100)];
    const current = [row('a', 125, { currentBudget: 1000 }), row('b', 80, { currentBudget: 10 }), row('c', 100)];
    const docs = current.map((item) => evidence(item.costCodeKey));
    const report = buildCvrPeriodComparison({ currentModel: model(current), previousModel: model(prior, { historic: true, snapshot: {} }), currentPeriod: hierarchy(docs, 'live'), previousPeriod: hierarchy(docs) });
    expect(report.sections.adverse.map((item) => item.costCodeKey)).toEqual(['a']);
    expect(report.sections.favourable.map((item) => item.costCodeKey)).toEqual(['b']);
    expect(report.rows.find((item) => item.costCodeKey === 'c').movementLabel).toBe('£0.00');
  });

  it('treats first-CVR and incomplete historic evidence as unavailable, never zero', () => {
    const report = buildCvrPeriodComparison({ currentModel: model([row('a', 10)]), previousModel: null, currentPeriod: hierarchy([evidence('a')], 'live'), previousPeriod: null });
    expect(report.available).toBe(false);
    expect(report.rows[0].previousForecast).toBeNull();
    expect(report.rows[0].movement).toBeNull();
  });

  it('uses zero only when a complete prior snapshot proves a new identity was absent', () => {
    const report = buildCvrPeriodComparison({ currentModel: model([row('new', 25)]), previousModel: model([], { historic: true, snapshot: { id: 'snap' } }), currentPeriod: hierarchy([evidence('new')], 'live'), previousPeriod: hierarchy([]) });
    expect(report.rows[0]).toMatchObject({ newCode: true, previousForecast: 0, movement: 25, unexplained: true });
  });

  it('retains previous-only archived identities rather than silently dropping them', () => {
    const report = buildCvrPeriodComparison({ currentModel: model([]), previousModel: model([row('old', 25)], { historic: true, snapshot: { id: 'snap' } }), currentPeriod: hierarchy([], 'live'), previousPeriod: hierarchy([evidence('old', '', '', 'archived_assignment')]) });
    expect(report.rows[0]).toMatchObject({ previousOnly: true, currentForecast: 0, movement: -25 });
  });

  it('keeps Budget movement outside the Final Forecast bridge', () => {
    const report = buildCvrPeriodComparison({ currentModel: model([row('a', 100, { currentBudget: 150 })]), previousModel: model([row('a', 100, { currentBudget: 100 })], { historic: true, snapshot: {} }), currentPeriod: hierarchy([evidence('a')], 'live'), previousPeriod: hierarchy([evidence('a')]) });
    expect(report.rows[0].movement).toBe(0);
    expect(report.rows[0].variance).toBe(50);
    expect(report.rows[0].components).toHaveLength(4);
  });

  it('flags hierarchy changes and preserves legacy and exceptional states without synthetic hierarchy', () => {
    const currentPeriod = hierarchy([evidence('a', 'House Build', 'Brickwork'), evidence('b', '', '', 'not_applicable')], 'live');
    const previousPeriod = { status: 'locked', snapshot: { commercialHierarchy: { state: 'legacy_not_captured', captured: false } } };
    const report = buildCvrPeriodComparison({ currentModel: model([row('a', 10), row('b', 0)]), previousModel: model([row('a', 5), row('b', 0)], { historic: true, snapshot: {} }), currentPeriod, previousPeriod });
    expect(report.rows.find((item) => item.costCodeKey === 'a').hierarchyChanged).toBe(true);
    expect(report.rows.find((item) => item.costCodeKey === 'a').previousHierarchy.state).toBe('legacy_not_captured');
    expect(report.rows.find((item) => item.costCodeKey === 'b').currentHierarchy.label).toBe('Not applicable');
    expect(JSON.stringify(report)).not.toMatch(/Other|General/);
  });

  it('surfaces unavailable modern components as unexplained rather than manufacturing zero', () => {
    const current = row('a', 110, { systemForecast: 100, expectedLiability: 10 });
    const previous = row('a', 100, { systemForecast: 100, expectedLiability: null, expectedLiabilityCaptured: false });
    const report = buildCvrPeriodComparison({ currentModel: model([current]), previousModel: model([previous], { historic: true, snapshot: {} }), currentPeriod: hierarchy([evidence('a')], 'live'), previousPeriod: hierarchy([evidence('a')]) });
    expect(report.rows[0].components.find((item) => item.key === 'expectedLiability').available).toBe(false);
    expect(report.rows[0]).toMatchObject({ explained: null, residual: null, unexplained: true });
  });

  it('does not call certificate or ledger activity a forecast cause when Final Forecast does not move', () => {
    const previous = { ...row('a', 100), certified: 10, actualCost: 10 };
    const current = { ...row('a', 100), certified: 50, actualCost: 40 };
    const report = buildCvrPeriodComparison({ currentModel: model([current]), previousModel: model([previous], { historic: true, snapshot: {} }), currentPeriod: hierarchy([evidence('a')], 'live'), previousPeriod: hierarchy([evidence('a')]) });
    expect(report.rows[0].movement).toBe(0);
    expect(report.sections.adverse).toEqual([]);
    expect(report.sections.favourable).toEqual([]);
  });

  it('reconciles mixed adverse and favourable rows through signed management states', () => {
    const prior = [row('a', 100), row('b', 100)];
    const current = [
      row('a', 125, { systemForecast: 120, commercialAdjustment: 5, adjustmentReason: 'Known adjustment' }),
      row('b', 90, { systemForecast: 90 }),
    ];
    const docs = current.map((item) => evidence(item.costCodeKey));
    const previousPeriod = { ...hierarchy(docs), id: 'previous', snapshot: { id: 'snapshot', commercialHierarchy: hierarchy(docs).snapshot.commercialHierarchy } };
    const explanation = {
      costCodeKey: 'b', component: 'systemForecast', unexplainedAmount: -10,
      fingerprint: 'previous|snapshot|b|systemForecast|-1000', reason: 'QS explained saving',
    };
    const currentPeriod = { ...hierarchy(docs, 'live'), commercialCommentary: { movementExplanations: [explanation] } };
    const report = buildCvrPeriodComparison({
      currentModel: model(current), previousModel: model(prior, { historic: true, snapshot: {} }),
      currentPeriod, previousPeriod,
    });
    expect(report).toMatchObject({
      totalMovement: 15,
      automaticallyAttributed: 5,
      qsExplained: -10,
      awaitingExplanation: 20,
      explanationReconciles: true,
    });
    expect(report.automaticallyAttributed + report.qsExplained + report.awaitingExplanation).toBe(report.totalMovement);
  });

  it('formats signed movement without floating-point drift', () => {
    expect(formatSignedMovement(0.1 + 0.2)).toBe('+£0.30');
    expect(formatSignedMovement(-2)).toBe('−£2.00');
  });
});
