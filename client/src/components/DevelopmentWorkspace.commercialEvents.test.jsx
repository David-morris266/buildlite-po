/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listPOs = vi.hoisted(() => vi.fn());
const ensurePackagesReadyForDevelopment = vi.hoisted(() => vi.fn());
const ensureCommercialEventsReadyForDevelopment = vi.hoisted(() => vi.fn());
const getCommercialEventsLoadState = vi.hoisted(() => vi.fn());
const getCommercialEventsLoadError = vi.hoisted(() => vi.fn());
const ensureMatricesReadyForDevelopment = vi.hoisted(() => vi.fn());
const getOrderMatricesLoadState = vi.hoisted(() => vi.fn());
const getOrderMatricesLoadError = vi.hoisted(() => vi.fn());
const authorityEnabled = vi.hoisted(() => ({ value: false }));
const buildDevelopmentWorkspaceModel = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  listPOs,
}));

vi.mock('../payments/packageStore', () => ({
  ensurePackagesReadyForDevelopment,
}));

vi.mock('../commercialEvents/commercialEventServerCache', () => ({
  ensureCommercialEventsReadyForDevelopment,
  getCommercialEventsLoadState,
  getCommercialEventsLoadError,
}));

vi.mock('../payments/orderMatrixServerCache', () => ({
  ensureMatricesReadyForDevelopment,
  getOrderMatricesLoadState,
  getOrderMatricesLoadError,
}));

vi.mock('../commercialEvents/commercialEventAuthority', () => ({
  isCommercialEventServerAuthorityEnabled: () => authorityEnabled.value,
}));

vi.mock('../developments/developmentHelpers', () => ({
  buildDevelopmentWorkspaceModel,
}));

vi.mock('../commercialAssistant/CommercialAssistantContext', () => ({
  useCommercialAssistantScope: vi.fn(),
}));

vi.mock('./DevelopmentOverview', () => ({
  default: ({ commercialEventsLoading, commercialEventsError }) => (
    <div data-testid="overview-panel">
      {commercialEventsLoading ? <span>Loading commercial data…</span> : null}
      {commercialEventsError ? <span role="alert">{commercialEventsError}</span> : null}
      <span>Overview panel</span>
    </div>
  ),
  DevelopmentPackagesTab: ({ commercialEventsLoading, commercialEventsError }) => (
    <div data-testid="packages-panel">
      {commercialEventsLoading ? <span>Loading commercial data…</span> : null}
      {commercialEventsError ? <span role="alert">{commercialEventsError}</span> : null}
      <span>Packages panel</span>
    </div>
  ),
  SummaryDashboard: () => null,
}));

vi.mock('./PlotMaster', () => ({ default: () => <div>Plot Master panel</div> }));
vi.mock('./DevelopmentCommercialEvents', () => ({
  default: ({ commercialEventsLoading, commercialEventsError }) => (
    <div data-testid="commercial-register">
      {commercialEventsLoading ? <span>Loading commercial data…</span> : null}
      {commercialEventsError ? <span role="alert">{commercialEventsError}</span> : null}
      <span>Commercial Events panel</span>
    </div>
  ),
}));
vi.mock('./PurchaseLedger', () => ({ default: () => <div>Ledger panel</div> }));
vi.mock('./RevenueWorkspace', () => ({
  default: () => <div data-testid="revenue-panel">Revenue panel</div>,
}));
vi.mock('./DevelopmentPrelimsWorkspace', () => ({
  default: () => <div data-testid="prelims-panel">Prelims panel</div>,
}));
vi.mock('./CVRRegister', () => ({ default: () => <div data-testid="cvr-panel">CVR panel</div> }));
vi.mock('./CVRSummaryPage', () => ({ default: () => null }));
vi.mock('./CVRWorkspace', () => ({ default: () => null }));
vi.mock('./SubcontractPackageWorkspace', () => ({
  default: ({ commercialEventsLoading, commercialEventsError }) => (
    <div data-testid="package-workspace">
      {commercialEventsLoading ? <span>Loading commercial data…</span> : null}
      {commercialEventsError ? <span role="alert">{commercialEventsError}</span> : null}
      Package workspace
    </div>
  ),
}));
vi.mock('./PackageWorkspaceNotFound', () => ({
  default: () => <div>Package unavailable</div>,
}));
vi.mock('./layout/ApplicationPageHeader', () => ({
  default: () => <div>Header</div>,
}));

