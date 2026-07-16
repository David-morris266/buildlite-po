/**
 * BL-017A — Supplier approval workflow helpers.
 */

export const SUPPLIER_APPROVAL_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
};

export function getSupplierApprovalStatus(supplier) {
  if (!supplier) return SUPPLIER_APPROVAL_STATUS.APPROVED;
  if (supplier.approvalStatus === SUPPLIER_APPROVAL_STATUS.PENDING) {
    return SUPPLIER_APPROVAL_STATUS.PENDING;
  }
  if (supplier.approvedSupplier === false) {
    return SUPPLIER_APPROVAL_STATUS.PENDING;
  }
  return SUPPLIER_APPROVAL_STATUS.APPROVED;
}

export function isSupplierApproved(supplier) {
  return getSupplierApprovalStatus(supplier) === SUPPLIER_APPROVAL_STATUS.APPROVED;
}

export function getSupplierApprovalBadge(supplier) {
  const status = getSupplierApprovalStatus(supplier);
  if (status === SUPPLIER_APPROVAL_STATUS.PENDING) {
    return { label: 'Pending Supplier', modifier: 'pending' };
  }
  return { label: 'Approved', modifier: 'approved' };
}

export function appendSupplierApprovalHistory(supplier, action, by = '', note = '') {
  const history = Array.isArray(supplier?.approvalHistory)
    ? [...supplier.approvalHistory]
    : [];

  history.push({
    at: new Date().toISOString(),
    by: String(by || '').trim(),
    action,
    note: String(note || '').trim(),
  });

  return history;
}

export function buildSupplierCreatePayload(form, { createdFromPo = false } = {}) {
  const payload = { ...form };

  if (createdFromPo) {
    payload.pendingApproval = true;
    payload.createdFromPo = true;
    payload.approvedSupplier = false;
    payload.approvalStatus = SUPPLIER_APPROVAL_STATUS.PENDING;
  }

  return payload;
}

export function formatSupplierApprovalAction(action) {
  const labels = {
    CREATED_PENDING: 'Created — pending approval',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    UPDATED: 'Updated',
  };
  return labels[action] || action;
}
