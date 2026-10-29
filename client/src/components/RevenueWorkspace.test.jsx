/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getRevenuePricingContext = vi.hoisted(() => vi.fn());
const applySalesRegisterImport = vi.hoisted(() => vi.fn());
const previewSalesRegisterImport = vi.hoisted(() => vi.fn());
const saveRevenueRecord = vi.hoisted(() => vi.fn());

vi.mock('../api/developments', () => ({
  applySalesRegisterImport,
  previewSalesRegisterImport,
}));

vi.mock('../revenue/revenueStrategy', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getRevenuePricingContext,
  };
});

vi.mock('../revenue/revenueStore', () => ({
  saveRevenueRecord,
}));

vi.mock('../admin/revenueCategoryStore', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ensureRevenueCategories: vi.fn() };
});

vi.mock('./RevenueStrategyPanel', () => ({
  default: function MockRevenueStrategyPanel({ onDraftChange }) {
    const [value, setValue] = useState('350');
    useEffect(() => { onDraftChange?.({ openMarket:{ ratePerFt2:'350' }, affordableHousing:{}, garagePremiums:{} }); }, [onDraftChange]);
    return <div>Revenue Strategy Panel<input aria-label="Mock strategy rate" value={value} onChange={(event) => { setValue(event.target.value); onDraftChange?.({ openMarket:{ ratePerFt2:event.target.value }, affordableHousing:{}, garagePremiums:{} }); }} /></div>;
  },
}));
vi.mock('./HouseTypeRevenueTable', () => ({
  default: () => <div>House Type Table</div>,
}));
vi.mock('./PlotRevenueOverrides', () => ({
  default: () => null,
}));
vi.mock('./RevenueDiagnosticsPanel', () => ({
  default: () => null,
}));
vi.mock('./RevenueHouseTypeSummary', () => ({
  default: () => null,
}));
vi.mock('./PlotDrawer', () => ({
  default: ({ open, plot }) => open ? <div role="dialog">Plot drawer {plot?.plotNumber}</div> : null,
}));

import RevenueWorkspace from './RevenueWorkspace';

const sampleContext = {
  plots: [{ id: 'plot-1', plotNumber: '1', houseType: 'Type A', revenueStatus: 'Available' }],
  strategy: {
    openMarket: { ratePerFt2: 350, effectiveDate: '' },
    affordableHousing: {},
    garagePremiums: { none: 0, single: 12500, double: 22500 },
  },
  houseTypePricing: {},
  revenueMode: 'sales_register',
  summaryRevenueLines: [],
  settings: {
    id: 'settings-1',
    exists: true,
    version: 1,
    revenueMode: 'sales_register',
    revenueAuthority: {
      ready: true,
      summary: { forecastRevenue: 350000 },
      establishment: { breakdown: { imported:0, calculated:1, manual:0, unresolved:0 }, outstandingPlotCount:0 },
    },
  },
};

