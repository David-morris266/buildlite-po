/**
 * BL-021A.1 / BL-021A.2 — Live supplier master resolution for draft PO workflows.
 */

import { listSuppliers } from '../api';
import { isSupplierApproved } from './supplierApproval';

/**
 * Issued POs awaiting approval use live supplier master for Approve eligibility.
 */
export function shouldResolveLiveSupplierForPoApproval(po) {
  if (!po) return false;
  const status = String(po.status || '').toLowerCase();
  const approvalStatus = String(po.approval?.status || '').toLowerCase();
  return status === 'issued' && approvalStatus === 'pending';
}

/**
 * Resolve supplier approval gating for POReviewDrawerContent.
 * Pending Issued POs use live master; historical POs use supplierSnapshot only.
 */
export function resolvePoReviewSupplierApprovalState(
  po,
  { supplier = null, loading = false, error = false } = {}
) {
  if (shouldResolveLiveSupplierForPoApproval(po)) {
    if (loading) {
      return {
        supplierPendingApproval: false,
        supplierApprovalLoading: true,
        supplierLookupFailed: false,
        approveDisabled: true,
      };
    }
    if (error || !supplier) {
      return {
        supplierPendingApproval: false,
        supplierApprovalLoading: false,
        supplierLookupFailed: true,
        approveDisabled: true,
      };
    }
    const supplierPendingApproval = !isSupplierApproved(supplier);
    return {
      supplierPendingApproval,
      supplierApprovalLoading: false,
      supplierLookupFailed: false,
      approveDisabled: supplierPendingApproval,
    };
  }

  const supplierPendingApproval = Boolean(
    po?.supplierSnapshot && !isSupplierApproved(po.supplierSnapshot)
  );
  return {
    supplierPendingApproval,
    supplierApprovalLoading: false,
    supplierLookupFailed: false,
    approveDisabled: supplierPendingApproval,
  };
}

/**
 * Mirrors server/routes/poRoutes.js assertSupplierApprovedForPoApproval.
 */
export function mirrorServerPoApprovalSupplierGate(supplier) {
  if (!supplier) return null;
  const pending =
    supplier.approvalStatus === 'pending' || supplier.approvedSupplier === false;
  if (!pending) return null;
  return {
    message:
      'This supplier is pending approval. Approve the supplier in Administration before approving this Purchase Order.',
  };
}

/**
 * Draft and rejected POs use live supplier master approval status.
 * Approved / historical issued POs retain supplierSnapshot for audit.
 */
export function shouldUseLiveSupplierMaster(po) {
  if (!po || !po.poNumber) return true;

  const status = String(po.status || '').toLowerCase();
  const approvalStatus = String(po.approval?.status || '').toLowerCase();

  if (status === 'draft' || approvalStatus === 'draft') return true;
  if (status === 'rejected' || approvalStatus === 'rejected') return true;

  return false;
}

export function pickSupplierById(suppliers, supplierId) {
  if (!supplierId) return null;
  return (
    (suppliers || []).find((item) => String(item.id) === String(supplierId)) || null
  );
}

export async function resolveLiveSupplier(supplierId, listFn = listSuppliers) {
  if (!supplierId) return null;
  const suppliers = await listFn('');
  return pickSupplierById(suppliers, supplierId);
}

/** Ignore out-of-order async supplier list responses (BL-021A.2). */
export function createAsyncSequenceGuard() {
  let generation = 0;
  return {
    next() {
      generation += 1;
      return generation;
    },
    isCurrent(token) {
      return token === generation;
    },
    invalidate() {
      generation += 1;
    },
  };
}

/**
 * Draft PO hydration must not copy a stale supplierSnapshot into selectedSupplier.
 * Issued POs keep the persisted snapshot for audit.
 */
export function resolveDraftPoSelectedSupplier(initialPo, liveSupplier) {
  if (!shouldUseLiveSupplierMaster(initialPo)) {
    return initialPo?.supplierSnapshot || null;
  }
  return liveSupplier || null;
}

/**
 * Simulates POForm state updates to expose hydration-vs-live-sync ordering bugs.
 * Returns the final selectedSupplier approval status after the sequence completes.
 */
export function simulateSupplierSelectionRace({
  initialSnapshot,
  liveSupplier,
  hydrationRunsAfterLiveSync = false,
}) {
  let selectedSupplier = null;
  const draftPo = {
    poNumber: 'PO-000001',
    status: 'Draft',
    supplierSnapshot: initialSnapshot,
  };

  function hydrateFromInitialPo() {
    if (!shouldUseLiveSupplierMaster(draftPo)) {
      selectedSupplier = draftPo.supplierSnapshot || null;
    }
  }

  function applyLiveSync() {
    selectedSupplier = liveSupplier || null;
  }

  if (hydrationRunsAfterLiveSync) {
    applyLiveSync();
    hydrateFromInitialPo();
  } else {
    hydrateFromInitialPo();
    applyLiveSync();
  }

  return {
    selectedSupplier,
    isApproved: isSupplierApproved(selectedSupplier),
  };
}

/**
 * Simulates overlapping listSuppliers responses; only the latest token may commit.
 */
export async function resolveLatestSupplierList(fetchCalls, sequenceGuard) {
  const results = await Promise.all(
    fetchCalls.map(async ({ token, suppliers, delayMs = 0 }) => {
      if (delayMs) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (!sequenceGuard.isCurrent(token)) {
        return { token, applied: false, suppliers: null };
      }
      return { token, applied: true, suppliers };
    })
  );

  return results.filter((result) => result.applied).pop() || null;
}
