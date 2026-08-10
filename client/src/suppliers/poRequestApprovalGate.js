/**
 * BL-025.5 — Supplier approval gate for PO request-approval workflows.
 */

import { canSendPoForApproval } from '../setup/setupDraft';
import { isSupplierApproved } from './supplierApproval';
import {
  pickSupplierById,
  shouldUseLiveSupplierMaster,
} from './supplierMasterSync';

export const PO_SAVED_DRAFT_SUPPLIER_PENDING_MESSAGE =
  'Purchase Order saved as Draft. The supplier must be approved before this order can be sent for approval.';

export const PO_REQUEST_APPROVAL_SUPPLIER_PENDING_MESSAGE =
  'The supplier must be approved before this order can be sent for approval.';

/** Mirrors server assertSupplierApprovedForPoRequestApproval. */
export function mirrorServerPoRequestApprovalSupplierGate(supplier) {
  if (!supplier || isSupplierApproved(supplier)) return null;
  return { message: PO_REQUEST_APPROVAL_SUPPLIER_PENDING_MESSAGE };
}

export function resolvePoLinkedSupplier(po, suppliers = []) {
  const supplierId = po?.supplierId || po?.supplierSnapshot?.id;
  if (!supplierId) return null;

  if (shouldUseLiveSupplierMaster(po)) {
    return pickSupplierById(suppliers, supplierId) || po.supplierSnapshot || null;
  }

  return po.supplierSnapshot || pickSupplierById(suppliers, supplierId) || null;
}

export function isPoSupplierApprovalOutstanding(po, supplier) {
  if (!po) return false;
  const poStatus = String(po.status || '').toLowerCase();
  const approvalStatus = String(po.approval?.status || '').toLowerCase();
  const isDraftLike =
    poStatus === 'draft' ||
    approvalStatus === 'draft' ||
    poStatus === 'rejected' ||
    approvalStatus === 'rejected';

  if (!isDraftLike) return false;

  const linked = supplier || resolvePoLinkedSupplier(po, []);
  return linked ? !isSupplierApproved(linked) : false;
}

export function canSendPoForApprovalWithSupplier(po, supplier) {
  if (!canSendPoForApproval(po)) return false;
  const linked = supplier ?? resolvePoLinkedSupplier(po, []);
  if (!linked) return true;
  return isSupplierApproved(linked);
}

export async function executePoSaveAndSendWorkflow({
  supplier,
  persistDraft,
  requestApproval,
  buildRequestApprovalBody,
}) {
  const po = await persistDraft();
  const poNumber = po?.poNumber;
  if (!poNumber) {
    throw new Error('PO number missing after save');
  }

  if (supplier && !isSupplierApproved(supplier)) {
    return {
      outcome: 'saved-draft-supplier-pending',
      po,
      poNumber,
      message: PO_SAVED_DRAFT_SUPPLIER_PENDING_MESSAGE,
    };
  }

  await requestApproval(poNumber, buildRequestApprovalBody());
  return {
    outcome: 'sent-for-approval',
    po,
    poNumber,
  };
}

export async function executePoRequestApprovalFromDraft({
  poNumber,
  supplier,
  requestApproval,
  buildRequestApprovalBody,
}) {
  const block = mirrorServerPoRequestApprovalSupplierGate(supplier);
  if (block) {
    const error = new Error(block.message);
    error.code = 'SUPPLIER_PENDING';
    throw error;
  }

  return requestApproval(poNumber, buildRequestApprovalBody());
}
