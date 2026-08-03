import { describe, expect, it, vi } from 'vitest';
import { isSupplierApproved } from './supplierApproval';
import {
  createAsyncSequenceGuard,
  mirrorServerPoApprovalSupplierGate,
  pickSupplierById,
  resolveDraftPoSelectedSupplier,
  resolveLatestSupplierList,
  resolveLiveSupplier,
  resolvePoReviewSupplierApprovalState,
  shouldResolveLiveSupplierForPoApproval,
  shouldUseLiveSupplierMaster,
  simulateSupplierSelectionRace,
} from './supplierMasterSync';
import {
  notifyMasterDataChanged,
  subscribeMasterDataChanged,
} from '../admin/masterDataEvents';

describe('supplierMasterSync', () => {
  it('uses live supplier master for new and draft PO contexts', () => {
    expect(shouldUseLiveSupplierMaster(null)).toBe(true);
    expect(shouldUseLiveSupplierMaster({})).toBe(true);
    expect(
      shouldUseLiveSupplierMaster({
        poNumber: 'PO-000001',
        status: 'Draft',
        approval: { status: 'Draft' },
      })
    ).toBe(true);
    expect(
      shouldUseLiveSupplierMaster({
        poNumber: 'PO-000002',
        status: 'Rejected',
        approval: { status: 'Rejected' },
      })
    ).toBe(true);
  });

  it('keeps issued and approved POs on historical supplier snapshots', () => {
    expect(
      shouldUseLiveSupplierMaster({
        poNumber: 'PO-000003',
        status: 'Issued',
        approval: { status: 'Pending' },
      })
    ).toBe(false);
    expect(
      shouldUseLiveSupplierMaster({
        poNumber: 'PO-000004',
        status: 'Approved',
        approval: { status: 'Approved' },
      })
    ).toBe(false);
  });

  it('resolves a supplier from the live master list by id', async () => {
    const listFn = vi.fn().mockResolvedValue([
      { id: 'sup-1', name: 'Alpha', approvalStatus: 'pending' },
      { id: 'sup-2', name: 'Beta', approvalStatus: 'approved', approvedSupplier: true },
    ]);

    const pending = await resolveLiveSupplier('sup-1', listFn);
    const approved = await resolveLiveSupplier('sup-2', listFn);

    expect(listFn).toHaveBeenCalledWith('');
    expect(pending.name).toBe('Alpha');
    expect(isSupplierApproved(pending)).toBe(false);
    expect(isSupplierApproved(approved)).toBe(true);
  });

  it('picks suppliers from an in-memory list', () => {
    const suppliers = [{ id: 'sup-9', name: 'Gamma' }];
    expect(pickSupplierById(suppliers, 'sup-9')?.name).toBe('Gamma');
    expect(pickSupplierById(suppliers, 'missing')).toBeNull();
  });
});

describe('masterDataEvents supplier broadcast', () => {
  it('notifies supplier listeners when master data changes', () => {
    const seen = [];
    const unsubscribe = subscribeMasterDataChanged((scope) => {
      seen.push(scope);
    });

    notifyMasterDataChanged('suppliers');
    unsubscribe();

    expect(seen).toEqual(['suppliers']);
  });
});

describe('draft PO supplier approval reconciliation', () => {
  it('allows Save & Send once live master is approved even if snapshot was pending', () => {
    const staleSnapshot = {
      id: 'sup-1',
      name: 'Inline Supplier',
      approvalStatus: 'pending',
      approvedSupplier: false,
    };
    const liveMaster = {
      id: 'sup-1',
      name: 'Inline Supplier',
      approvalStatus: 'approved',
      approvedSupplier: true,
    };

    const draftPo = {
      poNumber: 'PO-000010',
      status: 'Draft',
      supplierId: 'sup-1',
      supplierSnapshot: staleSnapshot,
    };

    expect(shouldUseLiveSupplierMaster(draftPo)).toBe(true);
    expect(isSupplierApproved(staleSnapshot)).toBe(false);
    expect(isSupplierApproved(liveMaster)).toBe(true);
  });

  it('does not override issued PO audit snapshots with live master rules', () => {
    const issuedPo = {
      poNumber: 'PO-000011',
      status: 'Issued',
      approval: { status: 'Pending' },
      supplierId: 'sup-1',
      supplierSnapshot: {
        id: 'sup-1',
        approvalStatus: 'pending',
        approvedSupplier: false,
      },
    };

    expect(shouldUseLiveSupplierMaster(issuedPo)).toBe(false);
  });
});

