/**
 * BL-017A — Shared approval types for batch approval preparation.
 */

export const BATCH_APPROVAL_DOMAINS = {
  PAYMENT_CERTIFICATE: 'payment-certificate',
  PURCHASE_ORDER: 'purchase-order',
};

export const BATCH_APPROVAL_STATUS = {
  PENDING: 'pending',
  SELECTED: 'selected',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

export function createBatchApprovalItem({
  id,
  domain,
  title,
  subtitle = '',
  amount = null,
  status = BATCH_APPROVAL_STATUS.PENDING,
  meta = {},
}) {
  return {
    id,
    domain,
    title,
    subtitle,
    amount,
    status,
    meta,
  };
}
