/**
 * @vitest-environment jsdom
 * BL-029B — file-picker/import lifecycle remains stable with matrix authority OFF.
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrderMatrixPlaceholderPreview from './OrderMatrixPlaceholderPreview';

describe('OrderMatrixPlaceholderPreview file-picker lifecycle', () => {
  let container;
  let root;

  beforeEach(() => {
    localStorage.clear();
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

  const order = {
    orderKey: 'dev-1::sup-1::0120',
    jobId: 'dev-1',
    supplierId: 'sup-1',
    costCode: '0120',
    projectLabel: 'Test Site 1',
    supplierLabel: 'Wipe It Cleaners',
    committedValue: 50000,
  };

  it('keeps the Excel file input mounted across parent re-renders', () => {
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

    renderPreview();

    act(() => {
      document.querySelector('.po-btn-primary')?.click();
    });

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
    expect(document.body.textContent).toContain('Choose your spreadsheet');

    renderPreview();

    const fileInputAfter = document.querySelector('input[type="file"]');
    expect(fileInputAfter).toBe(fileInput);
    expect(fileInputAfter.isConnected).toBe(true);
    expect(document.body.textContent).toContain('Choose your spreadsheet');
  });
});
