/**
 * @vitest-environment jsdom
 * BL-029B — Development workspace Order Matrix hydration.
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
const buildDevelopmentWorkspaceModel = vi.hoisted(() => vi.fn());
const matrixAuthorityEnabled = vi.hoisted(() => ({ value: false }));

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
  isCommercialEventServerAuthorityEnabled: () => false,
}));

vi.mock('../payments/orderMatrixAuthority', () => ({
  isOrderMatrixServerAuthorityEnabled: () => matrixAuthorityEnabled.value,
}));

vi.mock('../developments/developmentHelpers', () => ({
  buildDevelopmentWorkspaceModel,
}));

vi.mock('../commercialAssistant/CommercialAssistantContext', () => ({
  useCommercialAssistantScope: vi.fn(),
}));

vi.mock('./DevelopmentOverview', () => ({
  default: ({ matricesLoading, matricesError, onOpenPackage }) => (
    <div data-testid="overview-panel">
      {matricesLoading ? <span>Loading matrix data…</span> : null}
      {matricesError ? <span role="alert">{matricesError}</span> : null}
      <span>Overview panel</span>
      <button
        type="button"
        onClick={() =>
          onOpenPackage?.('dev-matrix-1::sup-1::0120', {
            orderKey: 'dev-matrix-1::sup-1::0120',
            openedFrom: 'DevelopmentPackages',
            initialTab: 'overview',
          })
        }
      >
        Open package
      </button>
    </div>
  ),
  DevelopmentPackagesTab: ({ matricesLoading, matricesError }) => (
    <div data-testid="packages-panel">
      {matricesLoading ? <span>Loading matrix data…</span> : null}
      {matricesError ? <span role="alert">{matricesError}</span> : null}
      <span>Packages panel</span>
    </div>
  ),
  SummaryDashboard: () => null,
}));

vi.mock('./PlotMaster', () => ({ default: () => <div>Plot Master panel</div> }));
vi.mock('./DevelopmentCommercialEvents', () => ({
  default: () => <div>Commercial Events panel</div>,
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
  default: ({ matricesLoading, matricesError, matricesReady }) => (
    <div data-testid="package-workspace">
      {matricesLoading ? <span>Loading matrix data…</span> : null}
      {matricesError ? <span role="alert">{matricesError}</span> : null}
      {matricesReady ? <span>Matrix cache ready</span> : null}
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
  id: 'dev-matrix-1',
  developmentName: 'Test Site 1',
  jobNumber: 'TS1',
  status: 'live',
  version: 1,
};

const sampleModel = {
  id: 'dev-matrix-1',
  developmentName: 'Test Site 1',
  jobNumber: 'TS1',
  statusMeta: { label: 'Live', modifier: 'live' },
  summaryCards: [],
  packages: [
    {
      orderKey: 'dev-matrix-1::sup-1::0120',
      developmentId: 'dev-matrix-1',
      supplierLabel: 'Sparktastic',
      projectLabel: 'Drylining',
    },
  ],
};

describe('DevelopmentWorkspace order matrix hydration (BL-029B)', () => {
  let container;
  let root;
  let matrixResolve;
  let matrixPromise;

  beforeEach(() => {
    matrixAuthorityEnabled.value = false;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    listPOs.mockResolvedValue({ items: [] });
    ensurePackagesReadyForDevelopment.mockResolvedValue(sampleModel.packages);
    buildDevelopmentWorkspaceModel.mockReturnValue(sampleModel);
    ensureCommercialEventsReadyForDevelopment.mockResolvedValue([]);
    getCommercialEventsLoadState.mockReturnValue('loaded');
    getCommercialEventsLoadError.mockReturnValue(null);

    matrixPromise = new Promise((resolve) => {
      matrixResolve = resolve;
    });
    ensureMatricesReadyForDevelopment.mockReturnValue(matrixPromise);
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

  it('begins matrix hydration in parallel with package hydration', async () => {
    renderWorkspace();

    expect(ensureMatricesReadyForDevelopment).toHaveBeenCalledWith('dev-matrix-1');
    expect(ensurePackagesReadyForDevelopment).toHaveBeenCalled();
    expect(ensureCommercialEventsReadyForDevelopment).toHaveBeenCalledWith('dev-matrix-1');

    await act(async () => {
      matrixResolve([]);
      await matrixPromise;
    });
  });

  it('shows loading matrix data when server authority is enabled during hydration', async () => {
    matrixAuthorityEnabled.value = true;
    getOrderMatricesLoadState.mockReturnValue('loading');

    renderWorkspace();

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Loading matrix data…');
  });

  it('shows loaded matrix readiness on the package workspace after hydration', async () => {
    matrixAuthorityEnabled.value = true;
    getOrderMatricesLoadState.mockReturnValue('loading');

    renderWorkspace();
    await act(async () => {
      await Promise.resolve();
    });

    getOrderMatricesLoadState.mockReturnValue('loaded');
    await act(async () => {
      matrixResolve([{ orderKey: 'dev-matrix-1::sup-1::0120' }]);
      await matrixPromise;
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent === 'Open package')
        ?.click();
    });

    expect(document.body.textContent).toContain('Matrix cache ready');
    expect(document.body.textContent).not.toContain('Loading matrix data…');
  });

  it('shows matrix error when server authority is enabled and hydration fails', async () => {
    matrixAuthorityEnabled.value = true;
    const matrixError = new Error('Unable to load order matrix data. Please try again.');
    ensureMatricesReadyForDevelopment.mockRejectedValue(matrixError);
    getOrderMatricesLoadState.mockReturnValue('error');
    getOrderMatricesLoadError.mockReturnValue(matrixError);

    renderWorkspace();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Unable to load order matrix data. Please try again.'
    );
  });

  it('does not show matrix loading placeholders when authority remains local', async () => {
    matrixAuthorityEnabled.value = false;
    getOrderMatricesLoadState.mockReturnValue('loading');

    renderWorkspace();

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain('Loading matrix data…');
    expect(document.body.textContent).toContain('Overview panel');
  });
});
