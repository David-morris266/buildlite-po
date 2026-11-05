/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(), overlaps: vi.fn(), allowed: true }));
vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePermission: () => mocks.allowed }));
vi.mock('../api/variationOrders', () => ({ createDirectVariationOrder: mocks.create, listDirectVariationOrderOverlaps: mocks.overlaps }));
vi.mock('../api/variationAccounts', () => ({ listVariationAccount: mocks.list }));
vi.mock('./VariationOrderDrawer', () => ({ default: ({ open, variationOrder }) => open ? <div data-testid="drawer">{variationOrder.description}</div> : null }));
import DirectVariationOrderPanel from './DirectVariationOrderPanel';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function setValue(element, value) {
  const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

async function render() {
  mocks.list.mockResolvedValue([{ id: 'va-1', reference: 'VA-0001', description: 'Previously certified work' }]);
  mocks.overlaps.mockResolvedValue({ records: [{ type: 'variation_account', id: 'va-1', reference: 'VA-0001', description: 'Previously certified work', status: 'active' }] });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<DirectVariationOrderPanel packageId="pkg-1" order={{ developmentId: 'dev-1', poNumber: 'S0004', supplierId: 'supplier-1', costCode: '5105' }} />));
  await act(async () => Promise.resolve());
  return { host, root };
}

describe('DirectVariationOrderPanel', () => {
  afterEach(() => { vi.clearAllMocks(); mocks.allowed = true; document.body.innerHTML = ''; });

  it('requires and submits an explicit independent-work declaration', async () => {
    mocks.create.mockResolvedValue({ id: 'vo-1', description: 'Extra scaffold lift' });
    const { host, root } = await render();
    await act(async () => host.querySelector('button').click());
    const inputs = host.querySelectorAll('input');
    await act(async () => {
      setValue(inputs[0], 'Extra scaffold lift');
      setValue(inputs[1], '750');
      setValue(inputs[2], 'Separate client instruction');
    });
    const create = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Create Draft VO');
    expect(create.disabled).toBe(false);
    await act(async () => create.click());
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      packageId: 'pkg-1', sourcePoNumber: 'S0004',
      directInstruction: { treatment: 'independent', reason: 'Separate client instruction', variationAccountItemId: null, reviewedEvidence: [{ type: 'variation_account', id: 'va-1' }] },
    }));
    expect(host.querySelector('[data-testid="drawer"]').textContent).toBe('Extra scaffold lift');
    await act(async () => root.unmount());
  });

  it('requires a selected VA item when the direct VO reconciles existing evidence', async () => {
    const { host, root } = await render();
    await act(async () => host.querySelector('button').click());
    const inputs = host.querySelectorAll('input');
    const treatment = host.querySelector('select');
    await act(async () => {
      setValue(inputs[0], 'Formal instruction after assessment');
      setValue(inputs[1], '500');
      setValue(inputs[2], 'Replaces assessed VA authority');
      setValue(treatment, 'link_variation_account');
    });
    const create = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Create Draft VO');
    expect(create.disabled).toBe(true);
    await act(async () => setValue(host.querySelectorAll('select')[1], 'va-1'));
    expect(create.disabled).toBe(false);
    await act(async () => root.unmount());
  });
});
