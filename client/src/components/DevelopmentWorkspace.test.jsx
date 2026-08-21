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

vi.mock('../developments/developmentHelpers', () => ({
  buildDevelopmentWorkspaceModel,
}));

vi.mock('../commercialAssistant/CommercialAssistantContext', () => ({
  useCommercialAssistantScope: vi.fn(),
}));

vi.mock('./DevelopmentOverview', () => ({
  default: ({ onOpenPackage }) => (
    <div>
      <span>Overview panel</span>
      <button
        type="button"
        onClick={() =>
          onOpenPackage?.('order-key-1', {
            orderKey: 'order-key-1',
            openedFrom: 'DevelopmentPackages',
            initialTab: 'overview',
          })
        }
      >
        Open package
      </button>
    </div>
  ),
  DevelopmentPackagesTab: () => <div>Packages panel</div>,
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
  default: () => <div data-testid="package-workspace">Package workspace</div>,
}));
vi.mock('./PackageWorkspaceNotFound', () => ({
  default: () => <div>Package unavailable</div>,
}));
vi.mock('./layout/ApplicationPageHeader', () => ({
  default: () => <div>Header</div>,
}));

import DevelopmentWorkspace from './DevelopmentWorkspace';

const sampleDevelopment = {
  id: 'dev-1',
  developmentName: 'Test Site 1',
  jobNumber: 'TS1',
  status: 'live',
  version: 1,
};

const sampleModel = {
  id: 'dev-1',
  developmentName: 'Test Site 1',
  jobNumber: 'TS1',
  statusMeta: { label: 'Live', modifier: 'live' },
  summaryCards: [],
  packages: [
    {
      orderKey: 'order-key-1',
      developmentId: 'dev-1',
      supplierLabel: 'Sparktastic',
      projectLabel: 'Drylining',
    },
  ],
};

describe('DevelopmentWorkspace stability guards', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    listPOs.mockResolvedValue({ items: [] });
    ensurePackagesReadyForDevelopment.mockResolvedValue(sampleModel.packages);
    ensureCommercialEventsReadyForDevelopment.mockResolvedValue([]);
    getCommercialEventsLoadState.mockReturnValue('loaded');
    getCommercialEventsLoadError.mockReturnValue(null);
    ensureMatricesReadyForDevelopment.mockResolvedValue([]);
    getOrderMatricesLoadState.mockReturnValue('loaded');
    getOrderMatricesLoadError.mockReturnValue(null);
    buildDevelopmentWorkspaceModel.mockReturnValue(sampleModel);
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

  it('shows a visible defensive state when the workspace model is missing', () => {
    buildDevelopmentWorkspaceModel.mockReturnValue(null);

    renderWorkspace();

    expect(document.body.textContent).toContain(
      'Development workspace data is unavailable'
    );
    expect(document.body.textContent).toContain('Back to Developments');
  });

  it('switches to Revenue when selecting the Revenue tab from the workspace shell', async () => {
    renderWorkspace();

    await act(async () => {
      await Promise.resolve();
    });

    clickTab('Revenue');

    expect(document.querySelector('[data-testid="revenue-panel"]')).not.toBeNull();
  });
});
