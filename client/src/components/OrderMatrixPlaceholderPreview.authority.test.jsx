/**
 * @vitest-environment jsdom
 * BL-029D — Order Matrix import save cutover UI.
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());
const authorityEnabled = vi.hoisted(() => ({ value: false }));

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('../payments/orderMatrixAuthority', () => ({
  isOrderMatrixServerAuthorityEnabled: () => authorityEnabled.value,
}));

vi.mock('../api/orderMatrices', () => import('../test/mockOrderMatrixApi'));

vi.mock('../payments/packageStore', () => ({
  fetchPackageByOrderKey: vi.fn(),
  getCachedPackageByOrderKey: () => null,
}));

vi.mock('./OrderMatrixImportWizard', () => ({
  default: ({ onImport, importing }) => (
    <button
      type="button"
      data-testid="mock-import"
      disabled={importing}
      onClick={() => {
        onImport({
          layout: 'plot-stage',
          stages: ['Stage 1'],
          plots: [{ id: 'plot-1', label: 'Plot 1', values: [50000] }],
        });
        onImport({
          layout: 'plot-stage',
          stages: ['Stage 1'],
          plots: [{ id: 'plot-1', label: 'Plot 1', values: [50000] }],
        });
      }}
    >
      Mock Import
    </button>
  ),
}));

import {
  getOrderMatrixPutCallCount,
  resetOrderMatrixApiStore,
  setOrderMatrixPutDelay,
  setOrderMatrixPutReject,
} from '../test/mockOrderMatrixApi';
import {
  __resetOrderMatrixServerCacheForTests,
  ensureMatricesReadyForDevelopment,
} from '../payments/orderMatrixServerCache';
import { loadOrderMatrix } from '../payments/orderMatrixStore';
import OrderMatrixPlaceholderPreview from './OrderMatrixPlaceholderPreview';

const DEV_ID = 'dev-1785599776666-zck5pl';
const ORDER_KEY = `${DEV_ID}::sup-1::0120`;
const PACKAGE_UUID = 'a2419cff-f776-4a2c-8a29-01934b460bf1';

const order = {
  orderKey: ORDER_KEY,
  developmentId: DEV_ID,
  jobId: DEV_ID,
  packageId: PACKAGE_UUID,
  supplierId: 'sup-1',
  projectLabel: 'Test Site 1',
  supplierLabel: 'Wipe It Cleaners',
  committedValue: 50000,
};

describe('OrderMatrixPlaceholderPreview server-authority save (BL-029D)', () => {
  let networkGuard;
  let container;
  let root;

  beforeEach(async () => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = true;
    storage.clear();
    __resetOrderMatrixServerCacheForTests();
    resetOrderMatrixApiStore();
    await ensureMatricesReadyForDevelopment(DEV_ID);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  function renderPreview() {
    act(() => {
      root.render(
        <OrderMatrixPlaceholderPreview
          embedded
          order={order}
          hasMatrix={false}
          onCancel={vi.fn()}
          onMatrixImported={vi.fn()}
        />
      );
    });
  }

  it('saves via PUT, patches cache, and ignores a duplicate click', async () => {
    setOrderMatrixPutDelay(30);
    renderPreview();

    act(() => {
      document.querySelector('.po-btn-primary')?.click();
    });

    await act(async () => {
      document.querySelector('[data-testid="mock-import"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(getOrderMatrixPutCallCount()).toBe(1);
    expect(storage.get('buildlite_order_matrices_v1')).toBeUndefined();
    expect(loadOrderMatrix(ORDER_KEY)?.plots[0].label).toBe('Plot 1');
    expect(document.body.textContent).toContain('Order Matrix');
    expect(document.body.textContent).toContain('Plot 1');
  });

  it('keeps the wizard mounted and shows an API error without localStorage fallback', async () => {
    setOrderMatrixPutReject(new Error('Order matrix save failed'));
    renderPreview();

    act(() => {
      document.querySelector('.po-btn-primary')?.click();
    });

    await act(async () => {
      document.querySelector('[data-testid="mock-import"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="mock-import"]')).not.toBeNull();
    expect(document.body.textContent).toMatch(/Order matrix save failed|Unable to save/);
    expect(storage.get('buildlite_order_matrices_v1')).toBeUndefined();
    expect(loadOrderMatrix(ORDER_KEY)).toBeNull();
  });
});
