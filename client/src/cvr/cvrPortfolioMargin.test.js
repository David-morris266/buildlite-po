import { describe, expect, it } from 'vitest';
import { buildCvrPortfolioMarginKpis, buildCvrPortfolioModel, selectCvrPortfolioMarginPeriods } from './cvrPeriodHelpers';

function position({ revenue, efc, previousRevenue, previousEfc, frozen = true } = {}) {
  return {
    eligibility: 'eligible',
    current: { revenueAvailable: revenue != null, forecastRevenue: revenue, forecastCost: efc },
    previous: previousRevenue == null ? null : {
      revenueAvailable: true,
      forecastRevenue: previousRevenue,
      forecastCost: previousEfc,
      frozenRevenue: frozen,
    },
  };
}

function period(periodKey, status, overrides = {}) {
  return { periodKey, periodType: 'monthly_cvr', status, ...overrides };
}

function snapshot(revenue, efc, schemaVersion = 2) {
  return { schemaVersion, totals: { forecastRevenue: revenue, finalForecast: efc, grossProfit: revenue - efc } };
}

function buildModelFixture({ developments, periodsByDevelopment, liveByDevelopment = {}, unavailable = new Set(), readiness = {} }) {
  const buildModel = (developmentId, { periodKey }) => {
    const item = (periodsByDevelopment[developmentId] || []).find((candidate) => candidate.periodKey === periodKey);
    const key = `${developmentId}:${periodKey}`;
    const historic = item?.status === 'locked' && Boolean(item.snapshot);
    return {
      unavailable: unavailable.has(key) || (item?.status === 'locked' && !item.snapshot),
      historic,
      historicUnavailable: item?.status === 'locked' && !item.snapshot,
      summary: {
        finalForecast: item?.snapshot?.totals?.finalForecast ?? liveByDevelopment[developmentId]?.efc ?? 100,
        variance: 10,
      },
    };
  };
  const buildCommercialPosition = ({ developmentId, snapshot: frozen, costSummary }) => {
    if (frozen?.schemaVersion >= 2 && frozen?.totals?.forecastRevenue != null) {
      return { revenueAvailable: true, forecastRevenue: frozen.totals.forecastRevenue, forecastCost: costSummary.finalForecast };
    }
    if (frozen) return { revenueAvailable: false, forecastRevenue: null, forecastCost: costSummary.finalForecast };
    const live = liveByDevelopment[developmentId];
    return { revenueAvailable: live?.revenue != null, forecastRevenue: live?.revenue ?? null, forecastCost: costSummary.finalForecast };
  };
  return buildCvrPortfolioModel([], {
    developments,
    serverAuthorityEnabled: true,
    getPeriodReadiness: (developmentId) => ({ ready: readiness[developmentId] !== false }),
    listPeriods: (developmentId) => periodsByDevelopment[developmentId] || [],
    buildModel,
    buildCommercialPosition,
    buildDevelopmentRow: (development) => ({ developmentId: development.id }),
  });
}

function card(model, label) {
  return model.summaryCards.find((item) => item.label === label);
}

