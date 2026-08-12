/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ensureDevelopmentsReady = vi.hoisted(() => vi.fn());
const listPOs = vi.hoisted(() => vi.fn());
const getRevenuePricingContext = vi.hoisted(() => vi.fn());

vi.mock('../developments/developmentStore', () => ({
  ensureDevelopmentsReady,
  getDevelopment: vi.fn(() => null),
  refreshDevelopment: vi.fn(),
  listDevelopments: vi.fn(() => []),
}));

vi.mock('../api', () => ({
  listPOs,
  listSuppliers: vi.fn().mockResolvedValue([]),
  getPO: vi.fn(),
  deletePO: vi.fn(),
  approvePO: vi.fn(),
  requestApproval: vi.fn(),
  poPdfUrl: vi.fn(() => '/pdf'),
}));

vi.mock('../cvr/cvrPeriodHelpers', () => ({
  buildCvrPortfolioModel: vi.fn(() => ({
    summaryCards: [],
    awaitingApproval: [],
    rows: [],
  })),
}));

vi.mock('../cvr/cvrPeriodStore', () => ({
  approveCvrPeriod: vi.fn(),
  rejectCvrPeriod: vi.fn(),
}));

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

vi.mock('./DevelopmentWorkspace', () => ({
  default: () => <div>Development workspace</div>,
}));
vi.mock('./DevelopmentList', () => ({
  default: () => <div>Development list</div>,
}));
vi.mock('./RevenueStrategyPanel', () => ({
  default: () => <div>Strategy</div>,
}));
vi.mock('./HouseTypeRevenueTable', () => ({
  default: () => null,
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
vi.mock('../suppliers/usePoReviewLiveSupplier', () => ({
  usePoReviewLiveSupplier: () => ({
    supplier: null,
    loading: false,
    error: false,
  }),
}));
vi.mock('./OrderMatrixDrawerSection', () => ({
  default: () => null,
}));
vi.mock('./SubcontractOrdersList', () => ({
  default: () => <div>Payment certificates list</div>,
}));

import CVRPortfolio from './CVRPortfolio';
import Developments from './Developments';
import POList from './POList';
import RevenueWorkspace from './RevenueWorkspace';
import PaymentCertificates from './PaymentCertificates';

describe('workflow navigation smoke', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    ensureDevelopmentsReady.mockResolvedValue([]);
    listPOs.mockResolvedValue({ items: [] });
    getRevenuePricingContext.mockResolvedValue({
      plots: [],
      strategy: {
        openMarket: { ratePerFt2: 350, effectiveDate: '' },
        affordableHousing: {},
        garagePremiums: { none: 0, single: 0, double: 0 },
      },
      houseTypePricing: {},
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  async function mount(Component, props = {}) {
    await act(async () => {
      root.render(<Component {...props} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('mounts Developments without throwing', async () => {
    await mount(Developments);
    expect(document.body.textContent).toContain('Development list');
  });

  it('mounts CVRPortfolio without throwing', async () => {
    await mount(CVRPortfolio);
    expect(document.body.textContent).toContain('CVR Portfolio');
  });

  it('mounts RevenueWorkspace without throwing', async () => {
    await mount(RevenueWorkspace, { developmentId: 'dev-1' });
    expect(document.body.textContent).toContain('Revenue Dashboard');
  });

  it('mounts POList without throwing', async () => {
    await mount(POList);
    expect(document.body.textContent).toContain('Purchase Orders');
  });

  it('mounts PaymentCertificates without throwing', async () => {
    await mount(PaymentCertificates);
    expect(document.body.textContent).toContain('Payment certificates list');
  });
});
