// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VariationOrderDrawer from '../components/VariationOrderDrawer';
import { canCreateVariationOrder, formatVariationOrderReference } from './variationOrderPresentation';
import { createVariationOrderFromCommercialEvent } from '../api/variationOrders';
import { COMMERCIAL_CHANGED } from '../commercial/commercialEvents';

const approved = {
  id: 'ce-1', status: 'approved', eventType: 'variation',
  relationshipType: 'origin', financialTreatment: 'contractAmendment',
};

function vo(status = 'issued') {
  return {
    id: '11111111-1111-1111-1111-111111111111', version: 4, status,
    sourcePoNumber: 'PO-1047', variationOrderNumber: 'VO-0001',
    displayReference: 'PO-1047/VO-0001', supplierLabel: 'Supplier Ltd',
    developmentName: 'Development', description: 'Formal scope',
    vatTreatment: 'inherit', retentionTreatment: 'inherit',
    sourceCommercialEvents: [{ id: 'ce-1', eventNumber: 'CE-0001' }],
    lines: [{ id: 'line-1', costCode: '5218', description: 'Works', netValue: 1200 }],
    totalNetValue: 1200,
    audit: [{ id: 'a1', action: 'approve', actor: 'CM', createdAt: '2026-08-28T10:00:00Z' }, { id: 'a2', action: 'issue', actor: 'CM', createdAt: '2026-08-28T10:00:01Z' }],
  };
}

describe('Variation Order CE workflow', () => {
  let container;
  let root;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); localStorage.setItem('userName', 'Test QS'); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); localStorage.clear(); });

  it('allows only eligible approved contract-value CEs', () => {
    expect(canCreateVariationOrder(approved)).toBe(true);
    for (const status of ['draft', 'submitted', 'rejected']) expect(canCreateVariationOrder({ ...approved, status })).toBe(false);
    expect(canCreateVariationOrder({ ...approved, eventType: 'budgetTransfer' })).toBe(false);
    expect(canCreateVariationOrder({ ...approved, relationshipType: 'recovery' })).toBe(false);
    expect(canCreateVariationOrder({ ...approved, eventType: 'other' })).toBe(false);
  });

  it('uses the deterministic PO/VO display reference and presents issued VO read-only', async () => {
    expect(formatVariationOrderReference(vo())).toBe('PO-1047/VO-0001');
    await act(async () => root.render(<VariationOrderDrawer open variationOrder={vo()} onClose={() => {}} />));
    expect(container.textContent).toContain('Variation Order / Formal Instruction');
    expect(container.textContent).toContain('PO-1047/VO-0001');
    expect(container.textContent).toContain('CE-0001');
    expect(container.textContent).toContain('approve');
    expect(container.textContent).toContain('issue');
    expect(container.textContent).not.toContain('Save Draft');
    expect([...container.querySelectorAll('input,textarea')].every((input) => input.disabled)).toBe(true);
    expect(container.textContent).toContain('Print / Save PDF');
    expect(container.querySelector('.vo-lines-table__cost')).not.toBeNull();
    expect(container.querySelector('.vo-lines-table__description')).not.toBeNull();
    expect(container.querySelector('.vo-lines-table__value')).not.toBeNull();
    const printDocument = container.querySelector('.vo-print-document');
    expect(printDocument.textContent).toContain('VARIATION ORDER / FORMAL INSTRUCTION');
    expect(printDocument.textContent).toContain('You are instructed to carry out the following variation');
    expect(printDocument.textContent).toContain('£1,200');
    expect(printDocument.textContent).toContain('amends and does not replace');
    expect(printDocument.textContent).not.toContain('Audit history');
    expect(printDocument.querySelectorAll('button,input,textarea,select')).toHaveLength(0);
  });

  it('notifies package/CVR readers after Approve & Issue', async () => {
    const changed = vi.fn();
    window.addEventListener(COMMERCIAL_CHANGED, changed);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(vo('issued')) }));
    await act(async () => root.render(<VariationOrderDrawer open variationOrder={vo('submitted')} onClose={() => {}} />));
    await act(async () => container.querySelector('.po-btn-primary').click());
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0][0].detail).toMatchObject({ source: 'variation-order', status: 'issued' });
    window.removeEventListener(COMMERCIAL_CHANGED, changed);
  });

  it.each(['draft', 'submitted'])('does not offer formal printing while %s', async (status) => {
    await act(async () => root.render(<VariationOrderDrawer open variationOrder={vo(status)} onClose={() => {}} />));
    expect(container.textContent).not.toContain('Print / Save PDF');
    expect(container.querySelector('.vo-print-document')).toBeNull();
  });

  it('sends the session actor when creating from a CE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(vo('draft')) }));
    await createVariationOrderFromCommercialEvent('ce-1');
    const [, options] = fetch.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body).actor).toBe('Test QS');
  });

  it('CE drawer exposes create and linked-VO actions', async () => {
    const source = await import('../components/CommercialEventDrawer.jsx?raw');
    expect(String(source.default)).toContain('Create Variation Order');
    expect(String(source.default)).toContain('Open Variation Order');
    expect(String(source.default)).toContain('variationOrderStatusLabel');
  });
});