describe('BL-021A.2 supplier approval race conditions', () => {
  const staleSnapshot = {
    id: 'sup-1',
    name: 'Inline Supplier',
    approvalStatus: 'pending',
    approvedSupplier: false,
  };
  const liveApproved = {
    id: 'sup-1',
    name: 'Inline Supplier',
    approvalStatus: 'approved',
    approvedSupplier: true,
  };

  it('documents the stale snapshot overwrite that caused intermittent failure', () => {
    let selectedSupplier = staleSnapshot;
    selectedSupplier = liveApproved;
    selectedSupplier = staleSnapshot;

    expect(isSupplierApproved(selectedSupplier)).toBe(false);
  });

  it('keeps approved live master when draft hydration reruns after live sync', () => {
    const result = simulateSupplierSelectionRace({
      initialSnapshot: staleSnapshot,
      liveSupplier: liveApproved,
      hydrationRunsAfterLiveSync: true,
    });

    expect(result.isApproved).toBe(true);
    expect(result.selectedSupplier).toEqual(liveApproved);
  });

  it('does not hydrate draft selectedSupplier from supplierSnapshot', () => {
    const draftPo = {
      poNumber: 'PO-000020',
      status: 'Draft',
      supplierSnapshot: staleSnapshot,
    };

    expect(resolveDraftPoSelectedSupplier(draftPo, null)).toBeNull();
    expect(resolveDraftPoSelectedSupplier(draftPo, liveApproved)).toEqual(liveApproved);
    expect(
      resolveDraftPoSelectedSupplier(
        {
          poNumber: 'PO-000021',
          status: 'Issued',
          approval: { status: 'Pending' },
          supplierSnapshot: staleSnapshot,
        },
        liveApproved
      )
    ).toEqual(staleSnapshot);
  });

  it('ignores stale listSuppliers responses when a newer fetch completes first', async () => {
    const guard = createAsyncSequenceGuard();
    const pendingList = [{ id: 'sup-1', approvalStatus: 'pending', approvedSupplier: false }];
    const approvedList = [{ id: 'sup-1', approvalStatus: 'approved', approvedSupplier: true }];

    const olderToken = guard.next();
    const newerToken = guard.next();

    const winner = await resolveLatestSupplierList(
      [
        { token: newerToken, suppliers: approvedList, delayMs: 0 },
        { token: olderToken, suppliers: pendingList, delayMs: 10 },
      ],
      guard
    );

    expect(winner?.applied).toBe(true);
    expect(isSupplierApproved(pickSupplierById(winner.suppliers, 'sup-1'))).toBe(true);
  });

  it('invalidates in-flight supplier sync tokens on unmount cleanup', () => {
    const guard = createAsyncSequenceGuard();
    const token = guard.next();
    guard.invalidate();
    expect(guard.isCurrent(token)).toBe(false);
  });
});

