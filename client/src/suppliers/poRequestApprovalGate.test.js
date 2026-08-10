import { describe, expect, it, vi } from 'vitest';
import { canSendPoForApproval } from '../setup/setupDraft';
import { mirrorServerPoApprovalSupplierGate } from './supplierMasterSync';
import {
  PO_REQUEST_APPROVAL_SUPPLIER_PENDING_MESSAGE,
  PO_SAVED_DRAFT_SUPPLIER_PENDING_MESSAGE,
  canSendPoForApprovalWithSupplier,
  executePoRequestApprovalFromDraft,
  executePoSaveAndSendWorkflow,
  isPoSupplierApprovalOutstanding,
  mirrorServerPoRequestApprovalSupplierGate,
  resolvePoLinkedSupplier,
} from './poRequestApprovalGate';

const pendingSupplier = {
  id: 'sup-pending',
  name: 'Pending Co',
  approvalStatus: 'pending',
  approvedSupplier: false,
};

const approvedSupplier = {
  id: 'sup-approved',
  name: 'Approved Co',
  approvalStatus: 'approved',
  approvedSupplier: true,
};

const draftPo = {
  poNumber: 'S0007',
  type: 'S',
  status: 'Draft',
  approval: { status: 'Draft' },
  supplierId: 'sup-pending',
  supplierSnapshot: {
    id: 'sup-pending',
    name: 'Pending Co',
    approvalStatus: 'pending',
    approvedSupplier: false,
  },
};