import DevelopmentWorkspace from './DevelopmentWorkspace';

const sampleDevelopment = {
  id: 'dev-ce-1',
  developmentName: 'Test Site 1',
  jobNumber: 'TS1',
  status: 'live',
  version: 1,
};

const sampleModel = {
  id: 'dev-ce-1',
  developmentName: 'Test Site 1',
  jobNumber: 'TS1',
  statusMeta: { label: 'Live', modifier: 'live' },
  summaryCards: [],
  packages: [
    {
      orderKey: 'order-key-1',
      developmentId: 'dev-ce-1',
      supplierLabel: 'Sparktastic',
      projectLabel: 'Drylining',
      committedValue: 100000,
    },
  ],
};

describe('DevelopmentWorkspace commercial event hydration (BL-028B.1)', () => {
  let container;
  let root;
  let ceResolve;
  let cePromise;

  beforeEach(() => {
    authorityEnabled.value = false;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    listPOs.mockResolvedValue({ items: [] });
    ensurePackagesReadyForDevelopment.mockResolvedValue(sampleModel.packages);
    buildDevelopmentWorkspaceModel.mockReturnValue(sampleModel);

    cePromise = new Promise((resolve) => {
      ceResolve = resolve;
    });
    ensureCommercialEventsReadyForDevelopment.mockReturnValue(cePromise);
    getCommercialEventsLoadState.mockReturnValue('loaded');
    getCommercialEventsLoadError.mockReturnValue(null);
    ensureMatricesReadyForDevelopment.mockResolvedValue([]);
    getOrderMatricesLoadState.mockReturnValue('loaded');
    getOrderMatricesLoadError.mockReturnValue(null);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  function renderWorkspace(props = {}) {
    act(() => {
      root.render(
        <DevelopmentWorkspace
          development={sampleDevelopment}
          onBackToList={vi.fn()}
          {...props}
        />
      );
    });
  }

  function clickTab(label) {
    const tab = Array.from(document.querySelectorAll('.po-package-tabs__tab')).find(
      (button) => button.textContent === label
    );
    act(() => {
      tab?.click();
    });
  }

  it('begins CE hydration in parallel with package hydration', async () => {
    renderWorkspace();

    expect(ensureCommercialEventsReadyForDevelopment).toHaveBeenCalledWith('dev-ce-1');
    expect(ensurePackagesReadyForDevelopment).toHaveBeenCalled();

    await act(async () => {
      ceResolve([]);
      await cePromise;
    });
  });

  it('shows loading commercial data when server authority is enabled during hydration', async () => {
    authorityEnabled.value = true;
    getCommercialEventsLoadState.mockReturnValue('loading');

    renderWorkspace();

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Loading commercial data…');
  });

  it('shows CE error when server authority is enabled and hydration fails', async () => {
    authorityEnabled.value = true;
    const ceError = new Error('Unable to load Commercial Events. Please try again.');
    ensureCommercialEventsReadyForDevelopment.mockRejectedValue(ceError);
    getCommercialEventsLoadState.mockReturnValue('error');
    getCommercialEventsLoadError.mockReturnValue(ceError);

    renderWorkspace();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Unable to load Commercial Events. Please try again.'
    );
  });

  it('does not show CE loading placeholders when authority remains local', async () => {
    authorityEnabled.value = false;
    getCommercialEventsLoadState.mockReturnValue('loading');

    renderWorkspace();

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain('Loading commercial data…');
    expect(document.body.textContent).toContain('Overview panel');
  });

  it('does not blank the workspace when unmounting during hydration', async () => {
    renderWorkspace();

    act(() => {
      root.unmount();
    });

    await act(async () => {
      ceResolve([]);
      await cePromise;
    });

    expect(container.textContent).toBe('');
  });

  it('passes CE readiness to commercial register tab without blank render', async () => {
    authorityEnabled.value = true;
    getCommercialEventsLoadState.mockReturnValue('loading');

    renderWorkspace();

    await act(async () => {
      await Promise.resolve();
    });

    clickTab('Commercial Events');

    const register = document.querySelector('[data-testid="commercial-register"]');
    expect(register).not.toBeNull();
    expect(register.textContent).toContain('Loading commercial data…');
    expect(register.textContent).toContain('Commercial Events panel');
  });
});
