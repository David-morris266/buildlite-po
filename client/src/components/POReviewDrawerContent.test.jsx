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

  it('describes Approved PO terms as an immutable approval-time binding', () => {
    renderDrawer({
      ...basePo,
      status: 'Approved',
      approval: { status: 'Approved' },
      governingTerms: {
        state: 'bound',
        source: 'tenant_default',
        version: {
          familyName: 'Standard Subcontract Terms',
          versionLabel: 'Standard 2026',
          revisionNumber: 1,
        },
      },
    });

    expect(document.body.textContent).toContain('Bound contract terms');
    expect(document.body.textContent).toContain('Standard Subcontract Terms · Standard 2026 · Revision 1');
    expect(document.body.textContent).toContain('Source at approval');
    expect(document.body.textContent).toContain('Company default');
    expect(document.body.textContent).not.toContain('Resolved source');
  });

  it('retains live-resolution wording for a Pending Approval PO', () => {
    renderDrawer({
      ...basePo,
      status: 'Pending Approval',
      approval: { status: 'Pending' },
      governingTerms: {
        state: 'proposed',
        source: 'tenant_default',
        version: {
          familyName: 'Standard Subcontract Terms',
          versionLabel: 'Standard 2026 v2',
          revisionNumber: 2,
        },
      },
    });

    expect(document.body.textContent).toContain('Proposed governing terms');
    expect(document.body.textContent).toContain('Resolved source');
    expect(document.body.textContent).toContain('Company default');
  });

  it('retains neutral legacy wording', () => {
    renderDrawer({
      ...basePo,
      status: 'Approved',
      approval: { status: 'Approved' },
      governingTerms: { state: 'legacy', source: 'unconfigured', version: null },
    });

    expect(document.body.textContent).toContain('Legacy / not formally configured');
  });
});
