/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  approveSupplier: vi.fn(),
  createSupplier: vi.fn(),
  listSuppliers: vi.fn(),
  updateSupplier: vi.fn(),
}));
const structure = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => api);
vi.mock('../../admin/commercialStructureService', () => ({ loadCommercialStructure: structure }));
vi.mock('../../admin/masterDataEvents', () => ({ notifyMasterDataChanged: vi.fn() }));

import {
  buildAdminSupplierSavePayload,
  supplierToAdminForm,
} from './adminSupplierForm';
import AdminSuppliersPage from './AdminSuppliersPage';

let container;
let root;
const settle = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});
const button = (label) => [...container.querySelectorAll('button')]
  .find((item) => item.textContent.includes(label));
const field = (label) => [...container.querySelectorAll('label')]
  .find((item) => item.textContent.includes(label))
  ?.querySelector('input, textarea, select');
const setValue = async (element, value) => {
  const prototype = element.tagName === 'TEXTAREA'
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  Object.values(api).forEach((mock) => mock.mockReset());
  structure.mockReset().mockResolvedValue({ heads: [], reportingGroups: [] });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AdminSuppliersPage supplier edit authority', () => {
  it('preserves modern authoritative values and submits only operator changes', () => {
    const initialForm = supplierToAdminForm({
      name: 'Modern Supplier Ltd',
      supplierType: 'consultant',
      termsDays: 45,
      defaultVat: 'Reverse Charge',
      vatStatus: 'VAT Registered',
      approvedSupplier: true,
      approvalStatus: 'approved',
      notes: 'Existing note',
    });
    const form = { ...initialForm, notes: 'Updated note' };

    expect(initialForm).toMatchObject({
      supplierType: 'consultant',
      termsDays: 45,
      defaultVat: 'Reverse Charge',
      vatStatus: 'VAT Registered',
    });
    expect(buildAdminSupplierSavePayload(form, { initialForm, isNew: false })).toEqual({
      notes: 'Updated note',
    });
  });

  it('does not manufacture classification, VAT, or terms defaults for legacy edits', () => {
    const initialForm = supplierToAdminForm({ name: 'Legacy Supplier' });
    const form = { ...initialForm, notes: 'Contact details checked' };

    expect(initialForm).toMatchObject({
      supplierType: '',
      termsDays: '',
      defaultVat: '',
      vatStatus: '',
    });
    expect(buildAdminSupplierSavePayload(form, { initialForm, isNew: false })).toEqual({
      notes: 'Contact details checked',
    });
  });

  it('submits deliberate classification and VAT changes for governed server review', () => {
    const initialForm = supplierToAdminForm({
      name: 'Changed Supplier',
      supplierType: 'subcontractor',
      defaultVat: 'Standard',
      vatStatus: 'VAT Registered',
    });
    const form = {
      ...initialForm,
      supplierType: 'consultant',
      defaultVat: 'Reverse Charge',
    };

    expect(buildAdminSupplierSavePayload(form, { initialForm, isNew: false })).toEqual({
      supplierType: 'consultant',
      defaultVat: 'Reverse Charge',
    });
  });

  it('retains explicit defaults for a newly created pending supplier', () => {
    expect(buildAdminSupplierSavePayload({
      name: 'New Supplier Ltd',
      supplierType: 'subcontractor',
      preferredTrade: '',
      preferredCommercialHead: '',
      termsDays: 30,
      creditAccount: false,
      cisStatus: '',
      insuranceExpiry: '',
      defaultVat: 'Standard',
      vatStatus: 'VAT Registered',
      active: true,
      notes: '',
    }, { isNew: true })).toMatchObject({
      name: 'New Supplier Ltd',
      supplierType: 'subcontractor',
      termsDays: 30,
      defaultVat: 'Standard',
      vatStatus: 'VAT Registered',
    });
  });
});

