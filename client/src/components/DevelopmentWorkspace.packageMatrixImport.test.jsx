/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSubcontractOrderKey } from '../payments/packageKeyMigration';
import { PACKAGE_OPENED_FROM } from '../payments/packageWorkspaceLaunch';

const listPOs = vi.hoisted(() => vi.fn());
const ensurePackagesReadyForDevelopment = vi.hoisted(() => vi.fn());
const ensureCommercialEventsReadyForDevelopment = vi.hoisted(() => vi.fn());
const getCommercialEventsLoadState = vi.hoisted(() => vi.fn());
const getCommercialEventsLoadError = vi.hoisted(() => vi.fn());
const ensureMatricesReadyForDevelopment = vi.hoisted(() => vi.fn());
const getOrderMatricesLoadState = vi.hoisted(() => vi.fn());
const getOrderMatricesLoadError = vi.hoisted(() => vi.fn());
const workspaceMountCount = vi.hoisted(() => ({ value: 0 }));

const TEST_SITE_ID = 'dev-1785599776666-zck5pl';
const WIPE_SUPPLIER = 'sup-1786619149194';
const WIPE_ORDER_KEY = buildSubcontractOrderKey(
  TEST_SITE_ID,
  WIPE_SUPPLIER,
  '5231 - cleaning - cleaning'
);
const WIPE_PACKAGE_UUID = 'a2419cff-f776-4a2c-8a29-01934b460bf1';

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

vi.mock('../commercialAssistant/CommercialAssistantContext', () => ({
  useCommercialAssistantScope: vi.fn(),
}));

vi.mock('./DevelopmentOverview', () => ({
  default: () => <div>Overview panel</div>,
  DevelopmentPackagesTab: ({ onOpenPackage, model }) => (
    <div data-testid="packages-panel">
      {(model?.packages || []).map((pkg) => (
        <button
          key={pkg.orderKey}
          type="button"
          data-testid={`open-${pkg.orderKey}`}
          onClick={() =>
            onOpenPackage?.(pkg.orderKey, {
              orderKey: pkg.orderKey,
              developmentId: pkg.developmentId,
              supplierId: pkg.supplierId,
              costCode: pkg.costCode,
              packageId: pkg.packageId,
              openedFrom: PACKAGE_OPENED_FROM.DevelopmentPackages,
              initialTab: 'matrix',
              identityError: null,
            })
          }
        >
          Open {pkg.supplierLabel}
        </button>
      ))}
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
  default: ({ order }) => {
    workspaceMountCount.value += 1;
    return (
      <div data-testid="package-workspace">
        {order?.committedValue}
        {order?.packageId}
      </div>
    );
  },
}));
vi.mock('./PackageWorkspaceNotFound', () => ({
  default: () => <div data-testid="package-unavailable">Package unavailable</div>,
}));
vi.mock('./layout/ApplicationPageHeader', () => ({
  default: () => <div>Header</div>,
}));

import DevelopmentWorkspace from './DevelopmentWorkspace';

const sampleDevelopment = {
  id: TEST_SITE_ID,
  developmentName: 'Test Site 1',
  jobNumber: 'DEV-001',
  status: 'live',
  version: 1,
};

function wipeServerPackage() {
  return {
    id: WIPE_PACKAGE_UUID,
    orderKey: WIPE_ORDER_KEY,
    developmentId: TEST_SITE_ID,
    supplierId: WIPE_SUPPLIER,
    costCode: '5231 - cleaning - cleaning',
    supplierLabel: 'Wipe It Cleaners',
    developmentNumber: 'DEV-001',
    developmentName: 'Test Site 1',
    poNumbers: ['S0012'],
  };
}

function approvedWipePo() {
  return {
    poNumber: 'S0012',
    type: 'S',
    status: 'Approved',
    approval: { status: 'approved' },
    supplierId: WIPE_SUPPLIER,
    development: { id: TEST_SITE_ID, developmentName: 'Test Site 1' },
    developmentId: TEST_SITE_ID,
    costRef: { costCode: '5231 - Cleaning - Cleaning' },
    items: [{ costCode: '5231 - Cleaning - Cleaning' }],
    subtotal: 50000,
  };
}

describe('DevelopmentWorkspace package matrix import stability', () => {
  let container;
  let root;
  let resolveInitialPos;
  let resolveRefreshPos;
  let posRequestCount;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    workspaceMountCount.value = 0;
    posRequestCount = 0;

    ensureCommercialEventsReadyForDevelopment.mockResolvedValue([]);
    getCommercialEventsLoadState.mockReturnValue('loaded');
    getCommercialEventsLoadError.mockReturnValue(null);
    ensureMatricesReadyForDevelopment.mockResolvedValue([]);
    getOrderMatricesLoadState.mockReturnValue('loaded');
    getOrderMatricesLoadError.mockReturnValue(null);
    ensurePackagesReadyForDevelopment.mockResolvedValue([wipeServerPackage()]);

    listPOs.mockImplementation(() => {
      posRequestCount += 1;
      if (posRequestCount === 1) {
        return Promise.resolve({ items: [approvedWipePo()] });
      }
      if (posRequestCount === 2) {
        return new Promise((resolve) => {
          resolveRefreshPos = resolve;
        });
      }
      return Promise.resolve({ items: [approvedWipePo()] });
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  async function openPackagesTab() {
    const tab = Array.from(document.querySelectorAll('.po-package-tabs__tab')).find(
      (button) => button.textContent === 'Packages'
    );
    act(() => {
      tab?.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function waitForSelector(selector, attempts = 40) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (document.querySelector(selector)) return;
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  it('keeps package workspace mounted when PO list refreshes after initial open', async () => {
    act(() => {
      root.render(
        <DevelopmentWorkspace
          development={sampleDevelopment}
          onBackToList={vi.fn()}
        />
      );
    });

    await openPackagesTab();
    await waitForSelector(`[data-testid="open-${WIPE_ORDER_KEY}"]`);

    act(() => {
      document.querySelector(`[data-testid="open-${WIPE_ORDER_KEY}"]`)?.click();
    });

    await waitForSelector('[data-testid="package-workspace"]');

    expect(document.body.textContent).toContain('50000');

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain('Loading package commercial data');
    expect(document.querySelector('[data-testid="package-workspace"]')).not.toBeNull();
    expect(document.body.textContent).toContain('50000');

    await act(async () => {
      resolveRefreshPos?.({ items: [approvedWipePo()] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="package-workspace"]')).not.toBeNull();
    expect(document.body.textContent).toContain('50000');
  });
});