describe('RevenueWorkspace async loading guard', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    saveRevenueRecord.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  function renderRevenue(props = {}) {
    act(() => {
      root.render(
        <RevenueWorkspace developmentId="dev-1" refreshToken={0} {...props} />
      );
    });
  }

  it('shows loading state on initial async fetch', async () => {
    let resolveContext;
    getRevenuePricingContext.mockReturnValue(
      new Promise((resolve) => {
        resolveContext = resolve;
      })
    );

    renderRevenue();

    expect(document.body.textContent).toContain('Loading revenue data');

    await act(async () => {
      resolveContext(sampleContext);
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Current Revenue position');
  });

  it('renders content after a successful load', async () => {
    getRevenuePricingContext.mockResolvedValue(sampleContext);

    renderRevenue();

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Current Revenue position');
    expect(document.body.textContent).toContain('CVR authority: Plot-level Sales Register');
    expect(document.body.textContent).toContain('Pricing Assumptions');
    expect(document.body.textContent).not.toContain('Revenue Strategy Panel');
    expect(document.body.textContent).not.toContain('Revenue Dashboard');
  });

  it('opens the real Sales Register importer from the actual action and supports cancel/reopen without mutation', async () => {
    getRevenuePricingContext.mockResolvedValue(sampleContext);
    renderRevenue();
    await act(async () => { await Promise.resolve(); });

    const open = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Import Sales Register');
    expect(open).toBeTruthy();
    await act(async () => { open.click(); });
    expect(container.querySelector('input[aria-label="Sales Register file"]')).toBeTruthy();
    expect(document.body.textContent).toContain('Review existing customer sales facts');
    expect(applySalesRegisterImport).not.toHaveBeenCalled();

    const cancel = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Cancel');
    await act(async () => { cancel.click(); });
    expect(container.querySelector('input[aria-label="Sales Register file"]')).toBeFalsy();
    const reopen = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Import Sales Register');
    await act(async () => { reopen.click(); });
    expect(container.querySelector('input[aria-label="Sales Register file"]')).toBeTruthy();
    expect(applySalesRegisterImport).not.toHaveBeenCalled();
  });

  it('renders Summary Revenue lines without Sales Register controls or false secondary metrics', async () => {
    getRevenuePricingContext.mockResolvedValue({
      ...sampleContext,
      revenueMode: 'summary',
      summaryRevenueLines: [{ id:'line-1', description:'Private Sales', forecastRevenue:100000 }],
      settings: { ...sampleContext.settings, revenueMode:'summary', summaryRevenueLines:[], version:1 },
    });
    renderRevenue();
    await act(async () => { await Promise.resolve(); });
    expect(document.body.textContent).toContain('Summary Revenue');
    const openSummary = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Open Summary Revenue');
    await act(async () => { openSummary.click(); });
    expect(document.querySelector('input[aria-label="Revenue line 1 description"]')?.value).toBe('Private Sales');
    expect(document.body.textContent).toContain('Total Forecast Revenue');
    expect(document.body.textContent).toContain('not tracked in Summary Revenue');
    expect(document.body.textContent).not.toContain('Revenue Strategy Panel');
    expect(document.body.textContent).not.toContain('Revenue Dashboard');
    expect(document.body.textContent).not.toContain('Import Sales Register');
    expect(container.querySelector('input[aria-label="Sales Register file"]')).toBeFalsy();
  });

  it('switches to the Sales Register view without changing CVR Revenue authority', async () => {
    getRevenuePricingContext.mockResolvedValue({
      ...sampleContext,
      plots: Array.from({ length:48 }, (_, index) => ({ id:`plot-${index + 1}`, plotNumber:String(index + 1), houseType:'Type A', revenueStatus:'Available' })),
      revenueMode: 'summary',
      summaryRevenueLines: [{ id:'line-1', description:'Private Sales', forecastRevenue:100000 }],
      settings: { ...sampleContext.settings, revenueMode:'summary', summaryRevenueLines:[{ id:'line-1', description:'Private Sales', forecastRevenue:100000 }], version:1 },
    });
    renderRevenue();
    await act(async () => { await Promise.resolve(); });

    const openRegister = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Plot Revenue Register');
    await act(async () => { openRegister.click(); });

    expect(document.body.textContent).toContain('Plot Revenue Register');
    expect(document.body.textContent).toContain('CVR authority: Summary Revenue');
    expect(container.querySelectorAll('.revenue-register__data-row')).toHaveLength(48);
    expect(saveRevenueRecord).not.toHaveBeenCalled();
  });

  it('withholds illustrative detailed financial analysis when Summary is authoritative but pricing is unestablished', async () => {
    getRevenuePricingContext.mockResolvedValue({
      ...sampleContext,
      revenueMode:'summary',
      summaryRevenueLines:[{ id:'line-1', description:'Summary', forecastRevenue:100000 }],
      settings:{
        ...sampleContext.settings,
        revenueMode:'summary',
        revenueAuthority:{
          ready:true,
          summary:{forecastRevenue:100000},
          establishment:{strategyEstablished:false,outstandingPlotCount:1,breakdown:{imported:0,calculated:0,manual:0,unresolved:1}},
        },
      },
    });
    renderRevenue();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === 'Revenue Analysis').click(); });

    expect(document.body.textContent).toContain('Pricing assumptions not established');
    expect(document.body.textContent).not.toContain('Revenue Dashboard');
    expect(container.querySelector('.revenue-split__total')).toBeFalsy();
    expect(document.body.textContent).not.toContain('Commercial Actions');
    expect(container.querySelector('[aria-label="Plot status counts"]')).toBeTruthy();

    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === 'Review plots').click(); });
    expect(document.body.textContent).toContain('Plot Revenue Register');
    expect(saveRevenueRecord).not.toHaveBeenCalled();
  });

  it('changes authority only through the explicit confirmed action', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    getRevenuePricingContext.mockResolvedValue({
      ...sampleContext,
      revenueMode: 'summary',
      summaryRevenueLines: [{ id:'line-1', description:'Private Sales', forecastRevenue:100000 }],
      settings: { ...sampleContext.settings, revenueMode:'summary', summaryRevenueLines:[{ id:'line-1', description:'Private Sales', forecastRevenue:100000 }], version:1 },
    });
    renderRevenue();
    await act(async () => { await Promise.resolve(); });
    const plotMode = [...container.querySelectorAll('.revenue-overview__mode')].find((element) => element.textContent.includes('Plot-level Sales Register'));
    const authorityButton = [...plotMode.querySelectorAll('button')].find((button) => button.textContent === 'Use for CVR Revenue');
    expect(authorityButton).toBeTruthy();

    await act(async () => { authorityButton.click(); });
    expect(confirm).toHaveBeenCalledOnce();
    expect(saveRevenueRecord).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await act(async () => { authorityButton.click(); await Promise.resolve(); });
    expect(saveRevenueRecord).toHaveBeenCalledWith('dev-1', expect.objectContaining({ revenueMode:'sales_register' }));
    confirm.mockRestore();
  });

  it('distinguishes imported forecasts from genuine manual overrides without changing authority', async () => {
    getRevenuePricingContext.mockResolvedValue({
      ...sampleContext,
      revenueMode: 'sales_register',
      settings: { ...sampleContext.settings, exists:true, revenueMode:'sales_register', version:1, revenueAuthority:{ ready:true, summary:{forecastRevenue:780000}, establishment:{strategyEstablished:false,outstandingPlotCount:0,breakdown:{imported:1,calculated:0,manual:2,unresolved:0}} } },
      plots: [
        { id:'imported', plotNumber:'1', tenureCode:'OPEN_MARKET', revenueStatus:'Available', revenueSource:'Manual Value', manualOverrideExplicit:true, manualForecastValue:250000, forecastImportProvenance:{ schemaVersion:'sales_register_forecast_v1' } },
        { id:'manual', plotNumber:'2', tenureCode:'OPEN_MARKET', revenueStatus:'Available', revenueSource:'Manual Value', manualOverrideExplicit:true, manualForecastValue:260000 },
        { id:'superseded', plotNumber:'3', tenureCode:'OPEN_MARKET', revenueStatus:'Available', revenueSource:'Manual Value', manualOverrideExplicit:true, manualForecastValue:270000, forecastImportProvenance:{ schemaVersion:'sales_register_forecast_v1', supersededAt:'2026-10-29T10:00:00.000Z' } },
      ],
    });
    renderRevenue();
    await act(async () => { await Promise.resolve(); });

    const measures = container.querySelector('.revenue-overview__kpis');
    expect(measures.textContent).toContain('Imported forecasts1');
    expect(measures.textContent).toContain('QS-edited / manual2');
    expect(document.body.textContent).not.toContain('Independent imported forecasts established for every plot.');
    expect(saveRevenueRecord).not.toHaveBeenCalled();

    const analysis = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Revenue Analysis');
    await act(async () => { analysis.click(); });
    expect(document.body.textContent).toContain('Revenue Dashboard');
    expect(document.body.textContent).toContain('Imported forecasts');
    expect(document.body.textContent).toContain('Manual overrides');
    expect(saveRevenueRecord).not.toHaveBeenCalled();
  });

  it('opens the selected exception plot from Revenue Analysis without stale drawer state', async () => {
    getRevenuePricingContext.mockResolvedValue({
      ...sampleContext,
      revenueMode: 'sales_register',
      settings: { ...sampleContext.settings, exists:true, revenueMode:'sales_register', version:1 },
      plots: [{ id:'plot-1', plotNumber:'1', tenureCode:'OPEN_MARKET', tenureResolved:true, revenueStatus:'Available', forecastSellingPrice:0 }],
    });
    renderRevenue();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === 'Revenue Analysis').click(); });
    const exceptionLink = [...container.querySelectorAll('.revenue-insights__link')].find((button) => button.textContent === 'Plot 1');
    expect(exceptionLink).toBeTruthy();
    await act(async () => { exceptionLink.click(); });
    expect(container.querySelector('[role="dialog"]')?.textContent).toBe('Plot drawer 1');
    expect(document.body.textContent).toContain('Plot Revenue Register');
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Back to Revenue overview')).click(); });
    expect(container.querySelector('[role="dialog"]')).toBeFalsy();
  });

  it('keeps unsaved Pricing Assumptions intact when discard is cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    getRevenuePricingContext.mockResolvedValue({ ...sampleContext, revenueMode:'sales_register', settings:{ ...sampleContext.settings, exists:true, revenueMode:'sales_register', version:1 } });
    renderRevenue();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === 'Pricing Assumptions').click(); });
    const input = container.querySelector('input[aria-label="Mock strategy rate"]');
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '375'); input.dispatchEvent(new Event('input', { bubbles:true })); });
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Back to Revenue overview')).click(); });
    expect(confirm).toHaveBeenCalledWith('Discard unsaved Pricing Assumptions changes and return to the Revenue overview?');
    expect(container.querySelector('input[aria-label="Mock strategy rate"]')?.value).toBe('375');
    confirm.mockReturnValue(true);
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Back to Revenue overview')).click(); });
    expect(document.body.textContent).toContain('Current Revenue position');
    confirm.mockRestore();
  });

  it('labels unestablished strategy output as illustrative and keeps persisted Summary totals authoritative', async () => {
    getRevenuePricingContext.mockResolvedValueOnce({ ...sampleContext, revenueMode:'sales_register', settings:{ exists:false, revenueMode:'sales_register', version:0, revenueAuthority:{ ready:false, summary:null, establishment:{breakdown:{imported:0,calculated:0,manual:0,unresolved:1},partialForecastRevenue:0,outstandingPlotCount:1} } } });
    renderRevenue();
    await act(async () => { await Promise.resolve(); });
    expect(document.body.textContent).toContain('Revenue Not Established');
    expect(container.querySelector('.revenue-overview__kpis')?.textContent).toContain('Forecast RevenueUnavailable');
    const reviewPlots = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Review plots');
    expect(reviewPlots).toBeTruthy();
    await act(async () => { reviewPlots.click(); });
    expect(document.body.textContent).toContain('Plot Revenue Register');
    expect(saveRevenueRecord).not.toHaveBeenCalled();
    act(() => root.unmount());
    root = createRoot(container);
    getRevenuePricingContext.mockResolvedValueOnce({
      ...sampleContext,
      revenueMode:'summary',
      summaryRevenueLines:[{ id:'line-1', description:'Persisted', forecastRevenue:100000 }],
      settings:{ ...sampleContext.settings, exists:true, revenueMode:'summary', version:1, revenueAuthority:{ready:true,summary:{forecastRevenue:100000},establishment:{breakdown:{imported:0,calculated:0,manual:0,unresolved:0}}} },
    });
    renderRevenue();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === 'Open Summary Revenue').click(); });
    const value = container.querySelector('input[aria-label="Revenue line 1 forecast revenue"]');
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(value, '250000'); value.dispatchEvent(new Event('input', { bubbles:true })); });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Back to Revenue overview')).click(); });
    expect(container.querySelector('.revenue-overview__kpis')?.textContent).toContain('£100,000.00');
    expect(container.querySelector('.revenue-overview__kpis')?.textContent).not.toContain('£250,000.00');
    confirm.mockRestore();
  });

  it('confirms the exact zero Summary Revenue total before changing authority', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    getRevenuePricingContext.mockResolvedValue({ ...sampleContext, revenueMode:'sales_register', summaryRevenueLines:[], settings:{ ...sampleContext.settings, exists:true, revenueMode:'sales_register', version:1 } });
    renderRevenue();
    await act(async () => { await Promise.resolve(); });
    const summaryCard = [...container.querySelectorAll('.revenue-overview__mode')].find((element) => element.textContent.includes('Summary Revenue'));
    const switchButton = [...summaryCard.querySelectorAll('button')].find((button) => button.textContent === 'Use for CVR Revenue');
    expect(switchButton.className).toBe('po-button');
    await act(async () => { switchButton.click(); });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('£0.00'));
    expect(saveRevenueRecord).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('shows a visible error instead of permanent loading when fetch rejects', async () => {
    getRevenuePricingContext.mockRejectedValue(new Error('Network failed'));

    renderRevenue();

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Network failed');
    expect(document.body.textContent).not.toContain('Loading revenue data');
  });

  it('does not update state after unmount before async resolution', async () => {
    let resolveContext;
    getRevenuePricingContext.mockReturnValue(
      new Promise((resolve) => {
        resolveContext = resolve;
      })
    );

    renderRevenue();

    await act(async () => {
      root.unmount();
      resolveContext(sampleContext);
      await Promise.resolve();
    });
  });
});
