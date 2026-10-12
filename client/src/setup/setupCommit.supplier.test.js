import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createOrGetSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  approveSupplier: vi.fn(),
}));

vi.mock('../api', () => ({
  createOrGetSupplier: api.createOrGetSupplier,
  updateSupplier: api.updateSupplier,
  approveSupplier: api.approveSupplier,
}));

const storage = new Map();
vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import { commitSupplierSection } from './setupCommit';

const supplierDraft = {
  name: 'Setup Consultant Ltd',
  addressLine1: '1 Test Street',
  town: 'Testford',
  postcode: 'TE1 1ST',
  vatNumber: 'GB123456789',
  termsDays: 30,
};

describe('governed supplier onboarding', () => {
  beforeEach(() => {
    storage.clear();
    api.createOrGetSupplier.mockReset();
    api.updateSupplier.mockReset();
    api.approveSupplier.mockReset();
    api.updateSupplier.mockImplementation(async (id, payload) => ({ id, ...payload, approvalStatus: 'pending' }));
  });

  it('does not complete setup when the operator lacks supplier approval authority', async () => {
    api.createOrGetSupplier.mockResolvedValue({ id: 'sup-pending', name: supplierDraft.name, approvalStatus: 'pending' });
    api.approveSupplier.mockRejectedValue(new Error('Permission required: po.approve or tenant.configure'));

    await expect(commitSupplierSection(supplierDraft)).rejects.toThrow(/permission required/i);
    expect(api.createOrGetSupplier).toHaveBeenCalledTimes(1);
    expect(api.approveSupplier).toHaveBeenCalledWith('sup-pending', expect.any(Object));
  });

  it('reuses a Pending supplier and completes after an authorised retry', async () => {
    const pending = { id: 'sup-pending', name: supplierDraft.name, approvalStatus: 'pending' };
    api.createOrGetSupplier.mockResolvedValue(pending);
    api.approveSupplier
      .mockRejectedValueOnce(new Error('Permission required: po.approve or tenant.configure'))
      .mockResolvedValueOnce({ ...pending, approvalStatus: 'approved', approvedSupplier: true });

    await expect(commitSupplierSection(supplierDraft)).rejects.toThrow(/permission required/i);
    const result = await commitSupplierSection(supplierDraft);

    expect(result.ok).toBe(true);
    expect(result.supplier.approvalStatus).toBe('approved');
    expect(api.createOrGetSupplier).toHaveBeenCalledTimes(2);
    expect(api.updateSupplier).toHaveBeenCalledTimes(2);
    expect(api.approveSupplier).toHaveBeenCalledTimes(2);
  });

  it('reconciles changed identity details before approving a retry', async () => {
    api.createOrGetSupplier.mockResolvedValue({
      id: 'sup-existing',
      name: supplierDraft.name,
      vatNumber: 'GB000000000',
      approvalStatus: 'pending',
    });
    api.approveSupplier.mockResolvedValue({
      id: 'sup-existing',
      ...supplierDraft,
      approvalStatus: 'approved',
      approvedSupplier: true,
    });

    await commitSupplierSection(supplierDraft);

    expect(api.updateSupplier).toHaveBeenCalledWith('sup-existing', expect.objectContaining({
      vatNumber: 'GB123456789',
      address1: '1 Test Street',
    }));
    expect(api.updateSupplier.mock.invocationCallOrder[0])
      .toBeLessThan(api.approveSupplier.mock.invocationCallOrder[0]);
  });

  it('does not treat a supplied supplier id as approval authority', async () => {
    api.approveSupplier.mockResolvedValue({
      id: 'sup-selected',
      ...supplierDraft,
      approvalStatus: 'approved',
      approvedSupplier: true,
    });

    await commitSupplierSection({ ...supplierDraft, supplierId: 'sup-selected' });

    expect(api.createOrGetSupplier).not.toHaveBeenCalled();
    expect(api.updateSupplier).toHaveBeenCalledWith('sup-selected', expect.objectContaining({
      vatNumber: supplierDraft.vatNumber,
    }));
    expect(api.approveSupplier).toHaveBeenCalledWith('sup-selected', expect.any(Object));
  });
});