describe('CVR portfolio margin KPIs', () => {
  it('selects the latest monthly CVR across mixed states and excludes Site Start', () => {
    const selection = selectCvrPortfolioMarginPeriods([
      { periodKey: 'SITE_START', periodType: 'site_start', status: 'locked' },
      { periodKey: 'P01', periodType: 'monthly_cvr', status: 'locked' },
      { periodKey: 'P02', periodType: 'monthly_cvr', status: 'submitted' },
    ]);
    expect(selection.current.periodKey).toBe('P02');
    expect(selection.previous.periodKey).toBe('P01');
  });

  it('does not substitute Site Start when P01 has no preceding monthly CVR', () => {
    const selection = selectCvrPortfolioMarginPeriods([
      { periodKey: 'SITE_START', periodType: 'site_start', status: 'locked' },
      { periodKey: 'P01', periodType: 'monthly_cvr', status: 'draft' },
    ]);
    expect(selection.current.periodKey).toBe('P01');
    expect(selection.previous).toBeNull();
  });

  it('defensively excludes a Site Start record whose period type is missing', () => {
    const selection = selectCvrPortfolioMarginPeriods([
      { periodKey: 'SITE_START', status: 'locked' },
      { periodKey: 'P01', status: 'draft' },
    ]);
    expect(selection.current.periodKey).toBe('P01');
    expect(selection.previous).toBeNull();
  });

  it('uses aggregate revenue and EFC rather than averaging development margins', () => {
    const result = buildCvrPortfolioMarginKpis([
      position({ revenue: 1000, efc: 900, previousRevenue: 1000, previousEfc: 950 }),
      position({ revenue: 3000, efc: 2100, previousRevenue: 3000, previousEfc: 2250 }),
    ]);

    expect(result.margin).toBe(25);
    expect(result.movement).toBe(5);
  });

  it.each([
    { currentEfc: 2800, expected: 5 },
    { currentEfc: 3400, expected: -10 },
    { currentEfc: 3000, expected: 0 },
  ])('reports percentage-point movement for positive, adverse and neutral cases', ({ currentEfc, expected }) => {
    const result = buildCvrPortfolioMarginKpis([
      position({ revenue: 4000, efc: currentEfc, previousRevenue: 4000, previousEfc: 3000 }),
    ]);
    expect(result.movement).toBe(expected);
  });

  it('fails closed when any current development lacks revenue evidence', () => {
    const result = buildCvrPortfolioMarginKpis([
      position({ revenue: 1000, efc: 800, previousRevenue: 1000, previousEfc: 850 }),
      position({ revenue: null, efc: 500, previousRevenue: 700, previousEfc: 600 }),
    ]);
    expect(result.margin).toBeNull();
    expect(result.movement).toBeNull();
    expect(result.marginHint).toMatch(/one or more included monthly CVRs/i);
  });

  it('distinguishes zero aggregate revenue from a zero margin', () => {
    const unavailable = buildCvrPortfolioMarginKpis([
      position({ revenue: 0, efc: 0, previousRevenue: 100, previousEfc: 100 }),
    ]);
    const zeroMargin = buildCvrPortfolioMarginKpis([
      position({ revenue: 1000, efc: 1000, previousRevenue: 1000, previousEfc: 1000 }),
    ]);
    expect(unavailable.margin).toBeNull();
    expect(unavailable.marginHint).toMatch(/aggregate Forecast Revenue is zero/i);
    expect(zeroMargin.margin).toBe(0);
    expect(zeroMargin.movement).toBe(0);
  });

  it('requires frozen preceding evidence for every current portfolio member', () => {
    const missingPrevious = buildCvrPortfolioMarginKpis([
      position({ revenue: 1000, efc: 800 }),
    ]);
    const legacyPrevious = buildCvrPortfolioMarginKpis([
      position({ revenue: 1000, efc: 800, previousRevenue: 900, previousEfc: 750, frozen: false }),
    ]);
    expect(missingPrevious.margin).toBe(20);
    expect(missingPrevious.movement).toBeNull();
    expect(legacyPrevious.movement).toBeNull();
  });

  it('discloses included coverage while excluding developments with no monthly CVR', () => {
    const result = buildCvrPortfolioMarginKpis([
      position({ revenue: 1000, efc: 800, previousRevenue: 1000, previousEfc: 850 }),
      { eligibility: 'no-monthly-cvr' },
    ]);
    expect(result.margin).toBe(20);
    expect(result.coverage).toEqual({
      totalDevelopments: 2,
      includedDevelopments: 1,
      excludedNoMonthly: 1,
      unresolvedDevelopments: 0,
    });
    expect(result.marginHint).toContain('1 of 2 developments included');
  });

  it('fails closed rather than omitting a development whose period eligibility is unresolved', () => {
    const result = buildCvrPortfolioMarginKpis([
      position({ revenue: 1000, efc: 800, previousRevenue: 1000, previousEfc: 850 }),
      { eligibility: 'unresolved' },
    ]);
    expect(result.margin).toBeNull();
    expect(result.movement).toBeNull();
    expect(result.coverage.unresolvedDevelopments).toBe(1);
    expect(result.marginHint).toMatch(/eligibility could not be established/i);
  });

  it('calculates movement from unrounded aggregate margins and prevents negative zero in presentation', () => {
    const result = buildCvrPortfolioMarginKpis([
      position({ revenue: 300, efc: 200, previousRevenue: 300, previousEfc: 201 }),
      position({ revenue: 700, efc: 505, previousRevenue: 700, previousEfc: 504.6 }),
    ]);
    expect(result.margin).toBeCloseTo(29.5, 10);
    expect(result.movement).toBeCloseTo(0.06, 10);
  });
});