describe('BL-021A.3 PO review drawer live supplier approval', () => {
  const staleSnapshot = {
    id: 'sup-1',
    name: 'Inline Supplier',
    approvalStatus: 'pending',
    approvedSupplier: false,
  };
  const liveApproved = {
    id: 'sup-1',
    name: 'Inline Supplier',
    approvalStatus: 'approved',
    approvedSupplier: true,
  };
  const livePending = {
    id: 'sup-1',
    name: 'Inline Supplier',
    approvalStatus: 'pending',
    approvedSupplier: false,
  };

  const pendingReviewPo = {
    poNumber: 'S0004',
    status: 'Issued',
    approval: { status: 'Pending' },
    supplierId: 'sup-1',
    supplierSnapshot: staleSnapshot,
  };

  const approvedHistoricalPo = {
    poNumber: 'S0005',
    status: 'Approved',
    approval: { status: 'Approved' },
    supplierId: 'sup-1',
    supplierSnapshot: staleSnapshot,
  };

  it('identifies issued/pending POs that require live supplier master', () => {
    expect(shouldResolveLiveSupplierForPoApproval(pendingReviewPo)).toBe(true);
    expect(shouldResolveLiveSupplierForPoApproval(approvedHistoricalPo)).toBe(false);
  });

  it('enables Approve when snapshot is pending but live supplier is approved', () => {
    const state = resolvePoReviewSupplierApprovalState(pendingReviewPo, {
      supplier: liveApproved,
      loading: false,
      error: false,
    });

    expect(state.supplierPendingApproval).toBe(false);
    expect(state.approveDisabled).toBe(false);
    expect(state.supplierApprovalLoading).toBe(false);
  });

  it('disables Approve when snapshot and live supplier are both pending', () => {
    const state = resolvePoReviewSupplierApprovalState(pendingReviewPo, {
      supplier: livePending,
      loading: false,
      error: false,
    });

    expect(state.supplierPendingApproval).toBe(true);
    expect(state.approveDisabled).toBe(true);
  });

  it('shows loading without treating unknown supplier as pending', () => {
    const state = resolvePoReviewSupplierApprovalState(pendingReviewPo, {
      loading: true,
    });

    expect(state.supplierPendingApproval).toBe(false);
    expect(state.supplierApprovalLoading).toBe(true);
    expect(state.approveDisabled).toBe(true);
  });

  it('blocks Approve on supplier lookup failure without silently approving', () => {
    const missing = resolvePoReviewSupplierApprovalState(pendingReviewPo, {
      supplier: null,
      loading: false,
      error: false,
    });
    const failed = resolvePoReviewSupplierApprovalState(pendingReviewPo, {
      loading: false,
      error: true,
    });

    expect(missing.supplierLookupFailed).toBe(true);
    expect(missing.approveDisabled).toBe(true);
    expect(failed.supplierLookupFailed).toBe(true);
    expect(failed.approveDisabled).toBe(true);
  });

  it('uses supplierSnapshot for approved historical PO display eligibility', () => {
    const state = resolvePoReviewSupplierApprovalState(approvedHistoricalPo, {
      supplier: liveApproved,
      loading: false,
      error: false,
    });

    expect(state.supplierPendingApproval).toBe(true);
    expect(state.approveDisabled).toBe(true);
  });

  it('picks up newly approved live master after Admin refresh', async () => {
    const listFn = vi
      .fn()
      .mockResolvedValueOnce([livePending])
      .mockResolvedValueOnce([liveApproved]);

    const firstLive = await resolveLiveSupplier('sup-1', listFn);
    const firstState = resolvePoReviewSupplierApprovalState(pendingReviewPo, {
      supplier: firstLive,
      loading: false,
      error: false,
    });

    const secondLive = await resolveLiveSupplier('sup-1', listFn);
    const secondState = resolvePoReviewSupplierApprovalState(pendingReviewPo, {
      supplier: secondLive,
      loading: false,
      error: false,
    });

    expect(firstState.approveDisabled).toBe(true);
    expect(secondState.approveDisabled).toBe(false);
    expect(listFn).toHaveBeenCalledTimes(2);
  });

  it('notifies supplier listeners when master data changes for drawer refresh', () => {
    const seen = [];
    const unsubscribe = subscribeMasterDataChanged((scope) => {
      seen.push(scope);
    });

    notifyMasterDataChanged('suppliers');
    unsubscribe();

    expect(seen).toEqual(['suppliers']);
  });

  it('mirrors server PO approval supplier gate for genuinely pending suppliers', () => {
    expect(mirrorServerPoApprovalSupplierGate(livePending)).toEqual({
      message:
        'This supplier is pending approval. Approve the supplier in Administration before approving this Purchase Order.',
    });
    expect(mirrorServerPoApprovalSupplierGate(liveApproved)).toBeNull();
  });
});
