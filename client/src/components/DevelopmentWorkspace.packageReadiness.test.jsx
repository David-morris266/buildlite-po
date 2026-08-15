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
const capturedWorkspaceOrder = vi.hoisted(() => ({ current: null }));

const TEST_SITE_ID = 'dev-1785599776666-zck5pl';
const BRICKS_SUPPLIER = 'sup-1786606980806';
const BRICKS_ORDER_KEY = buildSubcontractOrderKey(
  TEST_SITE_ID,
  BRICKS_SUPPLIER,
  '2300 — brickwork — brickwork'
);
const BRICKS_PACKAGE_UUID = 'e1174b75-72d3-4a8d-80e0-ec5cfe2edbfd';

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
              initialTab: 'overview',
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
vi.mock('./CVRRegister', () => ({ default: () => <div data-testid="cvr-panel">CVR panel</div> }));
vi.mock('./CVRSummaryPage', () => ({ default: () => null }));
vi.mock('./CVRWorkspace', () => ({ default: () => null }));
vi.mock('./SubcontractPackageWorkspace', () => ({
  default: ({ order, onBackToList }) => {
    capturedWorkspaceOrder.current = order;
    return (
      <div data-testid="package-workspace">
        {order?.committedValue}
        {order?.packageId}
        <button type="button" onClick={onBackToList}>
          Back to Packages
        </button>
      </div>
    );
  },
}));
vi.mock('./PackageWorkspaceNotFound', () => ({
  default: ({ message, onBack }) => (
    <div data-testid="package-unavailable">
      <span>{message}</span>
      <button type="button" onClick={onBack}>
        Back to Packages
      </button>
    </div>
  ),
}));
vi.mock('./layout/ApplicationPageHeader', () => ({
  default: () => <div>Header</div>,
}));

import DevelopmentWorkspace from './DevelopmentWorkspace';

const sampleDevelopment = {
  id: TEST_SITE_ID,
  developmentName: 'Test Site 1',
  jobNumber: 'TS1',
  status: 'live',
  version: 1,
};

function bricksServerPackage() {
  return {
    id: BRICKS_PACKAGE_UUID,
    orderKey: BRICKS_ORDER_KEY,
    developmentId: TEST_SITE_ID,
    supplierId: BRICKS_SUPPLIER,
    costCode: '2300 — brickwork — brickwork',
    supplierLabel: 'Bricks R Us',
    developmentNumber: 'TS1',
    developmentName: 'Test Site 1',
    poNumbers: ['S0011'],
  };
}

function approvedBricksPo() {
  return {
    poNumber: 'S0011',
    type: 'S',
    status: 'Approved',
    approval: { status: 'approved' },
    supplierId: BRICKS_SUPPLIER,
    development: { id: TEST_SITE_ID, developmentName: 'Test Site 1' },
    costRef: { costCode: '2300 — brickwork — brickwork' },
    items: [{ costCode: '2300 — brickwork — brickwork' }],
    subtotal: 250000,
  };
}

describe('DevelopmentWorkspace package readiness', () => {
  let container;
  let root;
  let resolvePos;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    capturedWorkspaceOrder.current = null;

    ensureCommercialEventsReadyForDevelopment.mockResolvedValue([]);
    getCommercialEventsLoadState.mockReturnValue('loaded');
    getCommercialEventsLoadError.mockReturnValue(null);
    ensureMatricesReadyForDevelopment.mockResolvedValue([]);
    getOrderMatricesLoadState.mockReturnValue('loaded');
    getOrderMatricesLoadError.mockReturnValue(null);
    ensurePackagesReadyForDevelopment.mockResolvedValue([bricksServerPackage()]);

    resolvePos = null;
    listPOs.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePos = resolve;
        })
    );
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  function renderWorkspace() {
    act(() => {
      root.render(
        <DevelopmentWorkspace
          development={sampleDevelopment}
          initialActiveTab="packages"
          onBackToList={vi.fn()}
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

  async function openPackagesTab() {
    clickTab('Packages');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function waitForPackageList() {
    await act(async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await Promise.resolve();
        if (document.querySelector(`[data-testid="open-${BRICKS_ORDER_KEY}"]`)) {
          break;
        }
      }
    });
  }

  it('shows loading commercial data instead of a £0 workspace while PO data resolves', async () => {
    renderWorkspace();
    await openPackagesTab();
    await waitForPackageList();

    const openButton = document.querySelector(`[data-testid="open-${BRICKS_ORDER_KEY}"]`);
    act(() => {
      openButton?.click();
    });

    expect(document.body.textContent).toContain('Loading package commercial data');
    expect(document.querySelector('[data-testid="package-workspace"]')).toBeNull();
    expect(document.body.textContent).not.toContain('250000');

    await act(async () => {
      resolvePos?.({ items: [approvedBricksPo()] });
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="package-workspace"]')).not.toBeNull();
    expect(document.body.textContent).toContain('250000');
    expect(capturedWorkspaceOrder.current?.packageId).toBe(BRICKS_PACKAGE_UUID);
    expect(capturedWorkspaceOrder.current?.orderKey).toBe(BRICKS_ORDER_KEY);
    expect(capturedWorkspaceOrder.current?.pos.length).toBeGreaterThan(0);
  });

  it('shows explicit incomplete state when PO loading completes without matching PO', async () => {
    renderWorkspace();
    await openPackagesTab();
    await waitForPackageList();

    const openButton = document.querySelector(`[data-testid="open-${BRICKS_ORDER_KEY}"]`);
    act(() => {
      openButton?.click();
    });

    await act(async () => {
      resolvePos?.({ items: [] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="package-unavailable"]')).not.toBeNull();
    expect(document.body.textContent).toContain(
      'Purchase order data for this package is unavailable'
    );
    expect(document.querySelector('[data-testid="package-workspace"]')).toBeNull();
  });

  it('returns to packages and supports tab navigation without stale launch state', async () => {
    renderWorkspace();
    await openPackagesTab();
    await waitForPackageList();

    act(() => {
      document.querySelector(`[data-testid="open-${BRICKS_ORDER_KEY}"]`)?.click();
    });

    await act(async () => {
      resolvePos?.({ items: [approvedBricksPo()] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="package-workspace"]')).not.toBeNull();

    act(() => {
      Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent === 'Back to Packages')
        ?.click();
    });

    expect(document.querySelector('[data-testid="packages-panel"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="package-workspace"]')).toBeNull();

    clickTab('Revenue');
    expect(document.querySelector('[data-testid="revenue-panel"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="package-workspace"]')).toBeNull();
  });
});