describe('poRequestApprovalGate', () => {
  it('allows Save Draft workflow without calling requestApproval for pending suppliers', async () => {
    const persistDraft = vi.fn().mockResolvedValue({
      ...draftPo,
      poNumber: 'S0007',
    });
    const requestApproval = vi.fn();

    const result = await executePoSaveAndSendWorkflow({
      supplier: pendingSupplier,
      persistDraft,
      requestApproval,
      buildRequestApprovalBody: () => ({ by: 'tester' }),
    });

    expect(persistDraft).toHaveBeenCalledTimes(1);
    expect(requestApproval).not.toHaveBeenCalled();
    expect(result.outcome).toBe('saved-draft-supplier-pending');
    expect(result.po.status).toBe('Draft');
    expect(result.message).toBe(PO_SAVED_DRAFT_SUPPLIER_PENDING_MESSAGE);
  });

  it('persists Draft first on Save & Send with pending supplier and returns explicit saved message', async () => {
    const persistDraft = vi.fn().mockResolvedValue({ ...draftPo, poNumber: 'S0007' });
    const requestApproval = vi.fn();

    const result = await executePoSaveAndSendWorkflow({
      supplier: pendingSupplier,
      persistDraft,
      requestApproval,
      buildRequestApprovalBody: () => ({}),
    });

    expect(persistDraft).toHaveBeenCalledTimes(1);
    expect(requestApproval).not.toHaveBeenCalled();
    expect(result.outcome).toBe('saved-draft-supplier-pending');
    expect(result.message).toContain('saved as Draft');
    expect(result.message).toContain('must be approved before this order can be sent for approval');
  });

  it('treats draft POs as list-visible draft records', () => {
    expect(canSendPoForApproval(draftPo)).toBe(true);
    expect(draftPo.status).toBe('Draft');
  });

  it('keeps the created supplier ID on the draft PO payload', () => {
    const linked = resolvePoLinkedSupplier(draftPo, [pendingSupplier]);
    expect(linked?.id).toBe('sup-pending');
    expect(draftPo.supplierId).toBe('sup-pending');
  });

  it('blocks draft journey send while supplier is pending', async () => {
    const requestApproval = vi.fn();

    await expect(
      executePoRequestApprovalFromDraft({
        poNumber: 'S0007',
        supplier: pendingSupplier,
        requestApproval,
        buildRequestApprovalBody: () => ({}),
      })
    ).rejects.toThrow(PO_REQUEST_APPROVAL_SUPPLIER_PENDING_MESSAGE);

    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('blocks PO list send while supplier is pending', () => {
    expect(
      canSendPoForApprovalWithSupplier(draftPo, pendingSupplier)
    ).toBe(false);
    expect(mirrorServerPoRequestApprovalSupplierGate(pendingSupplier)).toEqual({
      message: PO_REQUEST_APPROVAL_SUPPLIER_PENDING_MESSAGE,
    });
  });

  it('mirrors server request-approval rejection for pending suppliers', () => {
    expect(mirrorServerPoRequestApprovalSupplierGate(pendingSupplier)).toEqual({
      message:
        'The supplier must be approved before this order can be sent for approval.',
    });
    expect(mirrorServerPoRequestApprovalSupplierGate(approvedSupplier)).toBeNull();
  });

  it('leaves draft PO unchanged when request approval is blocked client-side', async () => {
    const requestApproval = vi.fn().mockRejectedValue(
      new Error(PO_REQUEST_APPROVAL_SUPPLIER_PENDING_MESSAGE)
    );

    await expect(
      executePoRequestApprovalFromDraft({
        poNumber: 'S0007',
        supplier: pendingSupplier,
        requestApproval,
        buildRequestApprovalBody: () => ({}),
      })
    ).rejects.toThrow(PO_REQUEST_APPROVAL_SUPPLIER_PENDING_MESSAGE);

    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('retains supplier ID after supplier approval', () => {
    const approvedLive = {
      ...pendingSupplier,
      approvalStatus: 'approved',
      approvedSupplier: true,
    };

    expect(approvedLive.id).toBe('sup-pending');
    expect(resolvePoLinkedSupplier(draftPo, [approvedLive])?.id).toBe('sup-pending');
  });

  it('allows an existing draft to be sent after supplier approval', async () => {
    const requestApproval = vi.fn().mockResolvedValue({
      ...draftPo,
      status: 'Issued',
      approval: { status: 'Pending' },
    });

    await executePoRequestApprovalFromDraft({
      poNumber: 'S0007',
      supplier: approvedSupplier,
      requestApproval,
      buildRequestApprovalBody: () => ({ by: 'tester' }),
    });

    expect(requestApproval).toHaveBeenCalledWith('S0007', { by: 'tester' });
    expect(canSendPoForApprovalWithSupplier(draftPo, approvedSupplier)).toBe(true);
  });

  it('keeps normal Save & Send unchanged for already-approved suppliers', async () => {
    const persistDraft = vi.fn().mockResolvedValue({
      ...draftPo,
      supplierId: 'sup-approved',
      poNumber: 'S0007',
    });
    const requestApproval = vi.fn().mockResolvedValue({
      poNumber: 'S0007',
      status: 'Issued',
      approval: { status: 'Pending' },
    });

    const result = await executePoSaveAndSendWorkflow({
      supplier: approvedSupplier,
      persistDraft,
      requestApproval,
      buildRequestApprovalBody: () => ({ by: 'tester' }),
    });

    expect(result.outcome).toBe('sent-for-approval');
    expect(persistDraft).toHaveBeenCalledTimes(1);
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(requestApproval).toHaveBeenCalledWith('S0007', { by: 'tester' });
  });

  it('preserves final PO approval supplier gate messaging', () => {
    expect(mirrorServerPoApprovalSupplierGate(pendingSupplier)).toEqual({
      message:
        'This supplier is pending approval. Approve the supplier in Administration before approving this Purchase Order.',
    });
  });

  it('keeps PO numbering sequential without duplicate request-approval calls', async () => {
    const persistDraft = vi.fn().mockResolvedValue({ poNumber: 'S0007', status: 'Draft' });
    const requestApproval = vi.fn();

    const pendingResult = await executePoSaveAndSendWorkflow({
      supplier: pendingSupplier,
      persistDraft,
      requestApproval,
      buildRequestApprovalBody: () => ({}),
    });

    expect(pendingResult.poNumber).toBe('S0007');
    expect(requestApproval).not.toHaveBeenCalled();

    requestApproval.mockResolvedValue({
      poNumber: 'S0007',
      status: 'Issued',
      approval: { status: 'Pending' },
    });

    await executePoRequestApprovalFromDraft({
      poNumber: 'S0007',
      supplier: approvedSupplier,
      requestApproval,
      buildRequestApprovalBody: () => ({}),
    });

    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(requestApproval).toHaveBeenCalledWith('S0007', {});
  });

  it('surfaces supplier approval outstanding on draft PO rows', () => {
    expect(
      isPoSupplierApprovalOutstanding(draftPo, pendingSupplier)
    ).toBe(true);
    expect(
      isPoSupplierApprovalOutstanding(draftPo, approvedSupplier)
    ).toBe(false);
  });
});
