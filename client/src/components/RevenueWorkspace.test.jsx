/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getRevenuePricingContext = vi.hoisted(() => vi.fn());

vi.mock('../revenue/revenueStrategy', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getRevenuePricingContext,
  };
});

vi.mock('../admin/revenueCategoryStore', () => ({
  ensureRevenueCategories: vi.fn(),
}));

vi.mock('./RevenueStrategyPanel', () => ({
  default: () => <div>Revenue Strategy Panel</div>,
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
  default: () => null,
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
};

describe('RevenueWorkspace async loading guard', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
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

    expect(document.body.textContent).toContain('Revenue Strategy Panel');
  });

  it('renders content after a successful load', async () => {
    getRevenuePricingContext.mockResolvedValue(sampleContext);

    renderRevenue();

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Revenue Dashboard');
    expect(document.body.textContent).toContain('Revenue Strategy Panel');
    expect(document.body.textContent).toContain('Current mode: Sales Register');
    expect(document.body.textContent).toContain('CVR Revenue currently uses Sales Register');
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Sales Register');
  });

  it('renders Summary Revenue lines without Sales Register controls or false secondary metrics', async () => {
    getRevenuePricingContext.mockResolvedValue({
      ...sampleContext,
      revenueMode: 'summary',
      summaryRevenueLines: [{ id:'line-1', description:'Private Sales', forecastRevenue:100000 }],
      settings: { revenueMode:'summary', summaryRevenueLines:[], version:1 },
    });
    renderRevenue();
    await act(async () => { await Promise.resolve(); });
    expect(document.body.textContent).toContain('Summary Revenue');
    expect(document.querySelector('input[aria-label="Revenue line 1 description"]')?.value).toBe('Private Sales');
    expect(document.body.textContent).toContain('Total Forecast Revenue');
    expect(document.body.textContent).toContain('not tracked in Summary Revenue');
    expect(document.body.textContent).not.toContain('Revenue Strategy Panel');
    expect(document.body.textContent).not.toContain('Revenue Dashboard');
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
