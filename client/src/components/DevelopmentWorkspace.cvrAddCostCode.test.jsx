/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listPOs = vi.hoisted(() => vi.fn());
const listCandidates = vi.hoisted(() => vi.fn());
const ensurePackages = vi.hoisted(() => vi.fn());
const ensureEvents = vi.hoisted(() => vi.fn());
const ensureMatrices = vi.hoisted(() => vi.fn());
const buildModel = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({ listPOs }));
vi.mock('../api/developments', () => ({
  getDevelopmentCommercialReadiness: vi.fn().mockResolvedValue({ ready: true }),
}));
vi.mock('../admin/costCodeMasterStore', () => ({
  listActiveCostCodesForSelect: listCandidates,
}));
vi.mock('../cvr/cvrPeriodAuthority', () => ({
  isCvrServerAuthorityEnabled: () => true,
}));
vi.mock('../api/cvrPeriods', () => import('../test/mockCvrPeriodApi'));
vi.mock('../payments/packageStore', () => ({
  ensurePackagesReadyForDevelopment: ensurePackages,
}));
vi.mock('../commercialEvents/commercialEventServerCache', () => ({
  ensureCommercialEventsReadyForDevelopment: ensureEvents,
  getCommercialEventsLoadState: () => 'loaded',
  getCommercialEventsLoadError: () => null,
}));
vi.mock('../payments/orderMatrixServerCache', () => ({
  ensureMatricesReadyForDevelopment: ensureMatrices,
  getOrderMatricesLoadState: () => 'loaded',
  getOrderMatricesLoadError: () => null,
}));
vi.mock('../developments/developmentHelpers', () => ({
  buildDevelopmentWorkspaceModel: buildModel,
}));
vi.mock('../developments/developmentStore', () => ({
  updateDevelopment: vi.fn(),
  VERSION_CONFLICT_MESSAGE: 'Version conflict',
}));
vi.mock('../api/developmentBudget', () => ({
  getDevelopmentBudget: vi.fn().mockResolvedValue({ exists: false, events: [], perCostCode: [] }),
  postDevelopmentBudgetEvent: vi.fn(),
  confirmSiteStartBudget: vi.fn(),
}));
vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePermission: () => true }));
vi.mock('../commercialAssistant/CommercialAssistantContext', () => ({
  useCommercialAssistantScope: vi.fn(),
}));
vi.mock('./DevelopmentOverview', () => ({
  default: () => <div>Overview</div>,
  DevelopmentPackagesTab: () => <div>Packages</div>,
  SummaryDashboard: () => null,
}));
vi.mock('./PlotMaster', () => ({ default: () => null }));
vi.mock('./DevelopmentCommercialEvents', () => ({ default: () => null }));
vi.mock('./PurchaseLedger', () => ({ default: () => null }));
vi.mock('./RevenueWorkspace', () => ({ default: () => null }));
vi.mock('./DevelopmentSellingCostsWorkspace', () => ({ default: () => null }));
vi.mock('./DevelopmentPrelimsWorkspace', () => ({ default: () => null }));
vi.mock('./CVRRegister', () => ({ default: () => null }));
vi.mock('./CVRSummaryPage', () => ({ default: () => null }));
vi.mock('./SubcontractPackageWorkspace', () => ({ default: () => null }));
vi.mock('./PackageWorkspaceNotFound', () => ({ default: () => null }));
vi.mock('./layout/ApplicationPageHeader', () => ({
  default: ({ actions, children }) => <header>{actions}{children}</header>,
}));

import DevelopmentWorkspace from './DevelopmentWorkspace';
import { UnsavedChangesProvider } from '../navigation/UnsavedChangesProvider.jsx';
import {
  buildServerCvrInputFixture,
  buildServerCvrPeriodFixture,
  resetCvrPeriodApiStore,
  seedMockCvrInputs,
  seedMockCvrPeriod,
} from '../test/mockCvrPeriodApi';
import { __resetCvrPeriodServerCacheForTests } from '../cvr/cvrPeriodServerCache';

const DEVELOPMENT = {
  id: 'willow-development',
  developmentName: 'Willow Gardens',
  jobNumber: 'WG01',
  status: 'live',
  version: 1,
};
const PERIOD_ID = 'c6634196-6b0f-4921-a0b5-637ff9b73f2f';

describe('Development P01 Add Cost Code production path', () => {
  let container;
  let root;

  beforeEach(() => {
    resetCvrPeriodApiStore();
    __resetCvrPeriodServerCacheForTests();
    listPOs.mockResolvedValue({ items: [] });
    ensurePackages.mockResolvedValue([]);
    ensureEvents.mockResolvedValue([]);
    ensureMatrices.mockResolvedValue([]);
    buildModel.mockReturnValue({
      ...DEVELOPMENT,
      id: DEVELOPMENT.id,
      statusMeta: { label: 'Live', modifier: 'live' },
      summaryCards: [],
      packages: [],
    });
    listCandidates.mockResolvedValue([
      { id: 'cc-2000', code: '2000', value: '2000', description: 'Site Management', active: true },
      { id: 'cc-5400', code: '5400', value: '5400', description: 'Selling Costs General Allowance', commercialHead: 'Sales & Marketing', active: true },
      ...Array.from({ length: 35 }, (_, index) => ({
        id: `cc-other-${index}`,
        code: `8${String(index).padStart(3, '0')}`,
        value: `8${String(index).padStart(3, '0')}`,
        description: `Other Cost Code ${index}`,
        active: true,
      })),
    ]);
    seedMockCvrPeriod(DEVELOPMENT.id, buildServerCvrPeriodFixture({
      id: PERIOD_ID,
      developmentId: DEVELOPMENT.id,
      periodKey: 'P01',
      status: 'draft',
    }));
    seedMockCvrInputs(PERIOD_ID, [buildServerCvrInputFixture({
      periodId: PERIOD_ID,
      costCodeKey: '2000',
      costCodeLabel: '2000 — Site Management',
      currentBudget: 100000,
    })]);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }

  it('opens the real P01 dialog, finds 5400, and selects it without adding membership', async () => {
    await act(async () => {
      root.render(
        <UnsavedChangesProvider>
          <DevelopmentWorkspace
            development={DEVELOPMENT}
            initialActiveTab="cvr"
            initialCvrPeriodKey="P01"
            initialCvrSubview="worksheet"
            onBackToList={vi.fn()}
          />
        </UnsavedChangesProvider>
      );
    });
    await flush();

    const open = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Add Cost Code');
    expect(open).toBeTruthy();
    act(() => open.click());
    await flush();
    expect(listCandidates).toHaveBeenCalledWith({ fresh: true });

    const search = document.body.querySelector('input[aria-label="CVR add cost code search"]');
    expect(search).toBeTruthy();
    await act(async () => {
      search.focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      ).set;
      setter.call(search, 'Selling Costs');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.body.querySelector('[role="option"][data-cost-code="5400"]')).toBeTruthy();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      ).set;
      setter.call(search, '5400');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const result = document.body.querySelector('[role="option"][data-cost-code="5400"]');
    expect(result).toBeTruthy();
    expect(result.textContent).toContain('5400 — Selling Costs General Allowance');
    act(() => result.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(search.value).toContain('5400 — Selling Costs General Allowance');
    expect(search.dataset.costCode).toBe('5400');

    const add = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Add Cost Code' && button !== open);
    expect(add.disabled).toBe(false);
    expect(document.body.querySelector('[role="option"][data-cost-code="5400"]')).toBeNull();
  });
});
