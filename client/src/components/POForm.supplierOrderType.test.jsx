// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const poFormCss = readFileSync(path.resolve(process.cwd(), 'src/components/POForm.css'), 'utf8');

const mocks = vi.hoisted(() => ({
  savePO: vi.fn(),
  requestApproval: vi.fn(),
  supplier: null,
}));

vi.mock('../api', () => ({
  savePO: mocks.savePO,
  updatePO: vi.fn(),
  requestApproval: mocks.requestApproval,
  getActiveBrand: vi.fn().mockResolvedValue(null),
  listSuppliers: vi.fn(async () => mocks.supplier ? [mocks.supplier] : []),
}));

vi.mock('../developments/developmentStore', () => ({
  ensureDevelopmentsReady: vi.fn().mockResolvedValue(undefined),
  listDevelopments: () => [{ id: 'dev-consultant-test', jobNumber: 'DEV-TEST', developmentName: 'Consultant Test Development' }],
}));

vi.mock('./DevelopmentSelect', () => ({
  default: ({ onChange }) => <button type="button" onClick={() => onChange('dev-consultant-test')}>Choose development</button>,
  DevelopmentSelectEmptyState: () => null,
}));

vi.mock('./DevelopmentSummaryCard', () => ({ default: () => <div>Development selected</div> }));

vi.mock('./CostCodeSelect', () => ({
  default: ({ onChange }) => <button type="button" onClick={() => onChange('1100')}>Choose Cost Code</button>,
}));

vi.mock('./SupplierSelect', async () => {
  const { getSuggestedOrderTypeForSupplier } = await import('../suppliers/supplierTypes');
  return {
    default: ({ onChange, onSelectFull, onSuggestedOrderType }) => (
      <button
        type="button"
        onClick={() => {
          const supplier = mocks.supplier;
          onChange({ id: supplier.id, name: supplier.name });
          onSelectFull(supplier);
          onSuggestedOrderType(getSuggestedOrderTypeForSupplier(supplier));
        }}
      >Choose supplier</button>
    ),
  };
});

vi.mock('../commercial/commercialEvents', () => ({ notifyCommercialChanged: vi.fn() }));
vi.mock('../developments/poDevelopmentRefStore', () => ({ savePoDevelopmentRef: vi.fn() }));
vi.mock('../admin/masterDataEvents', () => ({ subscribeMasterDataChanged: () => () => {} }));
vi.mock('../navigation/navigationBuilders', () => ({
  buildProcurementCreateNavigation: () => ({ breadcrumbs: [], contextLabel: '' }),
  buildProcurementEditNavigation: () => ({ breadcrumbs: [], contextLabel: '' }),
}));
vi.mock('./POSaveJourneyPanel', () => ({ default: () => null }));
vi.mock('./POPageHeader', () => ({ default: () => null }));

import POForm from './POForm';

const setValue = (element, value) => {
  const prototype = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('input', { bubbles: true }));
};

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('PO supplier classification and order type', () => {
  let container;
  let root;

  beforeEach(async () => {
    mocks.savePO.mockReset().mockResolvedValue({ poNumber: 'M-TEST-1' });
    mocks.requestApproval.mockReset().mockResolvedValue({ poNumber: 'M-TEST-1' });
    mocks.supplier = {
      id: 'supplier-consultant',
      name: 'Test Architects Ltd',
      supplierType: 'consultant',
      approvedSupplier: true,
      approvalStatus: 'approved',
    };
    window.scrollTo = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<POForm />));
    await settle();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  function button(label) {
    return [...container.querySelectorAll('button')].find((item) => item.textContent.includes(label));
  }

  async function completeRequiredFields(orderType = 'M', expectedSuggestion = 'S') {
    await act(async () => button('Choose supplier').click());
    const orderTypeSelect = [...container.querySelectorAll('select')]
      .find((select) => [...select.options].some((option) => option.textContent === 'Materials'));
    expect(orderTypeSelect.value).toBe(expectedSuggestion);
    await act(async () => setValue(orderTypeSelect, orderType));
    await act(async () => button('Choose development').click());
    await act(async () => button('Choose Cost Code').click());
    const description = container.querySelector('input[placeholder="e.g. C30 concrete"]');
    await act(async () => setValue(description, 'Professional services'));
    return orderTypeSelect;
  }

  it('suggests Subcontract for a consultant but permits a Materials draft', async () => {
    const orderTypeSelect = await completeRequiredFields('M');
    expect([...orderTypeSelect.options].map((option) => option.value)).toEqual(['M', 'S', 'P']);
    await act(async () => {
      button('Save Draft').click();
      await Promise.resolve();
    });
    expect(mocks.savePO).toHaveBeenCalledWith(expect.objectContaining({ type: 'M', supplierId: 'supplier-consultant' }));
  });

  it('allows an approved consultant Materials order to enter approval', async () => {
    await completeRequiredFields('M');
    await act(async () => {
      button('Save & Send for Approval').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.savePO).toHaveBeenCalledWith(expect.objectContaining({ type: 'M' }));
    expect(mocks.requestApproval).toHaveBeenCalledWith('M-TEST-1', expect.any(Object));
  });

  it('keeps pending consultant supplier approval as the send gate', async () => {
    mocks.supplier = { ...mocks.supplier, approvedSupplier: false, approvalStatus: 'pending' };
    await completeRequiredFields('M');
    await act(async () => {
      button('Save & Send for Approval').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.savePO).toHaveBeenCalledWith(expect.objectContaining({ type: 'M' }));
    expect(mocks.requestApproval).not.toHaveBeenCalled();
  });

  it.each(['S', 'P'])('permits a consultant to deliberately select %s', async (orderType) => {
    await completeRequiredFields(orderType);
    await act(async () => {
      button('Save Draft').click();
      await Promise.resolve();
    });
    expect(mocks.savePO).toHaveBeenCalledWith(expect.objectContaining({ type: orderType }));
  });

  it('does not force another supplier classification to its suggested order type', async () => {
    mocks.supplier = {
      ...mocks.supplier,
      id: 'supplier-utility',
      supplierType: 'utility',
    };
    await completeRequiredFields('P', 'M');
    await act(async () => {
      button('Save Draft').click();
      await Promise.resolve();
    });
    expect(mocks.savePO).toHaveBeenCalledWith(expect.objectContaining({ type: 'P' }));
  });

  it('uses a dedicated accessible green action style for Save & Send', () => {
    const send = button('Save & Send for Approval');
    expect(send.classList.contains('po-form-action--send')).toBe(true);
    expect(send.classList.contains('secondary')).toBe(false);
    expect(poFormCss).toContain('.po-form-container .po-form-action--send:hover:not(:disabled)');
    expect(poFormCss).toContain('.po-form-container .po-form-action--send:focus-visible');
    expect(poFormCss).toContain('.po-form-container .po-form-action--send:active:not(:disabled)');
    expect(poFormCss).toContain('.po-form-container .po-form-action--send:disabled');
  });
});
