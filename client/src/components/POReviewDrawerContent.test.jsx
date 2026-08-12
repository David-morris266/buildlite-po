/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import POReviewDrawerContent from './POReviewDrawerContent';

const drawerSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'POReviewDrawerContent.jsx'),
  'utf8'
);

vi.mock('../suppliers/usePoReviewLiveSupplier', () => ({
  usePoReviewLiveSupplier: vi.fn(() => ({
    supplier: null,
    loading: false,
    error: false,
  })),
}));

vi.mock('./OrderMatrixDrawerSection', () => ({
  default: () => null,
}));

import { usePoReviewLiveSupplier } from '../suppliers/usePoReviewLiveSupplier';

const basePo = {
  poNumber: 'S0001',
  items: [],
  supplierSnapshot: { id: 'sup-1', name: 'Test Supplier' },
};

describe('POReviewDrawerContent render stability', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    usePoReviewLiveSupplier.mockReturnValue({
      supplier: null,
      loading: false,
      error: false,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  function renderDrawer(po, props = {}) {
    act(() => {
      root.render(
        <POReviewDrawerContent
          po={po}
          onClose={vi.fn()}
          {...props}
        />
      );
    });
  }

  it('renders a Draft PO without throwing', () => {
    renderDrawer({
      ...basePo,
      status: 'Draft',
      approval: { status: 'Draft' },
      supplierId: 'sup-1',
    });

    expect(document.body.textContent).toContain('S0001');
  });

  it('renders a pending supplier PO with supplier gating intact', () => {
    usePoReviewLiveSupplier.mockReturnValue({
      supplier: {
        id: 'sup-1',
        name: 'Pending Supplier',
        approvalStatus: 'pending',
        approvedSupplier: false,
      },
      loading: false,
      error: false,
    });

    renderDrawer({
      ...basePo,
      status: 'Draft',
      approval: { status: 'Draft' },
      supplierId: 'sup-1',
    });

    expect(document.body.textContent).toContain(
      'Supplier is pending approval'
    );
  });

  it('renders an approved supplier PO without throwing', () => {
    usePoReviewLiveSupplier.mockReturnValue({
      supplier: {
        id: 'sup-1',
        name: 'Approved Supplier',
        approvalStatus: 'approved',
        approvedSupplier: true,
      },
      loading: false,
      error: false,
    });

    renderDrawer({
      ...basePo,
      status: 'Issued',
      approval: { status: 'Pending' },
      supplierId: 'sup-1',
    });

    expect(document.body.textContent).toContain('S0001');
    expect(document.body.textContent).not.toContain(
      'Supplier is pending approval'
    );
  });

  it('declares supplier approval state before showSendForApproval', () => {
    const supplierStateIndex = drawerSource.indexOf(
      '} = resolvePoReviewSupplierApprovalState'
    );
    const showSendIndex = drawerSource.indexOf('const showSendForApproval');

    expect(supplierStateIndex).toBeGreaterThan(-1);
    expect(showSendIndex).toBeGreaterThan(-1);
    expect(supplierStateIndex).toBeLessThan(showSendIndex);
  });
});