describe('buildCvrPortfolioModel margin authority', () => {
  const developments = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('fails closed when a listed development period set is not ready', () => {
    const model = buildModelFixture({
      developments: developments.slice(0, 2),
      periodsByDevelopment: { a: [period('P02', 'draft')] },
      liveByDevelopment: { a: { revenue: 1000, efc: 800 } },
      readiness: { b: false },
    });
    expect(card(model, 'Forecast GP Margin').value).toBe('—');
    expect(card(model, 'Forecast GP Margin').hint).toContain('eligibility could not be established for 1 development');
    expect(card(model, 'Forecast GP Margin').hint).toContain('1 of 2 developments included');
  });

  it('excludes no-monthly and Site-Start-only developments with explicit coverage', () => {
    const model = buildModelFixture({
      developments,
      periodsByDevelopment: {
        a: [period('P02', 'submitted')],
        b: [],
        c: [{ periodKey: 'SITE_START', periodType: 'site_start', status: 'locked', snapshot: snapshot(900, 700) }],
      },
      liveByDevelopment: { a: { revenue: 1000, efc: 800 } },
    });
    expect(card(model, 'Forecast GP Margin').value).toBe('20.0%');
    expect(card(model, 'Forecast GP Margin').hint).toContain('1 of 3 developments included; 2 without a monthly CVR excluded');
  });

  it('includes mixed Draft, Submitted and locked-v2 current positions across different reporting months', () => {
    const model = buildModelFixture({
      developments,
      periodsByDevelopment: {
        a: [period('P01', 'locked', { reportingMonth: '2026-06', snapshot: snapshot(1000, 850) }), period('P02', 'draft', { reportingMonth: '2026-09' })],
        b: [period('P03', 'locked', { reportingMonth: '2026-07', snapshot: snapshot(2000, 1700) }), period('P04', 'submitted', { reportingMonth: '2026-10' })],
        c: [period('P05', 'locked', { reportingMonth: '2026-08', snapshot: snapshot(3000, 2400) })],
      },
      liveByDevelopment: { a: { revenue: 1000, efc: 800 }, b: { revenue: 2000, efc: 1600 } },
    });
    expect(card(model, 'Forecast GP Margin').value).toBe('20.0%');
    expect(card(model, 'Forecast GP Margin').hint).toContain('reporting months may differ');
    expect(card(model, 'Margin Movement (pp)').value).toBe('—');
  });

  it.each([
    ['latest model unavailable', new Set(['a:P02']), [period('P02', 'draft')]],
    ['locked current snapshot missing', new Set(), [period('P02', 'locked')]],
    ['legacy v1 current snapshot', new Set(), [period('P02', 'locked', { snapshot: snapshot(1000, 800, 1) })]],
  ])('fails current margin closed when %s', (_label, unavailable, periods) => {
    const model = buildModelFixture({
      developments: developments.slice(0, 1), periodsByDevelopment: { a: periods },
      liveByDevelopment: { a: { revenue: 1000, efc: 800 } }, unavailable,
    });
    expect(card(model, 'Forecast GP Margin').value).toBe('—');
    expect(card(model, 'Margin Movement (pp)').value).toBe('—');
  });

  it.each([
    ['no preceding monthly CVR', [period('P01', 'draft')]],
    ['preceding snapshot missing', [period('P01', 'locked'), period('P02', 'draft')]],
    ['preceding legacy v1 revenue', [period('P01', 'locked', { snapshot: snapshot(1000, 850, 1) }), period('P02', 'draft')]],
    ['preceding zero revenue', [period('P01', 'locked', { snapshot: snapshot(0, 0) }), period('P02', 'draft')]],
  ])('keeps current margin but makes movement unavailable for %s', (_label, periods) => {
    const model = buildModelFixture({
      developments: developments.slice(0, 1), periodsByDevelopment: { a: periods },
      liveByDevelopment: { a: { revenue: 1000, efc: 800 } },
    });
    expect(card(model, 'Forecast GP Margin').value).toBe('20.0%');
    expect(card(model, 'Margin Movement (pp)').value).toBe('—');
  });

  it('preserves the established six KPI definitions while adding signed movement presentation', () => {
    const model = buildModelFixture({
      developments: developments.slice(0, 1),
      periodsByDevelopment: { a: [period('P01', 'locked', { snapshot: snapshot(1000, 850) }), period('P02', 'draft')] },
      liveByDevelopment: { a: { revenue: 1000, efc: 800 } },
    });
    expect(model.summaryCards.slice(0, 6).map((item) => item.label)).toEqual([
      'Developments', 'Draft CVRs', 'Submitted CVRs', 'Locked This Month', 'Portfolio EFC', 'Portfolio Variance',
    ]);
    expect(model.summaryCards.slice(0, 6).map((item) => item.value)).toEqual(['1', '1', '0', '0', '£800.00', '£10.00']);
    expect(card(model, 'Margin Movement (pp)').value).toBe('+5.0 pp');
    expect(card(model, 'Margin Movement (pp)').modifier).toBe('saving');
  });

  it.each([
    [800, '+5.0 pp', 'saving'],
    [900, '-5.0 pp', 'overspend'],
    [850, '0.0 pp', 'default'],
  ])('presents current EFC %s with the expected movement tone', (currentEfc, value, modifier) => {
    const model = buildModelFixture({
      developments: developments.slice(0, 1),
      periodsByDevelopment: { a: [period('P01', 'locked', { snapshot: snapshot(1000, 850) }), period('P02', 'draft')] },
      liveByDevelopment: { a: { revenue: 1000, efc: currentEfc } },
    });
    expect(card(model, 'Margin Movement (pp)').value).toBe(value);
    expect(card(model, 'Margin Movement (pp)').modifier).toBe(modifier);
  });

  it('does not report a partial margin when one of two eligible current models is unavailable', () => {
    const model = buildModelFixture({
      developments: developments.slice(0, 2),
      periodsByDevelopment: { a: [period('P02', 'draft')], b: [period('P03', 'submitted')] },
      liveByDevelopment: { a: { revenue: 1000, efc: 800 }, b: { revenue: 2000, efc: 1600 } },
      unavailable: new Set(['b:P03']),
    });
    expect(card(model, 'Forecast GP Margin').value).toBe('—');
    expect(card(model, 'Forecast GP Margin').hint).toContain('2 of 2 developments included');
  });

  it('fails current margin closed for zero aggregate revenue', () => {
    const model = buildModelFixture({
      developments: developments.slice(0, 1),
      periodsByDevelopment: { a: [period('P02', 'draft')] },
      liveByDevelopment: { a: { revenue: 0, efc: 0 } },
    });
    expect(card(model, 'Forecast GP Margin').value).toBe('—');
    expect(card(model, 'Forecast GP Margin').hint).toContain('aggregate Forecast Revenue is zero');
  });

  it('rounds the final unrounded percentage-point difference without displaying negative zero', () => {
    const model = buildModelFixture({
      developments: developments.slice(0, 1),
      periodsByDevelopment: { a: [period('P01', 'locked', { snapshot: snapshot(1000, 800) }), period('P02', 'draft')] },
      liveByDevelopment: { a: { revenue: 1000, efc: 800.4 } },
    });
    expect(card(model, 'Margin Movement (pp)').value).toBe('0.0 pp');
    expect(card(model, 'Margin Movement (pp)').modifier).toBe('default');
  });
});
