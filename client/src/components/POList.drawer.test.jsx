/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listPOs = vi.hoisted(() => vi.fn());
const listSuppliers = vi.hoisted(() => vi.fn());
const getPO = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  listPOs,
  listSuppliers,
  getPO,
  deletePO: vi.fn(),
  approvePO: vi.fn(),
  requestApproval: vi.fn(),
  poPdfUrl: vi.fn(() => '/pdf'),
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

import POList from './POList';

describe('POList focus drawer mount', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    listPOs.mockResolvedValue({
      items: [
        {
          poNumber: 'S0001',
          status: 'Draft',
          approval: { status: 'Draft' },
          supplierSnapshot: { name: 'Test Supplier' },
        },
      ],
    });
    listSuppliers.mockResolvedValue([]);
    getPO.mockResolvedValue({
      poNumber: 'S0001',
      status: 'Draft',
      approval: { status: 'Draft' },
      supplierId: 'sup-1',
      supplierSnapshot: { name: 'Test Supplier' },
      items: [],
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it('opens the review drawer from focusPoNumber without throwing', async () => {
    act(() => {
      root.render(
        <POList focusPoNumber="S0001" onFocusHandled={vi.fn()} />
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('S0001');
  });
});
