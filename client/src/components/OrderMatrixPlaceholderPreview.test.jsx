/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSubcontractOrderKey } from '../payments/packageKeyMigration';
import { hasOrderMatrix, loadOrderMatrix } from '../payments/orderMatrixStore';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('./OrderMatrixImportWizard', () => ({
  default: ({ onImport }) => (
    <button
      type="button"
      data-testid="mock-import"
      onClick={() =>
        onImport({
          layout: 'plot-stage',
          stages: ['Stage 1'],
          plots: [{ id: 'plot-1', label: 'Plot 1', values: [50000] }],
        })
      }
    >
      Mock Import
    </button>
  ),
}));

import OrderMatrixPlaceholderPreview from './OrderMatrixPlaceholderPreview';

const ORDER_KEY = buildSubcontractOrderKey(
  'dev-1785599776666-zck5pl',
  'sup-1786619149194',
  '5231 - cleaning - cleaning'
);

const order = {
  orderKey: ORDER_KEY,
  jobId: 'dev-1785599776666-zck5pl',
  supplierId: 'sup-1786619149194',
  costCode: '5231 - cleaning - cleaning',
  projectLabel: 'Test Site 1',
  supplierLabel: 'Wipe It Cleaners',
  committedValue: 50000,
};

describe('OrderMatrixPlaceholderPreview matrix visibility', () => {
  let container;
  let root;

  beforeEach(() => {
    storage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function renderPreview(props = {}) {
    act(() => {
      root.render(
        <OrderMatrixPlaceholderPreview
          embedded
          order={order}
          hasMatrix={false}
          onCancel={vi.fn()}
          onMatrixImported={vi.fn()}
          {...props}
        />
      );
    });
  }

  it('shows imported matrix immediately after save even when hasMatrix prop is still false', async () => {
    renderPreview();

    act(() => {
      document.querySelector('.po-btn-primary')?.click();
    });

    await act(async () => {
      document.querySelector('[data-testid="mock-import"]')?.click();
      await Promise.resolve();
    });

    expect(hasOrderMatrix(ORDER_KEY)).toBe(true);
    expect(loadOrderMatrix(ORDER_KEY)?.plots).toHaveLength(1);
    expect(document.body.textContent).toContain('Order Matrix');
    expect(document.body.textContent).not.toContain('Import your valuation matrix');
    expect(document.body.textContent).toContain('Plot 1');
  });
});