describe('AdminSuppliersPage rendered save lifecycle', () => {
  it('converges the baseline after save so a later revert is persisted', async () => {
    const original = {
      id: 'supplier-1', name: 'Supplier One', notes: 'Original', supplierType: 'consultant',
      approvalStatus: 'approved', approvedSupplier: true, updatedAt: '2026-10-12T10:00:00.000Z',
    };
    api.listSuppliers.mockResolvedValue([original]);
    api.updateSupplier
      .mockResolvedValueOnce({ ...original, notes: 'First save', updatedAt: '2026-10-12T10:01:00.000Z' })
      .mockResolvedValueOnce({ ...original, notes: 'Original', updatedAt: '2026-10-12T10:02:00.000Z' });

    await act(async () => root.render(<AdminSuppliersPage />));
    await settle();
    await act(async () => button('Supplier One').click());
    await setValue(container.querySelector('textarea'), 'First save');
    await act(async () => { button('Save Supplier').click(); await Promise.resolve(); });
    expect(api.updateSupplier).toHaveBeenNthCalledWith(1, 'supplier-1', { notes: 'First save' });

    await setValue(container.querySelector('textarea'), 'Original');
    await act(async () => { button('Save Supplier').click(); await Promise.resolve(); });
    expect(api.updateSupplier).toHaveBeenNthCalledWith(2, 'supplier-1', { notes: 'Original' });
    expect(container.querySelector('[role="status"]').textContent).toContain('Supplier saved');
  });

  it('creates, selects and then edits the authoritative pending supplier', async () => {
    api.listSuppliers.mockResolvedValue([]);
    const created = {
      id: 'supplier-new', name: 'New Supplier', notes: '', supplierType: 'subcontractor',
      approvalStatus: 'pending', approvedSupplier: false, updatedAt: '2026-10-12T11:00:00.000Z',
    };
    api.createSupplier.mockResolvedValue(created);
    api.updateSupplier.mockResolvedValue({
      ...created, notes: 'After create', updatedAt: '2026-10-12T11:01:00.000Z',
    });

    await act(async () => root.render(<AdminSuppliersPage />));
    await settle();
    await act(async () => button('Add Supplier').click());
    await setValue(field('Supplier Name'), 'New Supplier');
    await act(async () => { button('Save Supplier').click(); await Promise.resolve(); });
    expect(api.createSupplier).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Pending Supplier');

    await setValue(container.querySelector('textarea'), 'After create');
    await act(async () => { button('Save Supplier').click(); await Promise.resolve(); });
    expect(api.updateSupplier).toHaveBeenCalledWith('supplier-new', { notes: 'After create' });
  });

  it('fetches a full supplier when a save response is partial', async () => {
    const before = {
      id: 'supplier-partial', name: 'Partial Supplier', notes: 'Before',
      approvalStatus: 'approved', approvedSupplier: true, updatedAt: '2026-10-12T12:00:00.000Z',
    };
    const after = { ...before, notes: 'After', updatedAt: '2026-10-12T12:01:00.000Z' };
    api.listSuppliers.mockResolvedValueOnce([before]).mockResolvedValueOnce([after]);
    api.updateSupplier.mockResolvedValue({ id: before.id });

    await act(async () => root.render(<AdminSuppliersPage />));
    await settle();
    await act(async () => button('Partial Supplier').click());
    await setValue(container.querySelector('textarea'), 'After');
    await act(async () => { button('Save Supplier').click(); await Promise.resolve(); await Promise.resolve(); });

    expect(api.listSuppliers).toHaveBeenCalledTimes(2);
    expect(container.querySelector('textarea').value).toBe('After');
  });

  it('shows sanitised save and approval failures for contradictory evidence', async () => {
    const contradictory = {
      id: 'supplier-invalid', name: 'Invalid Supplier', approvalStatus: 'approved',
      approvedSupplier: false, updatedAt: '2026-10-12T13:00:00.000Z',
    };
    api.listSuppliers.mockResolvedValue([contradictory]);
    api.updateSupplier.mockRejectedValue(new Error('secret database detail'));
    api.approveSupplier.mockRejectedValue(new Error('secret approval detail'));

    await act(async () => root.render(<AdminSuppliersPage />));
    await settle();
    expect(container.textContent).toContain('Approval evidence requires review');
    await act(async () => button('Invalid Supplier').click());
    await setValue(container.querySelector('textarea'), 'Routine note');
    await act(async () => { button('Save Supplier').click(); await Promise.resolve(); });
    expect(container.querySelector('[role="alert"]').textContent).toContain('could not save');
    expect(container.textContent).not.toContain('secret database detail');

    await act(async () => { button('Approve Supplier').click(); await Promise.resolve(); });
    expect(container.querySelector('[role="alert"]').textContent).toContain('could not approve');
    expect(container.textContent).not.toContain('secret approval detail');
  });
});
