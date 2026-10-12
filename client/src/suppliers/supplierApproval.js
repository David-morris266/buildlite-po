/**
 * BL-017A — Supplier approval workflow helpers.
 */

export const SUPPLIER_APPROVAL_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
};

export function getSupplierApprovalStatus(supplier) {
  if (!supplier) return SUPPLIER_APPROVAL_STATUS.APPROVED;
  const status = String(supplier.approvalStatus || '').trim().toLowerCase();
  if (!status && (supplier.approvedSupplier == null || supplier.approvedSupplier === true)) {
    return SUPPLIER_APPROVAL_STATUS.APPROVED;
  }
  if (status === SUPPLIER_APPROVAL_STATUS.APPROVED && supplier.approvedSupplier === true) {
    return SUPPLIER_APPROVAL_STATUS.APPROVED;
  }
  if (status === SUPPLIER_APPROVAL_STATUS.PENDING && supplier.approvedSupplier !== true) {
    return SUPPLIER_APPROVAL_STATUS.PENDING;
  }
  return SUPPLIER_APPROVAL_STATUS.PENDING;
}

export function hasInvalidSupplierApprovalEvidence(supplier) {
  if (!supplier) return false;
  const status = String(supplier.approvalStatus || '').trim().toLowerCase();
  const legacyApproved = !status
    && (supplier.approvedSupplier == null || supplier.approvedSupplier === true);
  const pending = status === SUPPLIER_APPROVAL_STATUS.PENDING
    && supplier.approvedSupplier !== true;
  const approved = status === SUPPLIER_APPROVAL_STATUS.APPROVED
    && supplier.approvedSupplier === true;
  return !legacyApproved && !pending && !approved;
}

export function isSupplierApproved(supplier) {
  return getSupplierApprovalStatus(supplier) === SUPPLIER_APPROVAL_STATUS.APPROVED;
}

export function getSupplierApprovalBadge(supplier) {
  if (hasInvalidSupplierApprovalEvidence(supplier)) {
    return { label: 'Approval evidence requires review', modifier: 'warning' };
  }
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
