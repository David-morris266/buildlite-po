import { describe, expect, it } from 'vitest';
import {
  BATCH_APPROVAL_DOMAINS,
  BATCH_APPROVAL_STATUS,
  createBatchApprovalItem,
} from './approvalTypes';

describe('batch approval preparation', () => {
  it('creates queue items with domain and status metadata', () => {
    const item = createBatchApprovalItem({
      id: 'cert-1',
      domain: BATCH_APPROVAL_DOMAINS.PAYMENT_CERTIFICATE,
      title: 'Certificate 3 — Brickwork',
      subtitle: 'Riverside Phase 2',
      amount: 12500,
      status: BATCH_APPROVAL_STATUS.PENDING,
      meta: { orderKey: 'pkg-1' },
    });

    expect(item.domain).toBe(BATCH_APPROVAL_DOMAINS.PAYMENT_CERTIFICATE);
    expect(item.status).toBe(BATCH_APPROVAL_STATUS.PENDING);
    expect(item.amount).toBe(12500);
    expect(item.meta.orderKey).toBe('pkg-1');
  });
});
